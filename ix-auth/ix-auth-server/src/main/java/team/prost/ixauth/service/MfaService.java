package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.authz.AuthzService;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.MfaCredential;
import team.prost.ixauth.domain.User;
import team.prost.ixauth.domain.VerificationToken;
import team.prost.ixauth.mfa.BackupCodes;
import team.prost.ixauth.mfa.Base32;
import team.prost.ixauth.mfa.MfaSecretCipher;
import team.prost.ixauth.mfa.TotpGenerator;
import team.prost.ixauth.repository.MfaCredentialRepository;
import team.prost.ixauth.repository.UserRepository;
import team.prost.ixauth.repository.VerificationTokenRepository;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

/**
 * 2단계 인증(TOTP) — 등록 · 확인 · 검증 · 해제.
 *
 * <p>이 클래스를 관통하는 두 가지:</p>
 * <ul>
 *   <li><b>시크릿과 백업 코드는 발급 순간 외에 어디에도 나가지 않는다.</b>
 *       응답에도, 로그에도, 감사 기록에도 남기지 않는다</li>
 *   <li><b>등록과 활성화를 분리한다.</b> 코드가 실제로 맞는 것을 확인하기 전에는
 *       로그인에 아무 영향이 없다 — 그러지 않으면 QR 을 잘못 스캔한 사람이
 *       그 순간부터 자기 계정에서 잠긴다</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MfaService {

    private static final SecureRandom RANDOM = new SecureRandom();
    /** RFC 4226 이 권하는 하한(128비트)의 두 배. Base32 로 32글자가 된다 */
    private static final int SECRET_BYTES = 20;
    private static final int CHALLENGE_BYTES = 32;
    /** 앞뒤 1스텝(±30초)까지 허용한다. 넓히면 훔쳐본 코드가 그만큼 오래 산다 */
    private static final int ALLOWED_STEP_DRIFT = 1;
    /** 관리 API 를 열 수 있는 사람인지 판별하는 권한 코드 접두어 */
    private static final String IXAUTH_PERMISSION_PREFIX = "ixauth:";

    private final MfaCredentialRepository credentialRepository;
    private final VerificationTokenRepository tokenRepository;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final MfaSecretCipher cipher;
    private final AuthzService authzService;
    private final AuditService auditService;
    private final team.prost.ixauth.mail.MailService mailService;
    private final LoginAttemptService loginAttemptService;
    private final IxAuthProperties properties;

    /** @param backupCodes <b>평문.</b> 이 응답 이후로는 다시 볼 수 없다 */
    public record SetupResult(String otpauthUri, List<String> backupCodes) {
    }

    public record Challenge(String token, long expiresIn) {
    }

    public record StatusView(boolean enabled, String type, int backupCodesRemaining,
                             boolean pendingConfirm, String mode, boolean setupRequired) {
    }

    // ────────────────────────── 등록 ──────────────────────────

    /**
     * 시크릿을 만들고 <b>아직 켜지 않은</b> 등록을 남긴다.
     *
     * <p>돌려주는 것은 {@code otpauth://} URI 하나다. QR 이미지는 만들지 않는다 —
     * jar 는 화면을 만들지 않는다(설계 불변식 1).</p>
     */
    @Transactional
    public SetupResult setup(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "사용자를 찾을 수 없습니다."));

        credentialRepository.findByUserIdAndType(userId, MfaCredential.TYPE_TOTP)
                .ifPresent(existing -> {
                    if (existing.isActive()) {
                        // 켜져 있는 것을 조용히 갈아 끼우면, 토큰을 훔친 쪽이 자기 앱으로
                        // 바꿔 놓고 주인을 밀어낼 수 있다. 해제를 먼저 요구한다
                        throw new ApiException(ErrorCode.CONFLICT,
                                "이미 2단계 인증이 켜져 있습니다. 해제한 뒤 다시 등록하세요.");
                    }
                    credentialRepository.delete(existing);
                    credentialRepository.flush();
                });

        byte[] secret = new byte[SECRET_BYTES];
        RANDOM.nextBytes(secret);
        String base32 = Base32.encode(secret);

        var codes = BackupCodes.generate(Math.max(0, properties.getMfa().getBackupCodeCount()));
        credentialRepository.save(new MfaCredential(userId,
                cipher.encrypt(base32), BackupCodes.store(codes)));

        return new SetupResult(
                TotpGenerator.otpauthUri(issuerName(), user.getEmail(), base32), codes);
    }

    /**
     * 코드가 맞는지 확인하고 켠다.
     *
     * <p>여기서는 <b>백업 코드를 받지 않는다.</b> 확인의 목적은 "인증 앱이 실제로
     * 이 시크릿으로 코드를 만든다" 는 것이고, 백업 코드로는 그것이 증명되지 않는다.</p>
     */
    @Transactional
    public StatusView confirm(Long userId, String code, String ip, String userAgent) {
        var credential = credentialRepository.findByUserIdAndType(userId, MfaCredential.TYPE_TOTP)
                .orElseThrow(() -> new ApiException(ErrorCode.CONFLICT,
                        "등록을 먼저 시작하세요."));
        if (credential.isActive()) {
            throw new ApiException(ErrorCode.CONFLICT, "이미 2단계 인증이 켜져 있습니다.");
        }
        if (!consumeTotp(credential, code)) {
            auditService.record(AuditService.MFA_FAILED, userId, userId, ip, userAgent,
                    Map.of("phase", "CONFIRM"));
            throw new ApiException(ErrorCode.AUTH_MFA_INVALID);
        }

        credential.setConfirmedAt(Instant.now());
        credentialRepository.save(credential);
        auditService.record(AuditService.MFA_ENABLED, userId, userId, ip, userAgent,
                Map.of("backupCodes", BackupCodes.remaining(credential.getBackupCodesHash())));
        return status(userId);
    }

    /**
     * 해제 — 비밀번호를 다시 확인한다.
     *
     * <p>확인하지 않으면 자리를 비운 사이 남이 2단계를 꺼 버릴 수 있다. 그러면 이 기능이
     * 있는 이유가 사라진다.</p>
     */
    @Transactional
    public void disable(Long userId, String currentPassword, String ip, String userAgent) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "사용자를 찾을 수 없습니다."));
        if (user.getPasswordHash() == null
                || !passwordEncoder.matches(currentPassword, user.getPasswordHash())) {
            throw new ApiException(ErrorCode.AUTH_INVALID_CREDENTIALS,
                    "현재 비밀번호가 올바르지 않습니다.");
        }
        if (requiredFor(userId)) {
            // 필수인 사람이 스스로 끌 수 있으면 그 설정은 권고문에 지나지 않는다
            throw new ApiException(ErrorCode.AUTHZ_FORBIDDEN,
                    "이 계정은 2단계 인증을 해제할 수 없습니다. 관리자에게 문의하세요.");
        }

        credentialRepository.deleteByUserIdAndType(userId, MfaCredential.TYPE_TOTP);
        auditService.record(AuditService.MFA_DISABLED, userId, userId, ip, userAgent, Map.of());
    }

    /**
     * 관리자가 남의 2단계를 초기화한다 — 휴대폰과 백업 코드를 <b>모두</b> 잃었을 때의 복구 경로.
     *
     * <p>이 경로가 없으면 남는 수단은 DB 직접 수정뿐이고, 그쪽은 감사 로그도 통지도
     * 남지 않아 오히려 위험하다. 그래서 만들되, 두 가지를 <b>끌 수 없게</b> 붙인다:
     * 감사 기록과 본인 통지 메일이다. 관리자가 조용히 남의 2단계를 끄고 그 계정으로
     * 들어가는 일이 없어야 한다.</p>
     *
     * <p>비밀번호는 요구하지 않는다 — 남의 비밀번호를 관리자가 알 리 없다. 대신
     * {@code ixauth:users:write} 권한과 위 두 흔적이 통제 수단이다.</p>
     *
     * @return 실제로 등록돼 있던 것을 지웠는가. 아무것도 없었으면 {@code false} 이고,
     *         그 경우에도 기록과 통지는 나간다 — "시도했다" 는 사실 자체가 신호다
     */
    @Transactional
    public boolean resetByAdmin(Long userId, Long actorId, String ip, String userAgent) {
        if (!properties.getMfa().isAdminReset()) {
            throw new ApiException(ErrorCode.AUTHZ_FORBIDDEN,
                    "관리자에 의한 2단계 인증 초기화가 허용되지 않습니다.");
        }
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "사용자를 찾을 수 없습니다."));

        boolean had = credentialRepository
                .findByUserIdAndType(userId, MfaCredential.TYPE_TOTP).isPresent();
        credentialRepository.deleteByUserIdAndType(userId, MfaCredential.TYPE_TOTP);

        auditService.record(AuditService.MFA_RESET_BY_ADMIN, userId, actorId, ip, userAgent,
                Map.of("hadCredential", had));
        mailService.sendMfaReset(user.getEmail(), user.getName());
        log.warn("관리자가 2단계 인증을 초기화했다 — user={} actor={}", userId, actorId);
        return had;
    }

    // ────────────────────────── 조회 ──────────────────────────

    @Transactional(readOnly = true)
    public StatusView status(Long userId) {
        var credential = credentialRepository.findByUserIdAndType(userId, MfaCredential.TYPE_TOTP)
                .orElse(null);
        boolean active = credential != null && credential.isActive();
        int remaining = active ? BackupCodes.remaining(credential.getBackupCodesHash()) : 0;

        return new StatusView(active, MfaCredential.TYPE_TOTP, remaining,
                credential != null && !active,
                properties.getMfa().getMode().name(),
                !active && requiredFor(userId));
    }

    /** 로그인 경로가 묻는 것 — 이 사람에게 2단계가 걸려 있는가 */
    @Transactional(readOnly = true)
    public boolean isActive(Long userId) {
        return credentialRepository.existsByUserIdAndTypeAndConfirmedAtIsNotNull(
                userId, MfaCredential.TYPE_TOTP);
    }

    /**
     * 필수인데 아직 등록하지 않았는가.
     *
     * <p>이 신호를 받은 앱이 등록 화면으로 보내야 정책이 실제로 강제된다. jar 가 여기서
     * 로그인을 막지 않는 이유는 하나다 — 막으면 설정을 바꾼 순간 전원이 잠긴다.</p>
     */
    @Transactional(readOnly = true)
    public boolean setupRequired(Long userId) {
        return requiredFor(userId) && !isActive(userId);
    }

    // ────────────────────── 로그인 중간 단계 ──────────────────────

    /**
     * challenge 발급 — "비밀번호는 맞았다" 는 증표.
     *
     * <p><b>별도 트랜잭션에서 커밋한다.</b> 이 값을 받은 직후 호출자는
     * {@code AUTH_MFA_REQUIRED} 예외를 던지고, 그 예외가 주 트랜잭션을 롤백시키면
     * 방금 저장한 challenge 도 함께 사라져 <b>2단계로 넘어갈 수가 없다</b>
     * (로그인 실패 카운터가 같은 이유로 REQUIRES_NEW 다).</p>
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Challenge issueChallenge(Long userId) {
        Instant now = Instant.now();
        // 앞선 시도의 challenge 는 무효화한다 — 살려 두면 그중 하나만 새어도 통한다
        tokenRepository.invalidateAll(userId, VerificationToken.Purpose.MFA_CHALLENGE, now);

        byte[] bytes = new byte[CHALLENGE_BYTES];
        RANDOM.nextBytes(bytes);
        String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);

        var ttl = properties.getMfa().getChallengeTtl();
        tokenRepository.save(new VerificationToken(userId,
                VerificationToken.Purpose.MFA_CHALLENGE, sha256(raw), now.plus(ttl), null));
        return new Challenge(raw, ttl.toSeconds());
    }

    /**
     * challenge + 코드(또는 백업 코드)를 확인하고 <b>누구인지</b> 돌려준다.
     *
     * <p>토큰 발급은 여기서 하지 않는다 — 세션 발급은 {@code AuthService} 한 곳에 둔다.</p>
     *
     * <p>실패해도 challenge 를 소모하지 않는다. 오타 한 번에 로그인부터 다시 하게 만들면
     * 사용자는 2단계를 끄고 싶어진다. 대신 실패를 계정 잠금 카운터에 올려
     * 무차별 대입은 기존 정책으로 막는다.</p>
     */
    @Transactional
    public Long verifyChallenge(String challenge, String code, String ip, String userAgent) {
        var token = findChallenge(challenge);
        Long userId = token.getUserId();
        var credential = credentialRepository
                .findByUserIdAndType(userId, MfaCredential.TYPE_TOTP)
                .filter(MfaCredential::isActive)
                .orElseThrow(() -> new ApiException(ErrorCode.AUTH_TOKEN_INVALID));

        if (!consumeTotp(credential, code) && !consumeBackupCode(credential, code, ip, userAgent)) {
            loginAttemptService.registerFailure(userId, ip, userAgent);
            auditService.record(AuditService.MFA_FAILED, userId, userId, ip, userAgent,
                    Map.of("phase", "LOGIN"));
            throw new ApiException(ErrorCode.AUTH_MFA_INVALID);
        }

        token.setUsedAt(Instant.now());
        tokenRepository.save(token);
        auditService.record(AuditService.MFA_VERIFIED, userId, userId, ip, userAgent, Map.of());
        return userId;
    }

    // ────────────────────────── 내부 ──────────────────────────

    private VerificationToken findChallenge(String challenge) {
        if (challenge == null || challenge.isBlank()) {
            throw new ApiException(ErrorCode.AUTH_TOKEN_INVALID);
        }
        var token = tokenRepository.findByTokenHash(sha256(challenge))
                .orElseThrow(() -> new ApiException(ErrorCode.AUTH_TOKEN_INVALID));
        if (token.getPurpose() != VerificationToken.Purpose.MFA_CHALLENGE) {
            // 다른 용도의 토큰을 여기로 들이면 메일 링크 하나로 2단계를 넘을 수 있다
            throw new ApiException(ErrorCode.AUTH_TOKEN_INVALID);
        }
        if (!token.isUsable(Instant.now())) {
            throw new ApiException(ErrorCode.AUTH_TOKEN_EXPIRED,
                    "인증 시간이 지났습니다. 다시 로그인하세요.");
        }
        return token;
    }

    /**
     * TOTP 검증 + <b>재사용 차단</b>.
     *
     * <p>같은 스텝의 코드를 두 번 받아 주지 않는다. 재사용인지 아예 틀린 코드인지
     * 구분해 주지 않는 것도 의도다 — 구분하면 "그 코드는 맞았다" 는 정보가 새어나간다.</p>
     */
    private boolean consumeTotp(MfaCredential credential, String code) {
        byte[] secret = Base32.decode(cipher.decrypt(credential.getSecretEnc()));
        long now = TotpGenerator.stepAt(Instant.now());

        var matched = TotpGenerator.verify(secret, code, now, ALLOWED_STEP_DRIFT);
        if (matched.isEmpty()) {
            return false;
        }
        long step = matched.getAsLong();
        if (credential.getLastStep() != null && step <= credential.getLastStep()) {
            return false;
        }
        credential.setLastStep(step);
        credentialRepository.save(credential);
        return true;
    }

    private boolean consumeBackupCode(MfaCredential credential, String code,
                                      String ip, String userAgent) {
        var left = BackupCodes.consume(credential.getBackupCodesHash(), code);
        if (left.isEmpty()) {
            return false;
        }
        credential.setBackupCodesHash(left.get());
        credentialRepository.save(credential);

        int remaining = BackupCodes.remaining(left.get());
        auditService.record(AuditService.MFA_BACKUP_CODE_USED, credential.getUserId(),
                credential.getUserId(), ip, userAgent, Map.of("remaining", remaining));
        if (remaining == 0) {
            log.warn("백업 코드를 모두 썼다 — user={} 재등록이 필요하다", credential.getUserId());
        }
        return true;
    }

    /** 설정에 따라 이 사용자에게 2단계가 필수인가 */
    private boolean requiredFor(Long userId) {
        return switch (properties.getMfa().getMode()) {
            case OPTIONAL -> false;
            case REQUIRED_ALL -> true;
            // 관리 API 를 열 수 있는 사람 = 계정을 만들고 권한을 바꿀 수 있는 사람이다
            case REQUIRED_ADMIN -> authzService.effectivePermissions(userId).stream()
                    .anyMatch(codes -> codes.startsWith(IXAUTH_PERMISSION_PREFIX));
        };
    }

    /** 인증 앱 목록에 표시될 이름. 비어 있으면 메일 제품명을 쓴다 */
    private String issuerName() {
        String configured = properties.getMfa().getIssuer();
        if (configured != null && !configured.isBlank()) {
            return configured.trim();
        }
        return properties.getMail().getProductName();
    }

    private String sha256(String value) {
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new ApiException(ErrorCode.INTERNAL, "토큰 처리에 실패했습니다.");
        }
    }

    // ────────────────────── step-up 재인증 (2026-08-08 추가) ──────────────────────

    /**
     * challenge 없이 코드만 확인한다 — 민감 작업 앞의 재인증({@code mfa.step-up-actions}).
     *
     * <p>{@link #verifyChallenge} 와 나눈 이유: 그쪽은 <b>로그인 중간 상태</b>를 소비하는
     * 흐름이라 challenge 토큰이 있어야 하지만, 여기는 이미 access token 으로 인증된
     * 사용자가 "지금 이 순간에도 본인인가" 를 증명하는 자리다. challenge 를 끼워 넣으면
     * 민감 작업마다 왕복이 한 번씩 늘 뿐 얻는 것이 없다.</p>
     *
     * <p><b>재사용 차단은 그대로 적용된다.</b> 같은 스텝의 코드는 두 번 통하지 않고,
     * 백업 코드는 쓰면 사라진다 — 로그인 경로와 같은 {@code consumeTotp} 를 지나기
     * 때문이지, 여기서 따로 구현하지 않았다. 두 벌로 갈라지면 그중 하나만 고치는
     * 실수가 나고 그게 곧 구멍이 된다.</p>
     *
     * <p>실패는 계정 잠금 카운터에 올린다. 이 경로는 로그인처럼 속도 제한이 좁게
     * 걸려 있지 않으므로, 그 장치가 없으면 6자리를 마음껏 시도할 수 있다.</p>
     *
     * @return 2단계가 켜져 있지 않으면 {@code false} — 요구할 코드 자체가 없다는 뜻이다
     * @throws ApiException 코드가 틀리면 {@code AUTH_MFA_INVALID}
     */
    @Transactional
    public boolean verifyStepUpCode(Long userId, String code, String ip, String userAgent) {
        var credential = credentialRepository.findByUserIdAndType(userId, MfaCredential.TYPE_TOTP)
                .filter(MfaCredential::isActive)
                .orElse(null);
        if (credential == null) {
            return false;
        }
        if (!consumeTotp(credential, code) && !consumeBackupCode(credential, code, ip, userAgent)) {
            loginAttemptService.registerFailure(userId, ip, userAgent);
            auditService.record(AuditService.MFA_FAILED, userId, userId, ip, userAgent,
                    Map.of("phase", "STEP_UP"));
            throw new ApiException(ErrorCode.AUTH_MFA_INVALID);
        }
        auditService.record(AuditService.MFA_VERIFIED, userId, userId, ip, userAgent,
                Map.of("phase", "STEP_UP"));
        return true;
    }
}
