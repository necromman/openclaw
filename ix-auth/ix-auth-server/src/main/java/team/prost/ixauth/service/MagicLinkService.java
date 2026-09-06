package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
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

/**
 * 매직 링크 로그인 — 비밀번호 없이 메일의 링크로 들어온다.
 *
 * <h2>이 기능이 바꾸는 것</h2>
 *
 * <p><b>메일함이 곧 로그인 수단이 된다.</b> 비밀번호를 아무리 길게 걸어 두어도, 켜는
 * 순간 그 계정의 실질 보안 수준은 메일함의 보안 수준을 넘지 못한다. 사내 메일이 이미
 * SSO 뒤에 있는 곳에서는 합리적이지만 그 판단은 운영자 몫이라, 기능 전체가
 * 스위치({@code account.magic-link-enabled}, 기본 꺼짐)다.</p>
 *
 * <h2>세 가지를 지킨다</h2>
 *
 * <ol>
 *   <li><b>계정 존재를 알려 주지 않는다</b> — 요청은 무엇을 하든 같은 응답이다.
 *       "가입되지 않은 주소입니다" 를 주는 순간 이 화면이 가입자 명부 조회 도구가 된다</li>
 *   <li><b>수명이 짧다</b>(기본 10분) — 링크 자체가 로그인이라 유출되면 흔적 없이 들어온다.
 *       재설정 링크보다 짧게 잡는 이유가 이것이다</li>
 *   <li><b>2단계를 우회하지 않는다</b> — 2단계가 켜진 계정은 여기서도 challenge 를 받는다.
 *       그러지 않으면 메일 한 통으로 2단계가 통째로 무력화된다</li>
 * </ol>
 *
 * <p>토큰 발급·소비 규칙은 {@code AccountService} 와 같다(해시 저장·1회용·같은 용도의
 * 옛 토큰 무효화). 별도 표를 두지 않고 {@code verification_tokens} 를 쓰는 것도 같은
 * 이유다 — 만료·1회용·정리 규칙이 두 벌로 갈라지면 그중 하나만 고치는 실수가 난다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MagicLinkService {

    private static final SecureRandom RANDOM = new SecureRandom();
    /** 재설정 토큰과 같은 32바이트. 이 값은 곧 세션이므로 줄일 이유가 없다 */
    private static final int TOKEN_BYTES = 32;

    private final UserRepository userRepository;
    private final VerificationTokenRepository tokenRepository;
    private final MailService mailService;
    private final AuditService auditService;
    private final MfaService mfaService;
    private final AuthService authService;
    private final IxAuthProperties properties;

    // ────────────────────── 1) 요청 ──────────────────────

    /**
     * 로그인 링크를 보낸다. <b>결과와 무관하게 조용히 끝난다.</b>
     *
     * <p>계정이 없어도, 비활성이어도, 쿨다운에 걸려도 호출자에게는 차이가 없다 —
     * 차이를 두면 그것이 곧 계정 존재 여부의 신호다 ({@code AccountService} 와 같은 규칙).</p>
     *
     * <p>기능이 꺼져 있으면 여기서 403 이다. 이건 계정과 무관한 <b>전역 스위치</b>라
     * 알려 줘도 새는 것이 없고, 앱은 그 코드를 보고 "메일로 로그인" 버튼을 감춘다.</p>
     */
    @Transactional
    public void request(String email, String ip, String userAgent) {
        assertEnabled();

        var found = userRepository.findByEmailIgnoreCase(normalize(email));
        if (found.isEmpty()) {
            log.debug("매직 링크 요청 — 대상 없음");
            return;
        }
        User user = found.get();
        if (!canLogin(user)) {
            log.debug("매직 링크 요청 — 로그인할 수 없는 상태 user={} status={}",
                    user.getId(), user.getStatus());
            return;
        }
        if (onCooldown(user.getId())) {
            log.debug("매직 링크 요청 — 쿨다운 user={}", user.getId());
            return;
        }

        String raw = issue(user.getId());
        mailService.sendMagicLink(user.getEmail(), user.getName(), raw);
        auditService.record("MAGIC_LINK_REQUESTED", user.getId(), user.getId(),
                ip, userAgent, Map.of());
    }

    // ────────────────────── 2) 확인 ──────────────────────

    /**
     * 링크의 토큰으로 로그인을 마친다.
     *
     * <p><b>2단계가 켜진 계정은 여기서 토큰을 받지 못한다.</b> 대신 로그인 1단계와
     * 똑같이 {@code AUTH_MFA_REQUIRED} + challenge 를 받고 {@code /auth/mfa/verify} 로
     * 이어진다 — 앱 입장에서는 비밀번호 로그인과 같은 흐름이라 화면을 새로 만들 필요가 없다.</p>
     *
     * <p>메일을 받아 눌렀다는 것 자체가 주소 확인이므로, 미인증 계정은 이 시점에
     * 인증된 것으로 표시한다 (초대 수락·비밀번호 재설정과 같은 판단).</p>
     */
    @Transactional
    public AuthService.LoginResult verify(String rawToken, String ip, String userAgent) {
        assertEnabled();

        var token = consume(rawToken);
        User user = userRepository.findById(token.getUserId())
                .orElseThrow(() -> new ApiException(ErrorCode.AUTH_TOKEN_INVALID,
                        "유효하지 않은 링크입니다."));

        // 발급 후 이 사이에 상태가 바뀌었을 수 있다. 짧아도 창은 창이다
        assertLoginAllowed(user);

        if (user.getEmailVerifiedAt() == null) {
            user.setEmailVerifiedAt(Instant.now());
            userRepository.save(user);
        }

        if (mfaService.isActive(user.getId())) {
            throw mfaRequired(user, ip, userAgent);
        }

        auditService.record("MAGIC_LINK_CONSUMED", user.getId(), user.getId(),
                ip, userAgent, Map.of());
        return authService.issueFor(user, userAgent, ip, "magic-link");
    }

    /**
     * 2단계로 넘긴다 — 로그인 1단계가 하는 것과 같다.
     *
     * <p>challenge 는 {@code MfaService} 가 <b>별도 트랜잭션</b>에서 저장한다. 아래 예외가
     * 이 트랜잭션을 롤백시켜도 남아 있어야 앱이 다음 단계를 부를 수 있다.</p>
     *
     * <p>토큰은 이미 소비됐다. 2단계에서 실패해도 같은 링크를 다시 쓸 수 없다는 뜻인데,
     * 그게 맞다 — 링크는 "메일함을 쥐고 있다" 는 증명이고 그 증명은 한 번이면 족하다.
     * 코드를 틀린 사람은 challenge 로 다시 시도하면 된다(challenge 는 소모되지 않는다).</p>
     */
    private ApiException mfaRequired(User user, String ip, String userAgent) {
        var challenge = mfaService.issueChallenge(user.getId());
        auditService.record("MAGIC_LINK_MFA_CHALLENGED", user.getId(), user.getId(),
                ip, userAgent, Map.of());
        return new ApiException(ErrorCode.AUTH_MFA_REQUIRED,
                ErrorCode.AUTH_MFA_REQUIRED.getDefaultMessage(), null,
                Map.of("challenge", challenge.token(), "expiresIn", challenge.expiresIn()));
    }

    // ────────────────────── 상태 판정 ──────────────────────

    private void assertEnabled() {
        if (!properties.getAccount().isMagicLinkEnabled()) {
            throw new ApiException(ErrorCode.AUTHZ_FORBIDDEN,
                    "메일 링크 로그인이 허용되지 않습니다.");
        }
    }

    /** 요청 단계 — 조용히 끝내야 하므로 예외가 아니라 판단만 한다 */
    private boolean canLogin(User user) {
        return user.getStatus() == UserStatus.ACTIVE || user.getStatus() == UserStatus.LOCKED;
    }

    /**
     * 확인 단계의 상태 검사.
     *
     * <p>여기서 던지는 코드는 <b>계정이 있다는 것을 인정하는</b> 응답이다. 그래도 되는
     * 이유는 이 시점에 이미 그 계정의 메일함을 열었다는 증명이 끝났기 때문이다 —
     * 비밀번호를 통과한 뒤에만 잠금·비활성을 알려 주는 것과 같은 경계다.</p>
     *
     * <p><b>자동으로 잠긴 계정은 통과시킨다.</b> 자동 잠금은 비밀번호 무차별 대입을 막는
     * 장치인데, 이 경로는 비밀번호를 쓰지 않는다. 여기서 막으면 비밀번호를 잊어 잠긴
     * 사람이 메일로도 못 들어오게 된다.</p>
     *
     * <p><b>관리자가 건 잠금은 막는다.</b> 저쪽은 "이 사람을 지금 들이지 않겠다" 는
     * 결정이라 경로를 가리지 않는다 — 열어 두면 차단이 메일 한 통으로 우회된다
     * (계약: http-api.md §2-1-1).</p>
     */
    private void assertLoginAllowed(User user) {
        if (user.getStatus() == UserStatus.DISABLED) {
            throw new ApiException(ErrorCode.AUTH_ACCOUNT_DISABLED);
        }
        if (user.isAdminLocked()) {
            throw new ApiException(ErrorCode.AUTH_ACCOUNT_LOCKED,
                    "관리자가 잠근 계정입니다. 관리자에게 문의하세요.");
        }
        if (user.getStatus() == UserStatus.PENDING_APPROVAL) {
            throw new ApiException(ErrorCode.AUTH_ACCOUNT_PENDING_APPROVAL);
        }
        if (user.getStatus() == UserStatus.PENDING) {
            // 초대를 받아 놓고 수락하지 않은 상태. 초대 링크로 비밀번호를 정하는 것이 먼저다
            throw new ApiException(ErrorCode.AUTH_ACCOUNT_PENDING);
        }
    }

    // ────────────────────── 토큰 ──────────────────────

    /**
     * 새 링크를 만들고 <b>앞선 링크를 모두 무효화</b>한다.
     *
     * <p>살려 두면 메일함에 쌓인 옛 링크 하나만 새어도 계정을 빼앗긴다 — 사용자는
     * 최신 메일만 신경 쓰기 때문이다. 다른 용도의 토큰과 같은 규칙이다.</p>
     */
    private String issue(Long userId) {
        Instant now = Instant.now();
        tokenRepository.invalidateAll(userId, VerificationToken.Purpose.MAGIC_LINK, now);

        byte[] bytes = new byte[TOKEN_BYTES];
        RANDOM.nextBytes(bytes);
        String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);

        var ttl = properties.getAccount().getMagicLinkTokenTtl();
        tokenRepository.save(new VerificationToken(userId,
                VerificationToken.Purpose.MAGIC_LINK, sha256(raw), now.plus(ttl), null));
        return raw;
    }

    /** 검증하고 즉시 사용 처리한다 — 1회용이 여기서 성립한다 */
    private VerificationToken consume(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            throw new ApiException(ErrorCode.AUTH_TOKEN_INVALID, "유효하지 않은 링크입니다.");
        }
        var token = tokenRepository.findByTokenHash(sha256(rawToken))
                .orElseThrow(() -> new ApiException(ErrorCode.AUTH_TOKEN_INVALID,
                        "유효하지 않은 링크입니다."));

        // 용도가 다르면 여기서 막는다. 이 검사가 없으면 재설정·초대 메일의 토큰으로
        // 곧바로 로그인할 수 있게 되어, 가장 수명이 긴 링크가 로그인 수단이 된다
        if (token.getPurpose() != VerificationToken.Purpose.MAGIC_LINK) {
            throw new ApiException(ErrorCode.AUTH_TOKEN_INVALID, "유효하지 않은 링크입니다.");
        }
        if (!token.isUsable(Instant.now())) {
            throw new ApiException(ErrorCode.AUTH_TOKEN_EXPIRED,
                    "만료되었거나 이미 사용된 링크입니다.");
        }

        token.setUsedAt(Instant.now());
        tokenRepository.save(token);
        return token;
    }

    private boolean onCooldown(Long userId) {
        var cooldown = properties.getAccount().getResendCooldown();
        return tokenRepository.lastIssuedAt(userId, VerificationToken.Purpose.MAGIC_LINK)
                .map(last -> last.plus(cooldown).isAfter(Instant.now()))
                .orElse(false);
    }

    private static String normalize(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    private static String sha256(String value) {
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new ApiException(ErrorCode.INTERNAL, "토큰 처리에 실패했습니다.");
        }
    }
}
