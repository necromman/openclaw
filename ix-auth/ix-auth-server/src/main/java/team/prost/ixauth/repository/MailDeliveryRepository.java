package team.prost.ixauth.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import team.prost.ixauth.domain.MailDelivery;

import java.time.Instant;

public interface MailDeliveryRepository extends JpaRepository<MailDelivery, Long> {

    /**
     * 발송 이력 검색.
     *
     * <p>⚠ null 을 바인딩하지 않는다 — PostgreSQL 이 파라미터 타입을 추론하지 못해
     * 쿼리가 터진다 ({@link AuditLogRepository#search} 와 같은 이유). 조건을 무력화하는
     * 값을 넘긴다: 빈 문자열.</p>
     */
    @Query("""
            select d from MailDelivery d
             where (:status = '' or cast(d.status as string) = :status)
               and (:kind   = '' or d.kind = :kind)
               and (:email  = '' or lower(d.toEmail) like lower(concat('%', :email, '%')))
             order by d.createdAt desc
            """)
    Page<MailDelivery> search(@Param("status") String status,
                              @Param("kind") String kind,
                              @Param("email") String email,
                              Pageable pageable);

    /** 보존 기간 정리 — 운영 배치 전용. 이력에는 받는 사람 주소가 들어 있다 */
    @Modifying
    @Query("delete from MailDelivery d where d.createdAt < :before")
    int deleteOlderThan(@Param("before") Instant before);
}
