package team.prost.ixauth.captcha;

import team.prost.ixauth.config.IxAuthProperties;

/**
 * CAPTCHA 토큰 하나를 검증한다.
 *
 * <p>추상화를 두는 이유는 provider 가 바뀌기 때문이다. reCAPTCHA 는 중국·러시아 등에서
 * 접속이 막히고, hCaptcha·Turnstile 로 갈아타는 곳이 흔하다. 검증 호출이 서비스 코드에
 * 박혀 있으면 그때마다 로그인 경로를 다시 건드리게 된다.</p>
 *
 * <p><b>이 인터페이스는 "판정" 만 한다.</b> 어느 경로에 걸지, 실패를 어떻게 다룰지는
 * {@link CaptchaGuard} 의 몫이다 — 정책과 통신을 한 클래스에 섞으면 provider 를 바꿀
 * 때마다 정책까지 다시 쓰게 된다.</p>
 */
public interface CaptchaVerifier {

    /** 이 구현이 담당하는 provider. {@code captcha.provider} 와 대조해 고른다 */
    IxAuthProperties.Captcha.Provider provider();

    /**
     * @param token    앱이 요청 본문의 {@code captchaToken} 으로 넘긴 값
     * @param remoteIp 최종 사용자 IP. provider 가 판정에 참고한다 (없으면 null)
     * @return 판정 결과. <b>예외를 던지지 않는다</b> — 통신 실패도 값으로 돌려준다.
     *         예외로 만들면 호출부가 "실패" 와 "못 물어봄" 을 구분하지 못해 통째로
     *         막거나 통째로 통과시키게 된다
     */
    Result verify(String token, String remoteIp);

    /**
     * @param outcome 판정
     * @param score   reCAPTCHA v3 의 점수 (0.0~1.0). 점수를 주지 않는 provider 는 -1
     * @param detail  로그에만 남길 사유. <b>응답에 싣지 않는다</b> — 점수를 넘길 때까지
     *                조정하는 데 쓰인다
     */
    record Result(Outcome outcome, double score, String detail) {

        public static Result pass(double score) {
            return new Result(Outcome.PASS, score, null);
        }

        public static Result fail(String detail, double score) {
            return new Result(Outcome.FAIL, score, detail);
        }

        public static Result unavailable(String detail) {
            return new Result(Outcome.UNAVAILABLE, -1, detail);
        }
    }

    enum Outcome {
        /** 사람으로 판정 */
        PASS,
        /** 봇으로 판정 — 위조·만료·점수 미달. <b>요청을 거부한다</b> */
        FAIL,
        /** 물어보지 못했다 — 네트워크 장애·키 미설정. <b>통과시킨다</b> */
        UNAVAILABLE
    }
}
