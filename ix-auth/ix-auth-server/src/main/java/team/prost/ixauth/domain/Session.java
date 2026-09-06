package team.prost.ixauth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * 세션 — refresh token 보관처.
 *
 * <p>refresh token 은 JWT 가 아니라 opaque 난수다. JWT 로 두면 앱이 로컬 검증할 수
 * 있게 되어 <b>로그아웃이 실제로 먹지 않는다</b>. 여기 해시로 저장하고 대조해야
 * 폐기가 성립한다 (docs/contract/token.md §1).</p>
 */
@Entity
@Table(name = "sessions")
@Getter
@Setter
@NoArgsConstructor
public class Session {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** SHA-256 hex. 평문 저장 금지 */
    @Column(name = "refresh_token_hash", nullable = false, length = 64)
    private String refreshTokenHash;

    @Column(name = "issued_at", nullable = false)
    private Instant issuedAt = Instant.now();

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "last_used_at")
    private Instant lastUsedAt;

    @Column(name = "user_agent", length = 500)
    private String userAgent;

    @Column(length = 45)
    private String ip;

    /**
     * 대리(impersonation) 세션이면 그 관리자의 id. 평범한 로그인이면 {@code null}.
     *
     * <p>토큰의 {@code act} 클레임이 여기서 나온다. 토큰에만 두면 refresh 회전 때
     * 앱이 보내 준 값을 그대로 다시 서명하는 꼴이라, <b>대리 사실을 클라이언트가
     * 정할 수 있게 된다.</b> 세션 행이 정본이어야 회전이 몇 번 돌아도 출처가 서버다.</p>
     */
    @Column(name = "impersonator_id")
    private Long impersonatorId;

    /**
     * 대리를 시작한 관리자의 이메일 — <b>그 시점의 기록</b>이다.
     *
     * <p>지금 값을 조인으로 끌어오지 않는 이유: 관리자가 주소를 바꾸거나 계정이
     * 비활성이 되어도 "이 세션을 누가 열었나" 는 변하면 안 된다.</p>
     */
    @Column(name = "impersonator_email", length = 320)
    private String impersonatorEmail;

    /**
     * 이 세션을 연 외부 신원 공급자 — 연합 신원 교환으로 들어왔으면 그 provider 이름.
     * 자체 인증(비밀번호·매직 링크·소셜)이면 {@code null}.
     *
     * <p>토큰의 {@code ixauth_idp} 클레임이 여기서 나온다. 토큰에만 두면 15분마다 도는
     * 회전 때 앱이 보내 준 값을 그대로 다시 서명하는 꼴이라, <b>어느 IdP 로 들어왔는지를
     * 클라이언트가 정할 수 있게 된다.</b> {@link #impersonatorId} 와 같은 이유다.</p>
     */
    @Column(length = 64)
    private String idp;

    public Session(UUID id, Long userId, String refreshTokenHash, Instant expiresAt,
                   String userAgent, String ip) {
        this.id = id;
        this.userId = userId;
        this.refreshTokenHash = refreshTokenHash;
        this.expiresAt = expiresAt;
        this.userAgent = userAgent;
        this.ip = ip;
    }

    public boolean isUsable(Instant now) {
        return revokedAt == null && expiresAt.isAfter(now);
    }

    /** 관리자가 대리 중인 세션인가 */
    public boolean isImpersonated() {
        return impersonatorId != null;
    }
}
