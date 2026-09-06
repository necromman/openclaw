package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.domain.User;
import team.prost.ixauth.domain.UserStatus;
import team.prost.ixauth.repository.RoleRepository;
import team.prost.ixauth.repository.SessionRepository;
import team.prost.ixauth.repository.UserRepository;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** 사용자 관리. */
@Service
@RequiredArgsConstructor
public class UserAdminService {

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final SessionRepository sessionRepository;
    private final team.prost.ixauth.repository.IdentityRepository identityRepository;
    private final team.prost.ixauth.repository.FederatedIdentityRepository
            federatedIdentityRepository;
    private final team.prost.ixauth.repository.MfaCredentialRepository mfaCredentialRepository;
    private final team.prost.ixauth.repository.AuditLogRepository auditLogRepository;
    private final team.prost.ixauth.repository.TermAgreementRepository termAgreementRepository;
    private final team.prost.ixauth.authz.AuthzService authzService;
    private final PasswordEncoder passwordEncoder;
    private final PasswordPolicyService passwordPolicy;
    private final PasswordHistoryService passwordHistory;
    private final UserAttributeService userAttributeService;
    private final AuditService auditService;

    /**
     * @param role 역할 코드. 직접 부여분과 그룹 경유분을 모두 본다 —
     *             목록에 보이는 {@code roles} 와 같은 기준이어야 그 화면을 믿을 수 있다
     *             (계약: http-api.md §4). 없는 코드면 빈 목록이다
     */
    @Transactional(readOnly = true)
    public Page<User> search(String q, UserStatus status, String role, Pageable pageable) {
        // null 을 그대로 바인딩하면 PostgreSQL 이 타입을 추론하지 못한다 (UserRepository.search 주석)
        return userRepository.search(
                q == null ? "" : q,
                status == null ? java.util.EnumSet.allOf(UserStatus.class) : java.util.Set.of(status),
                role == null ? "" : role.trim(),
                pageable);
    }

    @Transactional(readOnly = true)
    public User get(Long id) {
        return userRepository.findById(id).orElseThrow(() -> ApiException.notFound("사용자"));
    }

    @Transactional
    public User create(String email, String name, String rawPassword, List<String> roleCodes,
                       Long actorId) {
        return create(email, name, rawPassword, roleCodes, null, actorId);
    }

    /**
     * @param attributes 정의({@code user_attribute_defs})에 따라 검증·정규화된다.
     *                   정의가 하나도 없으면 그대로 저장된다 — 이 기능이 생겼다는 이유로
     *                   지금까지 쓰던 앱이 400 을 받기 시작하면 안 된다
     */
    @Transactional
    public User create(String email, String name, String rawPassword, List<String> roleCodes,
                       Map<String, Object> attributes, Long actorId) {
        if (userRepository.existsByEmailIgnoreCase(email)) {
            throw ApiException.conflict("이미 사용 중인 이메일입니다.");
        }
        // 비밀번호를 주지 않으면 초대 방식이다 — 관리자가 비밀번호를 정해서
        // 메신저로 알려 주는 관행이 대개 가장 약한 고리이므로, 이쪽을 권장한다
        boolean invited = rawPassword == null || rawPassword.isBlank();
        if (!invited) {
            passwordPolicy.validate(rawPassword);
        }
        var checked = userAttributeService.validate(attributes);

        var user = new User(email, name, invited ? null : passwordEncoder.encode(rawPassword));
        if (invited) {
            user.setStatus(team.prost.ixauth.domain.UserStatus.PENDING);
        }
        if (checked != null) {
            user.setAttributes(new java.util.HashMap<>(checked));
        }
        applyRoles(user, roleCodes);
        userRepository.save(user);
        if (!invited) {
            passwordHistory.record(user.getId(), user.getPasswordHash());
        }

        auditService.record(AuditService.USER_CREATED, user.getId(), actorId, null, null,
                Map.of("email", email, "roles", roleCodes == null ? List.of() : roleCodes));
        return user;
    }

    /**
     * @param status 바꿀 상태. {@code LOCKED}·{@code DISABLED} 로 바꾸면 <b>기존 세션을
     *               즉시 폐기</b>한다 — 그러지 않으면 차단이 다음 로그인 시점까지
     *               미뤄지고, 이미 들어와 있는 사람은 그대로 쓴다 (계약: http-api.md §2-1-1)
     */
    @Transactional
    public User update(Long id, String name, UserStatus status, Map<String, Object> attributes,
                       Long actorId) {
        var user = get(id);
        if (name != null) {
            user.setName(name);
        }
        int revoked = 0;
        if (status != null) {
            revoked = applyStatus(user, status);
        }
        // null 이면 "손대지 않음" 이다. 이름만 바꾸는 요청이 속성 검사에 걸리면 안 된다
        var checked = userAttributeService.validate(attributes);
        if (checked != null) {
            user.setAttributes(new java.util.HashMap<>(checked));
        }
        auditService.record(AuditService.USER_UPDATED, id, actorId, null, null,
                revoked == 0 ? Map.of() : Map.of("revokedSessions", revoked));
        return user;
    }

    /**
     * 상태 전환에 딸린 부수 효과.
     *
     * <p>{@code LOCKED} 에 {@code locked_until} 을 비우는 것이 요점이다. 그 값의 유무가
     * <b>자동 잠금과 관리자 잠금을 가르는 기준</b>이라(User#isLocked), 값이 남아 있으면
     * 관리자가 건 잠금이 시각이 지나는 순간 저절로 풀린다.</p>
     *
     * @return 폐기한 세션 수
     */
    private int applyStatus(User user, UserStatus status) {
        user.setStatus(status);
        switch (status) {
            case LOCKED -> user.setLockedUntil(null);
            // 되살릴 때 잠금 흔적을 남기면 다음 로그인이 다시 막힌다
            case ACTIVE -> {
                user.setLockedUntil(null);
                user.setFailedCount(0);
            }
            default -> { }
        }
        if (status == UserStatus.LOCKED || status == UserStatus.DISABLED) {
            return sessionRepository.revokeAllByUserId(user.getId(), Instant.now());
        }
        return 0;
    }

    /** 소프트 삭제 — 물리 삭제하면 감사 로그의 FK 가 끊긴다 */
    @Transactional
    public void disable(Long id, Long actorId) {
        var user = get(id);
        user.setStatus(UserStatus.DISABLED);
        int revoked = sessionRepository.revokeAllByUserId(id, Instant.now());
        auditService.record(AuditService.USER_DISABLED, id, actorId, null, null,
                Map.of("revokedSessions", revoked));
    }

    /**
     * 잠금 해제 — <b>자동 잠금과 관리자 잠금을 모두</b> 푼다.
     *
     * <p>관리자 잠금을 푸는 경로는 이것과 {@code PATCH status=ACTIVE} 둘뿐이다.
     * 시간·로그인·비밀번호 재설정으로는 풀리지 않는다 (계약: http-api.md §2-1-1).</p>
     */
    @Transactional
    public void unlock(Long id, Long actorId) {
        var user = get(id);
        user.setFailedCount(0);
        user.setLockedUntil(null);
        if (user.getStatus() == UserStatus.LOCKED) {
            user.setStatus(UserStatus.ACTIVE);
        }
        auditService.record(AuditService.USER_UNLOCKED, id, actorId, null, null, Map.of());
    }

    /**
     * 관리자에 의한 비밀번호 초기화 — 기존 세션을 전부 끊는다.
     *
     * <p><b>재사용 이력은 검사하지 않는다.</b> 이력에 있으면 거부한다고 답하는 순간, 이
     * API 가 "그 사람이 전에 이 비밀번호를 썼는가" 를 확인하는 도구가 된다. 관리자는
     * 남의 지난 비밀번호를 알 이유가 없고, 알아야 할 이유도 없다. 대신 여기서 정한
     * 비밀번호는 <b>이력에 남긴다</b> — 사용자가 그것을 그대로 다시 쓰는 것은 막는다.</p>
     */
    @Transactional
    public void resetPassword(Long id, String newRawPassword, Long actorId) {
        passwordPolicy.validate(newRawPassword);
        var user = get(id);
        user.setPasswordHash(passwordEncoder.encode(newRawPassword));
        user.setFailedCount(0);
        user.setLockedUntil(null);
        passwordHistory.record(id, user.getPasswordHash());
        int revoked = sessionRepository.revokeAllByUserId(id, Instant.now());
        auditService.record(AuditService.PASSWORD_CHANGED, id, actorId, null, null,
                Map.of("by", "ADMIN", "revokedSessions", revoked));
    }

    @Transactional
    public void replaceRoles(Long id, List<String> roleCodes, Long actorId) {
        var user = get(id);
        user.getRoles().clear();
        applyRoles(user, roleCodes);
        auditService.record(AuditService.ROLE_GRANTED, id, actorId, null, null,
                Map.of("roles", roleCodes == null ? List.of() : roleCodes));
    }

    @Transactional
    public int revokeSessions(Long id, Long actorId) {
        int revoked = sessionRepository.revokeAllByUserId(id, Instant.now());
        auditService.record(AuditService.SESSION_REVOKED, id, actorId, null, null,
                Map.of("count", revoked));
        return revoked;
    }

    // ────────────────────── 상세 (G22) ──────────────────────

    /**
     * 한 사람의 지금 상태를 한 화면에 모은다.
     *
     * <p>목록만 있으면 "이 사람이 왜 못 들어오는가" 에 답하려고 사용자 탭 · 세션 · 감사
     * 로그를 번갈아 열게 된다. 그 사이에 정작 원인(2단계가 걸려 있다 · 소셜만 연결돼
     * 있다 · 어제 잠겼다)을 놓친다. 여기서는 <b>한 번에</b> 보인다.</p>
     *
     * <p>비밀·시크릿은 하나도 담지 않는다 — TOTP 시크릿도, 백업 코드도, 세션 토큰도
     * 여기 오지 않는다. 남는 것은 "걸려 있는가 · 몇 개 남았는가" 뿐이다.</p>
     */
    @Transactional(readOnly = true)
    public Map<String, Object> detail(Long id) {
        var user = get(id);
        var now = Instant.now();

        var out = new java.util.LinkedHashMap<String, Object>();
        out.put("id", String.valueOf(user.getId()));
        out.put("email", user.getEmail());
        out.put("name", user.getName());
        out.put("status", user.getStatus().name());
        out.put("emailVerified", user.getEmailVerifiedAt() != null);
        out.put("failedCount", user.getFailedCount());
        out.put("lockedUntil", user.getLockedUntil());
        out.put("lastLoginAt", user.getLastLoginAt());
        out.put("createdAt", user.getCreatedAt());
        out.put("deletionRequestedAt", user.getDeletionRequestedAt());
        out.put("attributes", user.getAttributes());
        out.put("roles", authzService.effectiveRoleCodes(id));
        out.put("groups", authzService.groupCodes(id));
        out.put("sessions", sessionsOf(id, now));
        out.put("identities", identitiesOf(id));
        out.put("federatedIdentities", federatedIdentitiesOf(id));
        out.put("mfa", mfaOf(id));
        out.put("terms", termsOf(id));
        out.put("recentAudit", recentAuditOf(id));
        return out;
    }

    /** 살아 있는 세션만. 폐기·만료된 것까지 보이면 "지금 어디서 쓰는가" 가 묻힌다 */
    private List<Map<String, Object>> sessionsOf(Long id, Instant now) {
        return sessionRepository.findByUserIdOrderByIssuedAtDesc(id).stream()
                .filter(s -> s.isUsable(now))
                .<Map<String, Object>>map(s -> {
                    var m = new java.util.LinkedHashMap<String, Object>();
                    m.put("id", s.getId().toString());
                    m.put("issuedAt", s.getIssuedAt());
                    m.put("lastUsedAt", s.getLastUsedAt());
                    m.put("expiresAt", s.getExpiresAt());
                    m.put("ip", s.getIp());
                    m.put("deviceLabel",
                            team.prost.ixauth.common.DeviceLabel.of(s.getUserAgent()));
                    return m;
                }).toList();
    }

    private List<Map<String, Object>> identitiesOf(Long id) {
        return identityRepository.findByUserId(id).stream()
                .<Map<String, Object>>map(i -> {
                    var m = new java.util.LinkedHashMap<String, Object>();
                    m.put("provider", i.getProvider().name());
                    m.put("email", i.getEmail());
                    m.put("displayName", i.getDisplayName());
                    m.put("linkedAt", i.getLinkedAt());
                    m.put("lastLoginAt", i.getLastLoginAt());
                    return m;
                }).toList();
    }

    /**
     * 연합 신원 연결 — 앱이 외부 IdP 에서 확인해 온 계정들.
     *
     * <p>{@link #identitiesOf}(소셜)와 나눠서 보여 주는 이유 — 두 목록은 <b>누가 그
     * 연결을 보증했는가</b> 가 다르다. 소셜은 jar 가 provider 와 직접 주고받은 결과이고,
     * 이쪽은 앱이 대신 확인해 온 결과다. 한 줄로 섞어 두면 "이 사람이 어떻게 들어오나"
     * 를 볼 때 그 차이가 사라진다.</p>
     */
    private List<Map<String, Object>> federatedIdentitiesOf(Long id) {
        return federatedIdentityRepository.findByUserIdOrderByIdAsc(id).stream()
                .<Map<String, Object>>map(f -> {
                    var m = new java.util.LinkedHashMap<String, Object>();
                    m.put("provider", f.getProvider());
                    m.put("subject", f.getSubject());
                    m.put("emailAtLink", f.getEmailAtLink());
                    m.put("linkedAt", f.getCreatedAt());
                    m.put("lastLoginAt", f.getLastLoginAt());
                    return m;
                }).toList();
    }

    /**
     * 2단계 상태.
     *
     * <p>남은 백업 코드 수는 <b>세어서만</b> 준다. 코드 자체는 해시로만 있고, 있어도
     * 관리자가 볼 이유가 없다 — 보이는 순간 그것으로 남의 2단계를 지나갈 수 있다.</p>
     */
    private Map<String, Object> mfaOf(Long id) {
        var credential = mfaCredentialRepository.findByUserIdAndType(
                id, team.prost.ixauth.domain.MfaCredential.TYPE_TOTP);
        var m = new java.util.LinkedHashMap<String, Object>();
        m.put("enabled", credential.map(c -> c.isActive()).orElse(false));
        m.put("registeredAt", credential.map(c -> c.getCreatedAt()).orElse(null));
        m.put("confirmedAt", credential.map(c -> c.getConfirmedAt()).orElse(null));
        m.put("backupCodesLeft", credential
                .map(c -> team.prost.ixauth.mfa.BackupCodes.remaining(c.getBackupCodesHash()))
                .orElse(0));
        return m;
    }

    /** 코드마다 마지막 응답만. 증빙 전체는 약관 탭에서 본다 */
    private List<Map<String, Object>> termsOf(Long id) {
        return termAgreementRepository.findLatestPerCode(id).stream()
                .<Map<String, Object>>map(a -> {
                    var m = new java.util.LinkedHashMap<String, Object>();
                    m.put("code", a.getCode());
                    m.put("version", a.getVersion());
                    m.put("agreed", a.isAgreed());
                    m.put("agreedAt", a.getAgreedAt());
                    return m;
                }).toList();
    }

    private List<Map<String, Object>> recentAuditOf(Long id) {
        var page = auditLogRepository.findByUserIdOrderByCreatedAtDesc(id,
                org.springframework.data.domain.PageRequest.of(0, 10));
        return page.getContent().stream()
                .<Map<String, Object>>map(a -> {
                    var m = new java.util.LinkedHashMap<String, Object>();
                    m.put("id", a.getId());
                    m.put("eventType", a.getEventType());
                    m.put("actorId", a.getActorId());
                    m.put("ip", a.getIp());
                    m.put("detail", a.getDetail());
                    m.put("createdAt", a.getCreatedAt());
                    return m;
                }).toList();
    }

    private void applyRoles(User user, List<String> roleCodes) {
        if (roleCodes == null || roleCodes.isEmpty()) {
            roleRepository.findByCode("USER").ifPresent(user.getRoles()::add);
            return;
        }
        var found = roleRepository.findByCodeIn(roleCodes);
        if (found.size() != roleCodes.size()) {
            throw new ApiException(ErrorCode.NOT_FOUND, "존재하지 않는 역할이 포함돼 있습니다.");
        }
        user.getRoles().addAll(found);
    }
}
