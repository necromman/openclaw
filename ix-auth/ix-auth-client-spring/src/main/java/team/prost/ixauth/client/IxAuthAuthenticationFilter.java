package team.prost.ixauth.client;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.ArrayList;

/**
 * 쿠키(또는 Bearer 헤더)의 토큰을 <b>로컬 검증</b>해 SecurityContext 를 세운다.
 *
 * <p>이 필터는 <b>네트워크를 타지 않는다</b> — JWKS 공개키가 캐시돼 있으면 순수 계산이다
 * (설계 불변식 2). IX-Auth 가 재시작 중이어도 이미 로그인한 사용자는 영향이 없다.</p>
 *
 * <p>권한(authority)은 두 벌을 넣는다:</p>
 * <ul>
 *   <li>{@code ROLE_<역할코드>} — {@code hasRole()} 로 쓰기 위해</li>
 *   <li>권한 코드 그대로 — {@code hasAuthority('page:reports:view')} 로 쓰기 위해</li>
 * </ul>
 */
@RequiredArgsConstructor
@Slf4j
public class IxAuthAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER = "Bearer ";

    private final IxAuthClient client;
    private final IxAuthClientProperties props;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String token = tokenOf(request);
        if (token != null) {
            try {
                var claims = client.verify(token);          // ← 네트워크 없음
                client.refreshMapIfStale(claims);

                var principal = IxAuthPrincipal.from(claims);
                var authorities = new ArrayList<SimpleGrantedAuthority>();
                principal.roles().forEach(r -> authorities.add(new SimpleGrantedAuthority("ROLE_" + r)));
                // 권한 코드도 그대로 — hasAuthority('page:reports:view') 를 쓸 수 있게
                client.effectivePermissions(claims)
                        .forEach(p -> authorities.add(new SimpleGrantedAuthority(p)));

                SecurityContextHolder.getContext().setAuthentication(
                        new UsernamePasswordAuthenticationToken(principal, null, authorities));
            } catch (IxAuthClient.IxAuthTokenException e) {
                // 여기서 응답을 쓰지 않는다 — 경로별 인가가 401/403 을 낸다
                log.debug("토큰 검증 실패: {}", e.getMessage());
            }
        }
        chain.doFilter(request, response);
    }

    private String tokenOf(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies != null) {
            for (Cookie c : cookies) {
                if (props.getAccessCookie().equals(c.getName())) {
                    return c.getValue();
                }
            }
        }
        String header = request.getHeader("Authorization");
        return (header != null && header.startsWith(BEARER)) ? header.substring(BEARER.length()) : null;
    }
}
