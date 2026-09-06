package team.prost.ixauth.client;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * 앱 측 설정 — {@code ixauth.client.*}.
 *
 * <p>{@code base-url} 은 <b>내부 통신 주소</b>다. IX-Auth 는 외부에 노출되지 않으므로
 * (설계 불변식 4) 브라우저가 이 주소를 알 필요가 없다.</p>
 */
@ConfigurationProperties(prefix = "ixauth.client")
@Getter
@Setter
public class IxAuthClientProperties {

    /** false 면 자동 구성을 통째로 끈다 */
    private boolean enabled = true;

    /** IX-Auth jar 주소 (내부) */
    private String baseUrl = "http://localhost:9100";

    /** 앱→jar 공유 시크릿. 브라우저로 내보내지 않는다 */
    private String serviceKey = "";

    /** 토큰 iss 검증값. jar 의 ixauth.jwt.issuer 와 같아야 한다 */
    private String issuer = "";

    /** 미설정 시 issuer 를 쓴다 */
    private String audience = "";

    private Duration clockSkew = Duration.ofSeconds(60);

    /** 액세스 토큰을 담는 쿠키 이름 (앱이 발급한다) */
    private String accessCookie = "ixauth_at";
    private String refreshCookie = "ixauth_rt";

    /** JWKS 캐시 — 짧으면 jar 부하가 늘고, 길면 키 회전 반영이 늦다 */
    private Duration jwksCache = Duration.ofMinutes(10);

    /**
     * permission-map 을 부팅 시 미리 받아 둘지.
     *
     * <p>{@code true} 면 jar 가 아직 안 떠 있을 때 앱 부팅이 지연될 수 있다.
     * 그래서 실패해도 부팅을 막지 않고, 첫 요청에서 다시 시도한다.</p>
     */
    private boolean preloadPermissionMap = true;

    /**
     * L2 판정 중 jar 에 닿지 못했을 때의 동작.
     *
     * <p>기본 {@code DENY} — 권한을 확인할 수 없으면 막는다(fail-secure). 가용성이
     * 더 중요한 화면이라면 {@code L1} 로 두어 광역 권한으로 대신 판정할 수 있으나,
     * 그때는 개별 리소스의 DENY 예외가 무시된다는 것을 알고 써야 한다.</p>
     */
    private ResourceFallback resourceFallback = ResourceFallback.DENY;

    /** jar 미도달 시 L2 판정을 어떻게 할지 */
    public enum ResourceFallback {
        /** 거부한다 (fail-secure) */
        DENY,
        /** L1 광역 권한으로 대신 판정한다 */
        L1
    }

    public String effectiveAudience() {
        return (audience == null || audience.isBlank()) ? issuer : audience;
    }
}
