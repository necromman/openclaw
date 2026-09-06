package team.prost.ixauth.repository;

import jakarta.persistence.EntityManager;
import java.util.List;
import lombok.RequiredArgsConstructor;
import team.prost.ixauth.config.DbDialect;
import team.prost.ixauth.domain.AuditLog;

/**
 * {@link AuditLogSettingHistory} 구현.
 *
 * <p>설정 이력 표를 새로 만들지 않고 감사 로그에서 뽑는 원 설계는 그대로다 —
 * 사실을 두 곳에 두면 언젠가 둘이 어긋난다. 스키마는 커넥션의 기본 스키마가
 * 정한다(application.yml). 네이티브인 이유와 방언이 갈리는 이유는
 * {@link AuditLogSettingHistory} 참조.</p>
 */
@RequiredArgsConstructor
public class AuditLogSettingHistoryImpl implements AuditLogSettingHistory {

    private static final String POSTGRESQL_SQL = """
            select * from audit_logs
             where event_type in ('SETTING_CHANGED', 'SETTING_RESET')
               and detail ->> 'key' = :key
             order by created_at desc
             limit :max
            """;

    /** MariaDB 에는 {@code ->>} 가 없다(MySQL 전용 표기) — {@code json_extract} 로 같은 키를 읽는다. */
    private static final String MARIADB_SQL = """
            select * from audit_logs
             where event_type in ('SETTING_CHANGED', 'SETTING_RESET')
               and json_unquote(json_extract(detail, '$.key')) = :key
             order by created_at desc
             limit :max
            """;

    private final EntityManager entityManager;
    private final DbDialect dialect;

    @Override
    @SuppressWarnings("unchecked")
    public List<AuditLog> findSettingHistory(String key, int max) {
        String sql = dialect == DbDialect.MARIADB ? MARIADB_SQL : POSTGRESQL_SQL;
        return entityManager.createNativeQuery(sql, AuditLog.class)
                .setParameter("key", key)
                .setParameter("max", max)
                .getResultList();
    }
}
