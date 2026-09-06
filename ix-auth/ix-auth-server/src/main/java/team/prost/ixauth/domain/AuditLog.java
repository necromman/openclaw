package team.prost.ixauth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/**
 * 감사 로그 — <b>append-only</b>.
 *
 * <p>UPDATE/DELETE 경로를 코드에 만들지 않는다 (.claude/rules/coding-style.md).
 * 보존 기간 정리는 운영 배치로만 한다.</p>
 *
 * <p>{@link #detail} 에 비밀번호·토큰·시크릿을 절대 넣지 않는다.</p>
 */
@Entity
@Table(name = "audit_logs")
@Getter
@Setter
@NoArgsConstructor
public class AuditLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "event_type", nullable = false, length = 50)
    private String eventType;

    /** 대상 사용자 */
    @Column(name = "user_id")
    private Long userId;

    /** 조작 주체 (관리자 조작 시). 본인 행위면 userId 와 같다 */
    @Column(name = "actor_id")
    private Long actorId;

    @Column(length = 45)
    private String ip;

    @Column(name = "user_agent", length = 500)
    private String userAgent;

    // columnDefinition 을 주지 않는다 — PostgreSQL 표기(jsonb)를 못박으면 MySQL 8 에서
    // Hibernate 검증이 found [json] but expecting [jsonb] 로 부팅을 거부한다 (User#attributes)
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private Map<String, Object> detail = new HashMap<>();

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();
}
