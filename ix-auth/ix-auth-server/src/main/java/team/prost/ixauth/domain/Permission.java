package team.prost.ixauth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * 권한 — {@code <domain>:<resource>:<action>}.
 *
 * <p>사전 등록제다 (결정 A4). 여기 등록된 코드만 역할에 부여할 수 있다.
 * 관리 화면에 목록을 보여주고 오타를 막기 위함.</p>
 *
 * <p>문법·매칭 규칙은 docs/contract/authz.md §2.</p>
 */
@Entity
@Table(name = "permissions")
@Getter
@Setter
@NoArgsConstructor
public class Permission {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 전체 코드. 예: {@code page:admin.users:view} */
    @Column(nullable = false, unique = true, length = 200)
    private String code;

    @Column(nullable = false, length = 50)
    private String domain;

    @Column(nullable = false, length = 120)
    private String resource;

    @Column(nullable = false, length = 30)
    private String action;

    @Column(length = 500)
    private String description;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    @PreUpdate
    void touch() {
        this.updatedAt = Instant.now();
    }

    public Permission(String domain, String resource, String action, String description) {
        this.domain = domain;
        this.resource = resource;
        this.action = action;
        this.code = domain + ":" + resource + ":" + action;
        this.description = description;
    }
}
