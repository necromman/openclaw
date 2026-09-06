package team.prost.ixauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import team.prost.ixauth.domain.SigningKey;

import java.util.List;
import java.util.Optional;

public interface SigningKeyRepository extends JpaRepository<SigningKey, String> {

    /** 현재 서명에 쓰는 키 (가장 최근 활성) */
    @Query("select k from SigningKey k where k.active = true order by k.createdAt desc limit 1")
    Optional<SigningKey> findActive();

    /**
     * JWKS 에 실을 키 전체 — 활성 + <b>아직 만료 안 된 토큰을 검증할 구 키</b>.
     *
     * <p>회전 직후 구 키를 즉시 지우면 아직 유효한 토큰이 검증 실패한다
     * (docs/contract/token.md §4).</p>
     */
    @Query("select k from SigningKey k where k.retiredAt is null order by k.createdAt desc")
    List<SigningKey> findPublishable();
}
