package team.prost.ixtrust.client.spi;

import java.util.Set;

/**
 * OIDC 역할을 앱의 로컬 역할로 매핑하는 전략.
 * 기본 구현: ADMIN 포함 시 ADMIN, 그 외 USER.
 */
@FunctionalInterface
public interface RoleMappingStrategy {

    /**
     * OIDC 역할 집합을 앱의 로컬 역할 문자열로 매핑한다.
     *
     * @param oidcRoles IX-Trust에서 전달한 역할 집합 (예: {"ADMIN", "USER"})
     * @return 로컬 역할 문자열 (예: "ADMIN")
     */
    String mapRole(Set<String> oidcRoles);

    /** 기본 전략: ADMIN > USER 2단계 */
    static RoleMappingStrategy defaultStrategy() {
        return roles -> roles.contains("ADMIN") ? "ADMIN" : "USER";
    }
}
