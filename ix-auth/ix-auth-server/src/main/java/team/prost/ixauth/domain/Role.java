package team.prost.ixauth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.HashSet;
import java.util.Set;

/**
 * 역할 — 권한 묶음.
 *
 * <p>계층(parent)을 두지 않는다 (결정 A2). 상속은 "왜 이 권한이 있지" 추적을
 * 어렵게 만든다. 권한 중복 부여로 처리하고, 필요해지면 그때 추가한다.</p>
 */
@Entity
@Table(name = "roles")
@Getter
@Setter
@NoArgsConstructor
public class Role {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 50)
    private String code;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(length = 500)
    private String description;

    /** 시스템 역할은 삭제·코드 변경 불가 (ADMIN, USER) */
    @Column(name = "is_system", nullable = false)
    private boolean system;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "role_permissions",
            joinColumns = @JoinColumn(name = "role_id"),
            inverseJoinColumns = @JoinColumn(name = "permission_id"))
    @Setter(AccessLevel.NONE)
    private Set<Permission> permissions = new HashSet<>();

    @PreUpdate
    void touch() {
        this.updatedAt = Instant.now();
    }

    public Role(String code, String name, String description) {
        this.code = code;
        this.name = name;
        this.description = description;
    }
}
