package team.prost.ixauth.security;

import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.SigningKey;
import team.prost.ixauth.repository.SigningKeyRepository;

import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.text.ParseException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.Map;

/**
 * JWT 서명 키 관리 + JWKS 게시.
 *
 * <p>키를 DB 에 두는 이유 — 재시작해도 발급된 토큰이 계속 검증되고, 여러 인스턴스가
 * 같은 키로 서명하며, 회전 시 구 키를 남겨 아직 유효한 토큰이 깨지지 않게 한다.</p>
 *
 * <p>암호 알고리즘을 직접 구현하지 않는다 — 키 생성·서명은 JDK/Nimbus 에 맡긴다
 * (.claude/rules/coding-style.md 보안 규칙 1).</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SigningKeyService {

    private static final int RSA_KEY_SIZE = 2048;

    private final SigningKeyRepository repository;
    private final IxAuthProperties properties;
    private final team.prost.ixauth.service.AuditService auditService;

    /** 부팅 시 활성 키가 없으면 만든다. 있으면 그대로 쓴다. */
    @Transactional
    public SigningKey ensureActiveKey() {
        return repository.findActive().orElseGet(this::generateAndSave);
    }

    @Transactional(readOnly = true)
    public SigningKey activeKey() {
        return repository.findActive()
                .orElseThrow(() -> new ApiException(ErrorCode.SERVICE_UNAVAILABLE, "서명 키가 없습니다."));
    }

    /**
     * JWKS 응답 — 활성 키 + 아직 폐기하지 않은 구 키.
     *
     * <p>구 키를 즉시 지우면 아직 유효한 access token 이 검증 실패한다.
     * 회전 시 access TTL 이상 겹치는 기간을 둔다 (docs/contract/token.md §4).</p>
     */
    @Transactional(readOnly = true)
    public Map<String, Object> jwks() {
        List<JWK> keys = repository.findPublishable().stream()
                .map(this::toJwk)
                .filter(java.util.Objects::nonNull)
                .toList();
        return new JWKSet(keys).toJSONObject();
    }

    /** kid 로 키를 찾는다 — 폐기되지 않은 키만 (회전 중 구 토큰 검증용) */
    @Transactional(readOnly = true)
    public java.util.Optional<SigningKey> jwksKeyById(String kid) {
        if (kid == null || kid.isBlank()) {
            return java.util.Optional.empty();
        }
        return repository.findById(kid).filter(k -> k.getRetiredAt() == null);
    }

    public RSAPrivateKey privateKeyOf(SigningKey key) {
        try {
            byte[] der = Base64.getDecoder().decode(key.getPrivatePkcs8());
            var spec = new PKCS8EncodedKeySpec(der);
            return (RSAPrivateKey) KeyFactory.getInstance("RSA").generatePrivate(spec);
        } catch (Exception e) {
            throw new ApiException(ErrorCode.INTERNAL, "서명 키를 읽을 수 없습니다.");
        }
    }

    public RSAPublicKey publicKeyOf(SigningKey key) {
        try {
            return RSAKey.parse(key.getPublicJwk()).toRSAPublicKey();
        } catch (Exception e) {
            throw new ApiException(ErrorCode.INTERNAL, "공개키를 읽을 수 없습니다.");
        }
    }

    // ────────────────────── 회전 (G19) ──────────────────────

    /**
     * 매일 새벽, 현재 키가 회전 주기를 넘었으면 새 키를 발급한다.
     *
     * <p>설정만 있고 도는 것이 없으면 <b>키는 영원히 그대로다.</b> 회전 주기를 90일로
     * 적어 둔 설치가 3년째 같은 키로 서명하는 상태가 되고, 그 사실은 아무 데도 드러나지
     * 않는다 — 설정 화면에는 90 이 적혀 있기 때문이다.</p>
     *
     * <p>회전과 <b>구 키 내리기를 같은 날 하지 않는다.</b> 방금 전에 발급된 access token 이
     * 구 키로 서명돼 있고, 그것을 즉시 내리면 그 토큰들이 한꺼번에 검증 실패한다
     * (docs/contract/token.md §4). 내리는 것은 {@link #retireSuperseded()} 가 다음 날
     * 이후에 한다.</p>
     */
    @Scheduled(cron = "0 40 3 * * *")
    public void rotateIfDue() {
        int days = properties.getJwt().getKeyRotationDays();
        if (days <= 0) {
            return;         // 0 = 회전하지 않는다
        }
        String injected = properties.getJwt().getPrivateKey();
        if (injected != null && !injected.isBlank()) {
            // 키를 직접 주입한 설치의 의도는 "이 키를 쓴다" 이다. 회전하면 그 의도를 뒤집는다
            log.debug("서명 키가 주입돼 있어 자동 회전을 건너뜁니다");
            return;
        }
        var active = repository.findActive().orElse(null);
        if (active == null) {
            return;         // 부팅 시 ensureActiveKey 가 만든다
        }
        if (active.getCreatedAt().isAfter(Instant.now().minus(days, ChronoUnit.DAYS))) {
            retireSuperseded();
            return;
        }
        rotate(active.getKid(), days);
        // 회전한 날은 아무것도 내리지 않는다 — 방금까지 구 키로 서명된 토큰이 살아 있다
    }

    @Transactional
    public SigningKey rotate(String previousKid, int days) {
        repository.findById(previousKid).ifPresent(previous -> {
            previous.setActive(false);       // JWKS 에는 남는다 (retiredAt 이 null 이다)
            repository.save(previous);
        });
        var created = generateAndSave();
        log.info("서명 키를 회전했습니다 — {} → {} ({}일 경과)", previousKid, created.getKid(), days);
        auditService.record(team.prost.ixauth.service.AuditService.SIGNING_KEY_ROTATED,
                null, null, null, null,
                Map.of("previousKid", previousKid, "newKid", created.getKid(),
                        "rotationDays", days));
        return created;
    }

    /**
     * 구 키를 JWKS 에서 내린다.
     *
     * <p>언제 내려도 되는가 — <b>현재 키가 access token 수명보다 오래됐을 때</b>다.
     * 활성이 아닌 키는 늦어도 현재 키가 만들어진 시점에 물러났으므로, 그 시점이 access
     * 수명보다 오래됐다면 그 키로 서명된 토큰은 모두 만료됐다. 키마다 '언제 물러났는가'
     * 를 따로 저장하지 않아도 이 한 가지로 판정이 선다.</p>
     */
    @Transactional
    public int retireSuperseded() {
        var active = repository.findActive().orElse(null);
        if (active == null) {
            return 0;
        }
        Duration grace = properties.getJwt().getAccessTtl()
                .plus(properties.getJwt().getClockSkew());
        if (active.getCreatedAt().isAfter(Instant.now().minus(grace))) {
            return 0;       // 아직 구 키로 서명된 토큰이 살아 있을 수 있다
        }
        int retired = 0;
        for (SigningKey key : repository.findPublishable()) {
            if (key.getKid().equals(active.getKid()) || key.getRetiredAt() != null) {
                continue;
            }
            key.setRetiredAt(Instant.now());
            repository.save(key);
            retired++;
            log.info("서명 키 {} 를 JWKS 에서 내렸습니다", key.getKid());
            auditService.record(team.prost.ixauth.service.AuditService.SIGNING_KEY_RETIRED,
                    null, null, null, null, Map.of("kid", key.getKid()));
        }
        return retired;
    }

    private SigningKey generateAndSave() {
        try {
            KeyPair pair;
            String injected = properties.getJwt().getPrivateKey();
            if (injected != null && !injected.isBlank()) {
                // 외부 주입 키 — 여러 인스턴스가 같은 키를 쓰도록 운영에서 지정할 수 있다
                var priv = (RSAPrivateKey) KeyFactory.getInstance("RSA")
                        .generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(stripPem(injected))));
                var pubSpec = new java.security.spec.RSAPublicKeySpec(
                        ((java.security.interfaces.RSAPrivateCrtKey) priv).getModulus(),
                        ((java.security.interfaces.RSAPrivateCrtKey) priv).getPublicExponent());
                var pub = (RSAPublicKey) KeyFactory.getInstance("RSA").generatePublic(pubSpec);
                pair = new KeyPair(pub, priv);
                log.info("주입된 서명 키를 사용합니다 (ixauth.jwt.private-key)");
            } else {
                var gen = KeyPairGenerator.getInstance("RSA");
                gen.initialize(RSA_KEY_SIZE);
                pair = gen.generateKeyPair();
                log.info("서명 키를 새로 생성했습니다 (RSA {}bit)", RSA_KEY_SIZE);
            }

            String kid = LocalDate.now() + "-" + Integer.toHexString((int) (System.nanoTime() & 0xffff));
            RSAKey jwk = new RSAKey.Builder((RSAPublicKey) pair.getPublic())
                    .keyUse(KeyUse.SIGNATURE)
                    .algorithm(com.nimbusds.jose.JWSAlgorithm.RS256)
                    .keyID(kid)
                    .build();

            var entity = new SigningKey(kid, "RS256",
                    jwk.toPublicJWK().toJSONString(),
                    Base64.getEncoder().encodeToString(pair.getPrivate().getEncoded()));
            return repository.save(entity);
        } catch (Exception e) {
            throw new IllegalStateException("서명 키 생성 실패", e);
        }
    }

    private JWK toJwk(SigningKey key) {
        try {
            return JWK.parse(key.getPublicJwk());
        } catch (ParseException e) {
            log.warn("JWKS 에서 키 {} 를 건너뜁니다 — 파싱 실패", key.getKid());
            return null;
        }
    }

    private String stripPem(String pem) {
        return pem.replaceAll("-----BEGIN [A-Z ]+-----", "")
                .replaceAll("-----END [A-Z ]+-----", "")
                .replaceAll("\\s", "");
    }
}
