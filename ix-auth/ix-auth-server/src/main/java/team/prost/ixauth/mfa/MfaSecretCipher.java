package team.prost.ixauth.mfa;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * TOTP 시크릿 암·복호화 (AES-256-GCM).
 *
 * <p><b>왜 해시가 아니라 암호화인가.</b> TOTP 는 검증할 때마다 원본 시크릿으로 코드를
 * 다시 계산한다. 해시로 두면 계산 자체가 불가능하다. 그렇다고 평문으로 두면 DB 백업
 * 한 부만 새어도 그 조직 전원의 2단계가 무의미해진다 — 비밀번호와 달리 시크릿은
 * 사용자가 바꾸지 않으므로 유출 사실조차 오래 드러나지 않는다.</p>
 *
 * <p>GCM 을 쓰는 이유는 <b>변조 탐지</b>다. CBC 였다면 누군가 DB 의 암호문을 바꿔치기해도
 * 복호화가 조용히 성공해 엉뚱한 시크릿으로 검증하게 된다.</p>
 *
 * <p>키는 환경변수 {@code IXAUTH_MFA_ENCRYPTION_KEY} 로 받고, 없으면
 * {@code ixauth.service-key} 에서 파생한다. 설정 화면에 노출하지 않는다 —
 * 시크릿을 DB·감사로그·백업에 흘리지 않는 것이 규칙이다(rules/settings-driven.md 3).</p>
 */
@Slf4j
@Component
public class MfaSecretCipher {

    /** 키 유도 문구를 섞는다 — service-key 파생일 때 같은 값이 다른 용도로 재사용되지 않게 */
    private static final String KEY_INFO = "ixauth-mfa-secret-v1";
    /** 나중에 키를 바꿀 때 저장된 값이 어느 키로 잠겼는지 알아야 한다 */
    private static final String FORMAT_PREFIX = "v1:";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private static final SecureRandom RANDOM = new SecureRandom();

    private final SecretKeySpec key;

    public MfaSecretCipher(IxAuthProperties properties) {
        String explicit = properties.getMfa().getEncryptionKey();
        boolean dedicated = explicit != null && !explicit.isBlank();
        this.key = deriveKey(dedicated ? explicit : properties.getServiceKey());

        if (dedicated) {
            log.info("2단계 인증 시크릿 암호화 — 전용 키 사용");
        } else {
            // 값은 남기지 않는다. 남기는 것은 '어느 쪽을 썼는가' 뿐이다
            log.info("2단계 인증 시크릿 암호화 — 전용 키가 없어 service-key 에서 파생했다. "
                    + "service-key 를 바꾸면 등록된 TOTP 가 전부 무효가 되므로, "
                    + "운영에서는 IXAUTH_MFA_ENCRYPTION_KEY 를 따로 준다.");
        }
    }

    public String encrypt(String plain) {
        try {
            byte[] iv = new byte[IV_BYTES];
            RANDOM.nextBytes(iv);

            var cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            byte[] sealed = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));

            // IV 는 비밀이 아니지만 매번 달라야 한다. 암호문 앞에 붙여 함께 보관한다
            byte[] packed = new byte[iv.length + sealed.length];
            System.arraycopy(iv, 0, packed, 0, iv.length);
            System.arraycopy(sealed, 0, packed, iv.length, sealed.length);
            return FORMAT_PREFIX + Base64.getEncoder().encodeToString(packed);
        } catch (Exception e) {
            // 예외 메시지에 평문 조각이 실릴 수 있어 원인을 그대로 올리지 않는다
            log.error("2단계 인증 시크릿 암호화 실패 — {}", e.getClass().getSimpleName());
            throw new ApiException(ErrorCode.INTERNAL);
        }
    }

    public String decrypt(String stored) {
        if (stored == null || !stored.startsWith(FORMAT_PREFIX)) {
            throw new ApiException(ErrorCode.INTERNAL, "저장된 인증 수단을 읽을 수 없습니다.");
        }
        try {
            byte[] packed = Base64.getDecoder().decode(stored.substring(FORMAT_PREFIX.length()));
            var spec = new GCMParameterSpec(TAG_BITS, packed, 0, IV_BYTES);

            var cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, spec);
            byte[] plain = cipher.doFinal(packed, IV_BYTES, packed.length - IV_BYTES);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception e) {
            // 대개 키가 바뀐 경우다(service-key 교체 등). 사용자에게는 원인을 말하지 않고
            // 운영자가 로그로 알 수 있게만 한다
            log.error("2단계 인증 시크릿 복호화 실패 — 암호화 키가 바뀌었을 수 있다 ({})",
                    e.getClass().getSimpleName());
            throw new ApiException(ErrorCode.INTERNAL, "저장된 인증 수단을 읽을 수 없습니다.");
        }
    }

    /**
     * 어떤 길이의 문자열이 오든 32바이트 AES 키로 맞춘다.
     *
     * <p>운영자가 넣은 값을 그대로 키로 쓰면 길이가 안 맞아 부팅이 깨진다. 그렇다고
     * 자르거나 채우면 실제 강도가 조용히 낮아진다.</p>
     */
    private static SecretKeySpec deriveKey(String material) {
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            digest.update(KEY_INFO.getBytes(StandardCharsets.UTF_8));
            return new SecretKeySpec(digest.digest(material.getBytes(StandardCharsets.UTF_8)),
                    "AES");
        } catch (Exception e) {
            throw new IllegalStateException("MFA 암호화 키를 만들 수 없습니다", e);
        }
    }
}
