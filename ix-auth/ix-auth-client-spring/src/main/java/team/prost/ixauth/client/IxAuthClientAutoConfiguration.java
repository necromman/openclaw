package team.prost.ixauth.client;

import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.context.event.EventListener;

/**
 * 자동 구성 — 앱은 의존성을 넣고 {@code ixauth.client.*} 만 설정하면 된다.
 *
 * <p>필터를 SecurityFilterChain 에 꽂는 것은 <b>앱이 직접 한다.</b> 앱마다 보안 설정이
 * 달라서 우리가 임의로 끼워 넣으면 기존 설정과 충돌한다. README 의 예시를 참고한다.</p>
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(IxAuthClientProperties.class)
@ConditionalOnProperty(prefix = "ixauth.client", name = "enabled", havingValue = "true",
        matchIfMissing = true)
@Slf4j
public class IxAuthClientAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public IxAuthClient ixAuthClient(IxAuthClientProperties props) {
        return new IxAuthClient(props);
    }

    @Bean
    @ConditionalOnMissingBean
    public IxAuthAuthenticationFilter ixAuthAuthenticationFilter(
            IxAuthClient client, IxAuthClientProperties props) {
        return new IxAuthAuthenticationFilter(client, props);
    }

    /**
     * permission-map 을 미리 받아 둔다.
     *
     * <p>실패해도 앱 부팅을 막지 않는다 — IX-Auth 가 아직 안 떴을 수 있고, 그 때문에
     * 앱이 못 뜨면 사이드카를 쓰는 의미가 없다. 첫 요청에서 다시 시도한다.</p>
     */
    @EventListener(ContextRefreshedEvent.class)
    public void preload(ContextRefreshedEvent event) {
        var props = event.getApplicationContext().getBean(IxAuthClientProperties.class);
        if (!props.isPreloadPermissionMap()) {
            return;
        }
        try {
            var map = event.getApplicationContext().getBean(IxAuthClient.class).loadPermissionMap();
            log.info("IX-Auth permission-map 로드 — version={}, 역할 {}개",
                    map.version(), map.roles().size());
        } catch (Exception e) {
            log.warn("IX-Auth permission-map 을 아직 받지 못했습니다 ({}). 첫 요청에서 다시 시도합니다.",
                    e.getMessage());
        }
    }
}
