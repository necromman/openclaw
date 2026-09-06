package team.prost.ixauth.api;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import team.prost.ixauth.api.dto.AccountDtos;
import team.prost.ixauth.api.dto.AuthDtos;
import team.prost.ixauth.api.dto.MfaDtos;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ApiResponse;
import team.prost.ixauth.common.ClientInfo;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties.StepUpAction;
import team.prost.ixauth.mfa.StepUpVerifier;
import team.prost.ixauth.security.JwtAuthenticationFilter.AuthPrincipal;
import team.prost.ixauth.service.AuthService;
import team.prost.ixauth.service.MfaService;

/**
 * 2단계 인증 API.
 *
 * <p>등록·해제·조회는 <b>본인</b>이 한다(access token). 로그인 도중의
 * {@code /auth/mfa/verify} 만 서비스 키로 호출된다 — 그 시점엔 아직 토큰이 없기 때문이다.</p>
 *
 * <p>QR 이미지는 만들지 않는다. {@code otpauth://} 문자열만 주고 그림은 앱이 그린다
 * (설계 불변식 1 — jar 는 화면을 만들지 않는다).</p>
 */
@RestController
@RequiredArgsConstructor
public class MfaController {

    private final MfaService mfaService;
    private final AuthService authService;
    private final StepUpVerifier stepUpVerifier;
    private final ClientInfo clientInfo;

    /**
     * 등록 시작 — 아직 켜지지 않는다.
     *
     * <p>백업 코드 평문은 <b>이 응답에서만</b> 볼 수 있다. 앱은 사용자가 저장했는지
     * 확인한 뒤 다음 단계로 넘겨야 한다.</p>
     */
    @PostMapping("/auth/mfa/totp/setup")
    public ApiResponse<MfaDtos.SetupResponse> setup(
            @AuthenticationPrincipal AuthPrincipal principal) {
        var result = mfaService.setup(require(principal).userId());
        return ApiResponse.ok(
                new MfaDtos.SetupResponse(result.otpauthUri(), result.backupCodes()));
    }

    /** 코드를 확인하고 켠다 */
    @PostMapping("/auth/mfa/totp/confirm")
    public ApiResponse<MfaDtos.StatusResponse> confirm(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody MfaDtos.ConfirmRequest req) {
        var view = mfaService.confirm(require(principal).userId(), req.code(), ip(), ua());
        return ApiResponse.ok(toResponse(view));
    }

    /**
     * 해제 — 현재 비밀번호를 확인한다.
     *
     * <p>{@code mfa.step-up-actions} 에 {@code MFA_DISABLE} 을 넣으면 <b>코드도</b> 요구한다.
     * 2단계를 끄는 데 2단계 코드를 받는 것이 이상해 보이지만, 그것이 없으면 비밀번호를
     * 훔친 쪽이 2단계부터 꺼 버리고 나머지 보호를 전부 무력화한다.</p>
     */
    @DeleteMapping("/auth/mfa/totp")
    public ApiResponse<AccountDtos.AcceptedResponse> disable(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody MfaDtos.DisableRequest req) {
        Long userId = require(principal).userId();
        stepUpVerifier.require(StepUpAction.MFA_DISABLE, userId, req.mfaCode(), ip(), ua());

        mfaService.disable(userId, req.currentPassword(), ip(), ua());
        return ApiResponse.ok(AccountDtos.AcceptedResponse.ok());
    }

    @GetMapping("/auth/mfa/status")
    public ApiResponse<MfaDtos.StatusResponse> status(
            @AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(toResponse(mfaService.status(require(principal).userId())));
    }

    /**
     * 로그인 2/2 — challenge + 코드로 최종 토큰을 받는다.
     *
     * <p>{@code code} 자리에는 인증 앱의 6자리 코드와 <b>백업 코드</b>가 모두 온다.
     * 둘을 다른 필드로 나누면 앱이 "지금 무엇을 입력받는지" 를 미리 알아야 하는데,
     * 사용자는 휴대폰이 없을 때 비로소 백업 코드를 꺼낸다.</p>
     */
    @PostMapping("/auth/mfa/verify")
    public ApiResponse<AuthDtos.LoginResponse> verify(
            @Valid @RequestBody MfaDtos.VerifyRequest req) {
        var r = authService.verifyMfa(req.challenge(), req.code(),
                clientInfo.userAgent(req.userAgent()), clientInfo.ip(req.ip()));

        return ApiResponse.ok(new AuthDtos.LoginResponse(
                r.accessToken(), r.refreshToken(), r.expiresIn(),
                new AuthDtos.UserSummary(String.valueOf(r.userId()), r.email(), r.name(),
                        r.roles(), r.groups()),
                r.mfaSetupRequired(), r.termsAgreementRequired()));
    }

    // ────────────────────────── 공통 ──────────────────────────

    private MfaDtos.StatusResponse toResponse(MfaService.StatusView view) {
        return new MfaDtos.StatusResponse(view.enabled(), view.type(),
                view.backupCodesRemaining(), view.pendingConfirm(),
                view.mode(), view.setupRequired());
    }

    private AuthPrincipal require(AuthPrincipal principal) {
        if (principal == null) {
            throw new ApiException(ErrorCode.AUTH_TOKEN_INVALID);
        }
        return principal;
    }

    private String ip() {
        return clientInfo.ip(null);
    }

    private String ua() {
        return clientInfo.userAgent(null);
    }
}
