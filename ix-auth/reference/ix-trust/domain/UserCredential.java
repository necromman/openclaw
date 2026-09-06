package team.prost.ixtrust.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * WebAuthn / FIDO2 passkey credential.
 *
 * <p>한 사용자가 여러 디바이스 (iPhone / Mac / Windows / YubiKey 등) 의 passkey 를 등록 가능.
 * private key 는 디바이스의 Secure Enclave (TPM / Apple Secure Enclave / Windows TPM) 박힘 —
 * 서버는 {@link #publicKeyCose} 만 보관. signature 검증으로 인증.
 *
 * <p>V59 마이그레이션이 테이블 신설. {@link User#getWebauthnUserHandle()} 와 user_id FK 로 연결.
 *
 * <p>참고: W3C WebAuthn Level 2 / FIDO Alliance FIDO2.
 */
@Entity
@Table(name = "user_credentials")
@Getter
@Setter
@NoArgsConstructor
public class UserCredential {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 소유 사용자 (FK users.id, ON DELETE CASCADE). */
    @Column(name = "user_id", nullable = false)
    private Long userId;

    /**
     * WebAuthn credential ID — 디바이스가 등록 시점에 발급한 opaque binary 식별자.
     * 인증 시 디바이스가 이 ID 를 응답으로 보내 server 가 사용자 lookup.
     */
    @Column(name = "credential_id", nullable = false, unique = true)
    private byte[] credentialId;

    /**
     * COSE 형태 (CBOR Object Signing and Encryption) public key.
     * 서버는 이걸로 서명 검증. RFC 8152 / W3C WebAuthn §6.5.1.
     */
    @Column(name = "public_key_cose", nullable = false)
    private byte[] publicKeyCose;

    /**
     * 디바이스가 증가시키는 signature counter (W3C WebAuthn §6.1.1).
     * cloned authenticator 탐지용 — 값이 감소하거나 동일하면 의심.
     */
    @Column(name = "signature_count", nullable = false)
    private long signatureCount = 0;

    /**
     * Authenticator Attestation GUID (W3C WebAuthn §6.4.4) — 디바이스 모델 식별.
     * 예: iPhone Touch ID, Windows Hello, YubiKey 5 series. 사용자 친화적 디바이스 이름 표시용.
     */
    @Column(name = "aaguid")
    private byte[] aaguid;

    /** 사용자 지정 이름 (예: "iPhone 14 (회사용)", "YubiKey - 책상 서랍"). */
    @Column(name = "name", length = 120)
    private String name;

    /** 전송 채널 CSV — internal / usb / nfc / ble / hybrid (W3C WebAuthn §5.8.4). */
    @Column(name = "transports", length = 120)
    private String transports;

    /** 디바이스가 backup 가능한지 (W3C WebAuthn §6.1.3, 예: iCloud Keychain 동기화). */
    @Column(name = "backup_eligible", nullable = false)
    private boolean backupEligible = false;

    /** 실제 backup 되어있는지 (eligible 이라도 사용자 비활성화 가능). */
    @Column(name = "backup_state", nullable = false)
    private boolean backupState = false;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "last_used_at")
    private LocalDateTime lastUsedAt;
}
