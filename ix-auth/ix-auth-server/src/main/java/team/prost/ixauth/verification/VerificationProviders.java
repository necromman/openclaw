package team.prost.ixauth.verification;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * 쓸 수 있는 본인확인 수단.
 *
 * <p>새 수단을 추가하려면 {@link VerificationProvider} 구현 하나를 만들어 빈으로 두면
 * 된다. 가입 흐름은 바뀌지 않는다 — 그것이 이 추상화의 목적이다.</p>
 */
@Component
@RequiredArgsConstructor
public class VerificationProviders {

    private final List<VerificationProvider> providers;

    private Map<IxAuthProperties.SignupVerification, VerificationProvider> byKind() {
        var map = new EnumMap<IxAuthProperties.SignupVerification, VerificationProvider>(
                IxAuthProperties.SignupVerification.class);
        providers.forEach(p -> map.put(p.kind(), p));
        return map;
    }

    /**
     * 그 수단을 쓸 수 있는지 확인하고 돌려준다.
     *
     * <p>연동이 없으면 <b>가입을 실패시킨다.</b> 확인하지 않은 것을 확인한 척하고
     * 통과시키면, "본인확인 필수" 라고 설정해 둔 운영자의 의도가 조용히 무너진다.</p>
     */
    public VerificationProvider require(IxAuthProperties.SignupVerification kind) {
        VerificationProvider p = byKind().get(kind);
        if (p == null || !p.isConfigured()) {
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE,
                    "본인확인 연동이 준비되지 않았습니다. 관리자에게 문의하세요.");
        }
        return p;
    }

    /** 관리 화면이 "고를 수 있는 수단" 을 표시하는 데 쓴다 */
    public List<String> configured() {
        return providers.stream().filter(VerificationProvider::isConfigured)
                .map(p -> p.kind().name()).toList();
    }
}
