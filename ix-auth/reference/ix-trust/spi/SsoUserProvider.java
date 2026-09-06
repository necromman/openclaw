package team.prost.ixtrust.client.spi;

import java.util.Optional;
import java.util.Set;

/**
 * 앱이 구현하는 사용자 연동 SPI.
 * 라이브러리는 이 인터페이스를 통해 앱의 User 엔티티를 조작한다.
 *
 * <p>1.7.0 — ID generic 화. 기본 type {@code Long} (1.5.x/1.6.x 호환), PX-PILOT 같이
 * UUID PK 사용하는 SP 는 {@code SsoUserProvider<UUID>} 로 명시.</p>
 *
 * <p>{@link #findById}는 JWT claim 의 String 표현을 받아 SP 가 자체 ID type 으로 변환한다.
 * 이로써 SDK 내부 JwtProvider 가 type-agnostic 으로 토큰 발급·검증 가능.</p>
 *
 * <p>사용 예시:</p>
 * <pre>
 * {@literal @}Component
 * public class MyAppUserProvider implements SsoUserProvider&lt;Long&gt; {
 *     private final UserRepository userRepository;
 *
 *     {@literal @}Override
 *     public Optional&lt;? extends SsoUserInfo&lt;Long&gt;&gt; findById(String userIdAsString) {
 *         return userRepository.findById(Long.parseLong(userIdAsString))
 *                 .map(MyUserAdapter::new);
 *     }
 *     // ...
 * }
 * </pre>
 *
 * @param <ID> User PK type — Long(기본), UUID, String 등
 */
public interface SsoUserProvider<ID> {

    /** 이메일로 사용자 조회 */
    Optional<? extends SsoUserInfo<ID>> findByEmail(String email);

    /**
     * JWT claim {@code userId} (String 표현) 으로 사용자 조회.
     * SP 가 String → 자기 ID type 으로 변환 후 Repository 호출.
     *
     * <p>1.7.0 변경: 이전 {@code findById(Long)} → {@code findById(String)} 으로 변경.
     * SP 별 ID type 다양성 (UUID/Long/String) 지원.</p>
     */
    Optional<? extends SsoUserInfo<ID>> findById(String userIdAsString);

    /** 이메일 존재 여부 */
    boolean existsByEmail(String email);

    /**
     * OIDC 콜백에서 사용자 조회 또는 생성 (JIT Provisioning).
     * 기존 사용자가 있으면 그대로 반환, 없으면 신규 생성.
     */
    SsoUserInfo<ID> findOrCreateByOidc(String email, String name, Set<String> roles);

    /**
     * OIDC 콜백에서 사용자 조회 또는 생성 — 전체 OIDC claim 수신 버전.
     * IX-Trust user_id (ssoId), org_id, department 등 추가 claim 을 SP 에 전달한다.
     *
     * <p>기본 구현은 {@link #findOrCreateByOidc(String, String, Set)} 에 위임 (하위 호환).
     * {@link AbstractSsoUserProvider} 는 이 메서드를 override 해 ssoId 자동 동기화 수행.
     *
     * @param oidc IX-Trust OIDC 속성 (user_id, email, name, roles, org_id 등)
     * @return 조회 또는 생성된 사용자
     * @since 1.9.2
     */
    default SsoUserInfo<ID> findOrCreateByOidc(OidcAttributes oidc) {
        return findOrCreateByOidc(oidc.email(), oidc.name(), oidc.roles());
    }

    /** 초기 관리자 계정 생성. */
    void createAdmin(String name, String email, String encodedPassword);
}
