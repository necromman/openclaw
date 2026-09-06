package team.prost.ixauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import team.prost.ixauth.domain.FederatedIdentity;

import java.util.List;
import java.util.Optional;

public interface FederatedIdentityRepository extends JpaRepository<FederatedIdentity, Long> {

    /** 매칭의 기준 — 이메일이 아니라 외부 IdP 의 불변 식별자다 */
    Optional<FederatedIdentity> findByProviderAndSubject(String provider, String subject);

    List<FederatedIdentity> findByUserIdOrderByIdAsc(Long userId);
}
