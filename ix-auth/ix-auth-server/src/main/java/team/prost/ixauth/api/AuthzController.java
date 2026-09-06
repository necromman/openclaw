package team.prost.ixauth.api;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import team.prost.ixauth.authz.AuthzService;
import team.prost.ixauth.authz.ResourceAuthzService;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ApiResponse;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.security.JwtAuthenticationFilter.AuthPrincipal;

import java.util.List;
import java.util.Map;

/**
 * 인가 API — L1(로컬 판정용 맵) + L2(인스턴스 판정).
 *
 * <p>{@code permission-map} 이 이 제품의 성능 설계에서 핵심이다 — 앱이 이걸 캐싱해
 * <b>매 요청 로컬 판정</b>하므로 인가 때문에 jar 를 호출하지 않는다 (설계 불변식 2).</p>
 *
 * <p>{@code /authz/check} 계열만 jar 를 타며, 이는 파일·문서 접근처럼 빈도가 낮은
 * 경로에 한정된 예외다.</p>
 */
@RestController
@RequiredArgsConstructor
public class AuthzController {

    private final AuthzService authzService;
    private final ResourceAuthzService resourceAuthzService;
    private final IxAuthProperties properties;

    /** 역할 → 권한 전체 맵. 앱이 부팅 시 1회 받아 캐싱한다 */
    @GetMapping("/authz/permission-map")
    public ResponseEntity<ApiResponse<Map<String, Object>>> permissionMap() {
        long version = authzService.permissionsVersion();
        Map<String, Object> body = Map.of(
                "version", version,
                "roles", authzService.permissionMap());

        long cacheSeconds = properties.getAuthz().getPermissionMapCache().toSeconds();
        return ResponseEntity.ok()
                .header("Cache-Control", "public, max-age=" + cacheSeconds)
                .header("X-IxAuth-Pv", String.valueOf(version))
                .body(ApiResponse.ok(body));
    }

    // ────────────────────────── L2 인스턴스 권한 ──────────────────────────

    public record CheckRequest(Long userId, String resourceType, String resourceKey, String action) {
    }

    public record BatchCheckRequest(Long userId, List<CheckItem> checks) {
    }

    public record CheckItem(String resourceType, String resourceKey, String action) {
    }

    /**
     * 단건 판정.
     *
     * <p>이 엔드포인트는 설계 불변식 2의 예외다 — 토큰 검증이 아니라 리소스 접근 판정이고,
     * 파일 접근처럼 빈도가 낮은 경로에서만 쓴다. 목록 화면에서는 반드시
     * {@code batch-check} 나 {@code list-resources} 를 쓴다.</p>
     */
    @PostMapping("/authz/check")
    public ApiResponse<Map<String, Object>> check(@RequestBody CheckRequest req) {
        var d = resourceAuthzService.check(
                req.userId(), req.resourceType(), req.resourceKey(), req.action());

        var body = new java.util.LinkedHashMap<String, Object>();
        body.put("allowed", d.allowed());
        body.put("reason", d.reason());        // 판정 근거를 항상 돌려준다
        body.put("matchedKey", d.matchedKey());
        body.put("grantId", d.grantId());
        return ApiResponse.ok(body);
    }

    @PostMapping("/authz/batch-check")
    public ApiResponse<List<Map<String, Object>>> batchCheck(@RequestBody BatchCheckRequest req) {
        int max = properties.getAuthz().getBatchCheckMax();
        if (req.checks() == null || req.checks().size() > max) {
            throw new ApiException(ErrorCode.AUTHZ_BATCH_TOO_LARGE,
                    "한 번에 최대 " + max + "건까지 요청할 수 있습니다.");
        }
        var requests = req.checks().stream()
                .map(c -> new ResourceAuthzService.CheckRequest(
                        c.resourceType(), c.resourceKey(), c.action()))
                .toList();

        var results = resourceAuthzService.batchCheck(req.userId(), requests);
        var body = new java.util.ArrayList<Map<String, Object>>(results.size());
        for (int i = 0; i < results.size(); i++) {
            var d = results.get(i);
            var m = new java.util.LinkedHashMap<String, Object>();
            m.put("resourceKey", req.checks().get(i).resourceKey());
            m.put("allowed", d.allowed());
            m.put("reason", d.reason());
            m.put("matchedKey", d.matchedKey());
            body.add(m);
        }
        return ApiResponse.ok(body);
    }

    /** 접근 가능한 리소스 키 목록 — 앱이 자기 쿼리를 필터링하는 데 쓴다 */
    @GetMapping("/authz/list-resources")
    public ApiResponse<Map<String, Object>> listResources(
            @RequestParam Long userId,
            @RequestParam String resourceType,
            @RequestParam(defaultValue = "read") String action) {

        int max = properties.getAuthz().getListResourcesMax();
        var keys = resourceAuthzService.listResources(userId, resourceType, action, max + 1);

        boolean truncated = keys.size() > max;
        return ApiResponse.ok(Map.of(
                "keys", truncated ? keys.subList(0, max) : keys,
                "truncated", truncated));
    }

    /** 현재 사용자의 유효 권한 — 메뉴 노출용 */
    @GetMapping("/authz/my-permissions")
    public ApiResponse<Map<String, Object>> myPermissions(@AuthenticationPrincipal AuthPrincipal principal) {
        if (principal == null) {
            throw new ApiException(ErrorCode.AUTH_TOKEN_INVALID);
        }
        List<String> permissions = authzService.effectivePermissions(principal.userId());
        return ApiResponse.ok(Map.of(
                "userId", String.valueOf(principal.userId()),
                "roles", principal.roles(),
                "permissions", permissions));
    }
}
