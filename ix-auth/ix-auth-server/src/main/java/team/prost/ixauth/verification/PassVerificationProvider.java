package team.prost.ixauth.verification;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import team.prost.ixauth.config.IxAuthProperties;

/**
 * PASS 본인확인 — <b>연동 자리만 있고 구현은 없다.</b>
 *
 * <p>NICE·KCB 등과의 계약과 심사가 필요해 제품에 기본 탑재할 수 없다. 대신 자리를
 * 열어 두어, 실제 연동이 필요해졌을 때 이 클래스만 채우면 되게 했다.</p>
 *
 * <p>{@link #isConfigured()} 가 false 이므로 이 수단을 고르면 가입이 실패한다 —
 * 조용히 통과시키면 "본인확인 필수" 설정이 아무 일도 하지 않게 된다.</p>
 */
@Slf4j
@Component
public class PassVerificationProvider implements VerificationProvider {

    @Override
    public IxAuthProperties.SignupVerification kind() {
        return IxAuthProperties.SignupVerification.PASS;
    }

    @Override
    public boolean isConfigured() {
        return false;
    }

    @Override
    public String begin(Long userId) {
        log.warn("PASS 본인확인이 요청됐으나 연동이 없습니다 — user={}", userId);
        throw new UnsupportedOperationException("PASS 연동이 구현되지 않았습니다");
    }
}
