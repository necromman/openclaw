package team.prost.ixtrust.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.LocalDateTime;

/**
 * 감사 로그 엔티티.
 * append-only — 수정/삭제 불가. 모든 보안 관련 이벤트를 기록.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "audit_logs", indexes = {
        @Index(name = "idx_audit_org_event_time", columnList = "organizationId, eventType, createdAt DESC"),
        @Index(name = "idx_audit_actor", columnList = "actorId, createdAt DESC"),
        @Index(name = "idx_audit_resource", columnList = "resourceType, resourceId"),
        @Index(name = "idx_audit_severity", columnList = "severity, createdAt DESC"),
        @Index(name = "idx_audit_correlation", columnList = "correlationId")
})
@EntityListeners(AuditingEntityListener.class)
public class AuditLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @CreatedDate
    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    // ── 이벤트 분류 ──

    /** 이벤트 타입 (LOGIN_SUCCESS, USER_CREATED, SECRET_ROTATED 등) */
    @Column(nullable = false, length = 100)
    private String eventType;

    /** 심각도 (INFO, WARN, CRITICAL) */
    @Column(nullable = false, length = 20)
    private String severity;

    // ── 대상 리소스 ──

    /** 리소스 타입 (USER, CLIENT, ROLE, DEPARTMENT, POSITION, SESSION, SETTING) */
    @Column(length = 50)
    private String resourceType;

    /** 대상 리소스 ID */
    private Long resourceId;

    /** 대상 리소스 이름 (삭제 후에도 추적 가능하도록) */
    @Column(length = 255)
    private String resourceName;

    // ── 수행자 ──

    /** 수행자 타입 (USER, ADMIN, SERVICE, SYSTEM) */
    @Column(length = 20)
    private String actorType;

    /** 수행자 ID */
    private Long actorId;

    /** 수행자 이메일 */
    @Column(length = 255)
    private String actorEmail;

    // ── 내용 ──

    /** 사람이 읽을 수 있는 설명 */
    @Column(columnDefinition = "TEXT")
    private String description;

    /** 변경 전 값 (JSON) */
    @Column(columnDefinition = "TEXT")
    private String oldValues;

    /** 변경 후 값 (JSON) */
    @Column(columnDefinition = "TEXT")
    private String newValues;

    // ── 네트워크 ──

    /** 클라이언트 IP (IPv4/IPv6) */
    @Column(length = 45)
    private String ipAddress;

    /** 클라이언트 User-Agent */
    @Column(columnDefinition = "TEXT")
    private String userAgent;

    // ── 결과 ──

    /** 결과 (SUCCESS, FAILURE) */
    @Column(nullable = false, length = 20)
    private String status;

    /** 에러 메시지 (실패 시) */
    @Column(columnDefinition = "TEXT")
    private String errorMessage;

    // ── 추적 ──

    /** 관련 이벤트 추적 ID (SSO 플로우 등) */
    @Column(length = 100)
    private String correlationId;

    /** 추가 메타데이터 (JSON — clientId, scopes 등) */
    @Column(columnDefinition = "TEXT")
    private String metadata;

    /** Organization ID */
    @Column(nullable = false)
    private Long organizationId;

    // ── 빌더 패턴 ──

    public static AuditLog create(String eventType, String severity) {
        var log = new AuditLog();
        log.eventType = eventType;
        log.severity = severity;
        log.status = "SUCCESS";
        log.organizationId = 1L; // TODO: 멀티 Organization 시 SecurityContext에서
        return log;
    }

    public AuditLog resource(String type, Long id, String name) {
        this.resourceType = type;
        this.resourceId = id;
        this.resourceName = name;
        return this;
    }

    public AuditLog actor(String type, Long id, String email) {
        this.actorType = type;
        this.actorId = id;
        this.actorEmail = email;
        return this;
    }

    public AuditLog description(String description) {
        this.description = description;
        return this;
    }

    public AuditLog changes(String oldValues, String newValues) {
        this.oldValues = oldValues;
        this.newValues = newValues;
        return this;
    }

    public AuditLog network(String ipAddress, String userAgent) {
        this.ipAddress = ipAddress;
        this.userAgent = userAgent;
        return this;
    }

    public AuditLog failure(String errorMessage) {
        this.status = "FAILURE";
        this.errorMessage = errorMessage;
        return this;
    }

    public AuditLog correlationId(String correlationId) {
        this.correlationId = correlationId;
        return this;
    }

    public AuditLog metadata(String metadata) {
        this.metadata = metadata;
        return this;
    }
}
