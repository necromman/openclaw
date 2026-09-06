package team.prost.ixauth.api.admin;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import team.prost.ixauth.common.ApiResponse;
import team.prost.ixauth.common.ClientInfo;
import team.prost.ixauth.service.AccountService;
import team.prost.ixauth.settings.SettingsService;
import team.prost.ixauth.verification.VerificationProviders;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 설정 관리 + 가입 승인.
 *
 * <p>설정 목록은 <b>정의 레지스트리에서 나온다.</b> 새 설정을 등록하면 이 API 와 화면이
 * 저절로 그것을 다룬다 — 여기에 코드를 더할 필요가 없다.</p>
 */
@RestController
@RequestMapping("/admin")
@RequiredArgsConstructor
public class SettingsAdminController {

    private final SettingsService settingsService;
    private final AccountService accountService;
    private final VerificationProviders verificationProviders;
    private final AdminGuard guard;
    private final ClientInfo clientInfo;

    public record ValueRequest(@NotBlank String value) {
    }

    public record RejectRequest(String reason) {
    }

    // ────────────────────── 설정 ──────────────────────

    @GetMapping("/settings")
    public ApiResponse<Map<String, Object>> list() {
        guard.require(AdminGuard.USERS_READ);
        var out = new LinkedHashMap<String, Object>();
        out.put("groups", settingsService.groups());
        out.put("items", settingsService.describeAll());
        // 고를 수 있는 본인확인 수단 — 연동이 없는 것을 고르면 가입이 실패한다
        out.put("verificationConfigured", verificationProviders.configured());
        return ApiResponse.ok(out);
    }

    /** 값 하나를 바꾼다. 형식이 틀리면 저장되지 않고 400 이다 */
    @PutMapping("/settings/{key}")
    public ApiResponse<Map<String, Object>> update(@PathVariable String key,
                                                   @Valid @RequestBody ValueRequest req) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        settingsService.update(key, req.value(), actor.userId(),
                clientInfo.ip(null), clientInfo.userAgent(null));
        return ApiResponse.ok(Map.of("key", key, "value", req.value()));
    }

    /**
     * 이 설정의 변경 이력 (G25).
     *
     * <p>감사 로그에서 뽑는다 — 표를 따로 두면 같은 사실이 두 곳에 생기고 언젠가
     * 어긋난다. 감사 로그 탭에서 찾아 헤매지 않아도 되게 항목 옆에서 바로 연다.</p>
     */
    @GetMapping("/settings/{key}/history")
    public ApiResponse<List<Map<String, Object>>> history(
            @PathVariable String key,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "20") int size) {
        guard.require(AdminGuard.AUDIT_READ);
        return ApiResponse.ok(settingsService.history(key, size));
    }

    /** 기본값(yml)으로 되돌린다 */
    @DeleteMapping("/settings/{key}")
    public ApiResponse<Map<String, Object>> reset(@PathVariable String key) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        settingsService.reset(key, actor.userId(),
                clientInfo.ip(null), clientInfo.userAgent(null));
        return ApiResponse.ok(Map.of("key", key, "reset", true));
    }

    // ────────────────────── 가입 승인 ──────────────────────

    /** 승인 대기 목록 — `signup-mode=APPROVAL` 일 때만 쌓인다 */
    @GetMapping("/signup-approvals")
    public ApiResponse<List<Map<String, Object>>> pending() {
        guard.require(AdminGuard.USERS_READ);
        return ApiResponse.ok(accountService.pendingApprovals().stream()
                .<Map<String, Object>>map(u -> {
                    var m = new LinkedHashMap<String, Object>();
                    m.put("id", u.getId());
                    m.put("email", u.getEmail());
                    m.put("name", u.getName());
                    m.put("emailVerified", u.getEmailVerifiedAt() != null);
                    m.put("createdAt", u.getCreatedAt());
                    return m;
                }).toList());
    }

    @PostMapping("/signup-approvals/{id}/approve")
    public ResponseEntity<Void> approve(@PathVariable Long id) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        accountService.approveSignup(id, actor.userId(),
                clientInfo.ip(null), clientInfo.userAgent(null));
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/signup-approvals/{id}/reject")
    public ResponseEntity<Void> reject(@PathVariable Long id,
                                       @RequestBody(required = false) RejectRequest req) {
        var actor = guard.require(AdminGuard.USERS_WRITE);
        accountService.rejectSignup(id, req == null ? null : req.reason(), actor.userId(),
                clientInfo.ip(null), clientInfo.userAgent(null));
        return ResponseEntity.noContent().build();
    }
}
