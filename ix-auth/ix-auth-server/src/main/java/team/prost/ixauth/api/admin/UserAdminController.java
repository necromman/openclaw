package team.prost.ixauth.api.admin;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import team.prost.ixauth.authz.AuthzService;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ApiResponse;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.domain.User;
import team.prost.ixauth.domain.UserStatus;
import team.prost.ixauth.api.dto.AuthDtos;
import team.prost.ixauth.repository.SessionRepository;
import team.prost.ixauth.security.JwtService;
import team.prost.ixauth.service.BulkUserImportService;
import team.prost.ixauth.service.UserAdminService;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/admin/users")
@RequiredArgsConstructor
public class UserAdminController {

    private final UserAdminService service;
    private final AuthzService authzService;
    private final SessionRepository sessionRepository;
    private final AdminGuard guard;
    private final team.prost.ixauth.service.AccountService accountService;
    private final team.prost.ixauth.service.MfaService mfaService;
    private final BulkUserImportService bulkImportService;
    private final team.prost.ixauth.service.ImpersonationService impersonationService;
    private final team.prost.ixauth.common.ClientInfo clientInfo;
    private final ObjectMapper objectMapper;

    /**
     * @param password 비우면 초대 방식이다 — 계정은 PENDING 으로 만들어지고
     *                 본인이 링크로 비밀번호를 정한다
     * @param invite   true 면 만든 즉시 초대 메일을 보낸다
     */
    public record CreateRequest(@NotBlank @Email String email, @NotBlank String name,
                                String password, List<String> roles, Boolean invite,
                                Map<String, Object> attributes) {
    }

    /**
     * 일괄 등록의 JSON 형태.
     *
     * <p>{@code invite} 를 끌 수 있게 둔 이유 — 이관 작업으로 수백 개를 넣을 때 그
     * 순간 수백 통이 나가면 안 되는 경우가 있다(주소가 아직 유효하지 않거나, 안내를
     * 따로 하기로 한 경우). 기본은 켬이다. 초대를 보내지 않으면 그 계정은
     * {@code PENDING} 인 채로 아무도 들어올 수 없으므로, 끄는 것은 의식적인 선택이어야 한다.</p>
     */
    public record BulkRequest(List<BulkUser> users, Boolean invite) {
    }

    public record BulkUser(String email, String name, List<String> roles,
                           Map<String, Object> attributes) {
    }

    public record UpdateRequest(String name, UserStatus status, Map<String, Object> attributes) {
    }

    public record PasswordResetRequest(@NotBlank String password) {
    }

    public record RolesRequest(List<String> roles) {
    }

    public record UserView(String id, String email, String name, String status,
                           int failedCount, Instant lockedUntil, Instant lastLoginAt,
                           List<String> roles, List<String> groups,
                           Map<String, Object> attributes, Instant createdAt) {
    }

    /**
     * @param role 역할 코드로 거른다. 직접 부여분과 그룹 경유분을 모두 본다 —
     *             응답의 {@code roles} 와 같은 기준이다 (계약: http-api.md §4).
     *             없는 코드면 빈 목록이고 400 이 아니다 — 역할은 런타임에 지워질 수 있어서다.
     *             <b>선언 자체가 이 필터의 핵심이다</b>: 없으면 Spring MVC 가 조용히 버려
     *             호출자가 오류 없이 잘못된 목록을 받는다 (2026-08-20 늘봄 PoC 실측)
     */
    @GetMapping
    public ApiResponse<ApiResponse.PageData<UserView>> list(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) UserStatus status,
            @RequestParam(required = false) String role,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        guard.require(AdminGuard.USERS_READ);

        int capped = Math.min(size, 100);
        var result = service.search(q, status, role,
                PageRequest.of(page, capped, Sort.by(Sort.Direction.DESC, "createdAt")));
        var items = result.getContent().stream().map(this::toView).toList();
        return ApiResponse.ok(new ApiResponse.PageData<>(items, page, capped, result.getTotalElements()));
    }

    @GetMapping("/{id}")
    public ApiResponse<UserView> get(@PathVariable Long id) {
        guard.require(AdminGuard.USERS_READ);
        return ApiResponse.ok(toView(service.get(id)));
    }

    /**
     * 한 사람의 지금 상태를 한 번에 — 역할·그룹 · 활성 세션 · 소셜 연결 · 2단계 · 약관 ·
     * 최근 감사 로그 10건 (G22).
     *
     * <p>목록만 있으면 "이 사람이 왜 못 들어오는가" 에 답하려고 탭을 번갈아 열게 되고,
     * 그러다 정작 원인을 놓친다. <b>시크릿은 하나도 담기지 않는다</b> — 2단계는
     * "걸려 있는가 · 백업 코드가 몇 개 남았는가" 까지다.</p>
     */
    @GetMapping("/{id}/detail")
    public ApiResponse<Map<String, Object>> detail(@PathVariable Long id) {
        guard.require(AdminGuard.USERS_READ);
        return ApiResponse.ok(service.detail(id));
    }

    @PostMapping
    public ApiResponse<UserView> create(@Valid @RequestBody CreateRequest req) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        var user = service.create(req.email(), req.name(), req.password(), req.roles(),
                req.attributes(), actor.userId());
        // 비밀번호 없이 만들었으면 초대 없이는 그 계정으로 들어올 방법이 없다
        boolean invite = Boolean.TRUE.equals(req.invite())
                || req.password() == null || req.password().isBlank();
        if (invite) {
            accountService.sendInvite(user.getId(), actor.name(), actor.userId(), null, null);
        }
        return ApiResponse.ok(toView(user));
    }

    /**
     * 일괄 등록 — CSV 본문 또는 JSON.
     *
     * <p><b>한 줄이 틀렸다고 전체가 실패하지 않는다.</b> 행마다 결과를 돌려주고,
     * 성공한 것은 그대로 남는다. 300명 명단에서 이메일 하나가 잘못됐다고 299명이 안
     * 들어가면 관리자는 고쳐서 통째로 다시 올려야 하고, 그러면 이미 들어간 계정이
     * 중복 오류를 낸다.</p>
     *
     * <p>CSV 는 {@code email,name,roles} 세 칸이다. 역할이 여럿이면
     * {@code "ADMIN,USER"} 처럼 따옴표로 감싸거나 {@code ADMIN;USER} 로 적는다.</p>
     *
     * <p>비밀번호는 만들지 않는다 — 수백 명에게 비밀번호를 안전하게 전달할 경로가
     * 없다. 초대 링크로 본인이 정하게 한다(기존 초대 흐름 그대로).</p>
     */
    @PostMapping(value = "/bulk", consumes = {"text/csv", "text/plain"})
    public ApiResponse<BulkUserImportService.Summary> bulkCsv(
            @RequestBody String csv,
            @RequestParam(defaultValue = "true") boolean invite) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        return ApiResponse.ok(bulkImportService.importRows(
                BulkUserImportService.parseCsv(csv), invite,
                new BulkUserImportService.Actor(actor.userId(), actor.name())));
    }

    /** JSON 형태 — 배열({@code [{…}]})과 객체({@code {"users":[…]}}) 둘 다 받는다 */
    @PostMapping(value = "/bulk", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ApiResponse<BulkUserImportService.Summary> bulkJson(@RequestBody JsonNode body) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        var request = toBulkRequest(body);
        var rows = new java.util.ArrayList<BulkUserImportService.Row>();
        var users = request.users() == null ? List.<BulkUser>of() : request.users();
        for (int i = 0; i < users.size(); i++) {
            var u = users.get(i);
            rows.add(new BulkUserImportService.Row(i + 1, u.email(), u.name(), u.roles(),
                    u.attributes() == null ? Map.of() : u.attributes()));
        }
        boolean invite = request.invite() == null || request.invite();
        return ApiResponse.ok(bulkImportService.importRows(rows, invite,
                new BulkUserImportService.Actor(actor.userId(), actor.name())));
    }

    /**
     * 배열로 온 것을 객체 형태로 맞춘다.
     *
     * <p>둘 다 받는 이유 — 스크립트로 만드는 쪽은 배열이 자연스럽고, 옵션({@code invite})을
     * 함께 보내려면 객체여야 한다. 하나만 받으면 나머지 절반이 400 을 보고 이유를 찾는다.</p>
     */
    private BulkRequest toBulkRequest(JsonNode body) {
        if (body == null || body.isNull()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "본문이 비었습니다.");
        }
        try {
            if (body.isArray()) {
                return new BulkRequest(
                        List.of(objectMapper.treeToValue(body, BulkUser[].class)), null);
            }
            return objectMapper.treeToValue(body, BulkRequest.class);
        } catch (Exception e) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "본문 형식이 올바르지 않습니다. email·name·roles 를 가진 배열 또는 "
                            + "{\"users\": [...]} 객체여야 합니다.");
        }
    }

    @PatchMapping("/{id}")
    public ApiResponse<UserView> update(@PathVariable Long id, @RequestBody UpdateRequest req) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        return ApiResponse.ok(toView(
                service.update(id, req.name(), req.status(), req.attributes(), actor.userId())));
    }

    /** 소프트 삭제 — status=DISABLED + 세션 폐기 */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> disable(@PathVariable Long id) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        service.disable(id, actor.userId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/password-reset")
    public ResponseEntity<Void> resetPassword(@PathVariable Long id,
                                              @Valid @RequestBody PasswordResetRequest req) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        service.resetPassword(id, req.password(), actor.userId());
        return ResponseEntity.noContent().build();
    }

    /**
     * 초대 메일을 보낸다.
     *
     * <p>{@code password-reset} 과 다르다. 저쪽은 관리자가 비밀번호를 정해서
     * 따로 알려 줘야 하고, 그 전달 경로(메신저·구두)가 대개 가장 약한 고리다.
     * 초대는 본인만 열 수 있는 링크를 보내 <b>본인이 직접</b> 정하게 한다.</p>
     */
    @PostMapping("/{id}/invite")
    public ResponseEntity<Void> invite(@PathVariable Long id) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        accountService.sendInvite(id, actor.name(), actor.userId(), null, null);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/unlock")
    public ResponseEntity<Void> unlock(@PathVariable Long id) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        service.unlock(id, actor.userId());
        return ResponseEntity.noContent().build();
    }

    /**
     * 2단계 인증 초기화 — 휴대폰과 백업 코드를 <b>모두</b> 잃은 사람의 복구 경로.
     *
     * <p>이 API 가 없으면 남는 수단은 DB 직접 수정뿐이고, 그쪽은 흔적이 남지 않아
     * 오히려 위험하다. 그래서 열되 <b>감사 로그와 본인 통지 메일이 반드시 따라붙는다</b>
     * — 관리자가 조용히 남의 2단계를 끄는 일이 없어야 한다.</p>
     *
     * <p>{@code ixauth.mfa.admin-reset} 을 끄면 403 이다.</p>
     */
    @PostMapping("/{id}/mfa-reset")
    public ApiResponse<Map<String, Object>> resetMfa(@PathVariable Long id) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        boolean had = mfaService.resetByAdmin(id, actor.userId(), null, null);
        return ApiResponse.ok(Map.of("reset", had));
    }

    @PutMapping("/{id}/roles")
    public ApiResponse<UserView> replaceRoles(@PathVariable Long id, @RequestBody RolesRequest req) {
        var actor = guard.require(AdminGuard.ROLES_WRITE);
        service.replaceRoles(id, req.roles(), actor.userId());
        return ApiResponse.ok(toView(service.get(id)));
    }

    /**
     * 사용자 대리 시작 — 대상 사용자의 토큰을 받는다 (GitLab 의 impersonation 과 같은 것).
     *
     * <p>답하려는 질문은 하나다: <b>"저는 그 화면이 안 나와요" 를 어떻게 재현하는가.</b>
     * 대안은 그 사람의 비밀번호를 초기화하고 로그인해 보는 것인데, 그건 사용자를 실제로
     * 쫓아내고 감사 로그에 <b>본인 로그인</b>으로 남는다. 대리가 오히려 흔적이 정확하다.</p>
     *
     * <p>응답은 로그인과 같은 봉투이고, access token 에는 표준 {@code act} 클레임으로
     * 관리자가 실린다. 앱은 그것으로 "누가 대리 중인지" 를 화면에 띄운다.</p>
     *
     * <p><b>전용 권한 {@code ixauth:impersonation:create} 를 쓴다.</b>
     * {@code ixauth:users:write} 를 재사용하지 않는 이유 — 사용자를 고치는 것과 사용자가
     * 되는 것은 다른 일이고, 후자는 그 사람 이름으로 흔적을 남긴다.</p>
     *
     * <p>대상이 {@code ACTIVE} 가 아니면 409, 자기 자신이면 400 이다.
     * 대리 세션으로는 이 API 를 다시 부를 수 없다 — {@link AdminGuard#principal()} 가 막는다.</p>
     */
    @PostMapping("/{id}/impersonate")
    public ApiResponse<AuthDtos.ImpersonateResponse> impersonate(
            @PathVariable Long id,
            @RequestBody(required = false) AuthDtos.ImpersonateRequest req) {
        var actor = guard.require(AdminGuard.IMPERSONATION_CREATE);

        String ip = clientInfo.ip(req == null ? null : req.ip());
        String userAgent = clientInfo.userAgent(req == null ? null : req.userAgent());

        var result = impersonationService.start(id,
                new JwtService.Actor(actor.userId(), actor.email()), userAgent, ip);

        return ApiResponse.ok(new AuthDtos.ImpersonateResponse(
                result.accessToken(), result.refreshToken(), result.expiresIn(),
                new AuthDtos.UserSummary(String.valueOf(result.userId()), result.email(),
                        result.name(), result.roles(), result.groups()),
                new AuthDtos.ActorSummary(String.valueOf(actor.userId()), actor.email(),
                        actor.name())));
    }

    @GetMapping("/{id}/sessions")
    public ApiResponse<List<Map<String, Object>>> sessions(@PathVariable Long id) {
        guard.require(AdminGuard.USERS_READ);
        var now = Instant.now();
        var list = sessionRepository.findByUserIdOrderByIssuedAtDesc(id).stream()
                .<Map<String, Object>>map(s -> {
                    var m = new java.util.LinkedHashMap<String, Object>();
                    m.put("id", s.getId().toString());
                    m.put("issuedAt", s.getIssuedAt());
                    m.put("expiresAt", s.getExpiresAt());
                    m.put("revokedAt", s.getRevokedAt());
                    m.put("lastUsedAt", s.getLastUsedAt());
                    m.put("ip", s.getIp());
                    m.put("userAgent", s.getUserAgent());
                    // 원문만 있으면 관리자도 "이게 무슨 기기냐" 를 판단할 수 없다.
                    // 본인 세션 목록(/auth/sessions)과 같은 표기를 쓴다
                    m.put("deviceLabel", team.prost.ixauth.common.DeviceLabel.of(s.getUserAgent()));
                    m.put("active", s.isUsable(now));
                    // 대리 세션도 여기 그대로 보이고 같은 방법으로 끊긴다. 다만 구분이
                    // 없으면 관리자는 사용자가 낯선 기기에서 접속한 것으로 읽는다
                    m.put("impersonated", s.isImpersonated());
                    if (s.isImpersonated()) {
                        m.put("impersonatorId", String.valueOf(s.getImpersonatorId()));
                        m.put("impersonatorEmail", s.getImpersonatorEmail());
                    }
                    return m;
                })
                .toList();
        return ApiResponse.ok(list);
    }

    /** 강제 로그아웃 */
    @DeleteMapping("/{id}/sessions")
    public ApiResponse<Map<String, Object>> revokeSessions(@PathVariable Long id) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        int revoked = service.revokeSessions(id, actor.userId());
        return ApiResponse.ok(Map.of("revoked", revoked));
    }

    private UserView toView(User u) {
        return new UserView(String.valueOf(u.getId()), u.getEmail(), u.getName(),
                u.getStatus().name(), u.getFailedCount(), u.getLockedUntil(), u.getLastLoginAt(),
                authzService.effectiveRoleCodes(u.getId()), authzService.groupCodes(u.getId()),
                u.getAttributes(), u.getCreatedAt());
    }
}
