package team.prost.ixauth.api.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * 계정 라이프사이클 DTO.
 *
 * <p>요청 응답에 "그런 계정이 없습니다" 를 담지 않는다 — 그렇게 답하는 화면은
 * 가입자 명부를 조회하는 도구가 된다. 그래서 요청형 응답은 모두 같은 모양이다.</p>
 */
public final class AccountDtos {

    private AccountDtos() {
    }

    // ── 비밀번호 ──

    /**
     * @param captchaToken {@code captcha.protect} 에 {@code PASSWORD_FORGOT} 이 있을 때만 본다.
     *                     꺼져 있으면 보내도 무시된다 — 앱이 조건 분기를 둘 필요가 없다
     */
    public record ForgotPasswordRequest(@NotBlank @Email String email, String captchaToken) {
    }

    public record ResetPasswordRequest(@NotBlank String token, @NotBlank String newPassword) {
    }

    /**
     * @param mfaCode 2단계 인증 코드(또는 백업 코드). {@code mfa.step-up-actions} 에
     *                {@code PASSWORD_CHANGE} 가 있고 이 계정이 2단계를 켜 두었을 때만 필요하다.
     *                필요한데 없으면 {@code AUTH_MFA_REQUIRED}
     */
    public record ChangePasswordRequest(@NotBlank String currentPassword,
                                        @NotBlank String newPassword,
                                        String mfaCode) {
    }

    // ── 이메일 ──

    public record EmailRequest(@NotBlank @Email String email) {
    }

    public record VerifyEmailRequest(@NotBlank String token) {
    }

    /**
     * @param mfaCode {@code mfa.step-up-actions} 에 {@code EMAIL_CHANGE} 가 있을 때 필요하다.
     *                <b>네 작업 중 가장 중요한 자리다</b> — 주소를 바꾸면 그다음 "비밀번호
     *                찾기" 한 번으로 계정이 통째로 넘어간다
     */
    public record ChangeEmailRequest(@NotBlank @Email String newEmail,
                                     @NotBlank String currentPassword,
                                     String mfaCode) {
    }

    // ── 초대 · 가입 ──

    public record AcceptInviteRequest(@NotBlank String token, @NotBlank String password,
                                      String name) {
    }

    /**
     * @param attributes 사용자 속성. 정의({@code user_attribute_defs})가 있으면 검증된다.
     *                   정의가 없으면 그대로 저장된다
     * @param agreements 약관 코드 → 동의 여부 ({@code {"service": true, "marketing": false}}).
     *                   <b>버전은 보내지 않는다</b> — 서버가 현재 게시본으로 정한다.
     *                   클라이언트가 보낸 버전을 믿으면 옛 버전에 동의한 것으로 기록해
     *                   재동의를 회피할 수 있다
     */
    public record SignupRequest(@NotBlank @Email String email, @NotBlank String password,
                                String name, Map<String, Object> attributes,
                                Map<String, Boolean> agreements,
                                /**
                                 * {@code captcha.protect} 에 {@code SIGNUP} 이 있을 때만 본다.
                                 * 기본 보호 대상이라 가입을 여는 곳에서는 대개 필요하다
                                 */
                                String captchaToken) {
    }

    /**
     * 요청형 공통 응답.
     *
     * <p>계정이 있든 없든 이 응답이다. 앱은 이걸 받아 "메일을 보냈습니다" 라고
     * 안내하면 된다 — 실제로 보냈는지는 앱도 알 필요가 없다.</p>
     */
    public record AcceptedResponse(boolean accepted) {
        public static AcceptedResponse ok() {
            return new AcceptedResponse(true);
        }
    }

    // ── 탈퇴 ──

    /**
     * 본인 탈퇴 요청.
     *
     * <p>현재 비밀번호를 함께 받는다 — 잠깐 자리를 비운 사이 남이 계정을 닫아 버리는
     * 것을 막는다. 비밀번호 변경·이메일 변경과 같은 급의 행위다.</p>
     */
    public record DeleteAccountRequest(@NotBlank String currentPassword, String mfaCode) {
    }

    /**
     * @param mode        적용된 방식 — {@code IMMEDIATE} 면 이 응답 시점에 이미 비활성이다
     * @param effectiveAt 비활성이 되는 시각. {@code GRACE} 면 그때까지 <b>로그인 한 번</b>으로
     *                    취소할 수 있다. 앱은 이 시각을 사용자에게 그대로 보여 준다
     */
    public record DeleteAccountResponse(String mode, Instant effectiveAt) {
    }

    // ── 세션 ──

    /**
     * @param userAgent   원문. 진단용으로 그대로 둔다 — 표시가 틀렸을 때 대조할 것이 필요하다
     * @param deviceLabel 사람이 알아보는 이름 ({@code "Chrome · Windows"}).
     *                    사용자가 "이 중에 내가 모르는 기기가 있는가" 를 판단하는 건 이 값이다.
     *                    알아보지 못하면 {@code "알 수 없는 기기"} — 비어 오지 않는다
     * @param current     지금 이 요청을 보낸 세션
     */
    public record SessionInfo(String id, Instant issuedAt, Instant lastUsedAt,
                              Instant expiresAt, String ip, String userAgent,
                              String deviceLabel, boolean current) {
    }

    public record SessionListResponse(List<SessionInfo> items) {
    }

    // ── 약관 ──

    /**
     * 사용자에게 보여 줄 약관 하나.
     *
     * <p>{@code body} 와 {@code bodyUrl} 중 하나는 채워져 온다. 앱은 본문이 있으면
     * 그대로 그리고, 없으면 주소를 새 창으로 연다.</p>
     *
     * @param version 이 버전으로 동의가 기록된다. 앱은 그대로 보여 주기만 하면 되고,
     *                동의 요청에 실어 보낼 필요는 없다 — 서버가 다시 정한다
     */
    public record TermView(String code, int version, String title, String body,
                           String bodyUrl, boolean required, int displayOrder) {
    }

    public record TermListResponse(List<TermView> items) {
    }

    /** @param agreements 약관 코드 → 동의 여부. 필수 약관에 {@code false} 를 보내면 400 */
    public record AgreeTermsRequest(Map<String, Boolean> agreements) {
    }

    /**
     * @param recorded 남긴 이력 건수. 게시되지 않은 코드는 조용히 버려지므로
     *                 보낸 개수와 다를 수 있다
     * @param pending  이 요청 뒤에도 남은 필수 약관 코드. 비어야 동의 화면을 닫는다
     */
    public record AgreeTermsResponse(int recorded, List<String> pending) {
    }

    /**
     * 내 동의 이력 한 줄.
     *
     * <p>지운 것이 없으므로 옛 버전에 동의한 기록도, 거절한 기록도 그대로 나온다 —
     * 그것이 이 목록의 쓸모다.</p>
     */
    public record AgreementView(String code, int version, boolean agreed, Instant agreedAt) {
    }

    public record AgreementListResponse(List<AgreementView> items) {
    }
}
