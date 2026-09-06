package team.prost.ixauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import team.prost.ixauth.domain.Session;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SessionRepository extends JpaRepository<Session, UUID> {

    Optional<Session> findByRefreshTokenHash(String refreshTokenHash);

    List<Session> findByUserIdOrderByIssuedAtDesc(Long userId);

    /**
     * 사용자의 모든 세션을 폐기한다.
     *
     * <p>쓰이는 곳 — ① 관리자의 강제 로그아웃 ② <b>refresh 재사용 감지</b>.
     * ②는 토큰 탈취 신호이므로 해당 사용자 전체를 끊는다 (docs/contract/token.md §5).</p>
     */
    @Modifying
    @Query("update Session s set s.revokedAt = :now where s.userId = :userId and s.revokedAt is null")
    int revokeAllByUserId(@Param("userId") Long userId, @Param("now") Instant now);

    /**
     * 세션 하나를 폐기한다 (refresh 회전 시 옛 세션).
     *
     * <p>dirty checking 에 맡기지 않고 명시적 UPDATE 를 쓴다 — 폐기가 누락되면
     * <b>재사용 감지가 통째로 무력화</b>되어 탈취된 토큰을 계속 쓸 수 있게 된다
     * (2026-08-08 실측: 영속성 컨텍스트 경유 시 반영되지 않아 재사용이 200 으로 통과).</p>
     *
     * @return 실제로 폐기된 행 수 (이미 폐기됐으면 0)
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Session s set s.revokedAt = :now, s.lastUsedAt = :now "
            + "where s.refreshTokenHash = :hash and s.revokedAt is null")
    int revokeByTokenHash(@Param("hash") String hash, @Param("now") Instant now);

    @Modifying
    @Query("delete from Session s where s.expiresAt < :before")
    int deleteExpiredBefore(@Param("before") Instant before);

    @Query("select count(s) from Session s where s.userId = :userId and s.revokedAt is null and s.expiresAt > :now")
    long countActive(@Param("userId") Long userId, @Param("now") Instant now);

    /**
     * 지금 살아 있는 세션을 <b>오래된 것부터</b>. 동시 로그인 상한을 적용할 때 쓴다.
     *
     * <p>넘칠 때 무엇을 끊을지는 이 순서가 정한다 — 가장 오래된 것부터다.
     * 최근 것을 끊으면 방금 로그인한 사람이 그 자리에서 튕긴다.</p>
     */
    @Query("select s from Session s where s.userId = :userId and s.revokedAt is null "
            + "and s.expiresAt > :now order by s.issuedAt asc")
    List<Session> findActiveOldestFirst(@Param("userId") Long userId, @Param("now") Instant now);

    /**
     * 지정한 세션들을 폐기한다.
     *
     * <p>영속성 컨텍스트에 맡기지 않고 명시적 UPDATE 를 쓴다 —
     * {@link #revokeByTokenHash} 주석의 실측 사례와 같은 이유다.</p>
     */
    @Modifying
    @Query("update Session s set s.revokedAt = :now where s.id in :ids and s.revokedAt is null")
    int revokeByIds(@Param("ids") Collection<UUID> ids, @Param("now") Instant now);

    /**
     * 이 세션을 뺀 나머지 세션 수 — "이 계정에 <b>이전</b> 로그인이 있었는가".
     *
     * <p>폐기·만료된 것도 센다. 지금 살아 있는지가 아니라 <b>전에 들어온 적이 있는지</b>를
     * 묻는 것이라서다. 0 이면 첫 로그인이고, 그때는 새 기기 알림을 보내지 않는다 —
     * 가입 직후 전원에게 "새 기기에서 로그인되었습니다" 가 가면 소음일 뿐이다.</p>
     */
    long countByUserIdAndIdNot(Long userId, UUID id);

    /**
     * 같은 (IP, User-Agent) 조합으로 들어온 적이 있는가.
     *
     * <p>NULL 을 파라미터로 넘기지 않고 빈 문자열로 바꿔 {@code coalesce} 로 맞춘다.
     * PostgreSQL 은 null 파라미터의 타입을 추론하지 못해 터진다
     * ({@code UserRepository.search} 주석의 실측 사례).</p>
     */
    @Query("select count(s) from Session s where s.userId = :userId and s.id <> :exclude "
            + "and coalesce(s.ip, '') = :ip and coalesce(s.userAgent, '') = :userAgent")
    long countSameDevice(@Param("userId") Long userId, @Param("exclude") UUID exclude,
                         @Param("ip") String ip, @Param("userAgent") String userAgent);
}
