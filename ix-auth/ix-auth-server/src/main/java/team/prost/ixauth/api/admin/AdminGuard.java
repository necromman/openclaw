package team.prost.ixauth.api.admin;

import lombok.RequiredArgsConstructor;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import team.prost.ixauth.authz.AuthzService;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.security.JwtAuthenticationFilter.AuthPrincipal;

/**
 * 관리 API 권한 검사.
 *
 * <p>여기서는 매 호출 DB 를 조회한다. 관리 API 는 빈도가 낮고, 권한 변경이 즉시
 * 반영돼야 하는 경로이기 때문이다. 앱의 일반 요청은 이 경로를 타지 않는다
 * (설계 불변식 2 — 앱은 permission-map 캐시로 로컬 판정).</p>
 */
@Component
@RequiredArgsConstructor
public class AdminGuard {

    public static final String USERS_READ = "ixauth:users:read";
    public static final String USERS_WRITE = "ixauth:users:write";
    public static final String ROLES_READ = "ixauth:roles:read";
    public static final String ROLES_WRITE = "ixauth:roles:write";
    public static final String AUDIT_READ = "ixauth:audit:read";
    /**
     * 사용자 대리 — <b>전용 코드다.</b>
     *
     * <p>{@code ixauth:users:write} 를 재사용하지 않는다. 사용자를 고치는 것과 사용자가
     * 되는 것은 다른 일이다. resource 를 {@code users} 가 아니라 {@code impersonation}
     * 으로 둔 것도 같은 이유 — {@code ixauth:users:*} 를 준 역할에 대리 권한이 딸려
     * 가지 않아야 한다 (docs/contract/http-api.md §4).</p>
     */
    public static final String IMPERSONATION_CREATE = "ixauth:impersonation:create";

    private final AuthzService authzService;

    /**
     * 현재 사용자를 꺼낸다. 인증이 없으면 401.
     *
     * <p><b>대리 세션은 여기서 막는다.</b> 경로별 차단({@code ImpersonationGuard})과
     * 겹치지만, 관리 API 는 새 엔드포인트가 계속 붙는 자리라 목록 한 곳에만 기대면
     * 언젠가 빠뜨린다. 모든 관리 API 가 이 메서드를 지나므로 여기가 마지막 관문이다 —
     * 특히 <b>재대리</b>({@code /admin/users/{id}/impersonate})가 이걸로 닫힌다.</p>
     */
    public AuthPrincipal principal() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof AuthPrincipal p)) {
            throw new ApiException(ErrorCode.AUTH_TOKEN_INVALID);
        }
        if (p.isImpersonated()) {
            throw new ApiException(ErrorCode.IMPERSONATION_ACTION_FORBIDDEN);
        }
        return p;
    }

    /**
     * 권한을 요구한다. 없으면 403.
     *
     * <p>응답에 "무엇이 없어서 막혔는지" 를 담지 않는다 — 권한 구조가 노출된다
     * (docs/contract/errors.md).</p>
     */
    public AuthPrincipal require(String permissionCode) {
        var p = principal();
        if (!authzService.hasPermission(p.userId(), permissionCode)) {
            throw new ApiException(ErrorCode.AUTHZ_FORBIDDEN);
        }
        return p;
    }
}
