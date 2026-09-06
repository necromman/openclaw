package team.prost.ixauth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import team.prost.ixauth.social.SocialProvider;

import java.time.Instant;

/**
 * OAuth 진행 중인 요청 하나 — CSRF 방어(state)와 PKCE 검증값.
 *
 * <p>메모리에 두면 인스턴스가 여러 대일 때 콜백이 다른 인스턴스로 들어와 실패한다.
 * 전용 Redis 를 두지 않는 것이 설계 불변식 3 이므로 앱 DB 에 둔다.</p>
 *
 * <p>{@code redirect_uri} 를 저장하는 이유 — 토큰 교환 때 <b>authorize 때와 똑같은 값</b>을
 * 다시 보내야 provider 가 받아 준다. 앱이 두 번째 요청에서 다른 값을 보내는 실수를 막는다.</p>
 */
@Entity
@Table(name = "oauth_states")
@Getter
@Setter
@NoArgsConstructor
public class OAuthState {

    /** 평문이 아니라 SHA-256 해시. 유출돼도 그것만으로 콜백을 위조할 수 없다 */
    @Id
    @Column(name = "state_hash", length = 64)
    private String stateHash;

    @jakarta.persistence.Enumerated(jakarta.persistence.EnumType.STRING)
    @Column(nullable = false, length = 20)
    private SocialProvider.Kind provider;

    @Column(name = "redirect_uri", nullable = false, length = 500)
    private String redirectUri;

    @Column(name = "code_verifier", length = 128)
    private String codeVerifier;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    public OAuthState(String stateHash, SocialProvider.Kind provider, String redirectUri,
                      String codeVerifier, Instant expiresAt) {
        this.stateHash = stateHash;
        this.provider = provider;
        this.redirectUri = redirectUri;
        this.codeVerifier = codeVerifier;
        this.expiresAt = expiresAt;
    }
}
