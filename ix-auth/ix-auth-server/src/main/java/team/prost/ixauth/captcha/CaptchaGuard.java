package team.prost.ixauth.captcha;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.config.IxAuthProperties.CaptchaAction;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * "이 요청에 CAPTCHA 를 요구할 것인가, 그리고 결과를 어떻게 다룰 것인가."
 *
 * <h2>왜 속도 제한만으로 부족한가</h2>
 *
 * <p>속도 제한은 <b>한 출처의 속도</b>를 누른다. 그런데 실제 무차별 대입은 봇넷에서
 * 온다 — 수천 IP 가 각각 한 번씩 던지면 어느 IP 도 분당 한도를 넘지 않은 채 전부
 * 통과한다. 계정 잠금도 마찬가지로 계정당이라, 수천 계정에 흔한 비밀번호를 한 번씩
 * 시도하는 방식(password spraying)을 막지 못한다. CAPTCHA 는 그 빈틈을 메운다.</p>
 *
 * <h2>실패는 거부, 미도달은 통과 — 이 비대칭이 핵심이다</h2>
 *
 * <table>
 *   <caption>판정별 처리</caption>
 *   <tr><th>결과</th><th>처리</th><th>왜</th></tr>
 *   <tr><td>{@code FAIL}</td><td><b>거부</b>(fail-closed)</td>
 *       <td>provider 가 정상적으로 "봇" 이라고 답했다. 통과시키면 이 기능이 없는 것과 같다</td></tr>
 *   <tr><td>{@code UNAVAILABLE}</td><td><b>통과</b>(fail-open)</td>
 *       <td>물어보지 못했을 뿐 봇이라는 증거가 없다. 여기서 막으면 <b>Google 장애가
 *           우리 가입 장애</b>가 된다 — 남의 서비스 가용성에 우리 로그인을 묶는 셈이다</td></tr>
 * </table>
 *
 * <p>이 판단은 유출 비밀번호 검사({@code password.check-breached})와 같다. 외부 조회에
 * 기대는 <b>보조 검사</b>는 못 물어봤을 때 통과시킨다. 다만 그 사실은 WARN 으로 남긴다 —
 * 조용히 통과하면 검증이 몇 주째 죽어 있어도 아무도 모른다.</p>
 *
 * <p>반대로 <b>토큰이 아예 안 온 것은 통과시키지 않는다.</b> 그건 외부 장애가 아니라
 * 앱이 보내지 않은 것이고, 통과시키면 공격자도 토큰을 빼고 보내면 그만이다.</p>
 */
@Slf4j
@Component
public class CaptchaGuard {

    private final IxAuthProperties properties;
    private final Map<IxAuthProperties.Captcha.Provider, CaptchaVerifier> verifiers =
            new EnumMap<>(IxAuthProperties.Captcha.Provider.class);

    public CaptchaGuard(IxAuthProperties properties, List<CaptchaVerifier> available) {
        this.properties = properties;
        available.forEach(v -> verifiers.put(v.provider(), v));
    }

    /**
     * 이 경로에 CAPTCHA 가 걸려 있으면 검증하고, 걸리지 않았으면 아무것도 하지 않는다.
     *
     * @param token    요청 본문의 {@code captchaToken}. 없으면 null
     * @param remoteIp 최종 사용자 IP (앱이 전달한 값). provider 가 판정에 참고한다
     * @throws ApiException {@code AUTH_CAPTCHA_REQUIRED} · {@code AUTH_CAPTCHA_FAILED}
     */
    public void require(CaptchaAction action, String token, String remoteIp) {
        if (!isProtected(action)) {
            return;
        }
        if (token == null || token.isBlank()) {
            // 앱의 실수다. 사용자에게 보일 것은 "다시 시도" 뿐이라 400 으로 준다
            log.debug("CAPTCHA 토큰 없음 — action={}", action);
            throw new ApiException(ErrorCode.AUTH_CAPTCHA_REQUIRED);
        }

        var verifier = verifiers.get(properties.getCaptcha().getProvider());
        if (verifier == null) {
            // 구현이 없는 provider 를 골랐다. 막지 않는다 — 설정 실수로 가입이 멈추면 안 된다
            log.warn("CAPTCHA provider 구현이 없다 — provider={} · 검증을 건너뛰고 통과시킨다",
                    properties.getCaptcha().getProvider());
            return;
        }

        apply(action, verifier.verify(token, remoteIp));
    }

    private void apply(CaptchaAction action, CaptchaVerifier.Result result) {
        switch (result.outcome()) {
            case PASS -> log.debug("CAPTCHA 통과 — action={} score={}", action, result.score());
            case FAIL -> {
                // provider 가 답한 판정이다. 여기서 통과시키면 이 기능이 있으나 마나다
                log.info("CAPTCHA 거부 — action={} ({})", action, result.detail());
                throw new ApiException(ErrorCode.AUTH_CAPTCHA_FAILED);
            }
            // 못 물어봤다 = 봇이라는 증거가 없다. 남의 장애를 우리 장애로 만들지 않는다.
            // WARN 인 것은 조용히 통과하면 검증이 죽어 있어도 아무도 모르기 때문이다
            case UNAVAILABLE -> log.warn(
                    "CAPTCHA 확인 실패 — 검사를 건너뛰고 통과시킨다 · action={} ({})",
                    action, result.detail());
            default -> throw new IllegalStateException("처리하지 않은 판정: " + result.outcome());
        }
    }

    /** 앱이 이 경로에 토큰을 실어야 하는지 미리 알 수 있게 — 로그인 화면이 위젯을 그릴지 정한다 */
    public boolean isProtected(CaptchaAction action) {
        var config = properties.getCaptcha();
        return config.isEnabled() && config.getProtect() != null
                && config.getProtect().contains(action);
    }
}
