package team.prost.ixauth.api.admin;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import team.prost.ixauth.common.ApiResponse;
import team.prost.ixauth.repository.AuditLogRepository;
import team.prost.ixauth.service.AccessAdminService;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** 역할 · 권한 · 그룹 · 감사로그 관리. */
@RestController
@RequestMapping("/admin")
@RequiredArgsConstructor
public class AccessAdminController {

    private final AccessAdminService service;
    private final team.prost.ixauth.service.ResourceGrantAdminService grantService;
    private final AuditLogRepository auditLogRepository;
    private final AdminGuard guard;
    private final team.prost.ixauth.repository.ResourceTypeRepository resourceTypeRepository;
    private final team.prost.ixauth.service.AuditService auditService;
    private final team.prost.ixauth.authz.ResourceAuthzService resourceAuthzService;

    public record CodeRequest(@NotBlank String code, @NotBlank String name, String description) {
    }

    public record PermissionRequest(@NotBlank String code, String description) {
    }

    public record CodesRequest(List<String> codes) {
    }

    public record MemberRequest(Long userId) {
    }

    // ── 권한 ──

    @GetMapping("/permissions")
    public ApiResponse<List<Map<String, Object>>> listPermissions() {
        guard.require(AdminGuard.ROLES_READ);
        var items = service.listPermissions().stream()
                .<Map<String, Object>>map(p -> Map.of(
                        "id", p.getId(), "code", p.getCode(), "domain", p.getDomain(),
                        "resource", p.getResource(), "action", p.getAction(),
                        "description", p.getDescription() == null ? "" : p.getDescription()))
                .toList();
        return ApiResponse.ok(items);
    }

    @PostMapping("/permissions")
    public ApiResponse<Map<String, Object>> createPermission(@Valid @RequestBody PermissionRequest req) {
        var actor = guard.require(AdminGuard.ROLES_WRITE);
        var p = service.createPermission(req.code(), req.description(), actor.userId());
        return ApiResponse.ok(Map.of("id", p.getId(), "code", p.getCode()));
    }

    @DeleteMapping("/permissions/{id}")
    public ResponseEntity<Void> deletePermission(@PathVariable Long id) {
        var actor = guard.require(AdminGuard.ROLES_WRITE);
        service.deletePermission(id, actor.userId());
        return ResponseEntity.noContent().build();
    }

    // ── 역할 ──

    @GetMapping("/roles")
    public ApiResponse<List<Map<String, Object>>> listRoles() {
        guard.require(AdminGuard.ROLES_READ);
        var items = service.listRoles().stream()
                .<Map<String, Object>>map(r -> Map.of(
                        "id", r.getId(), "code", r.getCode(), "name", r.getName(),
                        "system", r.isSystem(),
                        "permissions", r.getPermissions().stream().map(p -> p.getCode()).sorted().toList()))
                .toList();
        return ApiResponse.ok(items);
    }

    @PostMapping("/roles")
    public ApiResponse<Map<String, Object>> createRole(@Valid @RequestBody CodeRequest req) {
        var actor = guard.require(AdminGuard.ROLES_WRITE);
        var role = service.createRole(req.code(), req.name(), req.description(), actor.userId());
        return ApiResponse.ok(Map.of("id", role.getId(), "code", role.getCode()));
    }

    @DeleteMapping("/roles/{id}")
    public ResponseEntity<Void> deleteRole(@PathVariable Long id) {
        var actor = guard.require(AdminGuard.ROLES_WRITE);
        service.deleteRole(id, actor.userId());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/roles/{id}/permissions")
    public ApiResponse<List<String>> rolePermissions(@PathVariable Long id) {
        guard.require(AdminGuard.ROLES_READ);
        return ApiResponse.ok(service.getRole(id).getPermissions().stream()
                .map(p -> p.getCode()).sorted().toList());
    }

    @PutMapping("/roles/{id}/permissions")
    public ApiResponse<List<String>> replaceRolePermissions(@PathVariable Long id,
                                                            @RequestBody CodesRequest req) {
        var actor = guard.require(AdminGuard.ROLES_WRITE);
        var role = service.replaceRolePermissions(id, req.codes(), actor.userId());
        return ApiResponse.ok(role.getPermissions().stream().map(p -> p.getCode()).sorted().toList());
    }

    // ── 그룹 ──

    @GetMapping("/groups")
    public ApiResponse<List<Map<String, Object>>> listGroups() {
        guard.require(AdminGuard.ROLES_READ);
        var items = service.listGroups().stream()
                .<Map<String, Object>>map(g -> Map.of(
                        "id", g.getId(), "code", g.getCode(), "name", g.getName(),
                        "roles", g.getRoles().stream().map(r -> r.getCode()).sorted().toList()))
                .toList();
        return ApiResponse.ok(items);
    }

    @PostMapping("/groups")
    public ApiResponse<Map<String, Object>> createGroup(@Valid @RequestBody CodeRequest req) {
        var actor = guard.require(AdminGuard.ROLES_WRITE);
        var g = service.createGroup(req.code(), req.name(), req.description(), actor.userId());
        return ApiResponse.ok(Map.of("id", g.getId(), "code", g.getCode()));
    }

    @DeleteMapping("/groups/{id}")
    public ResponseEntity<Void> deleteGroup(@PathVariable Long id) {
        var actor = guard.require(AdminGuard.ROLES_WRITE);
        service.deleteGroup(id, actor.userId());
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/groups/{id}/roles")
    public ApiResponse<List<String>> replaceGroupRoles(@PathVariable Long id,
                                                       @RequestBody CodesRequest req) {
        var actor = guard.require(AdminGuard.ROLES_WRITE);
        var g = service.replaceGroupRoles(id, req.codes(), actor.userId());
        return ApiResponse.ok(g.getRoles().stream().map(r -> r.getCode()).sorted().toList());
    }

    /**
     * 그룹 구성원 목록. 계약 표의 {@code GET /admin/groups/{id}/members}.
     *
     * <p>OPENCLAW-FORK-DELTA: 원본 컨트롤러에는 POST·DELETE 만 있어 GET 이 405 였다.
     * 비밀 없이 신원 네 칸만 준다. 화면이 부서를 비웠는지 확인하는 데 그 이상은 필요 없다.</p>
     */
    @GetMapping("/groups/{id}/members")
    public ApiResponse<List<Map<String, Object>>> listMembers(@PathVariable Long id) {
        guard.require(AdminGuard.ROLES_READ);
        return ApiResponse.ok(service.listMembers(id).stream()
                .<Map<String, Object>>map(u -> Map.of(
                        "id", u.getId(), "email", u.getEmail(), "name", u.getName(),
                        "status", u.getStatus().name()))
                .toList());
    }

    @PostMapping("/groups/{id}/members")
    public ResponseEntity<Void> addMember(@PathVariable Long id, @RequestBody MemberRequest req) {
        var actor = guard.require(AdminGuard.ROLES_WRITE);
        service.addMember(id, req.userId(), actor.userId());
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/groups/{id}/members/{userId}")
    public ResponseEntity<Void> removeMember(@PathVariable Long id, @PathVariable Long userId) {
        var actor = guard.require(AdminGuard.ROLES_WRITE);
        service.removeMember(id, userId, actor.userId());
        return ResponseEntity.noContent().build();
    }

    // ── 리소스 인스턴스 권한 (L2) ──

    public record GrantRequest(String subjectType, Long subjectId, String resourceType,
                               String resourceKey, String action, String effect,
                               Instant expiresAt) {
    }

    /**
     * 등록된 리소스 종류 — 화면이 목록으로 고르게 한다.
     *
     * <p>자유 입력이면 {@code file} 로 부여하고 {@code files} 로 물어 조용히
     * 권한이 없는 상태가 된다. 그 결과는 "권한 없음" 과 구분되지 않는다.</p>
     */
    @GetMapping("/resource-types")
    public ApiResponse<List<Map<String, Object>>> resourceTypes() {
        guard.require(AdminGuard.ROLES_READ);
        return ApiResponse.ok(resourceTypeRepository.findAllByOrderByCodeAsc().stream()
                .<Map<String, Object>>map(rt -> {
                    var m = new java.util.LinkedHashMap<String, Object>();
                    m.put("code", rt.getCode());
                    m.put("name", rt.getName());
                    m.put("keyFormat", rt.getKeyFormat().name());
                    m.put("caseSensitive", rt.isCaseSensitive());
                    m.put("delegated", rt.isDelegated());
                    m.put("description", rt.getDescription());
                    return m;
                }).toList());
    }

    public record ResourceTypeRequest(String code, String name, String keyFormat,
                                      Boolean caseSensitive, Boolean delegated,
                                      String description) {
    }

    @PostMapping("/resource-types")
    public ApiResponse<Map<String, Object>> upsertResourceType(
            @RequestBody ResourceTypeRequest req) {
        var actor = guard.require(AdminGuard.ROLES_WRITE);
        if (req.code() == null || req.code().isBlank()) {
            throw new team.prost.ixauth.common.ApiException(
                    team.prost.ixauth.common.ErrorCode.VALIDATION_FAILED, "코드가 비었습니다.");
        }
        var rt = resourceTypeRepository.findById(req.code().trim())
                .orElseGet(() -> new team.prost.ixauth.domain.ResourceType(
                        req.code().trim(), req.code().trim(),
                        team.prost.ixauth.domain.ResourceType.KeyFormat.PATH));
        if (req.name() != null && !req.name().isBlank()) {
            rt.setName(req.name().trim());
        }
        if (req.keyFormat() != null && !req.keyFormat().isBlank()) {
            rt.setKeyFormat(team.prost.ixauth.domain.ResourceType.KeyFormat
                    .valueOf(req.keyFormat().toUpperCase(java.util.Locale.ROOT)));
        }
        if (req.caseSensitive() != null) {
            rt.setCaseSensitive(req.caseSensitive());
        }
        if (req.delegated() != null) {
            rt.setDelegated(req.delegated());
        }
        rt.setDescription(req.description());
        resourceTypeRepository.save(rt);

        auditService.record("RESOURCE_TYPE_CHANGED", null, actor.userId(), null, null,
                Map.of("code", rt.getCode(), "keyFormat", rt.getKeyFormat().name(),
                        "delegated", rt.isDelegated()));
        return ApiResponse.ok(Map.of("code", rt.getCode()));
    }

    @GetMapping("/resource-grants")
    public ApiResponse<ApiResponse.PageData<Map<String, Object>>> listGrants(
            @RequestParam(required = false) String resourceType,
            @RequestParam(required = false) String subjectType,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        guard.require(AdminGuard.ROLES_READ);

        int capped = Math.min(size, 100);
        var result = grantService.search(resourceType, subjectType, PageRequest.of(page, capped));
        var items = result.getContent().stream()
                .<Map<String, Object>>map(g -> {
                    var m = new java.util.LinkedHashMap<String, Object>();
                    m.put("id", g.getId());
                    m.put("subject", g.getSubjectType() + ":" + g.getSubjectId());
                    m.put("resourceType", g.getResourceType());
                    m.put("resourceKey", g.getResourceKey());
                    m.put("action", g.getAction());
                    m.put("effect", g.getEffect());
                    m.put("expiresAt", g.getExpiresAt());
                    return m;
                })
                .toList();
        return ApiResponse.ok(new ApiResponse.PageData<>(items, page, capped, result.getTotalElements()));
    }

    @PostMapping("/resource-grants")
    public ApiResponse<Map<String, Object>> createGrant(@RequestBody GrantRequest req) {
        var actor = guard.require(AdminGuard.ROLES_WRITE);
        var g = grantService.grant(req.subjectType(), req.subjectId(), req.resourceType(),
                req.resourceKey(), req.action(), req.effect(), req.expiresAt(), actor.userId());
        return ApiResponse.ok(Map.of("id", g.getId(), "effect", g.getEffect()));
    }

    /**
     * 관리 화면의 판정 시험.
     *
     * <p>{@code /authz/check} 와 같은 판정을 하지만 <b>인증 방식이 다르다</b> —
     * 저쪽은 앱→jar 서비스 키 전용이고, 여기는 관리자 토큰이다. 관리자가 앱 서비스 키를
     * 들고 있을 이유가 없고, 반대로 {@code /authz/**} 를 관리자에게 열면 경계가 흐려진다.</p>
     */
    @PostMapping("/resource-grants/check")
    public ApiResponse<Map<String, Object>> checkGrant(@RequestBody CheckProbe req) {
        guard.require(AdminGuard.ROLES_READ);
        var d = resourceAuthzService.check(req.userId(), req.resourceType(),
                req.resourceKey(), req.action());

        var m = new java.util.LinkedHashMap<String, Object>();
        m.put("allowed", d.allowed());
        m.put("reason", d.reason());
        m.put("matchedKey", d.matchedKey());
        m.put("grantId", d.grantId());
        return ApiResponse.ok(m);
    }

    public record CheckProbe(Long userId, String resourceType, String resourceKey,
                             String action) {
    }

    @DeleteMapping("/resource-grants/{id}")
    public ResponseEntity<Void> revokeGrant(@PathVariable Long id) {
        var actor = guard.require(AdminGuard.ROLES_WRITE);
        grantService.revoke(id, actor.userId());
        return ResponseEntity.noContent().build();
    }

    // ── 감사 로그 (조회 전용 — 수정·삭제 엔드포인트를 만들지 않는다) ──

    @GetMapping("/audit-logs")
    public ApiResponse<ApiResponse.PageData<Map<String, Object>>> auditLogs(
            @RequestParam(required = false) String eventType,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        guard.require(AdminGuard.AUDIT_READ);

        int capped = Math.min(size, 100);
        // null 바인딩 회피 — 조건을 무력화하는 값으로 바꾼다 (AuditLogRepository.search 주석)
        var result = auditLogRepository.search(
                eventType == null ? "" : eventType,
                userId == null ? Long.valueOf(-1L) : userId,   // 삼항에 long 을 섞으면 불필요한 언박싱/리박싱
                from == null ? Instant.EPOCH : from,
                to == null ? Instant.now().plusSeconds(86400) : to,
                PageRequest.of(page, capped));
        var items = result.getContent().stream()
                .<Map<String, Object>>map(a -> {
                    var m = new java.util.LinkedHashMap<String, Object>();
                    m.put("id", a.getId());
                    m.put("eventType", a.getEventType());
                    m.put("userId", a.getUserId());
                    m.put("actorId", a.getActorId());
                    m.put("ip", a.getIp());
                    m.put("userAgent", a.getUserAgent());   // 누락돼 있었다 — DB 엔 있는데 응답에 없었음
                    m.put("detail", a.getDetail());
                    m.put("createdAt", a.getCreatedAt());
                    return m;
                })
                .toList();
        return ApiResponse.ok(new ApiResponse.PageData<>(items, page, capped, result.getTotalElements()));
    }

    /**
     * 감사 로그 CSV 내보내기 (G14).
     *
     * <p><b>상한을 둔다</b> ({@code ixauth.audit.export-max}, 기본 5만 행). 무제한이면
     * 기간을 넓게 잡은 요청 하나로 서버 메모리를 태울 수 있다. 잘리면 그 사실을 파일
     * 마지막 줄에 적는다 — 조용히 끊으면 받는 사람은 그것이 전부인 줄 안다.</p>
     *
     * <p><b>내보내기 자체를 감사 로그에 남긴다.</b> 내려받은 파일에는 이메일·IP·
     * User-Agent 가 줄줄이 들어 있다. 그건 열람이 아니라 반출이고, 반출 기록이 없으면
     * 유출이 났을 때 어디로 나갔는지 되짚을 수 없다.</p>
     *
     * <p>{@code to} 를 요청 시각으로 닫아 둔다 — 열어 두면 내보내는 동안 새로 쌓이는
     * 행이 최근순 페이지를 밀어 같은 줄이 두 번 나온다.</p>
     */
    @GetMapping(value = "/audit-logs/export", produces = "text/csv;charset=UTF-8")
    public void exportAuditLogs(
            @RequestParam(required = false) String eventType,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) Instant from,
            @RequestParam(required = false) Instant to,
            jakarta.servlet.http.HttpServletResponse response) throws java.io.IOException {

        var actor = guard.require(AdminGuard.AUDIT_READ);
        Instant until = to == null ? Instant.now() : to;
        Instant since = from == null ? Instant.EPOCH : from;
        String eventFilter = eventType == null ? "" : eventType;
        Long userFilter = userId == null ? Long.valueOf(-1L) : userId;

        // 흘려보내기 전에 남긴다. 클라이언트가 중간에 끊어도 "받아 갔다" 는 사실은 남아야 한다
        auditService.record(team.prost.ixauth.service.AuditService.AUDIT_EXPORTED,
                null, actor.userId(), null, null,
                Map.of("eventType", eventFilter, "userId", userFilter,
                        "from", since.toString(), "to", until.toString()));

        String filename = "audit-logs-" + until.toString().substring(0, 10) + ".csv";
        response.setContentType("text/csv;charset=UTF-8");
        response.setHeader("Content-Disposition", "attachment; filename=\"" + filename + "\"");
        response.setHeader("Cache-Control", "no-store");

        // StreamingResponseBody 를 쓰지 않는다. 비동기 디스패치로 넘어가면 그 스레드에는
        // SecurityContext 가 없어 /admin/** 인가가 다시 걸리고, 본문을 이미 내보낸 뒤라
        // 오류 응답도 못 만든 채 연결이 끊긴다 (2026-08-08 실측: 클라이언트가
        // IncompleteRead 를 본다). 여기서는 같은 스레드로 흘려보낸다 — 행은 페이지 단위로
        // 읽으므로 메모리는 그대로 묶여 있지 않다
        try (var writer = new java.io.OutputStreamWriter(response.getOutputStream(),
                java.nio.charset.StandardCharsets.UTF_8)) {
            auditService.exportCsv(writer, eventFilter, userFilter, since, until);
        }
    }
}
