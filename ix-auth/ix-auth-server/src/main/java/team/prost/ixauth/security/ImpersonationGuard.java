package team.prost.ixauth.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.servlet.HandlerInterceptor;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.security.JwtAuthenticationFilter.AuthPrincipal;

import java.util.List;

/**
 * 대리(impersonation) 세션이 할 수 없는 일을 막는다.
 *
 * <p><b>왜 목록이 필요한가.</b> 대리 토큰은 대상 사용자의 토큰이라, 막지 않으면 관리자가
 * 그 사람의 비밀번호·이메일을 바꾸고 2단계를 풀고 계정을 지울 수 있다. 그 흔적은 전부
 * <b>본인이 한 일</b>로 남는다 — 사고가 나면 아무도 설명할 수 없다.</p>
 *
 * <p><b>왜 필터가 아니라 인터셉터인가.</b> 필터에서 예외를 던지면 응답 봉투를 직접
 * 써야 하고, 그러면 에러 형식이 {@code GlobalExceptionHandler} 와 갈라진다. 인터셉터는
 * DispatcherServlet 안이라 {@link ApiException} 이 그대로 공통 핸들러로 간다.</p>
 *
 * <p>{@code /admin/**} 은 여기와 {@code AdminGuard} 양쪽에서 막는다. 관리 API 는 새
 * 엔드포인트가 계속 붙는 자리라 목록 한 곳에만 기대면 언젠가 빠뜨린다.</p>
 *
 * <p><b>읽기는 막지 않는다.</b> 대리의 목적이 "그 사람에게 무엇이 보이는가" 를 확인하는
 * 것이라, 조회까지 막으면 기능 자체가 성립하지 않는다. 막는 것은 상태를 바꾸는 일뿐이다.</p>
 */
@Component
@Slf4j
public class ImpersonationGuard implements HandlerInterceptor {

    private static final AntPathMatcher MATCHER = new AntPathMatcher();

    /**
     * 대리 중 금지 목록.
     *
     * <p>기준은 하나다 — <b>본인만 할 수 있어야 하는 일</b>. 자격증명(비밀번호·이메일·
     * 2단계·소셜 연결)을 바꾸는 것, 계정을 없애는 것, 본인 의사 표시(약관 동의),
     * 그리고 다른 기기의 세션을 끊는 것이다. 관리 API 전체는 재대리까지 포함해 닫는다.</p>
     */
    private static final List<Rule> DENIED = List.of(
            // 관리 API 전체 — 재대리(/admin/users/{id}/impersonate)가 여기서 닫힌다
            Rule.any("/admin/**"),
            // 자격증명 변경 — 바꾸면 본인이 못 들어온다
            Rule.any("/auth/password/change"),
            Rule.any("/auth/email/change"),
            // 계정 삭제 — 되돌릴 수 없다
            Rule.any("/auth/account/delete"),
            // 2단계 등록·해제. 상태 조회(GET /auth/mfa/status)는 막지 않는다
            Rule.any("/auth/mfa/totp"),
            Rule.any("/auth/mfa/totp/**"),
            // 소셜 계정 연결·해제. 목록 조회(GET /auth/social/links)는 막지 않는다
            Rule.any("/auth/social/*/link"),
            // 약관 동의는 그 사람과 우리 사이의 합의다. 관리자가 대신 눌러 줄 수 없다
            Rule.any("/auth/terms/agree"),
            // 남의 기기를 끊어 버리는 일. 대리를 끝내는 것은 /auth/logout 으로 한다
            Rule.of("DELETE", "/auth/sessions"),
            Rule.of("DELETE", "/auth/sessions/*"));

    private record Rule(String method, String pattern) {

        static Rule any(String pattern) {
            return new Rule(null, pattern);
        }

        static Rule of(String method, String pattern) {
            return new Rule(method, pattern);
        }

        boolean matches(String requestMethod, String path) {
            return (method == null || method.equalsIgnoreCase(requestMethod))
                    && MATCHER.match(pattern, path);
        }
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
                             Object handler) {
        AuthPrincipal principal = currentPrincipal();
        if (principal == null || !principal.isImpersonated()) {
            return true;
        }

        String path = request.getRequestURI();
        String method = request.getMethod();
        for (Rule rule : DENIED) {
            if (rule.matches(method, path)) {
                log.warn("대리 세션의 민감 작업 차단 — 관리자={} 대상={} {} {}",
                        principal.impersonator().userId(), principal.userId(), method, path);
                throw new ApiException(ErrorCode.IMPERSONATION_ACTION_FORBIDDEN);
            }
        }
        return true;
    }

    private AuthPrincipal currentPrincipal() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof AuthPrincipal p)) {
            return null;
        }
        return p;
    }
}
