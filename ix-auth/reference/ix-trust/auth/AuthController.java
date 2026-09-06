package team.prost.ixtrust.client.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import team.prost.ixtrust.client.IxTrustClientProperties;
import team.prost.ixtrust.client.auth.dto.AuthRequest;
import team.prost.ixtrust.client.auth.dto.AuthResponse;
import team.prost.ixtrust.client.auth.dto.LoginResponse;
import team.prost.ixtrust.client.security.CookieHelper;
import team.prost.ixtrust.client.spi.UserExtraProvider;
import team.prost.ixtrust.client.sso.SsoService;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * SDK 자체 JWT 기반 ID/PW 인증 controller.
 *
 * <p>1.7.10 부터 {@code ixtrust.client.security.enabled} 가 false 면 등록되지 않는다 — SP 가
 * 자체 인증 (HttpSession + AuthenticationInterceptor 등) 을 쓰면서 path 가 겹치는 케이스
 * (lxp /api/auth/login + /api/auth/logout) 의 Ambiguous mapping 회귀 방지.
 * matchIfMissing=true 라 기존 SP (yaml 명시 안 한) 동작 동일.
 */
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
@ConditionalOnProperty(name = "ixtrust.client.security.enabled", havingValue = "true", matchIfMissing = true)
public class AuthController {

    private final AuthService authService;
    private final IxTrustClientProperties properties;

    @SuppressWarnings("rawtypes")
    @Autowired(required = false)
    private UserExtraProvider userExtraProvider;

    @Autowired(required = false)
    private SsoService ssoService;

    @PostMapping("/login")
    public ResponseEntity<LoginResponse> login(
            @Valid @RequestBody AuthRequest request,
            HttpServletRequest httpRequest,
            HttpServletResponse httpResponse) {
        AuthResponse auth = authService.login(request);
        CookieHelper.setAuthCookies(httpResponse, auth.accessToken(), auth.refreshToken(),
                CookieHelper.isSecureRequest(httpRequest));
        return ResponseEntity.ok(new LoginResponse(auth.name(), auth.email(), auth.role()));
    }

    @SuppressWarnings("unchecked")
    @PostMapping("/refresh")
    public ResponseEntity<LoginResponse> refresh(
            HttpServletRequest httpRequest,
            HttpServletResponse httpResponse) {
        String refreshToken = CookieHelper.getCookieValue(httpRequest, CookieHelper.REFRESH_TOKEN_COOKIE);
        if (refreshToken == null || refreshToken.isBlank()) {
            return ResponseEntity.status(401).build();
        }
        AuthResponse auth = authService.refresh(refreshToken);
        CookieHelper.setAuthCookies(httpResponse, auth.accessToken(), auth.refreshToken(),
                CookieHelper.isSecureRequest(httpRequest));

        Map<String, Object> extra = null;
        if (userExtraProvider != null) {
            var userOpt = authService.findUserByEmail(auth.email());
            if (userOpt.isPresent()) {
                extra = userExtraProvider.getExtra(userOpt.get());
            }
        }
        return ResponseEntity.ok(new LoginResponse(auth.name(), auth.email(), auth.role(), extra));
    }

    @PostMapping("/logout")
    public ResponseEntity<Map<String, Object>> logout(HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
        // 1.8.1+ — clear 전에 id_token cookie 읽어 RP-initiated logout 의 id_token_hint 로 전달.
        // BFF / hybrid 모두 SsoController 가 id_token cookie 발급하므로 본 흐름 일관.
        String idTokenHint = CookieHelper.getCookieValue(httpRequest, CookieHelper.ID_TOKEN_COOKIE);
        CookieHelper.clearAuthCookies(httpResponse, httpRequest);
        // SDK 1.7.4+ — 표준 OIDC RP-Initiated logout 정공법:
        //   1) SP cookie 클리어 (위 CookieHelper, id_token 포함)
        //   2) IX-Trust SSO 세션 종료 URL 응답에 포함 (id_token_hint 박음) — frontend SDK 가 자동 navigate
        //   3) IX-Trust 가 sid claim 파싱 → 정확한 RP cascade + post_logout_redirect_uris 화이트리스트 검증
        // 모든 SP 가 자체 SsoEndSessionUrlController 같은 우회 controller 없이 표준 흐름 사용 가능.
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", true);
        // SSO 활성 시에만 IX-Trust endSessionUrl 반환 — SSO off / IX-Trust 다운 시 프론트가 loginPath 로 fallback.
        // local enabled + 원격 ssoEnabled 둘 다 확인 (SsoService.resolveSsoEnabled — SsoController.ssoStatus 와 동일 판단).
        boolean ssoEnabled = ssoService != null && ssoService.resolveSsoEnabled(null);
        if (ssoEnabled) {
            String endSessionUrl = IxTrustLogoutSupport.buildEndSessionUrl(httpRequest, idTokenHint, properties);
            if (endSessionUrl != null) {
                body.put("endSessionUrl", endSessionUrl);
            }
        }
        return ResponseEntity.ok(body);
    }
}
