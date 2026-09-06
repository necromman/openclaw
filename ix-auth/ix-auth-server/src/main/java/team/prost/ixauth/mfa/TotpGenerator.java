package team.prost.ixauth.mfa;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Locale;
import java.util.OptionalLong;

/**
 * RFC 6238 TOTP (HMAC-SHA1 · 30초 · 6자리).
 *
 * <p><b>왜 직접 짰는가.</b> "암호 알고리즘을 직접 구현하지 않는다"(rules/coding-style.md
 * 보안 규칙 1)는 여전히 유효하다 — 여기서 직접 만든 것은 없다. HMAC-SHA1 은 JDK 의
 * {@link Mac} 이 하고, 이 클래스가 하는 일은 RFC 6238 이 정한 <b>자르는 규칙</b>
 * (dynamic truncation) 뿐이다. 그 규칙은 20줄이고, RFC 가 표준 테스트 벡터를 함께
 * 주므로 맞는지 틀리는지가 테스트로 확정된다({@code TotpGeneratorTest}).
 * 이것 하나 때문에 폐쇄망 배포 대상에 외부 의존성을 하나 더 얹지 않는다.</p>
 *
 * <p>파라미터(30초·6자리·SHA1)는 <b>설정으로 빼지 않는다.</b> 고객사마다 다를 수 있는
 * 정책이 아니라, 인증 앱과 맞아야 하는 규격이다. 바꾸면 대부분의 앱이 코드를 못 만든다.</p>
 */
public final class TotpGenerator {

    /** RFC 6238 기본 스텝(X). 인증 앱이 전부 이 값을 전제한다 */
    public static final int STEP_SECONDS = 30;

    private static final int DIGITS = 6;
    private static final String HMAC_ALGORITHM = "HmacSHA1";

    private TotpGenerator() {
    }

    public static long stepAt(Instant when) {
        return when.getEpochSecond() / STEP_SECONDS;
    }

    /** 이 스텝의 6자리 코드 */
    public static String code(byte[] secret, long step) {
        return code(secret, step, DIGITS);
    }

    /**
     * 자릿수를 지정한다 — <b>RFC 6238 테스트 벡터가 8자리</b>라서 열어 둔 통로다.
     * 운영 경로는 {@link #code(byte[], long)} 를 쓴다.
     */
    static String code(byte[] secret, long step, int digits) {
        byte[] hash = hmac(secret, ByteBuffer.allocate(Long.BYTES).putLong(step).array());

        // RFC 4226 §5.4 dynamic truncation — 마지막 바이트의 하위 4비트가 시작 위치다
        int offset = hash[hash.length - 1] & 0x0f;
        int binary = ((hash[offset] & 0x7f) << 24)
                | ((hash[offset + 1] & 0xff) << 16)
                | ((hash[offset + 2] & 0xff) << 8)
                | (hash[offset + 3] & 0xff);

        int modulo = 1;
        for (int i = 0; i < digits; i++) {
            modulo *= 10;
        }
        return String.format(Locale.ROOT, "%0" + digits + "d", binary % modulo);
    }

    /**
     * 앞뒤 {@code window} 스텝까지 허용하며 검증한다.
     *
     * <p>허용하지 않으면 휴대폰 시계가 몇 초만 어긋나도 로그인이 안 된다. 반대로 넓히면
     * 훔쳐본 코드가 오래 살아 있으므로 ±1(=±30초) 이 관행이다.</p>
     *
     * <p><b>일치한 스텝을 돌려주는 이유</b> — 호출자가 그 값을 저장해 두고 다음번에
     * "그보다 큰 스텝만" 받아야 같은 코드의 재사용을 막을 수 있다. 참/거짓만 돌려주면
     * 재사용 방지를 만들 수 없다.</p>
     */
    public static OptionalLong verify(byte[] secret, String candidate, long currentStep,
                                      int window) {
        if (candidate == null) {
            return OptionalLong.empty();
        }
        String cleaned = candidate.replace(" ", "").replace("-", "");
        if (cleaned.length() != DIGITS) {
            return OptionalLong.empty();
        }
        for (long step = currentStep - window; step <= currentStep + window; step++) {
            // 문자열 equals 는 첫 불일치에서 끝나 시간차가 새어나간다
            if (constantTimeEquals(code(secret, step), cleaned)) {
                return OptionalLong.of(step);
            }
        }
        return OptionalLong.empty();
    }

    /**
     * {@code otpauth://totp/…} — 인증 앱이 읽는 등록 문자열.
     *
     * <p>QR 이미지는 만들지 않는다. jar 는 화면을 만들지 않으므로(설계 불변식 1)
     * 이 문자열만 주고 그림은 앱이 그린다.</p>
     */
    public static String otpauthUri(String issuer, String accountName, String base32Secret) {
        String label = encode(issuer) + ":" + encode(accountName);
        return "otpauth://totp/" + label
                + "?secret=" + base32Secret
                + "&issuer=" + encode(issuer)
                + "&algorithm=SHA1&digits=" + DIGITS + "&period=" + STEP_SECONDS;
    }

    private static String encode(String raw) {
        return java.net.URLEncoder.encode(raw, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private static boolean constantTimeEquals(String a, String b) {
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8),
                b.getBytes(StandardCharsets.UTF_8));
    }

    private static byte[] hmac(byte[] secret, byte[] message) {
        try {
            var mac = Mac.getInstance(HMAC_ALGORITHM);
            mac.init(new SecretKeySpec(secret, HMAC_ALGORITHM));
            return mac.doFinal(message);
        } catch (GeneralSecurityException e) {
            // JDK 에 HmacSHA1 이 없는 상황은 없다. 있다면 부팅부터 잘못된 것이다
            throw new IllegalStateException("TOTP 코드를 계산할 수 없습니다", e);
        }
    }
}
