package team.prost.ixauth.verification;

import team.prost.ixauth.config.IxAuthProperties;

/**
 * 본인확인 수단 하나.
 *
 * <p>이메일 링크는 IX-Auth 가 직접 하지만, PASS 같은 실명확인은 외부 서비스
 * (NICE·KCB 등)와의 계약이 필요하다. 그 연동을 붙일 자리를 미리 열어 둔다 —
 * 나중에 끼워 넣으려면 가입 흐름 전체를 다시 손봐야 하기 때문이다.</p>
 */
public interface VerificationProvider {

    IxAuthProperties.SignupVerification kind();

    /** 연동이 실제로 설정돼 있는가. false 면 그 수단을 고를 수 없다 */
    boolean isConfigured();

    /**
     * 확인 절차를 시작한다.
     *
     * @return 사용자를 보낼 주소 (있는 경우). 이메일처럼 앱이 별도로 안내하면 null
     */
    String begin(Long userId);
}
