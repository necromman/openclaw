package team.prost.ixauth.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import team.prost.ixauth.domain.ResourceGrant;

import java.util.Collection;
import java.util.List;

public interface ResourceGrantRepository extends JpaRepository<ResourceGrant, Long> {

    /**
     * 판정에 필요한 grant 를 한 번에 긁어온다.
     *
     * <p>주체 집합(사용자 · 소속 그룹 · 보유 역할)과 <b>조상 경로 집합</b>을 IN 으로 넣는다.
     * prefix LIKE 가 아니라 IN 인 이유: {@code /contracts/2026/a.pdf} 판정에 필요한 것은
     * <b>조상</b>({@code /contracts/2026/}, {@code /contracts/}, {@code /})이지
     * 형제({@code /contracts/2026/b.pdf})가 아니다. prefix LIKE 는 형제까지 잡는다.</p>
     */
    @Query("""
            select g from ResourceGrant g
             where g.resourceType = :resourceType
               and g.resourceKey in :keys
               and concat(g.subjectType, ':', g.subjectId) in :subjects
            """)
    List<ResourceGrant> findForDecision(@Param("resourceType") String resourceType,
                                        @Param("keys") Collection<String> keys,
                                        @Param("subjects") Collection<String> subjects);

    /** 사용자가 접근 가능한 리소스 키 목록 (list-resources) */
    @Query("""
            select g from ResourceGrant g
             where g.resourceType = :resourceType
               and concat(g.subjectType, ':', g.subjectId) in :subjects
             order by g.resourceKey
            """)
    List<ResourceGrant> findBySubjects(@Param("resourceType") String resourceType,
                                       @Param("subjects") Collection<String> subjects);

    @Query("""
            select g from ResourceGrant g
             where (:resourceType = '' or g.resourceType = :resourceType)
               and (:subjectType  = '' or g.subjectType  = :subjectType)
             order by g.id desc
            """)
    Page<ResourceGrant> search(@Param("resourceType") String resourceType,
                               @Param("subjectType") String subjectType,
                               Pageable pageable);

    boolean existsBySubjectTypeAndSubjectIdAndResourceTypeAndResourceKeyAndAction(
            String subjectType, Long subjectId, String resourceType, String resourceKey, String action);
}
