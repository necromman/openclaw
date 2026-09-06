package team.prost.ixauth.repository;

import java.util.List;
import team.prost.ixauth.domain.AuditLog;

/**
 * 설정 변경 이력 조회 — 방언 분기가 필요한 프래그먼트.
 *
 * <p>조건이 {@code detail}(JSON) 안의 키라서 JPQL 로는 표현할 수 없고, JSON 접근
 * 문법이 DB 마다 다르다(PostgreSQL {@code ->>} · MariaDB {@code json_extract}).
 * 그래서 이 메서드만 리포지토리 인터페이스에서 분리해 구현체가 SQL 을 고른다.</p>
 */
public interface AuditLogSettingHistory {

    /** 설정 항목 하나의 변경 이력 — 최신순 {@code max} 건. */
    List<AuditLog> findSettingHistory(String key, int max);
}
