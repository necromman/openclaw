package team.prost.ixauth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * 2단계 인증 수단 하나 — 지금은 TOTP 뿐이다.
 *
 * <p><b>등록과 활성화를 분리한다.</b> {@code confirmedAt} 이 비어 있으면 아직
 * "앱에 등록해 봤다" 는 상태일 뿐 로그인에는 아무 영향이 없다. 이 분리가 없으면
 * QR 을 잘못 스캔한 사람이 그 순간부터 자기 계정에서 잠긴다.</p>
 *
 * <p>시크릿은 {@code secretEnc} 에 <b>암호화</b>해 둔다. 검증할 때마다 원본으로
 * 코드를 다시 계산해야 하므로 해시로는 안 되고, 그렇다고 평문으로 두면 DB 를 읽는
 * 것만으로 남의 2단계를 통과할 수 있다.</p>
 *
 * <p>백업 코드는 반대로 <b>해시</b>만 둔다 — 대조만 하면 되므로 되돌려 읽을 이유가 없다.</p>
 */
@Entity
@Table(name = "mfa_credentials")
@Getter
@Setter
@NoArgsConstructor
public class MfaCredential {

    /** 지금 지원하는 유일한 종류. WebAuthn 등은 제품 경계 밖이다 (rules/product-boundary.md) */
    public static final String TYPE_TOTP = "TOTP";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(nullable = false, length = 20)
    private String type = TYPE_TOTP;

    /** AES-GCM 암호문(Base64). 평문 저장 금지 */
    @Column(name = "secret_enc", nullable = false, columnDefinition = "text")
    private String secretEnc;

    /** 남은 백업 코드의 SHA-256 hex 목록. 쓰면 그 줄이 사라진다 */
    @Column(name = "backup_codes_hash", columnDefinition = "text")
    private String backupCodesHash;

    /** 확인 시각. NULL = 등록만 하고 아직 켜지 않았다 */
    @Column(name = "confirmed_at")
    private Instant confirmedAt;

    /**
     * 마지막으로 통과한 TOTP 스텝.
     *
     * <p>이보다 크지 않은 스텝은 거부한다 — 같은 코드를 두 번 쓰지 못하게 하는 유일한 장치다.</p>
     */
    @Column(name = "last_step")
    private Long lastStep;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    public MfaCredential(Long userId, String secretEnc, String backupCodesHash) {
        this.userId = userId;
        this.secretEnc = secretEnc;
        this.backupCodesHash = backupCodesHash;
    }

    @PreUpdate
    void touch() {
        this.updatedAt = Instant.now();
    }

    /** 실제로 로그인에 관여하는가 */
    public boolean isActive() {
        return confirmedAt != null;
    }
}
