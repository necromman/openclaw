package team.prost.ixauth.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import team.prost.ixauth.api.dto.AuthDtos;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ApiResponse;
import team.prost.ixauth.common.ClientInfo;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.security.JwtAuthenticationFilter.AuthPrincipal;
import team.prost.ixauth.service.SocialAuthService;
import team.prost.ixauth.service.SocialProviderRegistry;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 소셜 로그인 — Microsoft · 카카오 · 네이버.
 *
 * <p><b>콜백은 앱이 받는다.</b> IX-Auth 는 외부에 노출되지 않으므로(설계 불변식 4)
 * provider 가 브라우저를 여기로 돌려보낼 수 없다. 앱이 콜백 주소를 자기 도메인에 두고,
 * 받은 {@code code} 를 이 API 로 중계한다.</p>
 */
@RestController
@RequiredArgsConstructor
public class SocialAuthController {

    private final SocialAuthService socialAuthService;
    private final SocialProviderRegistry registry;
    private final ClientInfo clientInfo;

    public record CallbackRequest(@NotBlank String code, @NotBlank String state) {
    }

    /** 로그인 화면에 어떤 버튼을 그릴지 — 앱이 이걸 보고 정한다 */
    @GetMapping("/auth/social/providers")
    public ApiResponse<Map<String, Object>> providers() {
        return ApiResponse.ok(Map.of(
                "enabled", registry.isEnabled(),
                "providers", registry.enabledProviders()));
    }

    /**
     * 동의 화면 주소를 만든다.
     *
     * @param redirectUri <b>앱의</b> 콜백 주소. provider 콘솔에 등록된 것과 같아야 하고,
     *                    토큰 교환 때도 같은 값이 쓰인다
     */
    @GetMapping("/auth/social/{provider}/authorize-url")
    public ApiResponse<Map<String, Object>> authorizeUrl(@PathVariable String provider,
                                                         @RequestParam String redirectUri) {
        var result = socialAuthService.authorizeUrl(provider, redirectUri);
        var out = new LinkedHashMap<String, Object>();
        out.put("url", result.url());
        // 앱이 콜백에서 대조할 수 있게 돌려준다. 검증은 IX-Auth 도 다시 한다
        out.put("state", result.state());
        return ApiResponse.ok(out);
    }

    /** 앱이 받은 {@code code} 를 중계한다. 성공하면 로그인 응답과 같은 모양이다 */
    @PostMapping("/auth/social/{provider}/callback")
    public ApiResponse<AuthDtos.LoginResponse> callback(
            @PathVariable String provider, @Valid @RequestBody CallbackRequest req) {
        var r = socialAuthService.callback(provider, req.code(), req.state(), null,
                clientInfo.ip(null), clientInfo.userAgent(null));

        return ApiResponse.ok(new AuthDtos.LoginResponse(
                r.accessToken(), r.refreshToken(), r.expiresIn(),
                new AuthDtos.UserSummary(String.valueOf(r.userId()), r.email(), r.name(),
                        r.roles(), r.groups()),
                // 소셜로 들어와도 약관은 우리와 사용자 사이의 합의라 provider 가
                // 대신 받아 줄 수 없다 — 2단계 인증과 달리 여기서도 신호가 나간다
                r.mfaSetupRequired(), r.termsAgreementRequired()));
    }

    // ────────────────────── 내 계정 연결 ──────────────────────

    /**
     * 로그인한 사용자가 자기 계정에 연결한다 — <b>가장 안전한 경로다.</b>
     *
     * <p>이메일 검증 신호에 기대지 않고 본인 확인이 이미 끝난 상태에서 붙이므로,
     * 네이버처럼 검증 여부를 주지 않는 provider 도 이 경로로는 안전하게 연결된다.</p>
     */
    @PostMapping("/auth/social/{provider}/link")
    public ApiResponse<Map<String, Object>> link(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable String provider, @Valid @RequestBody CallbackRequest req) {
        var me = require(principal);
        socialAuthService.callback(provider, req.code(), req.state(), me.userId(),
                clientInfo.ip(null), clientInfo.userAgent(null));
        return ApiResponse.ok(Map.of("linked", true));
    }

    @GetMapping("/auth/social/links")
    public ApiResponse<List<Map<String, Object>>> links(
            @AuthenticationPrincipal AuthPrincipal principal) {
        var me = require(principal);
        return ApiResponse.ok(socialAuthService.listIdentities(me.userId()).stream()
                .<Map<String, Object>>map(i -> {
                    var m = new LinkedHashMap<String, Object>();
                    m.put("provider", i.getProvider().name());
                    m.put("email", i.getEmail());
                    m.put("displayName", i.getDisplayName());
                    m.put("linkedAt", i.getLinkedAt());
                    m.put("lastLoginAt", i.getLastLoginAt());
                    return m;
                })
                .toList());
    }

    @DeleteMapping("/auth/social/{provider}/link")
    public ApiResponse<Map<String, Object>> unlink(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String provider) {
        var me = require(principal);
        socialAuthService.unlink(me.userId(), provider,
                clientInfo.ip(null), clientInfo.userAgent(null));
        return ApiResponse.ok(Map.of("unlinked", true));
    }

    private AuthPrincipal require(AuthPrincipal principal) {
        if (principal == null) {
            throw new ApiException(ErrorCode.AUTH_TOKEN_INVALID);
        }
        return principal;
    }
}
