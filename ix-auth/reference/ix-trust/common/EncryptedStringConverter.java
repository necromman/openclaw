package team.prost.ixtrust.security;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/**
 * JPA AttributeConverter — entity field 의 DB ↔ Java 자동 암호화/복호화.
 *
 * <p>모듈 의존 분리 위해 Holder 패턴 — ix-trust-core 의 Converter 는 Spring 의존 X.
 * ix-trust-api 의 Registrar 가 부팅 시 {@link CryptoProvider} 구현체를 등록 (SettingEncryptor wrapping).
 *
 * <p>{@code @Convert(converter = EncryptedStringConverter.class)} 부착한 entity field 에서:
 * <ul>
 *   <li>write (entity → DB): {@link CryptoProvider#encrypt(String)} → {@code {enc}<hex>}</li>
 *   <li>read (DB → entity): {@link CryptoProvider#decrypt(String)} → 평문</li>
 * </ul>
 *
 * <p>Registrar 미설치 (provider==null) 또는 fallback 모드 시 no-op (평문 그대로).
 */
@Converter
public class EncryptedStringConverter implements AttributeConverter<String, String> {

    /** Encryptor provider 인터페이스 — Spring 모듈 (ix-trust-api) 에서 SettingEncryptor 구현체 등록. */
    public interface CryptoProvider {
        String encrypt(String plaintext);
        String decrypt(String stored);
    }

    private static volatile CryptoProvider provider;

    /** 부팅 시 Registrar Bean 이 호출 — Spring 모듈에서 SettingEncryptor wrapping 후 register. */
    public static void register(CryptoProvider p) {
        provider = p;
    }

    @Override
    public String convertToDatabaseColumn(String plaintext) {
        if (plaintext == null || plaintext.isEmpty()) {
            return plaintext;
        }
        return provider != null ? provider.encrypt(plaintext) : plaintext;
    }

    @Override
    public String convertToEntityAttribute(String stored) {
        if (stored == null || stored.isEmpty()) {
            return stored;
        }
        return provider != null ? provider.decrypt(stored) : stored;
    }
}
