package team.prost.ixauth.mfa;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * 백업 코드 — 휴대폰을 잃어버렸을 때의 유일한 출구.
 *
 * <p>TOTP 만 켜 두면 기기 분실이 곧 계정 상실이다. 관리자도 예외가 아니라서,
 * 관리자 한 명뿐인 설치에서는 <b>아무도 들어갈 수 없는 상태</b>가 된다.
 * 그래서 TOTP 를 켜는 순간 백업 코드를 함께 발급한다.</p>
 *
 * <p><b>평문은 발급 순간 한 번만</b> 보여 준다. DB 에는 SHA-256 해시만 남기므로
 * 다시 보여 줄 방법이 없다 — 그게 목적이다.</p>
 *
 * <p>bcrypt 가 아니라 SHA-256 인 이유: 코드는 사람이 정하는 비밀번호와 달리
 * 50비트 난수라 사전 공격의 대상이 아니다. 반대로 bcrypt 였다면 검증 한 번에
 * 남은 코드 수만큼(기본 10회) 느린 해시를 돌아야 해 로그인이 눈에 띄게 느려진다.</p>
 */
public final class BackupCodes {

    /**
     * 눈으로 옮겨 적는 값이라 헷갈리는 글자(I·O·0·1)를 뺐다. 남은 32글자.
     */
    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int CODE_LENGTH = 10;
    private static final int GROUP_SIZE = 5;
    private static final String SEPARATOR = "\n";

    private static final SecureRandom RANDOM = new SecureRandom();

    private BackupCodes() {
    }

    /** {@code ABCDE-FGHJK} 형태로 count 개. 되돌려 주는 것은 <b>평문</b>이다 */
    public static List<String> generate(int count) {
        var codes = new ArrayList<String>(count);
        for (int i = 0; i < count; i++) {
            var sb = new StringBuilder(CODE_LENGTH + 1);
            for (int c = 0; c < CODE_LENGTH; c++) {
                if (c > 0 && c % GROUP_SIZE == 0) {
                    sb.append('-');
                }
                sb.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
            }
            codes.add(sb.toString());
        }
        return List.copyOf(codes);
    }

    /** DB 에 들어갈 형태 — 해시를 줄바꿈으로 이어 둔다 */
    public static String store(List<String> plainCodes) {
        return plainCodes.stream().map(BackupCodes::hash)
                .reduce((a, b) -> a + SEPARATOR + b).orElse("");
    }

    public static int remaining(String stored) {
        return split(stored).size();
    }

    /**
     * 코드를 소모한다.
     *
     * @return 맞았으면 <b>그 코드를 뺀</b> 새 저장값. 틀렸으면 비어 있다
     */
    public static Optional<String> consume(String stored, String candidate) {
        if (candidate == null || candidate.isBlank()) {
            return Optional.empty();
        }
        String target = hash(candidate);
        var left = new ArrayList<String>();
        boolean matched = false;
        for (String saved : split(stored)) {
            // 이미 하나 맞았으면 나머지는 그대로 남긴다 (같은 해시가 둘일 이유는 없지만
            // 있더라도 한 번의 입력으로 두 개가 소모되면 안 된다)
            if (!matched && MessageDigest.isEqual(saved.getBytes(StandardCharsets.UTF_8),
                    target.getBytes(StandardCharsets.UTF_8))) {
                matched = true;
                continue;
            }
            left.add(saved);
        }
        if (!matched) {
            return Optional.empty();
        }
        return Optional.of(String.join(SEPARATOR, left));
    }

    private static List<String> split(String stored) {
        if (stored == null || stored.isBlank()) {
            return List.of();
        }
        return java.util.Arrays.stream(stored.split(SEPARATOR))
                .map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    /** 하이픈·공백·대소문자를 무시한다 — 사용자는 적어 둔 종이를 보고 친다 */
    private static String hash(String rawCode) {
        String normalized = rawCode.replace("-", "").replace(" ", "").toUpperCase(Locale.ROOT);
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(
                    digest.digest(normalized.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("백업 코드를 처리할 수 없습니다", e);
        }
    }
}
