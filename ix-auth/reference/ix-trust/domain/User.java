package team.prost.ixtrust.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;

/**
 * SSO 사용자 엔티티.
 * 모든 PROST 서비스의 통합 계정.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "users")
public class User extends BaseEntity {

    @Column(name = "organization_id", nullable = false)
    private Long organizationId;

    /**
     * primary organization 멤버십이 마지막으로 변경된 시각 (V16).
     * <p>AdminJwtFilter 가 매 요청 시 JWT iat 와 비교 — 변경 시점 이전 발급 토큰은 즉시 무효화.
     * MFA 패턴과 동일한 iat revocation 정공법 (plan-org-admin-and-membership-mgmt §2.1).
     * <p>NULL = 변경 이력 없음 (V10 자동 매핑 또는 신규 사용자) → 가드 통과.
     */
    @Column(name = "organization_changed_at")
    private LocalDateTime organizationChangedAt;

    @Column(nullable = false, unique = true)
    private String email;

    @Column
    private String password;

    @Column(nullable = false)
    private String name;

    /** 성 (family name) — OIDC family_name 클레임 정본 (V73). 비면 name 자동 파싱 폴백. */
    @Column(name = "family_name", length = 100)
    private String familyName;

    /** 이름 (given name) — OIDC given_name 클레임 정본 (V73). 비면 name 자동 파싱 폴백. */
    @Column(name = "given_name", length = 100)
    private String givenName;

    /** 소속 부서 (nullable) */
    @Column(name = "department_id")
    private Long departmentId;

    /** 직급 (nullable) */
    @Column(name = "position_id")
    private Long positionId;

    /** 사원번호 (예: P001) */
    @Column(name = "employee_number", length = 10)
    private String employeeNumber;

    /** 표시이름 */
    @Column(name = "display_name")
    private String displayName;

    /** 사진 (DB 직접 저장, bytea) */
    @Column(name = "photo", columnDefinition = "bytea")
    private byte[] photo;

    /** 담당업무 */
    @Column(name = "job_description")
    private String jobDescription;

    /** 핸드폰번호 */
    @Column(name = "phone_number")
    private String phoneNumber;

    /** 우편번호 */
    @Column(name = "zip_code", length = 10)
    private String zipCode;

    /** 기본주소 (도로명/지번 — 카카오 우편번호 검색 결과) */
    @Column(name = "address")
    private String address;

    /** 상세주소 (사용자 직접 입력 — 동/호수 등) */
    @Column(name = "address_detail")
    private String addressDetail;

    /** 인증 방식: LOCAL, SOCIAL, LOCAL_AND_SOCIAL */
    @Column(name = "auth_method", nullable = false, length = 20)
    private String authMethod = "LOCAL";

    @Column(nullable = false)
    private boolean active = true;

    /** 로그인 실패 횟수 */
    @Column(name = "failed_attempts", nullable = false)
    private int failedAttempts = 0;

    /** 계정 잠금 해제 시각 (null이면 잠금 아님) */
    @Column(name = "locked_until")
    private LocalDateTime lockedUntil;

    /** TOTP MFA 비밀키 (Base32 인코딩) */
    @Column(name = "totp_secret", length = 64)
    private String totpSecret;

    /** MFA 활성화 여부 */
    @Column(name = "totp_enabled", nullable = false)
    private boolean totpEnabled = false;

    /** 백업 코드 (쉼표 구분, 일회용) */
    @Column(name = "backup_codes", columnDefinition = "TEXT")
    private String backupCodes;

    /**
     * WebAuthn / FIDO2 사용자 핸들 — opaque binary (UUID 16 byte encoded).
     * <p>WebAuthn 표준 (W3C Level 2 §5.4.3 / 14.6.1) 은 email 같은 직접 식별자 대신
     * opaque user handle 사용 권장 (privacy). 한 사용자의 모든 passkey credential 은 같은 handle.
     * <p>정공 lazy 패턴 — 옛 사용자는 NULL, passkey 첫 등록 시점에
     * {@code WebauthnService.lazyAssignUserHandle} 가 UUID 생성. UNIQUE constraint 가
     * nullable column 의 multiple NULL 허용하므로 옛 사용자 공존 OK.
     */
    @Column(name = "webauthn_user_handle", unique = true, length = 64)
    private byte[] webauthnUserHandle;

    /** 다대다 역할 관계 */
    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(
            name = "user_roles",
            joinColumns = @JoinColumn(name = "user_id"),
            inverseJoinColumns = @JoinColumn(name = "role_id")
    )
    private Set<Role> roles = new HashSet<>();

    /**
     * 실제 성 (OIDC family_name 클레임) — 명시 컬럼 우선, 비면 {@code name} 자동 파싱
     * ({@link team.prost.ixtrust.common.NameParser} — 복성 인식 + 영문 공백 분리).
     * 분리 불가 (음역 외국명 등) 시 {@code null} — 호출지가 클레임 자체를 생략한다.
     */
    public String getEffectiveFamilyName() {
        if (familyName != null && !familyName.isBlank()) {
            return familyName;
        }
        String parsed = team.prost.ixtrust.common.NameParser.parse(name).familyName();
        return parsed.isBlank() ? null : parsed;
    }

    /** 실제 이름 (OIDC given_name 클레임) — {@link #getEffectiveFamilyName()} 와 동일 규칙. */
    public String getEffectiveGivenName() {
        if (givenName != null && !givenName.isBlank()) {
            return givenName;
        }
        String parsed = team.prost.ixtrust.common.NameParser.parse(name).givenName();
        return parsed.isBlank() ? null : parsed;
    }

    /** 역할 코드 목록 반환 (편의 메서드) */
    public Set<String> getRoleCodes() {
        Set<String> codes = new HashSet<>();
        for (Role role : roles) {
            codes.add(role.getCode());
        }
        return codes;
    }

    /** 특정 역할 보유 여부 */
    public boolean hasRole(String code) {
        return roles.stream().anyMatch(r -> r.getCode().equals(code));
    }

    /** 계정이 잠겨있는지 확인 (시간 경과 시 자동 해제) */
    public boolean isLocked() {
        return lockedUntil != null && LocalDateTime.now().isBefore(lockedUntil);
    }

    /** 로그인 실패 기록 */
    public void recordFailedAttempt(int maxAttempts, int lockDurationMinutes) {
        this.failedAttempts++;
        if (maxAttempts > 0 && this.failedAttempts >= maxAttempts) {
            this.lockedUntil = LocalDateTime.now().plusMinutes(lockDurationMinutes);
        }
    }

    /** 로그인 성공 시 실패 횟수 초기화 */
    public void resetFailedAttempts() {
        this.failedAttempts = 0;
        this.lockedUntil = null;
    }

    /** 관리자가 수동으로 잠금 해제 */
    public void unlock() {
        this.failedAttempts = 0;
        this.lockedUntil = null;
    }
}
