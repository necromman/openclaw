package team.prost.ixauth.api.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

import java.util.List;

/** 인증 API 요청·응답. 정본은 docs/contract/http-api.md §2. */
public final class AuthDtos {

    private AuthDtos() {
    }

    public record LoginRequest(
            @NotBlank @Email String email,
            @NotBlank String password,
            /** 앱이 전달하는 최종 사용자 정보 — jar 입장에선 앱이 클라이언트라 직접 알 수 없다 */
            String userAgent,
            String ip,
            /**
             * CAPTCHA 토큰. {@code captcha.protect} 에 {@code LOGIN} 이 들어 있을 때만 본다.
             * 꺼져 있으면 보내도 무시되므로 앱이 조건 분기를 둘 필요가 없다
             */
            String captchaToken) {
    }

    /**
     * @param mfaSetupRequired 2단계 인증이 필수인데 아직 등록하지 않았다.
     *                         앱은 이 값이 참이면 등록 화면으로 보낸다 — jar 가 로그인
     *                         자체를 막지 않는 이유는 설정을 바꾼 순간 전원이 잠기기
     *                         때문이다 (docs/contract/http-api.md §2-3)
     * @param termsAgreementRequired 아직 동의하지 않은 <b>필수</b> 약관 코드.
     *                         비어 있으면 앱은 아무것도 하지 않아도 된다.
     *                         {@code mfaSetupRequired} 와 같은 이유로 로그인을 막지 않는다 —
     *                         막으면 새 약관을 게시하는 순간 전원이 못 들어온다
     */
    public record LoginResponse(String accessToken, String refreshToken, long expiresIn,
                                UserSummary user, boolean mfaSetupRequired,
                                List<String> termsAgreementRequired) {
    }

    public record RefreshRequest(@NotBlank String refreshToken) {
    }

    public record RefreshResponse(String accessToken, String refreshToken, long expiresIn) {
    }

    public record LogoutRequest(String refreshToken, String sessionId) {
    }

    public record UserSummary(String id, String email, String name,
                              List<String> roles, List<String> groups) {
    }

    // ── 사용자 대리 (impersonation) ──

    /**
     * 앱이 전달하는 최종 사용자 정보 — 로그인 요청과 같은 이유다. 이 값이 대리 세션과
     * 감사 로그에 남는다. 본문 없이 호출해도 된다(그러면 요청 헤더에서 뽑는다).
     */
    public record ImpersonateRequest(String userAgent, String ip) {
    }

    /**
     * 로그인과 같은 봉투다 — 앱이 로그인 응답을 다루던 코드를 그대로 쓸 수 있어야 한다.
     *
     * <p>다른 점은 {@code impersonator} 한 칸뿐이고, 그 값은 access token 의 표준
     * {@code act} 클레임과 같은 사실을 가리킨다. 토큰을 열어 보지 않고도 "지금 누구를
     * 대리 중인가" 를 화면에 띄울 수 있어야 하기 때문이다.</p>
     *
     * <p>{@code mfaSetupRequired} · {@code termsAgreementRequired} 는 싣지 않는다 —
     * 관리자에게 대상 사용자의 2단계 등록이나 약관 동의를 시킬 수는 없다.</p>
     */
    public record ImpersonateResponse(String accessToken, String refreshToken, long expiresIn,
                                      UserSummary user, ActorSummary impersonator) {
    }

    /** 대리 중인 관리자 — 토큰 {@code act} 클레임의 사람 */
    public record ActorSummary(String id, String email, String name) {
    }

    public record MeResponse(String id, String email, String name,
                             List<String> roles, List<String> groups,
                             java.util.Map<String, Object> attributes,
                             java.time.Instant lastLoginAt) {
    }

    // ── 매직 링크 (2026-08-08 추가) ──

    /**
     * 로그인 링크 요청.
     *
     * <p>응답은 <b>계정이 있든 없든 같다</b>. 다르게 답하면 이 화면이 가입자 명부를
     * 조회하는 도구가 된다 — 비밀번호 찾기와 같은 규칙이다.</p>
     */
    public record MagicLinkRequest(@NotBlank @Email String email, String captchaToken) {
    }

    /**
     * 링크의 토큰을 중계한다. 성공하면 {@code /auth/login} 200 과 같은 모양이다.
     *
     * @param userAgent 앱이 전달하는 최종 사용자 정보 — 로그인 요청과 같은 이유다.
     *                  이 값이 세션과 감사 로그에 남고, 새 기기 알림 판정에도 쓰인다
     */
    public record MagicLinkVerifyRequest(@NotBlank String token,
                                         String userAgent, String ip) {
    }

    // ── 연합 신원 교환 (2026-08-27 추가) ──

    /**
     * 앱이 <b>이미 검증한</b> 외부 신원 한 벌.
     *
     * <p>{@code subject} 는 외부 IdP 가 주는 불변 식별자다 — 이메일이 아니다. 이메일은
     * 바뀌고, 바뀐 주소가 남에게 재할당될 수도 있다. 매칭은 {@code (provider, subject)}
     * 로만 한다.</p>
     *
     * <p>{@code email} 을 필수로 두지 않은 이유 — 주지 않는 IdP 가 있을 수 있다. 다만
     * 없으면 연결도 생성도 할 수 없어 {@code AUTH_FEDERATION_NO_ACCOUNT}(404) 다.
     * 형식만 맞으면 되고, 그 주소가 진짜인지는 <b>앱이 이미 확인했다</b>는 전제다.</p>
     *
     * @param userAgent 앱이 전달하는 최종 사용자 정보 — 로그인 요청과 같은 이유다.
     *                  이 값이 세션과 감사 로그에 남는다
     * @param ip        최종 사용자의 IP. 뽑는 법은 docs/guides/client-ip.md
     */
    public record FederatedExchangeRequest(@NotBlank String provider,
                                           @NotBlank String subject,
                                           @Email String email,
                                           String name,
                                           String userAgent, String ip) {
    }
}
