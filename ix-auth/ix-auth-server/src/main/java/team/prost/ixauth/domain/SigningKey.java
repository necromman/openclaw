package team.prost.ixauth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * JWT 서명 키.
 *
 * <p>DB 에 두는 이유 — ① jar 가 재시작해도 키가 유지돼야 발급된 토큰이 계속 검증된다
 * ② 여러 인스턴스가 같은 키로 서명해야 한다 ③ 회전 시 구 키를 JWKS 에 남겨둬야
 * 아직 유효한 토큰이 깨지지 않는다 (docs/contract/token.md §4).</p>
 *
 * <p>private key 는 PKCS#8 Base64. 운영에서 DB 접근이 곧 키 유출이므로,
 * DB 자체의 접근 통제가 전제다. 외부 주입({@code ixauth.jwt.private-key})도 지원한다.</p>
 */
@Entity
@Table(name = "signing_keys")
@Getter
@Setter
@NoArgsConstructor
public class SigningKey {

    /** JWKS 의 kid. 예: {@code 2026-08-a} */
    @Id
    @Column(length = 50)
    private String kid;

    @Column(nullable = false, length = 10)
    private String algorithm;

    /** 공개키 JWK JSON — JWKS 응답에 그대로 실린다 */
    @Column(name = "public_jwk", nullable = false, columnDefinition = "text")
    private String publicJwk;

    @Column(name = "private_pkcs8", nullable = false, columnDefinition = "text")
    private String privatePkcs8;

    /** 활성 키로 서명한다. 회전 후 구 키는 false 지만 JWKS 에는 남는다 */
    @Column(nullable = false)
    private boolean active = true;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "retired_at")
    private Instant retiredAt;

    public SigningKey(String kid, String algorithm, String publicJwk, String privatePkcs8) {
        this.kid = kid;
        this.algorithm = algorithm;
        this.publicJwk = publicJwk;
        this.privatePkcs8 = privatePkcs8;
    }
}
