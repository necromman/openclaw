package team.prost.ixtrust.client.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import team.prost.ixtrust.client.spi.SsoUserInfo;
import team.prost.ixtrust.client.spi.SsoUserProvider;

import java.io.IOException;
import java.util.List;

@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtProvider jwtProvider;
    @SuppressWarnings("rawtypes")
    private final SsoUserProvider userProvider;
    private final TokenBlacklistService tokenBlacklistService;

    /** 공개 엔드포인트는 JWT 필터 스킵 — 블랙리스트 체크가 permitAll을 차단하는 문제 방지 */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return path.startsWith("/api/auth/")
                || path.startsWith("/api/callback/")
                || path.equals("/api/health");
    }

    @Override
    @SuppressWarnings({"rawtypes", "unchecked"})
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String token = resolveToken(request);

        if (token != null && jwtProvider.validateToken(token)) {
            String userIdAsString = jwtProvider.getUserIdAsString(token);
            String email = jwtProvider.getEmail(token);
            String sid = jwtProvider.getSid(token);
            long iatSec = jwtProvider.getIssuedAtSec(token);

            // 백채널 로그아웃으로 무효화된 토큰 차단 (iat < cutoff) — email 또는 sid 기준
            if (tokenBlacklistService.isBlacklisted(email, sid, iatSec)) {
                response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                response.setContentType("application/json;charset=UTF-8");
                response.getWriter().write("{\"error\":\"세션이 종료되었습니다.\",\"code\":\"SESSION_LOGGED_OUT\"}");
                return;
            }

            // 1.7.0 — SsoUserProvider.findById(String) 호출. SP 가 자기 ID type 으로 변환.
            SsoUserInfo user = (SsoUserInfo) userProvider.findById(userIdAsString).orElse(null);
            if (user != null && user.isActive()) {
                String role = user.getPrimaryRole();
                var authorities = List.of(new SimpleGrantedAuthority("ROLE_" + role));
                // 1.7.1 — AuthUser<ID> generic. raw 생성 후 SP 가 자기 type 으로 cast 받음.
                AuthUser au = new AuthUser(user.getId(), user.getEmail(), role);
                var auth = new UsernamePasswordAuthenticationToken(au, null, authorities);
                SecurityContextHolder.getContext().setAuthentication(auth);
            }
        }

        filterChain.doFilter(request, response);
    }

    private String resolveToken(HttpServletRequest request) {
        // 1. Authorization 헤더 (API 클라이언트, 외부 호출)
        String bearer = request.getHeader("Authorization");
        if (bearer != null && bearer.startsWith("Bearer ")) {
            return bearer.substring(7);
        }
        // 2. httpOnly 쿠키 (브라우저)
        return CookieHelper.getCookieValue(request, CookieHelper.ACCESS_TOKEN_COOKIE);
    }

    /**
     * 1.7.1 — {@code AuthUser<ID>} generic record. SP 컨트롤러에서 자기 ID type 으로 받음.
     * <pre>
     *   {@literal @}AuthenticationPrincipal AuthUser&lt;Long&gt; authUser    // SX-Flow / EX-Ops / PRO-Tech
     *   {@literal @}AuthenticationPrincipal AuthUser&lt;UUID&gt; authUser    // PX-PILOT
     * </pre>
     * SDK 내부는 raw type {@code AuthUser} 으로 생성, SP 측 declared type 으로 cast 됨.
     * 1.7.0 raw type {@code AuthUser(Object id, ...)} 호환성 유지 — type erasure 후 동일.
     */
    public record AuthUser<ID>(ID id, String email, String role) { }
}
