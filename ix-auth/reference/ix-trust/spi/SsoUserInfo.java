package team.prost.ixtrust.client.spi;

import java.util.Set;

/**
 * 라이브러리가 인증 처리에 필요한 최소 사용자 정보.
 * 앱의 User 엔티티가 이 인터페이스를 구현하거나, 어댑터를 통해 제공.
 *
 * <p>1.7.0 — ID generic 화. 기본 type {@code Long} (1.5.x/1.6.x 호환), PX-PILOT 같이
 * UUID PK 사용하는 SP 는 {@code SsoUserInfo<UUID>} 로 명시.</p>
 *
 * @param <ID> User PK type — 일반적으로 {@code Long}, UUID, String 등.
 */
public interface SsoUserInfo<ID> {

    /** User PK. JWT claim 으로는 {@link String#valueOf(Object)} 직렬화. */
    ID getId();

    String getEmail();

    String getName();

    String getPassword();

    boolean isActive();

    /** 역할 코드 집합 (예: "ADMIN", "USER", "MANAGER") */
    Set<String> getRoles();

    /** 대표 역할 — SecurityContext에 설정할 단일 역할 */
    default String getPrimaryRole() {
        Set<String> roles = getRoles();
        if (roles != null && roles.contains("ADMIN")) {
            return "ADMIN";
        }
        if (roles != null && !roles.isEmpty()) {
            return roles.iterator().next();
        }
        return "USER";
    }
}
