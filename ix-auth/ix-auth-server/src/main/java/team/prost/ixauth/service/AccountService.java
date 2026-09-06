package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.User;
import team.prost.ixauth.domain.UserStatus;
import team.prost.ixauth.domain.VerificationToken;
import team.prost.ixauth.mail.MailService;
import team.prost.ixauth.repository.UserRepository;
import team.prost.ixauth.repository.VerificationTokenRepository;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * 계정 라이프사이클 — 비밀번호 찾기 · 이메일 인증 · 이메일 변경 · 초대 · 가입.
 *
 * <p><b>이 클래스 전체를 관통하는 규칙: 계정이 있는지 없는지 알려 주지 않는다.</b>
 * "가입되지 않은 이메일입니다" 라고 답하는 순간, 그 화면은 가입자 명부를 조회하는
 * 도구가 된다. 그래서 재설정·인증 요청은 무엇을 하든 <b>같은 응답</b>을 준다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AccountService {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int TOKEN_BYTES = 32;

    private final UserRepository userRepository;
    private final VerificationTokenRepository tokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final PasswordPolicyService passwordPolicy;
    private final PasswordHistoryService passwordHistory;
    private final TermsService termsService;
    private final UserAttributeService userAttributeService;
    private final MailService mailService;
    private final AuditService auditService;
    private final SessionRevocationService sessionRevocationService;
    private final IxAuthProperties properties;
    private final team.prost.ixauth.verification.VerificationProviders verificationProviders;

    // ────────────────────── 비밀번호 찾기 ──────────────────────

    /**
     * 재설정 메일을 보낸다. <b>결과와 무관하게 조용히 끝난다.</b>
     *
     * <p>계정이 없어도, 비활성이어도, 쿨다운에 걸려도 호출자에게는 차이가 없다.
     * 차이를 두면 그것이 곧 계정 존재 여부의 신호가 된다.</p>
     */
    @Transactional
    public void requestPasswordReset(String email, String ip, String userAgent) {
        Optional<User> found = userRepository.findByEmailIgnoreCase(normalize(email));
        if (found.isEmpty()) {
            // 존재하지 않는 주소에도 같은 시간이 걸리도록 — 응답 시간 차이도 신호다
            log.debug("재설정 요청 — 대상 없음");
            return;
        }
        User user = found.get();
        if (user.getStatus() == UserStatus.DISABLED) {
            log.debug("재설정 요청 — 비활성 계정 user={}", user.getId());
            return;
        }
        if (onCooldown(user.getId(), VerificationToken.Purpose.PASSWORD_RESET)) {
            log.debug("재설정 요청 — 쿨다운 user={}", user.getId());
            return;
        }

        String raw = issue(user.getId(), VerificationToken.Purpose.PASSWORD_RESET,
                properties.getAccount().getResetTokenTtl(), null);
        mailService.sendPasswordReset(user.getEmail(), user.getName(), raw);
        auditService.record("PASSWORD_RESET_REQUESTED", user.getId(), user.getId(),
                ip, userAgent, Map.of());
    }

    /**
     * 토큰으로 비밀번호를 바꾼다.
     *
     * <p>성공하면 <b>그 계정의 모든 세션을 끊는다.</b> 재설정을 하는 이유는 대개
     * 계정을 빼앗겼기 때문인데, 세션을 남겨 두면 빼앗은 쪽이 그대로 남는다.
     * 잠금도 함께 푼다 — 잠겨서 재설정한 사람이 여전히 못 들어오면 안 된다.</p>
     */
    @Transactional
    public void resetPassword(String rawToken, String newPassword, String ip, String userAgent) {
        // 정책 검사를 토큰 소비보다 먼저 한다. 비밀번호를 약하게 적었다고 링크가
        // 죽으면 메일을 다시 받아야 한다 — 롤백에 기대지 않고 순서로 보장한다
        passwordPolicy.validate(newPassword);

        // 재사용 이력도 같은 이유로 소비 **전**에 본다. 사용자 없이는 판단할 수 없어
        // 토큰을 찾기는 하되, 소비 처리(1회용 표시)는 검사를 통과한 뒤로 미룬다
        var token = findUsable(rawToken, VerificationToken.Purpose.PASSWORD_RESET,
                VerificationToken.Purpose.PASSWORD_RESET);
        User user = userRepository.findById(token.getUserId())
                .orElseThrow(() -> new ApiException(ErrorCode.AUTH_TOKEN_INVALID,
                        "유효하지 않은 토큰입니다."));
        passwordHistory.assertNotReused(user.getId(), newPassword);
        markUsed(token);

        applyNewPassword(user, newPassword);
        // 자동 잠금만 푼다. 관리자가 차단해 둔 계정이 '비밀번호 찾기' 한 번으로
        // 되살아나면 그건 차단이 아니다 (계약: http-api.md §2-1-1)
        user.clearAutomaticLock();
        // 재설정 링크는 메일로 갔다 — 그 메일함을 쓸 수 있다는 것이 곧 주소 확인이다
        if (user.getEmailVerifiedAt() == null) {
            user.setEmailVerifiedAt(Instant.now());
        }
        userRepository.save(user);

        sessionRevocationService.revokeAllForUser(user.getId(), Instant.now());
        mailService.sendPasswordChanged(user.getEmail(), user.getName());
        auditService.record("PASSWORD_RESET", user.getId(), user.getId(), ip, userAgent, Map.of());
    }

    /**
     * 로그인한 사용자가 스스로 바꾼다. 현재 비밀번호를 반드시 확인한다.
     *
     * <p>확인하지 않으면 잠깐 자리를 비운 사이 남이 비밀번호를 바꿔 계정을 가져갈 수 있다.</p>
     */
    @Transactional
    public void changePassword(Long userId, String currentPassword, String newPassword,
                               String ip, String userAgent) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "사용자를 찾을 수 없습니다."));

        if (user.getPasswordHash() == null
                || !passwordEncoder.matches(currentPassword, user.getPasswordHash())) {
            auditService.record("PASSWORD_CHANGE_FAILED", userId, userId, ip, userAgent, Map.of());
            throw new ApiException(ErrorCode.AUTH_INVALID_CREDENTIALS,
                    "현재 비밀번호가 올바르지 않습니다.");
        }
        if (passwordEncoder.matches(newPassword, user.getPasswordHash())) {
            // 이력 기능이 꺼져 있어도(기본값) 직전 것은 늘 막는다 — 현재 해시와의
            // 비교라 아무것도 따로 보관하지 않는다
            throw new ApiException(ErrorCode.AUTH_PASSWORD_REUSED,
                    "이전과 다른 비밀번호를 사용하세요.");
        }
        passwordPolicy.validate(newPassword);
        passwordHistory.assertNotReused(userId, newPassword);

        applyNewPassword(user, newPassword);
        userRepository.save(user);

        if (properties.getAccount().isRevokeSessionsOnPasswordChange()) {
            // 지금 이 요청의 세션까지 끊는다. 앱은 재로그인을 요구하면 된다 —
            // "다른 기기만 끊기" 는 어느 세션이 '나' 인지 확실할 때만 안전하다
            sessionRevocationService.revokeAllForUser(userId, Instant.now());
        }
        mailService.sendPasswordChanged(user.getEmail(), user.getName());
        auditService.record("PASSWORD_CHANGED", userId, userId, ip, userAgent, Map.of());
    }

    // ────────────────────── 이메일 인증 ──────────────────────

    /** 인증 메일 재발송. 재설정과 같은 이유로 결과를 알려 주지 않는다. */
    @Transactional
    public void requestEmailVerification(String email, String ip, String userAgent) {
        Optional<User> found = userRepository.findByEmailIgnoreCase(normalize(email));
        if (found.isEmpty()) {
            return;
        }
        User user = found.get();
        if (user.getEmailVerifiedAt() != null || user.getStatus() == UserStatus.DISABLED
                || onCooldown(user.getId(), VerificationToken.Purpose.EMAIL_VERIFY)) {
            return;
        }
        String raw = issue(user.getId(), VerificationToken.Purpose.EMAIL_VERIFY,
                properties.getAccount().getVerifyTokenTtl(), null);
        mailService.sendEmailVerification(user.getEmail(), user.getName(), raw);
        auditService.record("EMAIL_VERIFICATION_REQUESTED", user.getId(), user.getId(),
                ip, userAgent, Map.of());
    }

    /**
     * 인증 토큰을 확인한다. EMAIL_VERIFY 와 EMAIL_CHANGE 를 함께 받는다 —
     * 사용자에게는 둘 다 "메일의 링크를 눌렀다" 는 같은 행동이다.
     */
    @Transactional
    public void verifyEmail(String rawToken, String ip, String userAgent) {
        var token = consumeEither(rawToken,
                VerificationToken.Purpose.EMAIL_VERIFY, VerificationToken.Purpose.EMAIL_CHANGE);
        User user = userRepository.findById(token.getUserId())
                .orElseThrow(() -> new ApiException(ErrorCode.AUTH_TOKEN_INVALID,
                        "유효하지 않은 토큰입니다."));

        if (token.getPurpose() == VerificationToken.Purpose.EMAIL_CHANGE) {
            String newEmail = normalize(token.getPayload());
            // 발급 후 확인 전에 남이 그 주소로 가입했을 수 있다
            if (userRepository.existsByEmailIgnoreCaseAndIdNot(newEmail, user.getId())) {
                throw new ApiException(ErrorCode.CONFLICT, "이미 사용 중인 이메일입니다.");
            }
            String previous = user.getEmail();
            user.setEmail(newEmail);
            auditService.record("EMAIL_CHANGED", user.getId(), user.getId(), ip, userAgent,
                    Map.of("from", mask(previous), "to", mask(newEmail)));
        }

        user.setEmailVerifiedAt(Instant.now());
        userRepository.save(user);
        auditService.record("EMAIL_VERIFIED", user.getId(), user.getId(), ip, userAgent, Map.of());
    }

    /**
     * 이메일 변경 요청 — 확인 메일은 <b>새 주소</b>로 간다.
     *
     * <p>비밀번호를 함께 확인한다. 자리를 비운 사이 주소만 바꿔치기하면
     * 그 다음 "비밀번호 찾기" 한 번으로 계정을 통째로 가져갈 수 있다.</p>
     */
    @Transactional
    public void requestEmailChange(Long userId, String newEmail, String currentPassword,
                                   String ip, String userAgent) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "사용자를 찾을 수 없습니다."));

        if (user.getPasswordHash() == null
                || !passwordEncoder.matches(currentPassword, user.getPasswordHash())) {
            throw new ApiException(ErrorCode.AUTH_INVALID_CREDENTIALS,
                    "현재 비밀번호가 올바르지 않습니다.");
        }
        String target = normalize(newEmail);
        if (target.equals(normalize(user.getEmail()))) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "현재 주소와 동일합니다.");
        }
        // 여기서는 알려 준다 — 로그인한 본인이 자기 주소를 바꾸는 중이고,
        // 확인 없이 진행하면 확인 메일만 보내고 영영 바뀌지 않는다
        if (userRepository.existsByEmailIgnoreCaseAndIdNot(target, userId)) {
            throw new ApiException(ErrorCode.CONFLICT, "이미 사용 중인 이메일입니다.");
        }

        String raw = issue(userId, VerificationToken.Purpose.EMAIL_CHANGE,
                properties.getAccount().getVerifyTokenTtl(), target);
        mailService.sendEmailChange(target, user.getName(), raw);
        auditService.record("EMAIL_CHANGE_REQUESTED", userId, userId, ip, userAgent,
                Map.of("to", mask(target)));
    }

    // ────────────────────── 초대 ──────────────────────

    /** 관리자가 만든 계정에 초대 메일을 보낸다. 수락 전까지 PENDING 이다. */
    @Transactional
    public void sendInvite(Long userId, String inviterName, Long actorId,
                           String ip, String userAgent) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "사용자를 찾을 수 없습니다."));

        String raw = issue(userId, VerificationToken.Purpose.INVITE,
                properties.getAccount().getInviteTokenTtl(), null);
        mailService.sendInvite(user.getEmail(), user.getName(), inviterName, raw);
        auditService.record("INVITE_SENT", userId, actorId, ip, userAgent, Map.of());
    }

    /** 초대 수락 — 비밀번호를 정하면 ACTIVE 가 된다. */
    @Transactional
    public void acceptInvite(String rawToken, String password, String name,
                             String ip, String userAgent) {
        // 재설정과 같은 이유로 정책 검사가 먼저다 — 초대 링크는 다시 받기가 더 번거롭다
        passwordPolicy.validate(password);

        var token = consume(rawToken, VerificationToken.Purpose.INVITE);
        User user = userRepository.findById(token.getUserId())
                .orElseThrow(() -> new ApiException(ErrorCode.AUTH_TOKEN_INVALID,
                        "유효하지 않은 토큰입니다."));

        applyNewPassword(user, password);
        if (name != null && !name.isBlank()) {
            user.setName(name.trim());
        }
        user.setStatus(UserStatus.ACTIVE);
        // 초대 메일을 받아 눌렀다는 것 자체가 주소 확인이다
        user.setEmailVerifiedAt(Instant.now());
        userRepository.save(user);

        auditService.record("INVITE_ACCEPTED", user.getId(), user.getId(), ip, userAgent, Map.of());
    }

    // ────────────────────── 자체 가입 ──────────────────────

    /**
     * 가입 요청 한 건.
     *
     * <p>인자를 늘리는 대신 record 로 묶었다 — 가입이 받는 것이 늘어날 때마다
     * 호출부 전부를 고치게 되고, 인자가 여섯을 넘으면 순서를 틀린 것을 컴파일러가
     * 잡아 주지 못한다.</p>
     *
     * @param attributes 사용자 속성. 정의({@code user_attribute_defs})가 있으면 검증된다
     * @param agreements 약관 코드 → 동의 여부. 버전은 <b>서버가 정한다</b> —
     *                   클라이언트가 보낸 버전을 믿으면 옛 버전에 동의한 것으로 기록해
     *                   재동의를 회피할 수 있다
     */
    public record SignupCommand(String email, String password, String name,
                                Map<String, Object> attributes,
                                Map<String, Boolean> agreements) {
    }

    /**
     * 자체 가입. 기본은 꺼져 있다 — 설치형 제품에서 열어 두면 사내용 인스턴스에
     * 외부인이 계정을 만들 수 있다.
     *
     * <p>검사 순서에 뜻이 있다. <b>계정을 만들기 전에</b> 정책·속성·필수 약관을 모두
     * 본다 — 만든 뒤에 막으면 동의하지 않은 계정이 남고, 같은 주소로 다시 가입할
     * 수도 없게 된다.</p>
     */
    @Transactional
    public Long signup(SignupCommand cmd, String ip, String userAgent) {
        var account = properties.getAccount();
        if (account.getSignupMode() == IxAuthProperties.SignupMode.CLOSED) {
            throw new ApiException(ErrorCode.AUTHZ_FORBIDDEN, "가입이 허용되지 않습니다.");
        }
        String target = normalize(cmd.email());
        if (!domainAllowed(target)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "허용되지 않은 이메일 도메인입니다.");
        }
        passwordPolicy.validate(cmd.password());
        var attributes = userAttributeService.validate(cmd.attributes());
        termsService.assertRequiredAgreed(cmd.agreements());

        if (userRepository.existsByEmailIgnoreCase(target)) {
            notifyExistingAccount(target, account);
            return null;
        }

        var user = createSignupUser(target, cmd, attributes, account);
        termsService.agree(user.getId(), cmd.agreements(), ip, userAgent);
        startSignupVerification(user, account);

        auditService.record("SIGNUP", user.getId(), user.getId(), ip, userAgent,
                Map.of("mode", account.getSignupMode().name(),
                        "verification", account.getSignupVerification().name()));
        return user.getId();
    }

    /**
     * 이미 있는 주소로 가입을 시도했다.
     *
     * <p>응답은 성공과 <b>똑같이</b> 준다 — 다르게 답하면 그 화면이 가입자 명부를
     * 조회하는 도구가 된다. 사실은 그 주소의 주인에게만 메일로 알린다.</p>
     */
    private void notifyExistingAccount(String target, IxAuthProperties.Account account) {
        userRepository.findByEmailIgnoreCase(target).ifPresent(existing -> {
            if (existing.getStatus() == UserStatus.DISABLED
                    || onCooldown(existing.getId(), VerificationToken.Purpose.PASSWORD_RESET)) {
                return;
            }
            String raw = issue(existing.getId(), VerificationToken.Purpose.PASSWORD_RESET,
                    account.getResetTokenTtl(), null);
            mailService.sendAccountExists(existing.getEmail(), existing.getName(), raw);
        });
    }

    private User createSignupUser(String target, SignupCommand cmd,
                                  Map<String, Object> attributes,
                                  IxAuthProperties.Account account) {
        var user = new User();
        user.setEmail(target);
        user.setName(cmd.name() == null || cmd.name().isBlank()
                ? target.split("@")[0] : cmd.name().trim());
        user.setPasswordHash(passwordEncoder.encode(cmd.password()));
        if (attributes != null) {
            user.setAttributes(new java.util.HashMap<>(attributes));
        }
        // 승인제면 관리자가 승인할 때까지 로그인할 수 없다
        user.setStatus(account.getSignupMode() == IxAuthProperties.SignupMode.APPROVAL
                ? UserStatus.PENDING_APPROVAL : UserStatus.ACTIVE);
        userRepository.save(user);
        // 첫 비밀번호도 이력에 남긴다 — 남기지 않으면 첫 변경에서 가입 때 쓰던 것을
        // 그대로 다시 쓸 수 있다 (이력 기능이 꺼져 있으면 아무 일도 하지 않는다)
        passwordHistory.record(user.getId(), user.getPasswordHash());
        return user;
    }

    /** 본인확인 수단은 설정으로 고른다 (.claude/rules/settings-driven.md) */
    private void startSignupVerification(User user, IxAuthProperties.Account account) {
        switch (account.getSignupVerification()) {
            case EMAIL -> {
                String raw = issue(user.getId(), VerificationToken.Purpose.EMAIL_VERIFY,
                        account.getVerifyTokenTtl(), null);
                mailService.sendEmailVerification(user.getEmail(), user.getName(), raw);
            }
            case PASS -> {
                // 연동이 없으면 여기서 막는다. 확인하지 않은 것을 확인한 척하면 안 된다
                verificationProviders.require(
                        IxAuthProperties.SignupVerification.PASS).begin(user.getId());
            }
            case NONE -> {
                // 신원이 이미 보장된 폐쇄망 등. 확인 절차 없이 주소를 인정한다
                user.setEmailVerifiedAt(Instant.now());
                userRepository.save(user);
            }
            default -> throw new IllegalStateException(
                    "처리하지 않은 본인확인 수단: " + account.getSignupVerification());
        }
    }

    // ────────────────────── 가입 승인 (signup-mode=APPROVAL) ──────────────────────

    /** 승인 대기 목록 — 관리자가 처리해야 할 것 */
    @Transactional(readOnly = true)
    public java.util.List<User> pendingApprovals() {
        return userRepository.findByStatusOrderByCreatedAtAsc(UserStatus.PENDING_APPROVAL);
    }

    /** 승인 — 이제 로그인할 수 있다 */
    @Transactional
    public void approveSignup(Long userId, Long actorId, String ip, String userAgent) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "사용자를 찾을 수 없습니다."));
        if (user.getStatus() != UserStatus.PENDING_APPROVAL) {
            throw new ApiException(ErrorCode.CONFLICT, "승인 대기 상태가 아닙니다.");
        }
        user.setStatus(UserStatus.ACTIVE);
        userRepository.save(user);

        mailService.sendSignupApproved(user.getEmail(), user.getName());
        auditService.record("SIGNUP_APPROVED", userId, actorId, ip, userAgent, Map.of());
    }

    /**
     * 거절 — 계정을 지우지 않고 비활성으로 둔다.
     *
     * <p>지우면 같은 주소로 다시 가입할 수 있어 반복 시도를 막을 수 없고,
     * 거절 이력도 남지 않는다.</p>
     */
    @Transactional
    public void rejectSignup(Long userId, String reason, Long actorId,
                             String ip, String userAgent) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "사용자를 찾을 수 없습니다."));
        if (user.getStatus() != UserStatus.PENDING_APPROVAL) {
            throw new ApiException(ErrorCode.CONFLICT, "승인 대기 상태가 아닙니다.");
        }
        user.setStatus(UserStatus.DISABLED);
        userRepository.save(user);

        auditService.record("SIGNUP_REJECTED", userId, actorId, ip, userAgent,
                reason == null || reason.isBlank() ? Map.of() : Map.of("reason", reason));
    }

    // ────────────────────── 토큰 ──────────────────────

    /**
     * 새 토큰을 만들고 <b>같은 용도의 옛 토큰을 모두 무효화</b>한다.
     *
     * <p>옛 링크를 살려 두면 가장 오래된 메일 하나만 유출돼도 계정을 빼앗긴다 —
     * 사용자는 최신 메일만 신경 쓰기 때문이다.</p>
     *
     * @return 메일로 나갈 <b>평문</b> 토큰. DB 에는 해시만 남는다
     */
    private String issue(Long userId, VerificationToken.Purpose purpose,
                         java.time.Duration ttl, String payload) {
        tokenRepository.invalidateAll(userId, purpose, Instant.now());

        byte[] bytes = new byte[TOKEN_BYTES];
        RANDOM.nextBytes(bytes);
        String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);

        tokenRepository.save(new VerificationToken(
                userId, purpose, sha256(raw), Instant.now().plus(ttl), payload));
        return raw;
    }

    private VerificationToken consume(String rawToken, VerificationToken.Purpose purpose) {
        return consumeEither(rawToken, purpose, purpose);
    }

    /** 토큰을 검증하고 즉시 사용 처리한다 — 1회용이 여기서 성립한다. */
    private VerificationToken consumeEither(String rawToken, VerificationToken.Purpose a,
                                            VerificationToken.Purpose b) {
        var token = findUsable(rawToken, a, b);
        markUsed(token);
        return token;
    }

    /**
     * 토큰을 찾아 검증만 한다 — <b>아직 소모하지 않는다.</b>
     *
     * <p>{@link #consumeEither} 에서 이 단계를 떼어낸 이유는 하나다. 비밀번호 재설정은
     * 토큰의 주인을 알아야 할 수 있는 검사(재사용 이력)가 있는데, 그 검사에 걸렸다고
     * 링크까지 죽으면 메일을 처음부터 다시 받아야 한다. 정책 검사가 토큰 소비보다
     * 먼저라는 계약(http-api.md §2-1)을 이력 검사까지 넓힌 것이다.</p>
     */
    private VerificationToken findUsable(String rawToken, VerificationToken.Purpose a,
                                         VerificationToken.Purpose b) {
        if (rawToken == null || rawToken.isBlank()) {
            throw new ApiException(ErrorCode.AUTH_TOKEN_INVALID, "유효하지 않은 토큰입니다.");
        }
        var token = tokenRepository.findByTokenHash(sha256(rawToken))
                .orElseThrow(() -> new ApiException(ErrorCode.AUTH_TOKEN_INVALID,
                        "유효하지 않은 토큰입니다."));

        // 만료·재사용·용도 불일치를 하나의 메시지로 묶는다. 구분해 주면 유효한
        // 토큰을 찾는 쪽에 힌트가 된다
        if (token.getPurpose() != a && token.getPurpose() != b) {
            throw new ApiException(ErrorCode.AUTH_TOKEN_INVALID, "유효하지 않은 토큰입니다.");
        }
        if (!token.isUsable(Instant.now())) {
            throw new ApiException(ErrorCode.AUTH_TOKEN_EXPIRED, "만료되었거나 이미 사용된 링크입니다.");
        }
        return token;
    }

    private void markUsed(VerificationToken token) {
        token.setUsedAt(Instant.now());
        tokenRepository.save(token);
    }

    private boolean onCooldown(Long userId, VerificationToken.Purpose purpose) {
        var cooldown = properties.getAccount().getResendCooldown();
        return tokenRepository.lastIssuedAt(userId, purpose)
                .map(last -> last.plus(cooldown).isAfter(Instant.now()))
                .orElse(false);
    }

    /**
     * 새 비밀번호를 적용하고 <b>이력에 남긴다.</b>
     *
     * <p>비밀번호가 바뀌는 모든 자체 경로(재설정·변경·초대 수락)가 여기를 지난다.
     * 남기는 곳을 한 군데로 모아 두지 않으면 어느 한 경로만 이력에서 빠지고, 그
     * 경로로 바꾸면 재사용 검사를 우회할 수 있게 된다.</p>
     */
    private void applyNewPassword(User user, String raw) {
        user.setPasswordHash(passwordEncoder.encode(raw));
        user.setUpdatedAt(Instant.now());
        passwordHistory.record(user.getId(), user.getPasswordHash());
    }

    private boolean domainAllowed(String email) {
        var allowed = properties.getAccount().getSignupAllowedDomains();
        if (allowed == null || allowed.isEmpty()) {
            return true;
        }
        int at = email.lastIndexOf('@');
        String domain = at < 0 ? "" : email.substring(at + 1);
        return allowed.stream().anyMatch(d -> d.equalsIgnoreCase(domain));
    }

    private static String normalize(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    private String sha256(String value) {
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new ApiException(ErrorCode.INTERNAL, "토큰 처리에 실패했습니다.");
        }
    }

    /** 감사 로그용 마스킹 — 주소 원문을 남기지 않는다 */
    private static String mask(String email) {
        if (email == null || email.length() < 3) {
            return "***";
        }
        int at = email.indexOf('@');
        if (at <= 1) {
            return "***" + (at < 0 ? "" : email.substring(at));
        }
        return email.charAt(0) + "***" + email.substring(at);
    }
}
