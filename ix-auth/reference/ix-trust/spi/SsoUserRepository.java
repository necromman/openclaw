package team.prost.ixtrust.client.spi;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.repository.NoRepositoryBean;

import java.util.Optional;

/**
 * SsoUserProvider가 사용하는 최소 Repository 규약.
 * 앱의 UserRepository가 이 인터페이스를 상속하면 AbstractSsoUserProvider에서 자동으로 사용한다.
 *
 * <p>1.7.0 — {@code <ID>} generic 화. 기본 type {@code Long} (1.5.x/1.6.x 호환), UUID 같은
 * 다른 PK type 사용 가능.</p>
 *
 * @param <U>  User 엔티티 타입
 * @param <ID> User PK type — Long(기본) / UUID / String 등
 */
@NoRepositoryBean
public interface SsoUserRepository<U, ID> extends JpaRepository<U, ID> {
    Optional<U> findByEmail(String email);
    boolean existsByEmail(String email);
}
