package team.prost.ixauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import team.prost.ixauth.domain.Identity;
import team.prost.ixauth.social.SocialProvider;

import java.util.List;
import java.util.Optional;

public interface IdentityRepository extends JpaRepository<Identity, Long> {

    /** 매칭의 기준 — 이메일이 아니라 provider 의 불변 식별자다 */
    Optional<Identity> findByProviderAndSubject(SocialProvider.Kind provider, String subject);

    List<Identity> findByUserId(Long userId);

    boolean existsByUserIdAndProvider(Long userId, SocialProvider.Kind provider);
}
