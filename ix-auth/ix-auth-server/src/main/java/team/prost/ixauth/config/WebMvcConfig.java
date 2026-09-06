package team.prost.ixauth.config;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import team.prost.ixauth.security.ImpersonationGuard;

/**
 * MVC 인터셉터 등록.
 *
 * <p>지금은 대리 세션의 민감 작업 차단 하나뿐이다. 인가는 Spring Security 가 하고,
 * 여기는 <b>인증된 뒤에</b> 판단해야 하는 것만 둔다.</p>
 */
@Configuration
@RequiredArgsConstructor
public class WebMvcConfig implements WebMvcConfigurer {

    private final ImpersonationGuard impersonationGuard;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(impersonationGuard).addPathPatterns("/auth/**", "/admin/**");
    }
}
