package team.prost.ixauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import team.prost.ixauth.domain.Term;

import java.util.List;
import java.util.Optional;

public interface TermRepository extends JpaRepository<Term, Long> {

    /**
     * 지금 사용자에게 보여야 할 약관 — <b>코드마다 가장 높은 게시 버전 하나씩</b>.
     *
     * <p>초안(미게시)은 빠진다. 관리자가 문안을 다듬는 동안 가입 화면에 반쯤 쓴 약관이
     * 뜨면 안 된다.</p>
     *
     * <p>서브쿼리로 최대 버전을 고른다 — {@code DISTINCT ON} 은 PostgreSQL 전용이고,
     * 약관은 많아야 수십 행이라 이 정도 비용은 문제가 되지 않는다.</p>
     */
    @Query("""
            select t from Term t
             where t.publishedAt is not null
               and t.version = (select max(t2.version) from Term t2
                                 where t2.code = t.code and t2.publishedAt is not null)
             order by t.displayOrder asc, t.code asc
            """)
    List<Term> findCurrentPublished();

    /** 코드 하나의 현재 게시본 */
    @Query("""
            select t from Term t
             where t.code = :code and t.publishedAt is not null
               and t.version = (select max(t2.version) from Term t2
                                 where t2.code = :code and t2.publishedAt is not null)
            """)
    Optional<Term> findCurrentPublished(@Param("code") String code);

    /** 관리 화면용 — 초안 포함 전량. 코드별로 최신 버전이 위로 */
    List<Term> findAllByOrderByDisplayOrderAscCodeAscVersionDesc();

    List<Term> findByCodeOrderByVersionDesc(String code);

    Optional<Term> findByCodeAndVersion(String code, int version);

    /** 다음 버전 번호를 정할 때 쓴다. 초안까지 센다 — 같은 번호가 두 번 나오면 안 된다 */
    @Query("select coalesce(max(t.version), 0) from Term t where t.code = :code")
    int maxVersion(@Param("code") String code);
}
