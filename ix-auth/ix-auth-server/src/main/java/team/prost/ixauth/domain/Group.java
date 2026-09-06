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
 * 권한 그룹 — 권한을 묶어 부여하는 단위.
 *
 * <p><b>조직도가 아니다.</b> "이 그룹에 권한을 주는가" 면 여기,
 * "이 사람이 조직 어디에 속하는가" 면 앱 또는 IX-Trust
 * (.claude/rules/product-boundary.md).</p>
 *
 * <p>계층 없는 평면 구조다 (역할과 같은 이유).</p>
 *
 * <p><b>표 이름이 {@code groups} 가 아닌 이유</b> (2026-08-21 개명) — {@code GROUPS} 는
 * MySQL 8.0.2+ 예약어라(윈도우 함수 절) 인용하지 않은 {@code CREATE TABLE groups} 가
 * ERROR 1064 로 실패한다. DDL 만 백틱으로 감싸도 Hibernate 가 런타임 SELECT 에서 같은
 * 이름을 인용 없이 내보내 그룹을 읽는 경로가 전부 깨진다. 이름은 세 방언이 함께 쓰는
 * 한 벌이어야 하므로 PostgreSQL·MariaDB 쪽도 V12 가 rename 한다.</p>
 */
@Entity
@Table(name = "ixauth_groups")
@Getter
@Setter
@NoArgsConstructor
public class Group {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 50)
    private String code;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(length = 500)
    private String description;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "group_roles",
            joinColumns = @JoinColumn(name = "group_id"),
            inverseJoinColumns = @JoinColumn(name = "role_id"))
    @Setter(AccessLevel.NONE)
    private Set<Role> roles = new HashSet<>();

    @PreUpdate
    void touch() {
        this.updatedAt = Instant.now();
    }

    public Group(String code, String name, String description) {
        this.code = code;
        this.name = name;
        this.description = description;
    }
}
