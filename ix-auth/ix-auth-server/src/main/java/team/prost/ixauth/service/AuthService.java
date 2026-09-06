package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.authz.AuthzService;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.Session;
import team.prost.ixauth.domain.User;
import team.prost.ixauth.domain.UserStatus;
import team.prost.ixauth.repository.SessionRepository;
import team.prost.ixauth.repository.UserRepository;
import team.prost.ixauth.security.JwtService;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 인증 — 로그인 · 토큰 갱신 · 로그아웃.
 *
 * <p>보안 규칙 (계약 + rules/coding-style.md):</p>
 * <ul>
 *   <li>로그인 실패는 이유를 구분하지 않는다 — 계정 존재 여부가 새어나가면 안 된다</li>
 *   <li>잠금·비활성은 <b>비밀번호가 맞았을 때만</b> 알린다</li>
 *   <li>refresh token 은 해시로만 저장한다</li>
 *   <li>refresh 재사용이 감지되면 해당 사용자의 모든 세션을 폐기한다 (탈취 신호)</li>
 *   <li>2단계 인증이 켜진 계정은 비밀번호만으로 토큰을 받지 못한다 —
 *       {@code AUTH_MFA_REQUIRED} 와 challenge 를 주고 {@link #verifyMfa} 로 이어진다</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AuthService {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int REFRESH_BYTES = 32;

    private final UserRepository userRepository;
    private final SessionRepository sessionRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final AuthzService authzService;
    private final AuditService auditService;
    private final LoginAttemptService loginAttemptService;
    private final SessionRevocationService sessionRevocationService;
    private final MfaService mfaService;
    private final SessionLimitService sessionLimitService;
    private final LoginNotificationService loginNotificationService;
    private final AccountDeletionService accountDeletionService;
    private final TermsService termsService;
    private final IxAuthProperties properties;

    /**
     * @param mfaSetupRequired 2단계가 필수인데 아직 등록하지 않았다는 신호.
     *                         앱은 이걸 보고 등록 화면으로 보낸다 — jar 가 여기서 막으면
     *                         설정을 바꾼 순간 전원이 잠긴다
     * @param termsAgreementRequired 아직 동의하지 않은 필수 약관 코드. 같은 이유로
     *                         로그인을 막지 않고 신호만 준다
     */
    public record LoginResult(String accessToken, String refreshToken, long expiresIn,
                              Long userId, String email, String name,
                              List<String> roles, List<String> groups,
                              boolean mfaSetupRequired, List<String> termsAgreementRequired) {
    }

    public record RefreshResult(String accessToken, String refreshToken, long expiresIn) {
    }

    // ────────────────────────── 로그인 ──────────────────────────

    @Transactional
    public LoginResult login(String email, String rawPassword, String userAgent, String ip) {
        Instant now = Instant.now();

        User user = userRepository.findByEmailIgnoreCase(email).orElse(null);
        if (user == null) {
            // 계정이 없어도 "비밀번호 불일치" 와 같은 응답을 준다
            auditService.record(AuditService.LOGIN_FAILURE, null, null, ip, userAgent,
                    Map.of("email", mask(email), "reason", "NO_ACCOUNT"));
            throw new ApiException(ErrorCode.AUTH_INVALID_CREDENTIALS);
        }

        boolean passwordOk = user.getPasswordHash() != null
                && passwordEncoder.matches(rawPassword, user.getPasswordHash());

        if (!passwordOk) {
            // 별도 트랜잭션에서 커밋한다 — 아래 예외로 이 트랜잭션이 롤백돼도
            // 실패 카운터는 남아야 잠금이 성립한다 (LoginAttemptService 주석)
            loginAttemptService.registerFailure(user.getId(), ip, userAgent);
            throw new ApiException(ErrorCode.AUTH_INVALID_CREDENTIALS);
        }

        // ── 여기서부터는 비밀번호가 맞은 뒤다. 상태를 알려줘도 계정 존재가 새지 않는다 ──
        assertLoginAllowed(user, now);

        // 2단계가 켜져 있으면 여기서 멈춘다. 토큰은 코드를 확인한 뒤에 나간다.
        //
        // 아래 재해싱보다 앞에 두는 이유 — 어차피 이 예외가 트랜잭션을 롤백시켜
        // 재해싱 결과가 남지 않는다. 즉 2단계를 켠 사용자는 rehash-on-login 의
        // 대상에서 빠진다(레거시 해시는 대개 이사 직후 첫 로그인에 이미 바뀐다).
        if (mfaService.isActive(user.getId())) {
            throw mfaRequired(user, ip, userAgent);
        }

        // 레거시 해시 → 현행 알고리즘으로 조용히 재해싱 (이사 지원, 도입 케이스 B)
        if (properties.getPassword().isRehashOnLogin()
                && passwordEncoder.upgradeEncoding(user.getPasswordHash())) {
            user.setPasswordHash(passwordEncoder.encode(rawPassword));
            auditService.record(AuditService.PASSWORD_REHASHED, user.getId(), user.getId(),
                    ip, userAgent, Map.of());
        }

        // 자동 잠금만 푼다. 관리자 잠금은 여기 올 수 없다(위 게이트에서 막힌다)
        user.clearAutomaticLock();
        user.setLastLoginAt(now);

        var issued = issueSession(user, userAgent, ip, now);
        auditService.record(AuditService.LOGIN_SUCCESS, user.getId(), user.getId(), ip, userAgent,
                Map.of("sid", issued.sessionId().toString()));
        afterLogin(user, issued, ip, userAgent, now);

        return toResult(user, issued);
    }

    /**
     * 비밀번호가 맞은 뒤의 상태 검사.
     *
     * <p>여기서 던지는 코드들은 <b>계정이 있다는 것을 인정하는</b> 응답이다. 비밀번호를
     * 이미 통과했으므로 노출 문제가 없고, 안내가 없으면 사용자가 원인을 알 수 없다.</p>
     *
     * <p><b>패키지 가시성인 이유</b> — 연합 신원 교환({@code FederatedIdentityService})도
     * 같은 게이트를 지나야 한다. 거기서 판단을 새로 쓰면 "관리 화면은 잠김이라 적어 두고
     * 실제로는 들어와지는" 상태가 다시 생긴다 (계약: http-api.md §2-1-1).</p>
     */
    void assertLoginAllowed(User user, Instant now) {
        if (user.isLocked(now)) {
            throw accountLocked(user);
        }
        if (user.getStatus() == UserStatus.DISABLED) {
            throw new ApiException(ErrorCode.AUTH_ACCOUNT_DISABLED);
        }
        if (user.getStatus() == UserStatus.PENDING) {
            throw new ApiException(ErrorCode.AUTH_ACCOUNT_PENDING);
        }
        if (user.getStatus() == UserStatus.PENDING_APPROVAL) {
            // 본인이 할 일은 없다 — 관리자가 승인해야 한다는 것을 알려 줘야
            // 사용자가 무엇을 기다리는지 안다
            throw new ApiException(ErrorCode.AUTH_ACCOUNT_PENDING_APPROVAL);
        }
        if (properties.getAccount().isRequireEmailVerification()
                && user.getEmailVerifiedAt() == null) {
            // 앱은 이 코드를 보고 '인증 메일 다시 보내기' 를 안내하면 된다
            throw new ApiException(ErrorCode.AUTH_EMAIL_UNVERIFIED);
        }
    }

    /**
     * 잠긴 계정 응답 — 자동 잠금과 관리자 잠금은 <b>안내할 말이 다르다</b>.
     *
     * <p>자동 잠금은 기다리면 풀리므로 풀리는 시각을 준다({@code meta.lockedUntil}).
     * 관리자 잠금에는 그런 시각이 없다 — 기다리라고 안내하면 영영 기다리게 된다.
     * 앱은 {@code meta.lockedUntil} 의 유무로 둘을 가른다 (계약: errors.md).</p>
     */
    private ApiException accountLocked(User user) {
        if (user.isAdminLocked()) {
            return new ApiException(ErrorCode.AUTH_ACCOUNT_LOCKED,
                    "관리자가 잠근 계정입니다. 관리자에게 문의하세요.");
        }
        return new ApiException(ErrorCode.AUTH_ACCOUNT_LOCKED,
                "계정이 잠겼습니다. " + user.getLockedUntil() + " 이후 다시 시도하세요.",
                null, Map.of("lockedUntil", user.getLockedUntil().toString()));
    }

    /**
     * 2단계로 넘긴다 — challenge 를 함께 준다.
     *
     * <p>challenge 는 <b>별도 트랜잭션</b>에서 저장된다. 아래 예외가 이 트랜잭션을
     * 롤백시켜도 남아 있어야 앱이 다음 단계를 부를 수 있다.</p>
     */
    private ApiException mfaRequired(User user, String ip, String userAgent) {
        var challenge = mfaService.issueChallenge(user.getId());
        auditService.record(AuditService.MFA_CHALLENGED, user.getId(), user.getId(),
                ip, userAgent, Map.of());
        return new ApiException(ErrorCode.AUTH_MFA_REQUIRED,
                ErrorCode.AUTH_MFA_REQUIRED.getDefaultMessage(), null,
                Map.of("challenge", challenge.token(), "expiresIn", challenge.expiresIn()));
    }

    // ────────────────────── 2단계 인증 (로그인 2/2) ──────────────────────

    /**
     * challenge + 코드로 최종 토큰을 발급한다. 코드 자리에는 <b>백업 코드도</b> 온다.
     *
     * <p>검증은 {@code MfaService} 가 하고 세션 발급은 여기서 한다 — 토큰이 나가는
     * 지점을 한 곳으로 유지해야 회전·감사 규칙이 갈라지지 않는다.</p>
     */
    @Transactional
    public LoginResult verifyMfa(String challenge, String code, String userAgent, String ip) {
        Long userId = mfaService.verifyChallenge(challenge, code, ip, userAgent);
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.AUTH_TOKEN_INVALID));

        Instant now = Instant.now();
        // 1단계에서 이미 확인했지만 challenge 수명(기본 5분) 사이에 상태가 바뀔 수 있다
        assertLoginAllowed(user, now);

        user.clearAutomaticLock();
        user.setLastLoginAt(now);

        var issued = issueSession(user, userAgent, ip, now);
        auditService.record(AuditService.LOGIN_SUCCESS, user.getId(), user.getId(), ip, userAgent,
                Map.of("sid", issued.sessionId().toString(), "method", "mfa"));
        afterLogin(user, issued, ip, userAgent, now);
        return toResult(user, issued);
    }

    // ────────────────────────── 갱신 ──────────────────────────

    @Transactional
    public RefreshResult refresh(String refreshToken, String userAgent, String ip) {
        Instant now = Instant.now();
        String hash = sha256(refreshToken);

        Session session = sessionRepository.findByRefreshTokenHash(hash)
                .orElseThrow(() -> new ApiException(ErrorCode.AUTH_TOKEN_INVALID));

        // 이미 폐기된 토큰이 다시 왔다 = 탈취 신호. 해당 사용자의 모든 세션을 끊는다.
        // 별도 트랜잭션에서 커밋한다 — 아래 예외로 롤백되면 폐기가 취소되어
        // 탈취된 토큰이 계속 살아 있게 된다 (SessionRevocationService 주석)
        if (session.getRevokedAt() != null) {
            int revoked = sessionRevocationService.revokeAllForUser(session.getUserId(), now);
            auditService.record(AuditService.REFRESH_REUSE_DETECTED, session.getUserId(), null,
                    ip, userAgent, Map.of("revokedSessions", revoked));
            log.warn("refresh 재사용 감지 — user={} 세션 {}개 폐기", session.getUserId(), revoked);
            throw new ApiException(ErrorCode.AUTH_SESSION_REVOKED);
        }
        if (!session.getExpiresAt().isAfter(now)) {
            throw new ApiException(ErrorCode.AUTH_REFRESH_EXPIRED);
        }

        User user = userRepository.findById(session.getUserId())
                .orElseThrow(() -> new ApiException(ErrorCode.AUTH_TOKEN_INVALID));
        // 잠금을 DISABLED 로 뭉뚱그리면 앱이 "폐기된 계정" 으로 안내하게 된다.
        // 잠금은 풀릴 수 있는 상태이므로 그렇게 알려 준다
        if (user.isLocked(now)) {
            throw accountLocked(user);
        }
        if (!user.isActive()) {
            throw new ApiException(ErrorCode.AUTH_ACCOUNT_DISABLED);
        }

        // 회전 — 기존 세션을 폐기하고 새 세션을 만든다.
        // 덮어쓰지 않는 이유: 옛 해시가 다시 오면 위의 재사용 감지가 걸려야 한다.
        // 명시적 UPDATE 를 쓴다 (SessionRepository.revokeByTokenHash 주석 참조)
        UUID oldSessionId = session.getId();
        int revoked = sessionRepository.revokeByTokenHash(hash, now);
        if (revoked == 0) {
            // 폐기가 실패하면 옛 토큰이 계속 유효해져 재사용 감지가 무력화된다.
            // 조용히 넘어가면 안 되는 지점이라 요청 자체를 실패시킨다.
            log.error("세션 폐기 실패 — sid={} 회전을 중단한다", oldSessionId);
            throw new ApiException(ErrorCode.INTERNAL);
        }

        // 대리 세션이면 act 를 그대로 물려준다 — 출처는 토큰이 아니라 이 세션 행이다.
        // 앱이 보낸 토큰의 act 를 믿고 다시 서명하면 대리 사실을 클라이언트가 정하게 된다
        var actor = session.isImpersonated()
                ? new JwtService.Actor(session.getImpersonatorId(), session.getImpersonatorEmail())
                : null;
        // 대리 창은 회전으로 늘어나지 않는다. 늘어나면 ixauth.impersonation.ttl 이
        // '수명' 이 아니라 '유휴 시간' 이 되어, 15분마다 갱신하는 것만으로 남의 계정을
        // 무한정 붙들고 있을 수 있다
        Instant expiresAt = actor == null ? null : session.getExpiresAt();

        // idp 도 act 와 같은 이유로 세션 행이 정본이다 — 회전이 몇 번 돌아도
        // "이 세션은 어느 IdP 로 열렸나" 를 서버가 답한다
        var issued = issueSession(user, userAgent, ip, now, actor, expiresAt, session.getIdp());
        auditService.record(AuditService.TOKEN_REFRESHED, user.getId(), user.getId(), ip, userAgent,
                Map.of("oldSid", oldSessionId.toString(), "newSid", issued.sessionId().toString()));

        return new RefreshResult(issued.accessToken(), issued.refreshToken(), issued.expiresIn());
    }

    // ────────────────────────── 로그아웃 ──────────────────────────

    @Transactional
    public void logout(String refreshToken, UUID sessionId, String ip, String userAgent) {
        Instant now = Instant.now();
        Session session = null;

        if (refreshToken != null && !refreshToken.isBlank()) {
            session = sessionRepository.findByRefreshTokenHash(sha256(refreshToken)).orElse(null);
        } else if (sessionId != null) {
            session = sessionRepository.findById(sessionId).orElse(null);
        }

        if (session != null && session.getRevokedAt() == null) {
            session.setRevokedAt(now);
            auditService.record(AuditService.LOGOUT, session.getUserId(), session.getUserId(),
                    ip, userAgent, Map.of("sid", session.getId().toString()));
        }
        // 이미 없거나 폐기된 세션이어도 204 — 로그아웃은 멱등이어야 한다
    }

    // ────────────────────────── 내부 ──────────────────────────

    private record IssuedSession(String accessToken, String refreshToken, long expiresIn,
                                 UUID sessionId, List<String> roles, List<String> groups) {
    }

    /**
     * 비밀번호를 거치지 않고 세션을 발급한다 — 소셜 로그인이 쓴다.
     *
     * <p>비밀번호 검증·잠금 판단은 <b>호출자가 이미 끝냈다</b>는 전제다. 그래서
     * 아무 데서나 부르면 안 된다. 지금 쓰는 곳은 {@code SocialAuthService} 뿐이고,
     * 거기서는 provider 가 신원을 보증한 뒤다.</p>
     *
     * <p><b>2단계 인증을 요구하지 않는다.</b> provider 가 이미 본인확인(대개 자체 2단계
     * 포함)을 마친 경로이고, 여기서 다시 막으면 소셜로만 쓰던 사용자가 들어올 방법이
     * 없어진다. 이 경계는 설정 화면의 경고에도 적어 두었다.</p>
     */
    @Transactional
    public LoginResult issueFor(User user, String userAgent, String ip, String method) {
        return issueFor(user, userAgent, ip, method, null);
    }

    /**
     * @param idp 연합 신원 교환으로 들어온 경우 그 provider 이름. 세션 행과 토큰의
     *            {@code ixauth_idp} 클레임에 남는다. 자체 인증이면 {@code null}
     */
    @Transactional
    public LoginResult issueFor(User user, String userAgent, String ip, String method,
                                String idp) {
        Instant now = Instant.now();

        // 관리자 잠금은 호출자가 이미 걸렀다. 여기서는 자동 잠금만 푼다
        user.clearAutomaticLock();
        user.setLastLoginAt(now);
        userRepository.save(user);

        var issued = issueSession(user, userAgent, ip, now, null, null, idp);
        auditService.record(AuditService.LOGIN_SUCCESS, user.getId(), user.getId(), ip, userAgent,
                Map.of("sid", issued.sessionId().toString(), "method", method));
        afterLogin(user, issued, ip, userAgent, now);

        return toResult(user, issued);
    }

    /**
     * 대리 세션을 발급한다 — {@code ImpersonationService} 만 호출한다.
     *
     * <p><b>대상의 로그인 기록을 건드리지 않는다.</b> {@code lastLoginAt} · 실패 카운터 ·
     * 잠금 해제는 전부 그대로 둔다. 관리자가 들여다본 것을 본인의 로그인으로 적으면
     * "마지막 접속" 이 거짓이 되고, 이 기능이 답해야 할 질문(누가 언제 무엇을 했나)이
     * 오히려 흐려진다.</p>
     *
     * <p><b>{@code afterLogin} 도 부르지 않는다.</b> 동시 세션 상한을 적용하면 대리가
     * 사용자를 실제로 쫓아내고, 새 기기 알림을 보내면 사용자에게 "낯선 곳에서 로그인"
     * 메일이 나간다 — 둘 다 대리가 해서는 안 되는 일이다.</p>
     *
     * <p>2단계 인증도 요구하지 않는다 — 자격을 증명한 사람은 이미 관리자이고, 대상의
     * 코드를 관리자가 알 리 없다. 통제는 전용 권한과 감사 기록이다.</p>
     */
    @Transactional
    public LoginResult issueImpersonated(User target, JwtService.Actor actor,
                                         String userAgent, String ip) {
        var issued = issueSession(target, userAgent, ip, Instant.now(), actor, null, null);
        return toResult(target, issued);
    }

    /**
     * 로그인 성공 후처리 — 탈퇴 취소 · 동시 세션 상한 · 새 기기 알림.
     *
     * <p><b>{@link #issueSession} 이 아니라 여기에 둔다.</b> 토큰 <b>갱신</b>도 세션을
     * 새로 만들지만 그건 로그인이 아니다. 갱신마다 "새 기기" 를 판정하면 이동 중인
     * 휴대폰이 IP 를 바꿀 때마다 메일이 나가고, 갱신마다 상한을 적용해 봐야 회전이라
     * 세션 수는 그대로다.</p>
     *
     * <p>순서에 뜻이 있다. ① 탈퇴 취소를 가장 먼저 — 이 로그인이 "돌아왔다" 는 신호라
     * 나머지 판단보다 앞선다. ② 상한 적용. ③ 알림. 알림 판정은 폐기 여부를 보지 않으므로
     * ②가 ③에 영향을 주지 않는다.</p>
     */
    private void afterLogin(User user, IssuedSession issued, String ip, String userAgent,
                            Instant now) {
        accountDeletionService.cancelIfPending(user, ip, userAgent);
        sessionLimitService.enforce(user.getId(), issued.sessionId(), ip, userAgent, now);
        loginNotificationService.notifyIfNewDevice(user, issued.sessionId(), ip, userAgent, now);
    }

    /**
     * 토큰이 나가는 모든 경로가 여기를 지난다 — 비밀번호·2단계·소셜.
     *
     * <p>약관 재동의 신호는 <b>2단계 인증과 달리 소셜 로그인에도 붙는다.</b> 2단계는
     * provider 가 본인확인을 대신했다고 볼 수 있지만, 약관은 우리와 사용자 사이의
     * 합의라 provider 가 대신 받아 줄 수 있는 것이 아니다.</p>
     */
    private LoginResult toResult(User user, IssuedSession issued) {
        return new LoginResult(issued.accessToken(), issued.refreshToken(), issued.expiresIn(),
                user.getId(), user.getEmail(), user.getName(), issued.roles(), issued.groups(),
                mfaService.setupRequired(user.getId()),
                termsService.pendingRequiredCodes(user.getId()));
    }

    private IssuedSession issueSession(User user, String userAgent, String ip, Instant now) {
        return issueSession(user, userAgent, ip, now, null, null, null);
    }

    /**
     * @param actor     대리 중인 관리자. {@code null} 이면 평범한 세션이다
     * @param expiresAt 만료를 물려받을 때만 준다 (대리 세션 회전). {@code null} 이면
     *                  설정에서 새로 계산한다
     * @param idp       연합 신원 공급자. {@code null} 이면 IX-Auth 자체 인증이다
     */
    private IssuedSession issueSession(User user, String userAgent, String ip, Instant now,
                                       JwtService.Actor actor, Instant expiresAt, String idp) {
        List<String> roles = authzService.effectiveRoleCodes(user.getId());
        List<String> groups = authzService.groupCodes(user.getId());
        long pv = authzService.permissionsVersion();

        // 대리 세션은 일반 로그인(기본 7일)보다 짧다. 대리는 '지금 이 문의를 보는
        // 동안' 의 일이라, 길게 주면 관리자 브라우저에 남의 계정 열쇠가 그만큼 남는다
        Instant expiry = expiresAt != null ? expiresAt
                : now.plus(actor == null
                        ? properties.getJwt().getRefreshTtl()
                        : properties.getImpersonation().getTtl());

        String refreshToken = randomToken();
        UUID sessionId = UUID.randomUUID();
        var session = new Session(sessionId, user.getId(), sha256(refreshToken),
                expiry, userAgent, ip);
        session.setIssuedAt(now);
        if (actor != null) {
            session.setImpersonatorId(actor.userId());
            session.setImpersonatorEmail(actor.email());
        }
        session.setIdp(idp);
        sessionRepository.save(session);

        var access = jwtService.issueAccessToken(user.getId(), user.getEmail(), user.getName(),
                roles, groups, sessionId, pv, actor, idp);

        return new IssuedSession(access.token(), refreshToken, access.expiresInSeconds(),
                sessionId, roles, groups);
    }

    private String randomToken() {
        byte[] bytes = new byte[REFRESH_BYTES];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String sha256(String value) {
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new ApiException(ErrorCode.INTERNAL, "토큰 처리에 실패했습니다.");
        }
    }

    /** 감사 로그용 이메일 마스킹 — 원문을 그대로 남기지 않는다 */
    private String mask(String email) {
        if (email == null || email.length() < 3) {
            return "***";
        }
        int at = email.indexOf('@');
        if (at <= 1) {
            return "***";
        }
        return email.charAt(0) + "***" + email.substring(at);
    }
}
