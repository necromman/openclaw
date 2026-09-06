package team.prost.ixauth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * 사용자. IX-Auth 가 소유한다 — 앱이 users 테이블을 만들지 않는다.
 *
 * <p>앱 고유 필드는 {@link #attributes} JSONB 또는 앱 소유 프로필 테이블 + FK 로 둔다.
 * 이 엔티티에 앱 컬럼을 추가하지 않는다 (.claude/rules/product-boundary.md).</p>
 */
@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 320)
    private String email;

    /** 알고리즘 접두어 포함 — {@code {bcrypt}$2a$10$...} */
    @Column(name = "password_hash", length = 255)
    private String passwordHash;

    @Column(nullable = false, length = 100)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private UserStatus status = UserStatus.ACTIVE;

    @Column(name = "failed_count", nullable = false)
    private int failedCount;

    @Column(name = "locked_until")
    private Instant lockedUntil;

    @Column(name = "last_failed_at")
    private Instant lastFailedAt;

    @Column(name = "last_login_at")
    private Instant lastLoginAt;

    /** 이메일 인증 시각. NULL = 미인증 */
    @Column(name = "email_verified_at")
    private Instant emailVerifiedAt;

    /**
     * 본인이 탈퇴를 요청한 시각. NULL = 요청 없음.
     *
     * <p>값이 있고 {@code status} 가 아직 {@link UserStatus#DISABLED} 가 아니면 <b>유예 중</b>이다 —
     * 그 사이에 로그인하면 취소되어 다시 NULL 이 된다. 비활성이 된 뒤에도 값을 지우지 않는 이유는
     * 관리자가 닫은 계정과 본인이 닫은 계정이 다른 사건이기 때문이다.</p>
     */
    @Column(name = "deletion_requested_at")
    private Instant deletionRequestedAt;

    /**
     * 앱 고유 필드. 표기는 방언이 정한다 — PostgreSQL {@code jsonb} · MariaDB/MySQL {@code json}.
     *
     * <p>{@code columnDefinition = "jsonb"} 를 <b>쓰지 않는다</b>. PostgreSQL 표기를 못박아
     * 두면 MySQL 8 에서 Hibernate 검증이 {@code found [json] but expecting [jsonb]} 로
     * 부팅을 거부한다 (2026-08-21 실측). {@link JdbcTypeCode} 만 주면 방언이 각자의
     * 이름으로 검증한다.</p>
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private Map<String, Object> attributes = new HashMap<>();

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "user_roles",
            joinColumns = @JoinColumn(name = "user_id"),
            inverseJoinColumns = @JoinColumn(name = "role_id"))
    @Setter(AccessLevel.NONE)
    private Set<Role> roles = new HashSet<>();

    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "user_groups",
            joinColumns = @JoinColumn(name = "user_id"),
            inverseJoinColumns = @JoinColumn(name = "group_id"))
    @Setter(AccessLevel.NONE)
    private Set<Group> groups = new HashSet<>();

    @PreUpdate
    void touch() {
        this.updatedAt = Instant.now();
    }

    public User(String email, String name, String passwordHash) {
        this.email = email;
        this.name = name;
        this.passwordHash = passwordHash;
    }

    /**
     * 잠금 상태인지 — <b>자동 잠금과 관리자 잠금을 모두</b> 본다.
     *
     * <p>둘의 구분 기준은 {@link #lockedUntil} 의 유무다 (계약: http-api.md §2-1-1).</p>
     * <ul>
     *   <li><b>자동 잠금</b> — 로그인 실패 누적. {@code lockedUntil} 이 있고, 그 시각이
     *       지나면 저절로 풀린다. 그래서 시각만 보고 판단한다</li>
     *   <li><b>관리자 잠금</b> — {@code PATCH /admin/users/{id}} 의 {@code status=LOCKED}.
     *       풀리는 시각이 없으므로 {@code status} 를 봐야 한다</li>
     * </ul>
     *
     * <p>예전에는 {@code lockedUntil} 만 봤다. 그래서 관리자가 {@code LOCKED} 로 바꿔도
     * 로그인이 그대로 통과했고, 관리 화면은 "잠김" 이라 적어 두고 실제로는 들어와지는
     * 상태였다 (2026-08-20 늘봄 PoC 실측).</p>
     */
    public boolean isLocked(Instant now) {
        if (lockedUntil != null) {
            return lockedUntil.isAfter(now);
        }
        return status == UserStatus.LOCKED;
    }

    /** 관리자가 건 잠금인지 — 시간이 지나도, 비밀번호를 재설정해도 풀리지 않는다. */
    public boolean isAdminLocked() {
        return status == UserStatus.LOCKED && lockedUntil == null;
    }

    /**
     * <b>자동</b> 잠금만 해제한다 — 로그인 성공 · 비밀번호 재설정처럼 "본인이 돌아왔다" 가
     * 확인된 지점에서 부른다.
     *
     * <p>관리자 잠금은 손대지 않는다. 예전에는 이 자리에서 {@code LOCKED} 를 무조건
     * {@code ACTIVE} 로 되돌려, 관리자가 건 잠금이 로그인 한 번으로 흔적 없이 사라졌다.
     * 푸는 것은 관리자의 일이다 ({@code /unlock} 또는 {@code status=ACTIVE}).</p>
     */
    public void clearAutomaticLock() {
        this.failedCount = 0;
        if (lockedUntil == null) {
            return;
        }
        this.lockedUntil = null;
        if (status == UserStatus.LOCKED) {
            this.status = UserStatus.ACTIVE;
        }
    }

    public boolean isActive() {
        return status == UserStatus.ACTIVE;
    }
}
