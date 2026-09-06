package team.prost.ixauth.verification;

import org.springframework.stereotype.Component;
import team.prost.ixauth.config.IxAuthProperties;

/**
 * 이메일 링크 확인 — IX-Auth 가 직접 한다.
 *
 * <p>실제 메일 발송은 가입 흐름에서 처리하므로 여기서는 "쓸 수 있다" 만 알린다.
 * 목록에 나타나게 하는 것이 이 클래스의 역할이다.</p>
 */
@Component
public class EmailVerificationProvider implements VerificationProvider {

    @Override
    public IxAuthProperties.SignupVerification kind() {
        return IxAuthProperties.SignupVerification.EMAIL;
    }

    @Override
    public boolean isConfigured() {
        return true;
    }

    @Override
    public String begin(Long userId) {
        return null;   // 메일은 가입 흐름이 이미 보냈다
    }
}
