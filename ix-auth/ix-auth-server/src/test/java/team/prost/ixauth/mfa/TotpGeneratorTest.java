package team.prost.ixauth.mfa;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.nio.charset.StandardCharsets;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * TOTP 구현이 RFC 6238 과 같은 값을 내는지 고정한다.
 *
 * <p>직접 짠 코드라서 <b>이 테스트가 유일한 근거다.</b> 여기가 통과하지 않으면
 * 사용자의 인증 앱과 코드가 어긋나고, 그 증상은 "가끔 안 된다" 로 나타나 원인을
 * 찾기가 매우 어렵다.</p>
 */
class TotpGeneratorTest {

    /** RFC 6238 Appendix B 의 SHA-1 시드 — ASCII "12345678901234567890" */
    private static final byte[] RFC_SEED =
            "12345678901234567890".getBytes(StandardCharsets.US_ASCII);

    @ParameterizedTest(name = "T={0}s → {1}")
    @DisplayName("RFC 6238 표준 테스트 벡터와 일치한다 (SHA-1 · 8자리)")
    @CsvSource({
            "59,            94287082",
            "1111111109,    07081804",
            "1111111111,    14050471",
            "1234567890,    89005924",
            "2000000000,    69279037",
            "20000000000,   65353130"
    })
    void matchesRfc6238Vectors(long epochSeconds, String expected) {
        long step = TotpGenerator.stepAt(Instant.ofEpochSecond(epochSeconds));
        assertThat(TotpGenerator.code(RFC_SEED, step, 8)).isEqualTo(expected);
    }

    @ParameterizedTest(name = "counter={0} → {1}")
    @DisplayName("RFC 4226 HOTP 벡터와도 일치한다 — 운영 경로인 6자리 확인")
    @CsvSource({
            "0, 755224", "1, 287082", "2, 359152", "3, 969429", "4, 338314",
            "5, 254676", "6, 287922", "7, 162583", "8, 399871", "9, 520489"
    })
    void matchesRfc4226Vectors(long counter, String expected) {
        assertThat(TotpGenerator.code(RFC_SEED, counter)).isEqualTo(expected);
    }

    @Test
    @DisplayName("30초가 1스텝이다")
    void stepIsThirtySeconds() {
        assertThat(TotpGenerator.stepAt(Instant.ofEpochSecond(0))).isZero();
        assertThat(TotpGenerator.stepAt(Instant.ofEpochSecond(29))).isZero();
        assertThat(TotpGenerator.stepAt(Instant.ofEpochSecond(30))).isEqualTo(1);
        assertThat(TotpGenerator.stepAt(Instant.ofEpochSecond(59))).isEqualTo(1);
    }

    // ────────────────────── 시계 오차 허용 ──────────────────────

    @Test
    @DisplayName("앞뒤 1스텝(±30초)까지는 받아 준다 — 휴대폰 시계가 조금 어긋나도 들어온다")
    void acceptsOneStepDrift() {
        long now = 1_000_000L;

        assertThat(TotpGenerator.verify(RFC_SEED, TotpGenerator.code(RFC_SEED, now), now, 1))
                .hasValue(now);
        assertThat(TotpGenerator.verify(RFC_SEED, TotpGenerator.code(RFC_SEED, now - 1), now, 1))
                .as("직전 코드 — 사용자가 막 넘어간 코드를 입력한 경우").hasValue(now - 1);
        assertThat(TotpGenerator.verify(RFC_SEED, TotpGenerator.code(RFC_SEED, now + 1), now, 1))
                .as("다음 코드 — 휴대폰이 조금 빠른 경우").hasValue(now + 1);
    }

    @Test
    @DisplayName("2스텝(60초) 넘게 어긋난 코드는 거부한다")
    void rejectsTwoStepDrift() {
        long now = 1_000_000L;
        assertThat(TotpGenerator.verify(RFC_SEED, TotpGenerator.code(RFC_SEED, now - 2), now, 1))
                .isEmpty();
        assertThat(TotpGenerator.verify(RFC_SEED, TotpGenerator.code(RFC_SEED, now + 2), now, 1))
                .isEmpty();
    }

    @Test
    @DisplayName("일치한 스텝을 돌려준다 — 호출자가 이 값으로 재사용을 막는다")
    void reportsMatchedStep() {
        long now = 1_000_000L;
        var matched = TotpGenerator.verify(RFC_SEED, TotpGenerator.code(RFC_SEED, now - 1), now, 1);

        assertThat(matched).hasValue(now - 1);
        assertThat(matched.getAsLong()).isLessThan(now);
    }

    @Test
    @DisplayName("자릿수가 다르거나 비었으면 거부한다")
    void rejectsMalformedInput() {
        long now = 1_000_000L;
        assertThat(TotpGenerator.verify(RFC_SEED, null, now, 1)).isEmpty();
        assertThat(TotpGenerator.verify(RFC_SEED, "", now, 1)).isEmpty();
        assertThat(TotpGenerator.verify(RFC_SEED, "12345", now, 1)).isEmpty();
        assertThat(TotpGenerator.verify(RFC_SEED, "1234567", now, 1)).isEmpty();
        assertThat(TotpGenerator.verify(RFC_SEED, "000000", now, 1))
                .as("아무 6자리나 통하면 안 된다").isEmpty();
    }

    @Test
    @DisplayName("공백·하이픈이 섞여도 읽는다 — 사용자가 화면에 보이는 대로 친다")
    void toleratesFormatting() {
        long now = 1_000_000L;
        String code = TotpGenerator.code(RFC_SEED, now);
        String spaced = code.substring(0, 3) + " " + code.substring(3);

        assertThat(TotpGenerator.verify(RFC_SEED, spaced, now, 1)).hasValue(now);
    }

    // ────────────────────── 등록 URI ──────────────────────

    @Test
    @DisplayName("otpauth URI 에 규격 파라미터가 모두 들어간다")
    void buildsOtpauthUri() {
        String uri = TotpGenerator.otpauthUri("IX-Auth", "chris@prost.team", "JBSWY3DPEHPK3PXP");

        assertThat(uri).startsWith("otpauth://totp/");
        assertThat(uri).contains("secret=JBSWY3DPEHPK3PXP");
        assertThat(uri).contains("issuer=IX-Auth");
        assertThat(uri).contains("algorithm=SHA1").contains("digits=6").contains("period=30");
        assertThat(uri).as("라벨의 @ 는 인코딩돼야 앱이 잘못 자르지 않는다")
                .contains("chris%40prost.team");
    }

    @Test
    @DisplayName("Base32 는 왕복해도 같은 바이트다 — 인증 앱이 읽는 표기")
    void base32RoundTrips() {
        assertThat(Base32.decode(Base32.encode(RFC_SEED))).isEqualTo(RFC_SEED);
        // 소문자·하이픈·패딩을 섞어도 같은 값이어야 한다 (손으로 옮겨 적는 경우)
        String encoded = Base32.encode(RFC_SEED);
        String messy = encoded.toLowerCase(java.util.Locale.ROOT).replaceAll("(.{4})", "$1-");
        assertThat(Base32.decode(messy)).isEqualTo(RFC_SEED);
    }

    @Test
    @DisplayName("Base32 로 만든 시크릿으로도 같은 코드가 나온다 — 저장·복원 경로 확인")
    void survivesBase32Trip() {
        byte[] restored = Base32.decode(Base32.encode(RFC_SEED));
        assertThat(TotpGenerator.code(restored, 1L)).isEqualTo(TotpGenerator.code(RFC_SEED, 1L));
    }
}
