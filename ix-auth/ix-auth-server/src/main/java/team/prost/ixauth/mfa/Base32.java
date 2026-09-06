package team.prost.ixauth.mfa;

import java.util.Locale;

/**
 * RFC 4648 Base32 — TOTP 시크릿 표기.
 *
 * <p>인증 앱(Google Authenticator·1Password 등)이 {@code otpauth://} URI 의
 * {@code secret} 을 이 표기로 읽는다. Base64 가 아니라 Base32 인 것은 규격이 그렇게
 * 정했기 때문이고, 사용자가 손으로 옮겨 적을 수 있어야 해서이기도 하다
 * (대소문자 구분 없음, {@code +} · {@code /} 같은 글자가 없음).</p>
 *
 * <p>JDK 에 Base32 가 없어 여기서 처리한다. 인코딩일 뿐 암호가 아니므로
 * "암호 알고리즘을 직접 구현하지 않는다"(rules/coding-style.md) 에 해당하지 않는다.</p>
 */
public final class Base32 {

    private static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private static final int BITS_PER_CHAR = 5;
    private static final int BYTE_BITS = 8;

    private Base32() {
    }

    /** 패딩({@code =})을 붙이지 않는다 — 인증 앱이 없어도 읽는다 */
    public static String encode(byte[] data) {
        var out = new StringBuilder();
        int buffer = 0;
        int bits = 0;
        for (byte b : data) {
            buffer = (buffer << BYTE_BITS) | (b & 0xff);
            bits += BYTE_BITS;
            while (bits >= BITS_PER_CHAR) {
                bits -= BITS_PER_CHAR;
                out.append(ALPHABET.charAt((buffer >>> bits) & 0x1f));
            }
        }
        if (bits > 0) {
            out.append(ALPHABET.charAt((buffer << (BITS_PER_CHAR - bits)) & 0x1f));
        }
        return out.toString();
    }

    /**
     * 공백·하이픈·패딩·소문자를 모두 받아 준다.
     *
     * <p>사용자가 화면의 시크릿을 손으로 옮겨 적는 경우가 있어서다. 규격에 엄격하게
     * 굴어 봐야 "맞게 적었는데 안 된다" 는 문의만 늘어난다.</p>
     */
    public static byte[] decode(String encoded) {
        if (encoded == null) {
            throw new IllegalArgumentException("Base32 문자열이 비었습니다");
        }
        String cleaned = encoded.replace("=", "").replace(" ", "").replace("-", "")
                .toUpperCase(Locale.ROOT);
        var out = new java.io.ByteArrayOutputStream(cleaned.length() * BITS_PER_CHAR / BYTE_BITS + 1);

        int buffer = 0;
        int bits = 0;
        for (int i = 0; i < cleaned.length(); i++) {
            int value = ALPHABET.indexOf(cleaned.charAt(i));
            if (value < 0) {
                throw new IllegalArgumentException("Base32 가 아닌 문자가 있습니다");
            }
            buffer = (buffer << BITS_PER_CHAR) | value;
            bits += BITS_PER_CHAR;
            if (bits >= BYTE_BITS) {
                bits -= BYTE_BITS;
                out.write((buffer >>> bits) & 0xff);
            }
        }
        return out.toByteArray();
    }
}
