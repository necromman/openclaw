package team.prost.ixauth.mfa;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.config.IxAuthProperties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * TOTP 시크릿이 평문으로 저장되지 않는가, 그리고 변조를 알아채는가.
 *
 * <p>시크릿은 사용자가 바꾸지 않으므로 유출돼도 오래 드러나지 않는다. DB 백업 한 부가
 * 조직 전원의 2단계를 무력화하는 것을 막는 것이 이 클래스의 존재 이유다.</p>
 */
class MfaSecretCipherTest {

    private static final String SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

    private MfaSecretCipher cipherWith(String dedicatedKey) {
        var props = new IxAuthProperties();
        props.setServiceKey("test-service-key-must-be-at-least-32-chars");
        props.getMfa().setEncryptionKey(dedicatedKey);
        return new MfaSecretCipher(props);
    }

    @Test
    @DisplayName("암호화한 값을 다시 풀면 원본이다")
    void roundTrips() {
        var cipher = cipherWith("");
        assertThat(cipher.decrypt(cipher.encrypt(SECRET))).isEqualTo(SECRET);
    }

    @Test
    @DisplayName("저장값에 시크릿이 그대로 보이지 않는다")
    void storedValueHidesSecret() {
        String stored = cipherWith("").encrypt(SECRET);

        assertThat(stored).doesNotContain(SECRET);
        assertThat(stored).startsWith("v1:");
    }

    @Test
    @DisplayName("같은 값을 두 번 넣어도 저장값이 다르다 — IV 가 매번 새로 나온다")
    void usesFreshIv() {
        var cipher = cipherWith("");
        assertThat(cipher.encrypt(SECRET)).isNotEqualTo(cipher.encrypt(SECRET));
    }

    @Test
    @DisplayName("암호문이 한 글자라도 바뀌면 복호화가 실패한다 (GCM 변조 탐지)")
    void detectsTampering() {
        var cipher = cipherWith("");
        String stored = cipher.encrypt(SECRET);

        char last = stored.charAt(stored.length() - 1);
        String tampered = stored.substring(0, stored.length() - 1) + (last == 'A' ? 'B' : 'A');

        assertThatThrownBy(() -> cipher.decrypt(tampered)).isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("키가 다르면 남의 시크릿을 풀 수 없다")
    void keyIsolates() {
        String stored = cipherWith("dedicated-key-one").encrypt(SECRET);

        assertThatThrownBy(() -> cipherWith("dedicated-key-two").decrypt(stored))
                .isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("전용 키가 없으면 service-key 에서 파생한다 — 설정 없이도 평문이 되지 않는다")
    void derivesFromServiceKeyWhenUnset() {
        var cipher = cipherWith("");
        String stored = cipher.encrypt(SECRET);

        assertThat(cipher.decrypt(stored)).isEqualTo(SECRET);
        assertThat(stored).doesNotContain(SECRET);
    }

    @Test
    @DisplayName("형식이 아닌 값은 조용히 통과시키지 않는다")
    void rejectsForeignFormat() {
        var cipher = cipherWith("");

        assertThatThrownBy(() -> cipher.decrypt(SECRET)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> cipher.decrypt(null)).isInstanceOf(ApiException.class);
    }
}
