package team.prost.ixauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import team.prost.ixauth.domain.OAuthState;

import java.time.Instant;

public interface OAuthStateRepository extends JpaRepository<OAuthState, String> {

    /** 만료분 정리 — state 는 짧게 살고 재사용되지 않으므로 유예 없이 지운다 */
    @Modifying
    @Query("delete from OAuthState s where s.expiresAt < :before")
    int deleteExpiredBefore(@Param("before") Instant before);
}
