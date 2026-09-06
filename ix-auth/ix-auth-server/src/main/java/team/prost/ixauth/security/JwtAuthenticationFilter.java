package team.prost.ixauth.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import team.prost.ixauth.common.ApiException;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * access token 으로 사용자 컨텍스트를 세운다 — <b>관리 API 와 {@code /auth/me} 전용</b>.
 *
 * <p>앱의 일반 요청은 여기를 거치지 않는다. 앱이 JWKS 공개키로 스스로 검증한다
 * (설계 불변식 2). 이 필터는 jar 자신의 API 를 보호하기 위한 것이다.</p>
 */
@RequiredArgsConstructor
@Slf4j
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER = "Bearer ";

    private final JwtService jwtService;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith(BEARER)) {
            try {
                var claims = jwtService.verify(header.substring(BEARER.length()));
                List<String> roles = claims.getStringListClaim(JwtService.CLAIM_ROLES);

                var authorities = new ArrayList<SimpleGrantedAuthority>();
                if (roles != null) {
                    roles.forEach(r -> authorities.add(new SimpleGrantedAuthority("ROLE_" + r)));
                }

                var principal = new AuthPrincipal(
                        Long.valueOf(claims.getSubject()),
                        claims.getStringClaim("email"),
                        claims.getStringClaim("name"),
                        roles == null ? List.of() : roles,
                        claims.getStringListClaim(JwtService.CLAIM_GROUPS),
                        parseSid(claims.getStringClaim(JwtService.CLAIM_SID)),
                        parseActor(claims.getJSONObjectClaim(JwtService.CLAIM_ACT)));

                var auth = new UsernamePasswordAuthenticationToken(principal, null, authorities);
                SecurityContextHolder.getContext().setAuthentication(auth);
            } catch (ApiException e) {
                // 토큰이 잘못돼도 여기서 응답을 쓰지 않는다 — 경로별 인가가 401/403 을 낸다
                log.debug("토큰 검증 실패: {}", e.getCode());
            } catch (Exception e) {
                log.debug("토큰 파싱 실패");
            }
        }
        chain.doFilter(request, response);
    }

    /**
     * {@code act} 클레임 — 대리 세션에만 있다.
     *
     * <p>모양이 깨져 있으면 <b>대리로 보지 않고 통째로 버린다.</b> 여기서 관대하게
     * 넘어가면 "대리인데 대리로 인식되지 않는 세션" 이 생기고, 그 세션은 민감 작업
     * 차단(ImpersonationGuard)을 그냥 지나간다.</p>
     */
    private static Impersonator parseActor(Map<String, Object> act) {
        if (act == null) {
            return null;
        }
        Object sub = act.get("sub");
        if (sub == null) {
            return null;
        }
        try {
            Object email = act.get("email");
            return new Impersonator(Long.valueOf(String.valueOf(sub)),
                    email == null ? null : String.valueOf(email));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** 옛 토큰에는 sid 가 없을 수 있다 — 없다고 인증을 막지는 않는다 */
    private static UUID parseSid(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** 대리 중인 관리자 — 토큰 {@code act} 클레임에서 나온다 */
    public record Impersonator(Long userId, String email) {
    }

    /**
     * SecurityContext 에 담기는 사용자 정보.
     *
     * @param sessionId 이 토큰을 발급한 세션 — '지금 쓰는 기기' 를 표시하는 데 쓴다
     * @param impersonator 이 세션을 대리 중인 관리자. 평범한 로그인이면 {@code null}
     */
    public record AuthPrincipal(Long userId, String email, String name,
                                List<String> roles, List<String> groups, UUID sessionId,
                                Impersonator impersonator) {

        public boolean isImpersonated() {
            return impersonator != null;
        }
    }
}
