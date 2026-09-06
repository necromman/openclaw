package team.prost.ixauth.api;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import team.prost.ixauth.api.dto.AccountDtos;
import team.prost.ixauth.captcha.CaptchaGuard;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ApiResponse;
import team.prost.ixauth.common.ClientInfo;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties.CaptchaAction;
import team.prost.ixauth.config.IxAuthProperties.StepUpAction;
import team.prost.ixauth.mfa.StepUpVerifier;
import team.prost.ixauth.security.JwtAuthenticationFilter.AuthPrincipal;
import team.prost.ixauth.service.AccountDeletionService;
import team.prost.ixauth.service.AccountService;
import team.prost.ixauth.service.SessionQueryService;
import team.prost.ixauth.service.TermsService;

import java.util.UUID;

/**
 * 계정 라이프사이클 API — 비밀번호 찾기 · 이메일 인증 · 초대 · 가입 · 내 세션.
 *
 * <p>브라우저가 직접 부르지 않는다. 메일의 링크는 <b>앱</b> 화면을 가리키고,
 * 앱이 사용자 입력을 받아 여기로 중계한다 (설계 불변식 4).</p>
 *
 * <p>요청형 엔드포인트는 계정이 있든 없든 <b>같은 응답</b>을 준다. 다르게 답하면
 * 그 화면이 가입자 명부 조회 도구가 된다.</p>
 */
@RestController
@RequiredArgsConstructor
public class AccountController {

    private final AccountService accountService;
    private final SessionQueryService sessionQueryService;
    private final AccountDeletionService accountDeletionService;
    private final TermsService termsService;
    private final CaptchaGuard captchaGuard;
    private final StepUpVerifier stepUpVerifier;
    private final ClientInfo clientInfo;

    // ────────────────────── 비밀번호 ──────────────────────

    @PostMapping("/auth/password/forgot")
    public ApiResponse<AccountDtos.AcceptedResponse> forgot(
            @Valid @RequestBody AccountDtos.ForgotPasswordRequest req) {
        // 남의 주소로 메일을 퍼붓는 데 쓰이는 경로다. 속도 제한은 IP 당이라
        // 여러 곳에서 하나씩 던지면 그대로 통과한다 — CAPTCHA 가 그 빈틈을 메운다
        captchaGuard.require(CaptchaAction.PASSWORD_FORGOT, req.captchaToken(), ip());

        accountService.requestPasswordReset(req.email(), ip(), ua());
        return ApiResponse.ok(AccountDtos.AcceptedResponse.ok());
    }

    @PostMapping("/auth/password/reset")
    public ApiResponse<AccountDtos.AcceptedResponse> reset(
            @Valid @RequestBody AccountDtos.ResetPasswordRequest req) {
        accountService.resetPassword(req.token(), req.newPassword(), ip(), ua());
        return ApiResponse.ok(AccountDtos.AcceptedResponse.ok());
    }

    @PostMapping("/auth/password/change")
    public ApiResponse<AccountDtos.AcceptedResponse> change(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody AccountDtos.ChangePasswordRequest req) {
        Long userId = require(principal).userId();
        // 현재 비밀번호 확인은 서비스가 한다. 여기서 더 받는 것은 "지금 이 순간에도
        // 본인인가" 이고, 훔친 비밀번호로는 답할 수 없는 질문이다 (mfa.step-up-actions)
        stepUpVerifier.require(StepUpAction.PASSWORD_CHANGE, userId, req.mfaCode(), ip(), ua());

        accountService.changePassword(userId, req.currentPassword(), req.newPassword(), ip(), ua());
        return ApiResponse.ok(AccountDtos.AcceptedResponse.ok());
    }

    // ────────────────────── 이메일 ──────────────────────

    @PostMapping("/auth/email/verify/request")
    public ApiResponse<AccountDtos.AcceptedResponse> requestVerify(
            @Valid @RequestBody AccountDtos.EmailRequest req) {
        accountService.requestEmailVerification(req.email(), ip(), ua());
        return ApiResponse.ok(AccountDtos.AcceptedResponse.ok());
    }

    @PostMapping("/auth/email/verify")
    public ApiResponse<AccountDtos.AcceptedResponse> verify(
            @Valid @RequestBody AccountDtos.VerifyEmailRequest req) {
        accountService.verifyEmail(req.token(), ip(), ua());
        return ApiResponse.ok(AccountDtos.AcceptedResponse.ok());
    }

    @PostMapping("/auth/email/change")
    public ApiResponse<AccountDtos.AcceptedResponse> changeEmail(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody AccountDtos.ChangeEmailRequest req) {
        Long userId = require(principal).userId();
        // 주소가 바뀌면 그다음 '비밀번호 찾기' 한 번으로 계정이 통째로 넘어간다.
        // 네 작업 중 재인증의 값이 가장 큰 자리다
        stepUpVerifier.require(StepUpAction.EMAIL_CHANGE, userId, req.mfaCode(), ip(), ua());

        accountService.requestEmailChange(userId, req.newEmail(), req.currentPassword(),
                ip(), ua());
        return ApiResponse.ok(AccountDtos.AcceptedResponse.ok());
    }

    // ────────────────────── 초대 · 가입 ──────────────────────

    @PostMapping("/auth/invite/accept")
    public ApiResponse<AccountDtos.AcceptedResponse> acceptInvite(
            @Valid @RequestBody AccountDtos.AcceptInviteRequest req) {
        accountService.acceptInvite(req.token(), req.password(), req.name(), ip(), ua());
        return ApiResponse.ok(AccountDtos.AcceptedResponse.ok());
    }

    /** 자체 가입. {@code ixauth.account.signup-mode} 가 CLOSED 면 403 이다 */
    @PostMapping("/auth/signup")
    public ApiResponse<AccountDtos.AcceptedResponse> signup(
            @Valid @RequestBody AccountDtos.SignupRequest req) {
        // 계정을 만들기 전에 건다. 뒤에 두면 봇이 만든 계정이 남고, 그것을 지우는 것은
        // 사람 일이 된다 (captcha.protect 의 기본 대상)
        captchaGuard.require(CaptchaAction.SIGNUP, req.captchaToken(), ip());

        accountService.signup(new AccountService.SignupCommand(
                req.email(), req.password(), req.name(), req.attributes(), req.agreements()),
                ip(), ua());
        // 새로 만들었는지, 이미 있던 주소인지 구분해 주지 않는다
        return ApiResponse.ok(AccountDtos.AcceptedResponse.ok());
    }

    // ────────────────────── 약관 ──────────────────────

    /**
     * 지금 동의를 받아야 할 약관 — 코드마다 최신 게시본 하나씩.
     *
     * <p>서비스 키만으로 열린다. <b>가입 화면은 로그인 전에 뜨기 때문이다</b> —
     * access token 을 요구하면 가입하려는 사람이 약관을 볼 수 없다.
     * 게시된 약관은 어차피 공개 문서라 감출 것이 없다.</p>
     *
     * <p>기능이 꺼져 있으면 빈 목록이다. 앱은 목록이 비면 동의 단계를 건너뛰면 된다 —
     * "약관 기능이 켜졌는가" 를 따로 묻지 않아도 된다.</p>
     */
    @GetMapping("/auth/terms")
    public ApiResponse<AccountDtos.TermListResponse> terms() {
        var items = termsService.currentPublished().stream()
                .map(t -> new AccountDtos.TermView(t.getCode(), t.getVersion(), t.getTitle(),
                        t.getBody(), t.getBodyUrl(), t.isRequired(), t.getDisplayOrder()))
                .toList();
        return ApiResponse.ok(new AccountDtos.TermListResponse(items));
    }

    /**
     * 동의(또는 거절)를 남긴다. 로그인 응답의 {@code termsAgreementRequired} 를 받은 앱이 부른다.
     *
     * <p>응답에 <b>남은 필수 코드</b>를 다시 실어 준다. 앱이 동의 화면을 닫아도 되는지
     * 판단하려면 그것이 필요하고, 다음 로그인까지 기다리게 하면 화면이 어긋난다.</p>
     */
    @PostMapping("/auth/terms/agree")
    public ApiResponse<AccountDtos.AgreeTermsResponse> agreeTerms(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestBody AccountDtos.AgreeTermsRequest req) {
        Long userId = require(principal).userId();
        int recorded = termsService.agree(userId, req.agreements(), ip(), ua());
        return ApiResponse.ok(new AccountDtos.AgreeTermsResponse(
                recorded, termsService.pendingRequiredCodes(userId)));
    }

    /** 내 동의 이력 — 지운 것이 없으므로 옛 버전·거절 기록까지 그대로 나온다 */
    @GetMapping("/auth/terms/agreements")
    public ApiResponse<AccountDtos.AgreementListResponse> myAgreements(
            @AuthenticationPrincipal AuthPrincipal principal) {
        var items = termsService.myAgreements(require(principal).userId()).stream()
                .map(a -> new AccountDtos.AgreementView(a.getCode(), a.getVersion(),
                        a.isAgreed(), a.getAgreedAt()))
                .toList();
        return ApiResponse.ok(new AccountDtos.AgreementListResponse(items));
    }

    // ────────────────────── 탈퇴 ──────────────────────

    /**
     * 본인 탈퇴 — access token + 현재 비밀번호.
     *
     * <p>계정을 <b>지우지 않는다.</b> 지우면 감사 로그의 참조가 끊기고, 같은 주소로
     * 다시 가입해 이력을 지울 수 있다. {@code status=DISABLED} + 요청 시각 기록이다.</p>
     *
     * <p>{@code account.self-delete-mode} 가 {@code DISABLED} 면
     * {@code AUTH_SELF_DELETE_DISABLED}(403). 앱은 그 코드를 보고 탈퇴 화면을 감춘다.</p>
     */
    @PostMapping("/auth/account/delete")
    public ApiResponse<AccountDtos.DeleteAccountResponse> deleteAccount(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody AccountDtos.DeleteAccountRequest req) {
        Long userId = require(principal).userId();
        stepUpVerifier.require(StepUpAction.ACCOUNT_DELETE, userId, req.mfaCode(), ip(), ua());

        var result = accountDeletionService.requestSelfDelete(
                userId, req.currentPassword(), ip(), ua());
        return ApiResponse.ok(
                new AccountDtos.DeleteAccountResponse(result.mode(), result.effectiveAt()));
    }

    // ────────────────────── 내 세션 ──────────────────────

    /** 지금 어디에서 로그인돼 있는지. 사용자가 스스로 확인할 수 있어야 한다 */
    @GetMapping("/auth/sessions")
    public ApiResponse<AccountDtos.SessionListResponse> sessions(
            @AuthenticationPrincipal AuthPrincipal principal) {
        var me = require(principal);
        return ApiResponse.ok(new AccountDtos.SessionListResponse(
                sessionQueryService.listActive(me.userId(), me.sessionId())));
    }

    /** 세션 하나 끊기 — 모르는 기기를 발견했을 때 */
    @DeleteMapping("/auth/sessions/{id}")
    public ApiResponse<AccountDtos.AcceptedResponse> revokeSession(
            @AuthenticationPrincipal AuthPrincipal principal, @PathVariable String id) {
        UUID sessionId;
        try {
            sessionId = UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "세션 식별자가 올바르지 않습니다.");
        }
        sessionQueryService.revokeOwn(require(principal).userId(), sessionId, ip(), ua());
        return ApiResponse.ok(AccountDtos.AcceptedResponse.ok());
    }

    /** 전부 끊기 — 현재 세션도 포함한다. 계정을 빼앗겼을 때 쓰는 버튼이다 */
    @DeleteMapping("/auth/sessions")
    public ApiResponse<AccountDtos.AcceptedResponse> revokeAllSessions(
            @AuthenticationPrincipal AuthPrincipal principal) {
        sessionQueryService.revokeAllOwn(require(principal).userId(), ip(), ua());
        return ApiResponse.ok(AccountDtos.AcceptedResponse.ok());
    }

    // ────────────────────── 공통 ──────────────────────

    private AuthPrincipal require(AuthPrincipal principal) {
        if (principal == null) {
            throw new ApiException(ErrorCode.AUTH_TOKEN_INVALID);
        }
        return principal;
    }

    /** 프록시 헤더·IPv6 loopback 정규화는 ClientInfo 가 한다 */
    private String ip() {
        return clientInfo.ip(null);
    }

    private String ua() {
        return clientInfo.userAgent(null);
    }
}
