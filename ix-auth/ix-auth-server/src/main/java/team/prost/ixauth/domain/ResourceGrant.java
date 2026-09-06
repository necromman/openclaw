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

import java.time.Instant;

/**
 * 리소스 인스턴스 권한 (L2) — 특정 파일·폴더·문서 하나에 대한 부여.
 *
 * <p>Zanzibar 의 관계 튜플을 축소한 형태다. 임의 관계 그래프 대신
 * <b>조상 경로 상속</b>만 지원해 재귀 순회를 없앴다 (docs/design/authorization-model.md §3.2).</p>
 */
@Entity
@Table(name = "resource_grants")
@Getter
@Setter
@NoArgsConstructor
public class ResourceGrant {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** USER | GROUP | ROLE */
    @Column(name = "subject_type", nullable = false, length = 10)
    private String subjectType;

    @Column(name = "subject_id", nullable = false)
    private Long subjectId;

    /** 'file' | 'folder' | 'document' | 앱이 정의 */
    @Column(name = "resource_type", nullable = false, length = 50)
    private String resourceType;

    /**
     * 경로 또는 식별자.
     *
     * <p>{@code /} 로 시작하면 경로로 보고 상속이 적용된다. 폴더는 끝에 {@code /} 를 붙인다
     * ({@code /contracts/2026/}). 그 외({@code doc-4821})는 정확 매칭만 한다.</p>
     */
    @Column(name = "resource_key", nullable = false, length = 1000)
    private String resourceKey;

    /** read | write | delete | download | share | * */
    @Column(nullable = false, length = 30)
    private String action;

    /** ALLOW | DENY — DENY 가 우선한다 (결정 A3) */
    @Column(nullable = false, length = 10)
    private String effect = "ALLOW";

    @Column(name = "granted_by")
    private Long grantedBy;

    /** 임시 권한 (결정 A5). null 이면 무기한 */
    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    public ResourceGrant(String subjectType, Long subjectId, String resourceType,
                         String resourceKey, String action, String effect,
                         Long grantedBy, Instant expiresAt) {
        this.subjectType = subjectType;
        this.subjectId = subjectId;
        this.resourceType = resourceType;
        this.resourceKey = resourceKey;
        this.action = action;
        this.effect = effect;
        this.grantedBy = grantedBy;
        this.expiresAt = expiresAt;
    }

    public boolean isDeny() {
        return "DENY".equalsIgnoreCase(effect);
    }

    public boolean isLive(Instant now) {
        return expiresAt == null || expiresAt.isAfter(now);
    }

    /** 요청 action 을 덮는가 — '*' 는 모든 action 을 덮는다 */
    public boolean coversAction(String requested) {
        return "*".equals(action) || action.equalsIgnoreCase(requested);
    }
}
