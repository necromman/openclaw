package team.prost.ixauth.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import team.prost.ixauth.domain.TermAgreement;

import java.util.List;

/**
 * 동의 이력 조회.
 *
 * <p><b>수정·삭제 메서드를 두지 않는다.</b> 감사 로그와 같은 이유다 — 지울 수 있는
 * 경로가 있으면 그 순간 증빙이 아니게 된다. 철회는 {@code agreed = false} 인 새 행이다.</p>
 */
public interface TermAgreementRepository extends JpaRepository<TermAgreement, Long> {

    /** 내 이력 — 최근 것이 위로 */
    List<TermAgreement> findByUserIdOrderByAgreedAtDesc(Long userId);

    /**
     * 이 사용자가 각 코드에 <b>마지막으로</b> 남긴 응답.
     *
     * <p>재동의 판정이 매 로그인 이 질문을 한다. 코드마다 최신 한 건만 있으면 되므로
     * id 최대값으로 고른다 — 같은 시각에 두 건이 들어와도 순서가 흔들리지 않는다.</p>
     */
    @Query("""
            select a from TermAgreement a
             where a.userId = :userId
               and a.id = (select max(a2.id) from TermAgreement a2
                            where a2.userId = :userId and a2.code = a.code)
            """)
    List<TermAgreement> findLatestPerCode(@Param("userId") Long userId);

    Page<TermAgreement> findByTermIdOrderByAgreedAtDesc(Long termId, Pageable pageable);

    /**
     * 이 버전에 남은 이력 수.
     *
     * <p>0 이 아니면 그 약관 행은 지울 수 없다 — 이력이 가리키는 대상이 사라지면
     * 무엇에 동의했는지 되짚을 수 없다.</p>
     */
    long countByTermId(Long termId);
}
