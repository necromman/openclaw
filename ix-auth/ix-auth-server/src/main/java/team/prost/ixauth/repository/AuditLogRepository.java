package team.prost.ixauth.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import team.prost.ixauth.domain.AuditLog;

import java.time.Instant;

/**
 * 감사 로그 저장소.
 *
 * <p><b>수정·삭제 메서드를 만들지 않는다</b> (append-only). 보존 기간 정리는
 * 운영 배치 전용 메서드({@link #deleteOlderThan})로만 하며, 일반 경로에서 호출하지 않는다.</p>
 */
public interface AuditLogRepository extends JpaRepository<AuditLog, Long>, AuditLogSettingHistory {

    /**
     * 감사 로그 검색.
     *
     * <p>⚠ null 을 바인딩하지 않는다 — PostgreSQL 이 파라미터 타입을 추론하지 못해
     * 쿼리가 터진다 (UserRepository.search 와 같은 이유). 조건을 무력화하는 값을 넘긴다:
     * 빈 문자열 · -1 · 시간 범위 양끝.</p>
     */
    @Query("""
            select a from AuditLog a
             where (:eventType = '' or a.eventType = :eventType)
               and (:userId    = -1 or a.userId    = :userId)
               and a.createdAt >= :from
               and a.createdAt <= :to
             order by a.createdAt desc
            """)
    Page<AuditLog> search(@Param("eventType") String eventType,
                          @Param("userId") Long userId,
                          @Param("from") Instant from,
                          @Param("to") Instant to,
                          Pageable pageable);

    /** 사용자 상세 화면의 "최근 활동" — 이 사람에게 무슨 일이 있었는지 몇 줄 */
    Page<AuditLog> findByUserIdOrderByCreatedAtDesc(Long userId, Pageable pageable);

    // 설정 항목 변경 이력(findSettingHistory)은 JSON 접근 문법이 DB 방언마다 달라
    // AuditLogSettingHistory 프래그먼트로 분리했다 — 표를 새로 만들지 않는 원 설계는 그대로다.

    /** 보존 기간 정리 — 운영 배치 전용. 일반 코드 경로에서 호출 금지 */
    @org.springframework.data.jpa.repository.Modifying
    @Query("delete from AuditLog a where a.createdAt < :before")
    int deleteOlderThan(@Param("before") Instant before);
}
