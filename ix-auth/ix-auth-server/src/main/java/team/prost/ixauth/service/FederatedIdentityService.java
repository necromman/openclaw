package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.FederatedIdentity;
import team.prost.ixauth.domain.User;
import team.prost.ixauth.domain.UserStatus;
import team.prost.ixauth.repository.FederatedIdentityRepository;
import team.prost.ixauth.repository.RoleRepository;
import team.prost.ixauth.repository.UserRepository;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 연합 신원 교환 — 앱이 <b>이미 검증한</b> 외부 신원을 받아 세션을 발급한다.
 *
 * <p><b>이것은 OIDC IdP 화가 아니다.</b> jar 는 외부 provider 와 직접 토큰을 교환하지
 * 않고 브라우저를 받지도 않는다(설계 불변식 1·4). 흐름은 이렇다:</p>
 *
 * <ol>
 *   <li>앱이 외부 IdP 로 사용자를 보내 신원을 확인한다 (여기까지 jar 는 관여하지 않는다)</li>
 *   <li>앱이 {@code (provider, subject, email, name)} 을 서비스 키로 제출한다</li>
 *   <li>jar 가 그 신원을 계정에 잇거나(연결) 계정을 만들고(JIT) 토큰을 발급한다</li>
 * </ol>
 *
 * <p><b>이 경로의 신뢰 근거는 서비스 키 하나뿐이다.</b> 앱이 "이 사람은 홍길동이다" 라고
 * 말하면 jar 는 그대로 믿는다. 그래서 기본은 꺼짐이고, 켜더라도 허용 목록에 적힌
 * provider 만 통과한다. jar 를 외부에 노출하지 않는 것(설계 불변식 4)이 이 신뢰의
 * 전제이며, 노출하는 순간 이 엔드포인트는 아무 계정이나 여는 문이 된다.</p>
 *
 * <p>README 의 미구현 {@code ixauth.mode=federated}·{@code hybrid} 로 가는 첫 단계다 —
 * 저쪽은 IX-Trust 에 <b>검증까지</b> 위임하지만, 여기서는 검증을 앱이 하고 jar 는
 * 결과만 받는다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FederatedIdentityService {

    /**
     * JIT 생성 계정의 기본 역할.
     *
     * <p>정책이 아니라 <b>기존 시드 데이터의 이름</b>이다 — V1 이 심는 역할 코드이고,
     * 관리 API 가 역할을 지정하지 않았을 때 붙이는 것과 같은 값이다
     * ({@code UserAdminService.applyRoles}). 어떤 역할을 줄지는 그 역할에 어떤 권한을
     * 매다느냐로 정한다.</p>
     */
    private static final String DEFAULT_ROLE = "USER";

    private final FederatedIdentityRepository identityRepository;
    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final AuthService authService;
    private final AuditService auditService;
    private final IxAuthProperties properties;

    /** 앱이 제출하는 외부 신원 한 벌 */
    public record ExternalIdentity(String provider, String subject, String email, String name) {
    }

    /**
     * 외부 신원을 세션으로 바꾼다. 응답은 {@code POST /auth/login} 과 같은 모양이다.
     *
     * <p><b>2단계 인증을 요구하지 않는다.</b> 외부 IdP 가 이미 본인확인(대개 자체 2단계
     * 포함)을 마친 경로이고, 여기서 다시 막으면 그 IdP 로만 쓰던 사용자가 들어올 방법이
     * 없어진다 — 소셜 로그인과 같은 경계이며 설정 화면의 경고에도 적어 두었다.</p>
     */
    @Transactional
    public AuthService.LoginResult exchange(ExternalIdentity external, String ip,
                                            String userAgent) {
        var federation = properties.getFederation();
        if (!federation.isEnabled()) {
            throw new ApiException(ErrorCode.AUTH_FEDERATION_DISABLED);
        }
        if (!federation.allows(external.provider())) {
            // 운영자가 허용 목록을 채우면 통과한다 — 앱의 실수와 구분되도록 코드를 나눴다
            log.info("연합 신원 거부 — 허용 목록에 없는 provider={}", external.provider());
            throw new ApiException(ErrorCode.AUTH_FEDERATION_PROVIDER_NOT_ALLOWED);
        }

        String provider = IxAuthProperties.Federation.normalizeProvider(external.provider());
        String subject = external.subject().trim();
        String email = normalizeEmail(external.email());

        User user = resolve(provider, subject, email, external.name(), ip, userAgent);

        // 상태 게이트는 비밀번호 로그인과 같은 것을 쓴다. 여기서 판단을 새로 쓰면
        // 관리자가 건 차단이 "넥서스허브로 로그인" 한 번으로 우회된다 (http-api.md §2-1-1)
        authService.assertLoginAllowed(user, Instant.now());

        auditService.record(AuditService.FEDERATED_LOGIN, user.getId(), user.getId(),
                ip, userAgent, Map.of("provider", provider));
        return authService.issueFor(user, userAgent, ip, "federated", provider);
    }

    // ────────────────────── 계정 매칭 ──────────────────────

    /**
     * 이 외부 신원이 누구인지 정한다. <b>이 메서드가 이 기능의 보안 급소다.</b>
     *
     * <p>순서는 소셜 로그인과 같다 — ① 이미 연결됨 ② 같은 이메일의 계정 ③ 새로 생성.
     * 다른 점은 ②에서 provider 의 이메일 검증 신호를 보지 않는다는 것이다. 소셜은 jar 가
     * provider 와 직접 이야기하므로 그 신호를 읽을 수 있지만, 여기서는 <b>앱이 이미 신원을
     * 확인했다</b> 는 것이 전제이고 그 전제를 못 믿으면 이 기능 자체를 켜면 안 된다.
     * 대신 그 판단을 {@code federation.link-by-email} 로 운영자에게 넘긴다.</p>
     */
    private User resolve(String provider, String subject, String email, String name,
                         String ip, String userAgent) {
        var federation = properties.getFederation();

        // ① 이미 연결돼 있으면 그 사람이다. 이메일이 바뀌었어도 상관없다
        var linked = identityRepository.findByProviderAndSubject(provider, subject);
        if (linked.isPresent()) {
            FederatedIdentity identity = linked.get();
            identity.setLastLoginAt(Instant.now());
            identityRepository.save(identity);
            return userRepository.findById(identity.getUserId())
                    .orElseThrow(() -> new ApiException(ErrorCode.AUTH_FEDERATION_NO_ACCOUNT));
        }

        if (email.isBlank()) {
            // 이메일이 없으면 붙일 대상도 만들 계정도 정할 수 없다. 만들어 봐야
            // 비밀번호 찾기·알림이 불가능한 계정이 된다
            log.info("연합 신원 거부 — provider={} 이메일 미제공", provider);
            throw new ApiException(ErrorCode.AUTH_FEDERATION_NO_ACCOUNT);
        }

        // ② 같은 이메일의 기존 계정에 붙인다
        var existing = userRepository.findByEmailIgnoreCase(email);
        if (existing.isPresent()) {
            if (!federation.isLinkByEmail()) {
                // 여기서 새 계정을 만들면 같은 주소의 계정이 둘이 된다. 만들지 않는다
                throw new ApiException(ErrorCode.AUTH_FEDERATION_LINK_DENIED);
            }
            User user = existing.get();
            link(user, provider, subject, email);
            auditService.record(AuditService.FEDERATED_LINK, user.getId(), user.getId(),
                    ip, userAgent, Map.of("provider", provider));
            return user;
        }

        // ③ 새로 만든다
        if (!federation.isAutoProvision()) {
            log.info("연합 신원 거부 — provider={} 자동 생성 꺼짐", provider);
            throw new ApiException(ErrorCode.AUTH_FEDERATION_NO_ACCOUNT);
        }

        User user = provision(email, name);
        link(user, provider, subject, email);
        auditService.record(AuditService.FEDERATED_PROVISION, user.getId(), user.getId(),
                ip, userAgent, Map.of("provider", provider));
        return user;
    }

    /**
     * 계정을 새로 만든다 (JIT).
     *
     * <p><b>비밀번호가 없다.</b> 로그인은 이 IdP 로만 되고, 나중에 '비밀번호 찾기' 로
     * 스스로 만들 수 있다 — 소셜 자동 가입과 같다.</p>
     *
     * <p><b>이메일을 인증됨으로 표시한다.</b> 외부 IdP 가 그 주소로 사람을 확인해 준
     * 결과이기 때문이다. 표시하지 않으면 {@code account.require-email-verification} 을
     * 켠 설치에서 방금 만든 계정이 곧바로 로그인하지 못한다.</p>
     */
    private User provision(String email, String name) {
        var user = new User();
        user.setEmail(email);
        user.setName(name == null || name.isBlank() ? email.split("@")[0] : name.trim());
        user.setPasswordHash(null);
        user.setStatus(UserStatus.ACTIVE);
        user.setEmailVerifiedAt(Instant.now());
        // 기본 역할. 인가의 정본이 앱이더라도 역할이 하나도 없는 계정은
        // 관리 화면에서 "권한 설정을 잊은 사람" 과 구분되지 않는다
        roleRepository.findByCode(DEFAULT_ROLE).ifPresent(user.getRoles()::add);
        return userRepository.save(user);
    }

    private void link(User user, String provider, String subject, String email) {
        var identity = new FederatedIdentity(user.getId(), provider, subject, email);
        identity.setLastLoginAt(Instant.now());
        identityRepository.save(identity);
    }

    // ────────────────────── 조회 ──────────────────────

    /** 관리 화면의 사용자 상세가 쓴다 */
    @Transactional(readOnly = true)
    public List<FederatedIdentity> listFor(Long userId) {
        return identityRepository.findByUserIdOrderByIdAsc(userId);
    }

    // ────────────────────── 도구 ──────────────────────

    private static String normalizeEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }
}
