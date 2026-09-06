package team.prost.ixauth.captcha;

import org.springframework.stereotype.Component;
import team.prost.ixauth.config.IxAuthProperties;

/**
 * 검증하지 않는 구현 ({@code captcha.provider = NONE}).
 *
 * <p>왜 두는가 — 이것이 없으면 provider 를 고르지 못했을 때 검증기가 {@code null} 이
 * 되고, 호출부마다 {@code if (verifier != null)} 이 붙는다. 그 분기가 하나라도 빠지면
 * NPE 로 <b>로그인 경로가 통째로 죽는다.</b> 아무것도 하지 않는 구현을 두는 편이 안전하다.</p>
 *
 * <p>{@link Outcome#UNAVAILABLE} 을 돌려주는 것도 의도다. {@code PASS} 로 답하면
 * "검증해서 사람으로 판정했다" 가 되어 감사 로그·지표가 거짓이 된다. 우리는 그저
 * <b>물어보지 않았을</b> 뿐이고, 그 사실이 그대로 남아야 한다.</p>
 */
@Component
public class NoopCaptchaVerifier implements CaptchaVerifier {

    @Override
    public IxAuthProperties.Captcha.Provider provider() {
        return IxAuthProperties.Captcha.Provider.NONE;
    }

    @Override
    public Result verify(String token, String remoteIp) {
        return Result.unavailable("captcha.provider = NONE — 검증하지 않는다");
    }
}
