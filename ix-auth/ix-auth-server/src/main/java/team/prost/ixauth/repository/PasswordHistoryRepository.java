package team.prost.ixauth.repository;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import team.prost.ixauth.domain.PasswordHistory;

import java.util.List;

public interface PasswordHistoryRepository extends JpaRepository<PasswordHistory, Long> {

    /** 최근 것부터. 검사는 여기서 받은 해시를 인코더로 하나씩 대조한다 */
    List<PasswordHistory> findByUserIdOrderByCreatedAtDesc(Long userId, Pageable pageable);

    /**
     * 상한을 넘은 오래된 행을 지운다.
     *
     * <p>남겨 두면 설정을 줄여도 보관량이 줄지 않는다. 이력은 검사에 쓰려고 두는
     * 것이지 기록으로 두는 것이 아니다 — 그쪽은 감사 로그의 몫이다.</p>
     *
     * <p>서브쿼리로 "남길 것" 을 고르고 나머지를 지운다. {@code LIMIT} 은 JPQL 에 없어
     * 네이티브로 내려간다 — 이식성보다 한 번에 지우는 쪽이 낫다고 보았다
     * (한 사용자의 이력은 많아야 수십 행이다).</p>
     *
     * <p>⚠ {@code clearAutomatically} 를 켜지 않는다. 켜면 영속성 컨텍스트가 통째로
     * 비워져, 이 호출을 감싼 트랜잭션에서 수정 중이던 {@code User} 가 준영속이 된다 —
     * 그러면 {@code save()} 없이 변경 감지에 기대던 코드가 <b>조용히</b> 아무것도
     * 저장하지 않는다. 여기서 지운 행을 뒤에서 다시 읽지 않으므로 비울 이유도 없다.</p>
     *
     * <p>안쪽 서브쿼리를 파생 테이블({@code keep_ids})로 한 번 감싼 이유 — MariaDB 는
     * {@code IN} 서브쿼리 안의 {@code LIMIT} 를 지원하지 않고, DELETE 대상 표를 FROM 에
     * 다시 두는 것도 파생 테이블일 때만 허용한다. PostgreSQL 에서는 감싸든 아니든 같은
     * 계획으로 동작하므로, 방언 분기 없이 이 한 문장으로 양쪽을 다 만족시킨다.</p>
     */
    @Modifying(flushAutomatically = true)
    @Query(value = """
            delete from password_history
             where user_id = :userId
               and id not in (select keep_ids.id
                                from (select id from password_history
                                       where user_id = :userId
                                       order by created_at desc, id desc
                                       limit :keep) keep_ids)
            """, nativeQuery = true)
    int trimTo(@Param("userId") Long userId, @Param("keep") int keep);

    /** 이력 기능을 끈 뒤 남아 있던 것을 치운다. 위와 같은 이유로 컨텍스트를 비우지 않는다 */
    @Modifying(flushAutomatically = true)
    @Query("delete from PasswordHistory h where h.userId = :userId")
    int deleteAllForUser(@Param("userId") Long userId);
}
