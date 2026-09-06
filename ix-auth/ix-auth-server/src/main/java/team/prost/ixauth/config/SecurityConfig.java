package team.prost.ixauth.config;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.DelegatingPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import team.prost.ixauth.common.ClientInfo;
import team.prost.ixauth.security.ApiAuthenticationEntryPoint;
import team.prost.ixauth.security.JwtAuthenticationFilter;
import team.prost.ixauth.security.JwtService;
import team.prost.ixauth.security.RateLimitFilter;
import team.prost.ixauth.security.ServiceKeyFilter;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;

@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final IxAuthProperties properties;
    private final JwtService jwtService;

    /**
     * 알고리즘 접두어 방식 — {@code {bcrypt}$2a$10$...}.
     *
     * <p>개발 중 프로젝트가 IX-Auth 로 이사할 때 레거시 해시를 그대로 수용하고,
     * 로그인 성공 시 현행 알고리즘으로 조용히 재해싱하기 위한 장치다.
     * 나중에 도입하면 기존 행 전부를 손봐야 한다 (docs/contract/schema.sql).</p>
     */
    @Bean
    public PasswordEncoder passwordEncoder() {
        // 평문(noop) 인코더는 등록하지 않는다. 이사 대상에 평문 비밀번호가 있으면
        // 지원하지 않고 재설정을 강제하는 것이 맞다.
        String defaultId = "bcrypt";
        var encoders = Map.<String, PasswordEncoder>of(
                "bcrypt", new BCryptPasswordEncoder(properties.getPassword().getBcryptStrength()));
        var delegating = new DelegatingPasswordEncoder(defaultId, encoders);
        // 접두어 없는 레거시 해시는 bcrypt 로 간주해 검증을 시도한다 (이사 지원)
        delegating.setDefaultPasswordEncoderForMatches(
                new BCryptPasswordEncoder(properties.getPassword().getBcryptStrength()));
        return delegating;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http, ObjectMapper objectMapper,
                                          ClientInfo clientInfo,
                                          team.prost.ixauth.security.RateLimitCounters
                                                  rateLimitCounters) throws Exception {
        http
            .csrf(csrf -> csrf.disable())               // 내부 통신 전용 + 무상태
            .cors(Customizer.withDefaults())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            // 본문 없는 401 을 내면 앱이 "키 문제인지 토큰 문제인지" 를 알 수 없다
            .exceptionHandling(e -> e
                    .authenticationEntryPoint(new ApiAuthenticationEntryPoint(objectMapper)))
            .headers(h -> h
                    .frameOptions(f -> f.deny())
                    .contentTypeOptions(Customizer.withDefaults()))
            .authorizeHttpRequests(auth -> auth
                    // 공개 — 공개키와 헬스체크
                    .requestMatchers("/health", "/.well-known/jwks.json").permitAll()
                    // 관리 화면 (자체 로그인 폼 — 정적 자산)
                    .requestMatchers(properties.getAdminUi().getPath() + "/**").permitAll()
                    // 사용자 컨텍스트가 필요한 것 — 서비스 키만으로는 지나갈 수 없다
                    .requestMatchers("/auth/me", "/authz/my-permissions",
                            "/auth/password/change", "/auth/email/change",
                            "/auth/sessions", "/auth/sessions/**",
                            // 탈퇴는 본인만. 서비스 키만으로 열리면 앱 서버를 쥔 쪽이
                            // 아무 계정이나 닫을 수 있다
                            "/auth/account/delete",
                            // 내 계정에 소셜을 붙이고 떼는 것은 본인만 한다
                            "/auth/social/links", "/auth/social/*/link",
                            // 2단계 인증 등록·해제·조회도 본인만.
                            // /auth/mfa/verify 는 여기 없다 — 그 시점엔 아직 토큰이 없다
                            "/auth/mfa/status", "/auth/mfa/totp",
                            "/auth/mfa/totp/**",
                            // 약관 동의와 내 이력은 본인만. 목록(GET /auth/terms)은
                            // 여기 없다 — 가입 화면은 로그인 전에 떠야 한다
                            "/auth/terms/agree", "/auth/terms/agreements").authenticated()
                    // 앱 → jar 서버 간 호출
                    .requestMatchers("/auth/**", "/authz/**").hasAuthority(ServiceKeyFilter.ROLE_SERVICE)
                    // 관리 API — 권한은 메서드 수준에서 다시 본다
                    .requestMatchers("/admin/**").authenticated()
                    .anyRequest().denyAll())
            // 속도 제한이 가장 앞이다 — 인증을 시도하기도 전에 막아야 의미가 있다.
            // 같은 앵커에 먼저 등록하면 그 순서가 유지된다 (커스텀 필터는 앵커로 쓸 수 없다)
            // 공용 카운터는 storage=DATABASE 일 때만 쓰인다 (기본은 인스턴스 메모리)
            .addFilterBefore(new RateLimitFilter(properties, clientInfo, objectMapper,
                            rateLimitCounters),
                    UsernamePasswordAuthenticationFilter.class)
            .addFilterBefore(new ServiceKeyFilter(properties.getServiceKey()),
                    UsernamePasswordAuthenticationFilter.class)
            .addFilterBefore(new JwtAuthenticationFilter(jwtService),
                    UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }
}
