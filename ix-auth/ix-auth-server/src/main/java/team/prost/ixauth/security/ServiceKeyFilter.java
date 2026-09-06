package team.prost.ixauth.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;

/**
 * 앱 → jar 서버 간 인증 ({@code X-IxAuth-Key}).
 *
 * <p>jar 는 외부에 노출되지 않으므로(설계 불변식 4) 이 키는 내부 통신 식별자다.
 * 통과하면 {@code ROLE_SERVICE} 를 부여한다.</p>
 *
 * <p>키 비교는 타이밍 공격을 피해 상수 시간으로 한다.</p>
 */
@RequiredArgsConstructor
public class ServiceKeyFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-IxAuth-Key";
    public static final String ROLE_SERVICE = "ROLE_SERVICE";

    /**
     * 키 검사 결과를 남겨 둔다 — 인가 실패 시 {@code ApiAuthenticationEntryPoint} 가
     * "키가 없어서" 인지 "키가 틀려서" 인지 구분해 계약 에러코드를 고른다.
     * 이게 없으면 앱은 빈 401 만 받고 원인을 알 수 없다.
     */
    public static final String ATTR_RESULT = "ixauth.serviceKey.result";

    public enum Result { MISSING, INVALID, OK }

    private final String expectedKey;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String given = request.getHeader(HEADER);
        Result result;
        if (given == null) {
            result = Result.MISSING;
        } else if (constantTimeEquals(given, expectedKey)) {
            result = Result.OK;
            var auth = new UsernamePasswordAuthenticationToken(
                    "service", null, List.of(new SimpleGrantedAuthority(ROLE_SERVICE)));
            SecurityContextHolder.getContext().setAuthentication(auth);
        } else {
            result = Result.INVALID;
        }
        request.setAttribute(ATTR_RESULT, result);
        // 실패해도 여기서 막지 않는다 — 경로별 인가는 SecurityConfig 가 판단한다
        chain.doFilter(request, response);
    }

    private boolean constantTimeEquals(String a, String b) {
        return MessageDigest.isEqual(
                a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }
}
