package team.prost.ixauth.api;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import team.prost.ixauth.api.dto.AuthDtos;
import team.prost.ixauth.authz.AuthzService;
import team.prost.ixauth.captcha.CaptchaGuard;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ApiResponse;
import team.prost.ixauth.common.ClientInfo;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties.CaptchaAction;
import team.prost.ixauth.repository.UserRepository;
import team.prost.ixauth.security.JwtAuthenticationFilter.AuthPrincipal;
import team.prost.ixauth.security.SigningKeyService;
import team.prost.ixauth.service.AuthService;
import team.prost.ixauth.service.FederatedIdentityService;
import team.prost.ixauth.service.MagicLinkService;

import java.util.Map;
import java.util.UUID;

/**
 * 인증 API.
 *
 * <p>브라우저가 직접 호출하지 않는다. 앱이 중계하고 앱 도메인 쿠키로 심는다
 * (설계 불변식 4).</p>
 */
@RestController
@RequiredArgsConstructor
public class AuthController {

    private final ClientInfo clientInfo;
    private final AuthService authService;
    private final AuthzService authzService;
    private final UserRepository userRepository;
    private final SigningKeyService signingKeyService;
    private final MagicLinkService magicLinkService;
    private final FederatedIdentityService federatedIdentityService;
    private final CaptchaGuard captchaGuard;

    @PostMapping("/auth/login")
    public ApiResponse<AuthDtos.LoginResponse> login(@Valid @RequestBody AuthDtos.LoginRequest req) {
        // 세션에 남는 IP·UA 다. 원시 remoteAddr 을 그대로 쓰면 프록시 뒤에서는
        // 전부 게이트웨이 주소가 되고, 로컬에서는 ::1 로 남아 사용자가 알아볼 수 없다
        String ip = clientInfo.ip(req.ip());

        // 비밀번호를 보기 전에 건다. 뒤에 두면 CAPTCHA 에 막힌 요청도 이미 해시 대조를
        // 마친 뒤라, 막으려던 비용(bcrypt)을 그대로 치른다
        captchaGuard.require(CaptchaAction.LOGIN, req.captchaToken(), ip);

        var result = authService.login(req.email(), req.password(),
                clientInfo.userAgent(req.userAgent()), ip);
        return ApiResponse.ok(toResponse(result));
    }

    // ────────────────────── 매직 링크 (2026-08-08 추가) ──────────────────────

    /**
     * 로그인 링크를 메일로 보낸다.
     *
     * <p><b>계정이 없어도 성공 응답이다.</b> 다르게 답하면 이 화면이 가입자 명부를
     * 조회하는 도구가 된다 — 비밀번호 찾기와 같은 규칙이다. 기능 자체가 꺼져 있으면
     * {@code AUTHZ_FORBIDDEN}(403) 이고, 그건 계정과 무관한 전역 스위치라 알려 줘도
     * 새는 것이 없다.</p>
     */
    @PostMapping("/auth/magic-link/request")
    public ApiResponse<Map<String, Object>> requestMagicLink(
            @Valid @RequestBody AuthDtos.MagicLinkRequest req) {
        String ip = clientInfo.ip(null);
        captchaGuard.require(CaptchaAction.PASSWORD_FORGOT, req.captchaToken(), ip);

        magicLinkService.request(req.email(), ip, clientInfo.userAgent(null));
        return ApiResponse.ok(Map.of("accepted", true));
    }

    /**
     * 링크의 토큰으로 로그인을 마친다 — 응답은 {@code /auth/login} 과 같은 모양이다.
     *
     * <p><b>2단계가 켜진 계정은 여기서도 401 {@code AUTH_MFA_REQUIRED} + challenge</b> 를
     * 받는다. 메일 한 통으로 2단계를 넘을 수 있으면 2단계를 켠 의미가 없다.</p>
     */
    @PostMapping("/auth/magic-link/verify")
    public ApiResponse<AuthDtos.LoginResponse> verifyMagicLink(
            @Valid @RequestBody AuthDtos.MagicLinkVerifyRequest req) {
        var result = magicLinkService.verify(req.token(),
                clientInfo.ip(req.ip()), clientInfo.userAgent(req.userAgent()));
        return ApiResponse.ok(toResponse(result));
    }

    // ────────────────────── 연합 신원 교환 (2026-08-27 추가) ──────────────────────

    /**
     * 앱이 <b>이미 검증한</b> 외부 신원을 세션으로 바꾼다 — 응답은 {@code /auth/login} 과
     * 같은 모양이다.
     *
     * <p><b>IX-Auth 가 OIDC IdP 가 되는 것이 아니다.</b> 여기서 jar 는 외부 provider 와
     * 통신하지 않고 브라우저를 받지도 않는다(설계 불변식 1·4). 신원 확인은 앱이 끝냈고,
     * jar 는 그 결과를 계정에 잇는 일만 한다.</p>
     *
     * <p><b>2단계 인증을 건너뛴다.</b> 외부 IdP 가 이미 본인확인을 마쳤고, 여기서 다시
     * 막으면 그 IdP 로만 쓰던 사용자가 들어올 방법이 없어진다 (계약: http-api.md §2-7).</p>
     */
    @PostMapping("/auth/federated/exchange")
    public ApiResponse<AuthDtos.LoginResponse> federatedExchange(
            @Valid @RequestBody AuthDtos.FederatedExchangeRequest req) {
        var external = new FederatedIdentityService.ExternalIdentity(
                req.provider(), req.subject(), req.email(), req.name());
        var result = federatedIdentityService.exchange(external,
                clientInfo.ip(req.ip()), clientInfo.userAgent(req.userAgent()));
        return ApiResponse.ok(toResponse(result));
    }

    /** 로그인 응답 한 벌 — 비밀번호·매직 링크가 같은 모양을 주어야 앱이 분기하지 않는다 */
    private AuthDtos.LoginResponse toResponse(AuthService.LoginResult result) {
        return new AuthDtos.LoginResponse(
                result.accessToken(), result.refreshToken(), result.expiresIn(),
                new AuthDtos.UserSummary(String.valueOf(result.userId()), result.email(),
                        result.name(), result.roles(), result.groups()),
                result.mfaSetupRequired(), result.termsAgreementRequired());
    }

    @PostMapping("/auth/refresh")
    public ApiResponse<AuthDtos.RefreshResponse> refresh(
            @Valid @RequestBody AuthDtos.RefreshRequest req) {
        var r = authService.refresh(req.refreshToken(),
                clientInfo.userAgent(null), clientInfo.ip(null));
        return ApiResponse.ok(new AuthDtos.RefreshResponse(r.accessToken(), r.refreshToken(), r.expiresIn()));
    }

    @PostMapping("/auth/logout")
    public ResponseEntity<Void> logout(@RequestBody(required = false) AuthDtos.LogoutRequest req) {
        String refresh = req == null ? null : req.refreshToken();
        UUID sessionId = null;
        if (req != null && req.sessionId() != null && !req.sessionId().isBlank()) {
            try {
                sessionId = UUID.fromString(req.sessionId());
            } catch (IllegalArgumentException ignored) {
                // 형식이 틀린 sessionId 는 무시한다 — 로그아웃은 멱등
            }
        }
        authService.logout(refresh, sessionId, clientInfo.ip(null), clientInfo.userAgent(null));
        return ResponseEntity.noContent().build();
    }

    /**
     * 토큰 소유자 정보.
     *
     * <p><b>매 요청 호출하지 않는다.</b> 같은 정보가 이미 토큰 안에 있다 (설계 불변식 2).</p>
     */
    @GetMapping("/auth/me")
    public ApiResponse<AuthDtos.MeResponse> me(@AuthenticationPrincipal AuthPrincipal principal) {
        if (principal == null) {
            throw new ApiException(ErrorCode.AUTH_TOKEN_INVALID);
        }
        var user = userRepository.findById(principal.userId())
                .orElseThrow(() -> new ApiException(ErrorCode.AUTH_TOKEN_INVALID));

        return ApiResponse.ok(new AuthDtos.MeResponse(
                String.valueOf(user.getId()), user.getEmail(), user.getName(),
                authzService.effectiveRoleCodes(user.getId()),
                authzService.groupCodes(user.getId()),
                user.getAttributes(), user.getLastLoginAt()));
    }

    /** 공개키 게시 — 앱이 이걸로 토큰을 로컬 검증한다 (설계 불변식 2의 전제) */
    @GetMapping("/.well-known/jwks.json")
    public ResponseEntity<Map<String, Object>> jwks() {
        return ResponseEntity.ok()
                .header("Cache-Control", "public, max-age=3600")
                .body(signingKeyService.jwks());
    }
}
