package team.prost.ixtrust.client.spi;

import lombok.extern.slf4j.Slf4j;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * SsoUserProvider의 보일러플레이트를 제거하는 추상 클래스.
 * findByEmail, findById, existsByEmail, createAdmin의 기본 구현을 제공한다.
 * 앱은 toEntity(), toInfo(), parseId(), idFromEntity() 만 구현하면 된다.
 *
 * <p>1.7.0 — {@code <U, ID>} 두 개 generic. {@code parseId(String)} 으로 SP 측 ID 변환.</p>
 *
 * <p>기존 SsoUserProvider 인터페이스 직접 구현도 계속 지원된다.</p>
 *
 * @param <U>  앱의 User 엔티티 타입
 * @param <ID> User PK type — Long(기본) / UUID / String 등
 */
@Slf4j
public abstract class AbstractSsoUserProvider<U, ID> implements SsoUserProvider<ID> {

    private final SsoUserRepository<U, ID> repository;
    private final RoleMappingStrategy roleMappingStrategy;

    /**
     * @param repository 앱의 UserRepository (SsoUserRepository 상속)
     * @param roleMappingStrategy 역할 매핑 전략 (null이면 기본 전략 사용)
     */
    protected AbstractSsoUserProvider(SsoUserRepository<U, ID> repository,
                                       RoleMappingStrategy roleMappingStrategy) {
        this.repository = repository;
        this.roleMappingStrategy = roleMappingStrategy != null
            ? roleMappingStrategy
            : RoleMappingStrategy.defaultStrategy();
    }

    protected AbstractSsoUserProvider(SsoUserRepository<U, ID> repository) {
        this(repository, null);
    }

    // ───────── 앱이 구현할 추상 메서드 ─────────

    /** 엔티티를 SsoUserInfo 로 변환. */
    protected abstract SsoUserInfo<ID> toInfo(U entity);

    /**
     * 새 사용자 엔티티를 생성한다. (DB 저장 전)
     *
     * @param email           이메일
     * @param name            이름
     * @param role            매핑된 로컬 역할 (RoleMappingStrategy 적용 후)
     * @param encodedPassword BCrypt 인코딩된 비밀번호 (SSO 사용자는 랜덤값)
     * @return 저장 전 엔티티
     */
    protected abstract U toEntity(String email, String name, String role, String encodedPassword);

    /**
     * JWT claim 의 String 표현을 SP 의 ID type 으로 변환.
     * Long 이면 {@code Long.parseLong(s)}, UUID 면 {@code UUID.fromString(s)} 등.
     * 기본 구현 제공 — Long type 가정.
     */
    @SuppressWarnings("unchecked")
    protected ID parseId(String userIdAsString) {
        return (ID) Long.valueOf(userIdAsString);
    }

    // ───────── 기본 구현 ─────────

    @Override
    public Optional<? extends SsoUserInfo<ID>> findByEmail(String email) {
        return repository.findByEmail(email).map(this::toInfo);
    }

    @Override
    public Optional<? extends SsoUserInfo<ID>> findById(String userIdAsString) {
        try {
            ID id = parseId(userIdAsString);
            return repository.findById(id).map(this::toInfo);
        } catch (IllegalArgumentException e) {
            // NumberFormatException, UUID parse error 등 모두 IllegalArgumentException 하위
            log.debug("findById parse 실패: {} ({})", userIdAsString, e.getMessage());
            return Optional.empty();
        }
    }

    @Override
    public boolean existsByEmail(String email) {
        return repository.existsByEmail(email);
    }

    @Override
    @Transactional
    public SsoUserInfo<ID> findOrCreateByOidc(String email, String name, Set<String> roles) {
        U user = repository.findByEmail(email).orElse(null);

        if (user == null) {
            String role = roleMappingStrategy.mapRole(roles);
            user = toEntity(email, name, role, UUID.randomUUID().toString());
            repository.save(user);
            log.info("SSO 신규 사용자 생성: {} ({})", name, email);
        } else {
            log.info("SSO 기존 사용자 로그인: {} ({})", name, email);
        }

        return toInfo(user);
    }

    /**
     * OIDC 전체 claim 수신 + ssoId/name 자동 동기화.
     * entity 에 {@code setSsoId(String)} 메서드가 있으면 IX-Trust user_id 를 자동 저장한다.
     */
    @Override
    @Transactional
    public SsoUserInfo<ID> findOrCreateByOidc(OidcAttributes oidc) {
        U user = repository.findByEmail(oidc.email()).orElse(null);
        boolean isNew = (user == null);

        if (isNew) {
            String role = roleMappingStrategy.mapRole(oidc.roles());
            user = toEntity(oidc.email(), oidc.name(), role, UUID.randomUUID().toString());
        }

        syncOidcFields(user, oidc);
        repository.save(user);

        log.info("SSO {}: {} ({}), userId={}, orgId={}",
                isNew ? "신규 생성" : "기존 로그인",
                oidc.name(), oidc.email(), oidc.userId(), oidc.orgId());

        return toInfo(user);
    }

    /**
     * OIDC claim → entity 필드 자동 동기화 (reflection).
     * entity 에 해당 setter 가 있으면 동기화, 없으면 skip.
     * SP 가 override 해 커스텀 동기화 가능.
     *
     * <p>{@code setOidcProfile(String)} 이 있으면 전체 OIDC claim 을 JSON 으로 저장한다.
     * SP 의 {@link UserExtraProvider} 가 이 값을 extra 에 포함하면 IX-Trust 마스터 데이터 서빙 가능.
     */
    protected void syncOidcFields(U entity, OidcAttributes oidc) {
        if (oidc.userId() != null) {
            trySetString(entity, "setSsoId", oidc.userId());
        }
        if (oidc.name() != null) {
            trySetString(entity, "setName", oidc.name());
        }
        if (oidc.phoneNumber() != null) {
            trySetString(entity, "setPhone", oidc.phoneNumber());
        }
        String json = oidc.toJson();
        if (json != null) {
            trySetString(entity, "setOidcProfile", json);
        }
    }

    private void trySetString(Object entity, String setterName, String value) {
        try {
            var method = entity.getClass().getMethod(setterName, String.class);
            method.invoke(entity, value);
        } catch (NoSuchMethodException e) {
            // entity 에 해당 필드 없음 — skip
        } catch (Exception e) {
            log.debug("{} 호출 실패: {}", setterName, e.getMessage());
        }
    }

    @Override
    @Transactional
    public void createAdmin(String name, String email, String encodedPassword) {
        U admin = toEntity(email, name, "ADMIN", encodedPassword);
        repository.save(admin);
        log.info("초기 관리자 생성: {} ({})", name, email);
    }

    protected SsoUserRepository<U, ID> getRepository() {
        return repository;
    }

    protected RoleMappingStrategy getRoleMappingStrategy() {
        return roleMappingStrategy;
    }
}
