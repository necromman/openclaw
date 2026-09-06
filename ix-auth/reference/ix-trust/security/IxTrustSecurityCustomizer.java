package team.prost.ixtrust.client.security;

import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;

/**
 * SecurityFilterChain 추가 커스터마이징 콜백.
 *
 * <h3>두 가지 hook 단계 (1.6.0+)</h3>
 * <ol>
 *   <li>{@link #authorizeRequests} — {@code authorizeHttpRequests} 안에서 추가 매처를 등록한다.
 *       SDK 가 {@code anyRequest().authenticated()} 를 박기 <b>전</b>에 호출되므로 사용자 매처가
 *       항상 우선 적용된다. PM/DEV 같은 다양한 역할 매핑이나 메서드별 매핑이 필요할 때 사용.</li>
 *   <li>{@link #customize} — 그 외 {@link HttpSecurity} 설정 (CSRF, headers, addFilter 등).
 *       매처 등록 / anyRequest / SDK 의 Filter 가 모두 박힌 <b>이후</b>에 호출된다.</li>
 * </ol>
 * 둘 다 default 메서드라 SP 는 필요한 단계만 override 하면 된다.
 *
 * <p>1.5.x 호환: 기존 {@code customize(HttpSecurity)} 만 구현한 람다도 그대로 동작한다.</p>
 *
 * <p>예시 — 권한 매처 등록:</p>
 * <pre>
 * {@literal @}Bean
 * public IxTrustSecurityCustomizer pxPilotMatchers() {
 *     return new IxTrustSecurityCustomizer() {
 *         {@literal @}Override
 *         public void authorizeRequests(AuthorizeHttpRequestsConfigurer&lt;HttpSecurity&gt;
 *                 .AuthorizationManagerRequestMatcherRegistry auth) {
 *             auth.requestMatchers(HttpMethod.POST, "/api/projects").hasAnyRole("PM", "ADMIN");
 *             auth.requestMatchers("/api/admin/cleanup-tasks/**").hasRole("SUPER_ADMIN");
 *         }
 *     };
 * }
 * </pre>
 *
 * <p>예시 — Filter 추가:</p>
 * <pre>
 * {@literal @}Bean
 * public IxTrustSecurityCustomizer pxPilotFilters(HarnessApiKeyFilter harness) {
 *     return http -&gt; http.addFilterBefore(harness,
 *             UsernamePasswordAuthenticationFilter.class);
 * }
 * </pre>
 */
public interface IxTrustSecurityCustomizer {

    /**
     * 권한 매처 추가 hook. SDK 가 {@code permit-all-patterns} / {@code admin-patterns} /
     * {@code matchers} 적용 후 {@code anyRequest()} 박기 직전에 호출된다.
     *
     * <p>구현 안 하면 (default) 아무 매처도 추가하지 않는다.</p>
     */
    default void authorizeRequests(
            AuthorizeHttpRequestsConfigurer<HttpSecurity>
                    .AuthorizationManagerRequestMatcherRegistry auth) {
        // no-op
    }

    /**
     * 일반 HttpSecurity 커스터마이징 hook. 매처 / Filter 가 다 박힌 후 호출된다.
     * CSRF 예외 추가, 헤더 정책, 추가 Filter (addFilterBefore/After) 등.
     *
     * <p>구현 안 하면 (default) 아무 변경 안 한다.</p>
     */
    default void customize(HttpSecurity http) throws Exception {
        // no-op
    }
}
