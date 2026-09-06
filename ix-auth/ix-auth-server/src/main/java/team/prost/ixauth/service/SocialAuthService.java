package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.Identity;
import team.prost.ixauth.domain.OAuthState;
import team.prost.ixauth.domain.User;
import team.prost.ixauth.domain.UserStatus;
import team.prost.ixauth.repository.IdentityRepository;
import team.prost.ixauth.repository.OAuthStateRepository;
import team.prost.ixauth.repository.UserRepository;
import team.prost.ixauth.social.SocialProfile;
import team.prost.ixauth.social.SocialProvider;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 소셜 로그인.
 *
 * <p><b>콜백은 앱이 받는다.</b> IX-Auth 는 외부에 노출되지 않으므로(설계 불변식 4)
 * provider 가 브라우저를 IX-Auth 로 돌려보낼 수 없다. 흐름은 이렇다:</p>
 *
 * <ol>
 *   <li>앱이 {@code authorize-url} 을 받아 사용자를 provider 로 보낸다</li>
 *   <li>사용자가 동의하면 provider 가 <b>앱의</b> 콜백 주소로 돌려보낸다</li>
 *   <li>앱이 {@code code} 를 IX-Auth 로 중계한다</li>
 *   <li>IX-Auth 가 토큰 교환·프로필 조회·계정 매칭·세션 발급을 한다</li>
 * </ol>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SocialAuthService {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final SocialProviderRegistry registry;
    private final OAuthStateRepository stateRepository;
    private final IdentityRepository identityRepository;
    private final UserRepository userRepository;
    private final AuthService authService;
    private final AuditService auditService;
    private final IxAuthProperties properties;

    /** 앱에 돌려줄 값 — 사용자를 이 주소로 보내면 된다 */
    public record AuthorizeUrl(String url, String state) {
    }

    // ────────────────────── 1) 시작 ──────────────────────

    @Transactional
    public AuthorizeUrl authorizeUrl(String providerName, String redirectUri) {
        SocialProvider provider = registry.require(providerName);

        String state = random(32);
        String codeVerifier = provider.usesPkce() ? random(64) : null;
        String challenge = codeVerifier == null ? null : s256Base64Url(codeVerifier);

        // 평문 state 는 브라우저로만 나간다. DB 에는 해시만 둔다
        stateRepository.save(new OAuthState(sha256(state), provider.kind(), redirectUri,
                codeVerifier, Instant.now().plus(properties.getSocial().getStateTtl())));

        return new AuthorizeUrl(provider.authorizeUrl(redirectUri, state, challenge), state);
    }

    // ────────────────────── 2) 콜백 ──────────────────────

    /**
     * 앱이 중계한 {@code code} 로 로그인을 마친다.
     *
     * @param linkToUserId 로그인한 사용자가 <b>자기 계정에 연결</b>하는 경우 그 사용자 ID.
     *                     로그인 목적이면 null 이다
     */
    @Transactional
    public AuthService.LoginResult callback(String providerName, String code, String state,
                                            Long linkToUserId, String ip, String userAgent) {
        SocialProvider provider = registry.require(providerName);

        // state 는 1회용이다 — 소비하고 지운다. 남겨 두면 재생 공격이 가능하다
        OAuthState saved = stateRepository.findById(sha256(state))
                .orElseThrow(() -> new ApiException(ErrorCode.AUTH_SOCIAL_STATE_INVALID));
        stateRepository.delete(saved);

        if (saved.getExpiresAt().isBefore(Instant.now())
                || saved.getProvider() != provider.kind()) {
            throw new ApiException(ErrorCode.AUTH_SOCIAL_STATE_INVALID);
        }

        String token = provider.exchangeCodeForToken(code, saved.getRedirectUri(),
                saved.getCodeVerifier());
        SocialProfile profile = provider.fetchProfile(token);

        User user = linkToUserId != null
                ? link(linkToUserId, provider.kind(), profile, ip, userAgent)
                : resolve(provider.kind(), profile, ip, userAgent);

        if (user.getStatus() == UserStatus.DISABLED) {
            throw new ApiException(ErrorCode.AUTH_ACCOUNT_DISABLED);
        }
        // 잠긴 계정은 소셜로도 못 들어온다. 여기를 열어 두면 관리자가 건 차단이
        // "구글로 로그인" 한 번으로 우회된다 (계약: http-api.md §2-1-1)
        if (user.isLocked(Instant.now())) {
            throw new ApiException(ErrorCode.AUTH_ACCOUNT_LOCKED);
        }
        if (user.getStatus() == UserStatus.PENDING_APPROVAL) {
            // 승인 대기 중인 사람은 아직 우리가 받기로 한 사람이 아니다
            throw new ApiException(ErrorCode.AUTH_ACCOUNT_PENDING_APPROVAL);
        }
        if (user.getStatus() == UserStatus.PENDING) {
            // 초대를 소셜로 수락하는 셈이다 — 본인만 열 수 있는 경로로 들어왔으므로 활성화한다
            user.setStatus(UserStatus.ACTIVE);
            userRepository.save(user);
        }

        return authService.issueFor(user, userAgent, ip, "social");
    }

    // ────────────────────── 계정 매칭 ──────────────────────

    /**
     * 이 소셜 계정이 누구인지 정한다. <b>이 메서드가 이 기능의 보안 급소다.</b>
     */
    private User resolve(SocialProvider.Kind kind, SocialProfile profile,
                         String ip, String userAgent) {
        // ① 이미 연결돼 있으면 그 사람이다. 이메일이 바뀌었어도 상관없다
        var linked = identityRepository.findByProviderAndSubject(kind, profile.subject());
        if (linked.isPresent()) {
            Identity identity = linked.get();
            identity.setLastLoginAt(Instant.now());
            identity.setEmail(profile.email());
            identityRepository.save(identity);

            return userRepository.findById(identity.getUserId())
                    .orElseThrow(() -> new ApiException(ErrorCode.AUTH_SOCIAL_NO_ACCOUNT));
        }

        var social = properties.getSocial();
        String email = normalize(profile.email());

        // ② 같은 이메일의 기존 계정에 붙일 것인가 — 검증된 주소일 때만이다.
        //
        // provider 가 "검증했다" 고 명시하지 않았는데 붙이면, 남의 이메일을 자기 소셜
        // 계정에 적어 넣는 것만으로 그 계정을 가져갈 수 있다. 네이버처럼 검증 여부를
        // 주지 않는 곳에서 특히 위험하다.
        if (!email.isBlank() && profile.emailVerified() && social.isAutoLinkVerifiedEmail()) {
            var existing = userRepository.findByEmailIgnoreCase(email);
            if (existing.isPresent()) {
                User user = existing.get();
                createIdentity(user, kind, profile);
                auditService.record("SOCIAL_LINKED_BY_EMAIL", user.getId(), user.getId(),
                        ip, userAgent, Map.of("provider", kind.name()));
                return user;
            }
        }

        // ③ 새로 만들 것인가
        if (!social.isAutoSignup()) {
            // 이메일이 있는데도 못 붙였다면 대개 ②의 검증 조건에 걸린 것이다.
            // 운영자가 원인을 알 수 있게 남긴다 (사용자에게는 구분해 주지 않는다)
            log.info("소셜 로그인 거부 — provider={} 자동가입 꺼짐, 이메일검증={}",
                    kind, profile.emailVerified());
            throw new ApiException(ErrorCode.AUTH_SOCIAL_NO_ACCOUNT);
        }

        if (email.isBlank()) {
            // 이메일 없이 만들면 비밀번호 찾기·알림이 불가능한 계정이 된다
            log.info("소셜 자동가입 불가 — provider={} 이메일 미제공", kind);
            throw new ApiException(ErrorCode.AUTH_SOCIAL_NO_ACCOUNT);
        }
        if (userRepository.existsByEmailIgnoreCase(email)) {
            // 같은 주소의 계정이 있는데 ②에서 못 붙였다 = 검증되지 않은 주소다.
            // 여기서 새로 만들면 같은 주소의 계정이 둘이 된다
            throw new ApiException(ErrorCode.AUTH_SOCIAL_NO_ACCOUNT);
        }

        var user = new User();
        user.setEmail(email);
        user.setName(profile.name() == null || profile.name().isBlank()
                ? email.split("@")[0] : profile.name());
        // 비밀번호가 없는 계정이다. 로그인은 소셜로만 되고,
        // 나중에 '비밀번호 찾기' 로 비밀번호를 만들 수 있다
        user.setPasswordHash(null);
        user.setStatus(UserStatus.ACTIVE);
        if (profile.emailVerified()) {
            user.setEmailVerifiedAt(Instant.now());
        }
        userRepository.save(user);

        createIdentity(user, kind, profile);
        auditService.record("SOCIAL_SIGNUP", user.getId(), user.getId(), ip, userAgent,
                Map.of("provider", kind.name()));
        return user;
    }

    /** 로그인한 사용자가 자기 계정에 직접 연결한다 — 가장 안전한 경로다 */
    private User link(Long userId, SocialProvider.Kind kind, SocialProfile profile,
                      String ip, String userAgent) {
        var existing = identityRepository.findByProviderAndSubject(kind, profile.subject());
        if (existing.isPresent() && !existing.get().getUserId().equals(userId)) {
            throw new ApiException(ErrorCode.AUTH_SOCIAL_ALREADY_LINKED);
        }
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "사용자를 찾을 수 없습니다."));

        if (existing.isEmpty()) {
            createIdentity(user, kind, profile);
            auditService.record("SOCIAL_LINKED", userId, userId, ip, userAgent,
                    Map.of("provider", kind.name()));
        }
        return user;
    }

    private void createIdentity(User user, SocialProvider.Kind kind, SocialProfile profile) {
        var identity = new Identity(user.getId(), kind, profile.subject(),
                profile.email(), profile.name());
        identity.setLastLoginAt(Instant.now());
        identityRepository.save(identity);
    }

    // ────────────────────── 연결 관리 ──────────────────────

    @Transactional(readOnly = true)
    public List<Identity> listIdentities(Long userId) {
        return identityRepository.findByUserId(userId);
    }

    /**
     * 연결을 끊는다.
     *
     * <p>비밀번호가 없고 이것이 마지막 연결이면 거부한다 — 끊는 순간 그 계정으로
     * 들어올 방법이 사라진다.</p>
     */
    @Transactional
    public void unlink(Long userId, String providerName, String ip, String userAgent) {
        var kind = SocialProvider.Kind.of(providerName);
        var identities = identityRepository.findByUserId(userId);
        var target = identities.stream().filter(i -> i.getProvider() == kind).findFirst()
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "연결된 계정이 없습니다."));

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "사용자를 찾을 수 없습니다."));
        boolean hasPassword = user.getPasswordHash() != null;
        if (!hasPassword && identities.size() <= 1) {
            throw new ApiException(ErrorCode.CONFLICT,
                    "마지막 로그인 수단입니다. 비밀번호를 먼저 설정하세요.");
        }

        identityRepository.delete(target);
        auditService.record("SOCIAL_UNLINKED", userId, userId, ip, userAgent,
                Map.of("provider", kind.name()));
    }

    // ────────────────────── 도구 ──────────────────────

    private static String normalize(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    private static String random(int bytes) {
        byte[] b = new byte[bytes];
        RANDOM.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    private static String s256Base64Url(String verifier) {
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            return Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(digest.digest(verifier.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new ApiException(ErrorCode.INTERNAL, "PKCE 생성에 실패했습니다.");
        }
    }

    private static String sha256(String value) {
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of()
                    .formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new ApiException(ErrorCode.INTERNAL, "토큰 처리에 실패했습니다.");
        }
    }
}
