package team.prost.ixauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import team.prost.ixauth.domain.VerificationToken;

import java.time.Instant;
import java.util.Optional;

public interface VerificationTokenRepository extends JpaRepository<VerificationToken, Long> {

    Optional<VerificationToken> findByTokenHash(String tokenHash);

    /**
     * 이 사용자·용도로 마지막에 발급한 시각. 재발송 쿨다운 판단에 쓴다.
     *
     * <p>쿨다운이 없으면 남의 주소로 재설정 메일을 무한히 보낼 수 있다 — 메일 폭탄이다.</p>
     */
    @Query("select max(t.createdAt) from VerificationToken t "
            + "where t.userId = :userId and t.purpose = :purpose")
    Optional<Instant> lastIssuedAt(@Param("userId") Long userId,
                                   @Param("purpose") VerificationToken.Purpose purpose);

    /**
     * 같은 용도의 살아 있는 토큰을 모두 무효화한다.
     *
     * <p>새로 발급할 때 먼저 부른다. 옛 링크가 계속 유효하면 <b>가장 오래된 메일</b>
     * 하나만 유출돼도 계정을 빼앗긴다 — 사용자는 최신 메일만 신경 쓰기 때문이다.</p>
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update VerificationToken t set t.usedAt = :now "
            + "where t.userId = :userId and t.purpose = :purpose and t.usedAt is null")
    int invalidateAll(@Param("userId") Long userId,
                      @Param("purpose") VerificationToken.Purpose purpose,
                      @Param("now") Instant now);

    /** 만료분 정리 — 쓰였든 아니든 지난 것은 남겨 둘 이유가 없다 */
    @Modifying
    @Query("delete from VerificationToken t where t.expiresAt < :before")
    int deleteExpiredBefore(@Param("before") Instant before);
}
