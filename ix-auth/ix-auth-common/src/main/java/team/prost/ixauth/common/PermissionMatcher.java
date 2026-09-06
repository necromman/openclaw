package team.prost.ixauth.common;

import java.util.Collection;

/**
 * 권한 코드 매칭 — {@code <domain>:<resource>:<action>}.
 *
 * <p>계약 정본은 {@code docs/contract/authz.md} §2. <b>서버와 앱 측 SDK 가 같은 규칙을
 * 써야 하므로 이 클래스는 공용 모듈에 둔다.</b> 규칙이 갈리면 "화면에는 보이는데 API 는 403"
 * 같은 일이 난다.</p>
 *
 * <p>JS/TS 판({@code @ix-auth/client-node}, {@code @ix-auth/client-react})도 같은 규칙이다.
 * 계약을 바꿀 때 함께 고친다.</p>
 *
 * <pre>
 * page:*:view            → page:admin.users:view        ✅
 * page:admin.*:view      → page:admin.users:view        ✅
 * page:admin.*:view      → page:admin.users.detail:view ❌ ('*' 는 한 단계)
 * page:admin.**:view     → page:admin.users.detail:view ✅
 * file:contracts/**:download → file:contracts/2026/a.pdf:download ✅
 * *:*:*                  → 무엇이든                      ✅
 * </pre>
 */
public final class PermissionMatcher {

    /** 세그먼트 구분자는 '.' 과 '/' 둘 다 */
    private static final String SEGMENT_SPLIT = "[./]";
    private static final String ANY = "*";
    private static final String ANY_DEEP = "**";

    private PermissionMatcher() {
    }

    /** 부여된 권한 중 하나라도 요청 코드를 덮으면 허용 */
    public static boolean anyMatches(Collection<String> granted, String required) {
        if (granted == null || granted.isEmpty()) {
            return false;
        }
        return granted.stream().anyMatch(g -> matches(g, required));
    }

    /**
     * 패턴이 요청 코드를 덮는가.
     *
     * @throws IllegalArgumentException 코드가 3파트가 아닐 때.
     *         호출자(서버)가 계약 에러코드로 감싼다.
     */
    public static boolean matches(String pattern, String required) {
        String[] p = split(pattern);
        String[] r = split(required);
        for (int i = 0; i < 3; i++) {
            if (!partMatches(p[i], r[i])) {
                return false;
            }
        }
        return true;
    }

    /**
     * 코드 문법 검증. 등록 시 호출한다.
     *
     * <p>{@code **} 가 중간에 오는 패턴({@code a.**.c})은 매칭 복잡도 대비 실익이 없어
     * 지원하지 않는다 (계약 §8).</p>
     */
    public static void validateCode(String code) {
        for (String part : split(code)) {
            String[] segs = part.split(SEGMENT_SPLIT, -1);
            for (int i = 0; i < segs.length; i++) {
                if (segs[i].isEmpty()) {
                    throw new IllegalArgumentException("빈 세그먼트가 있습니다: " + code);
                }
                if (ANY_DEEP.equals(segs[i]) && i != segs.length - 1) {
                    throw new IllegalArgumentException(
                            "'**' 는 마지막 세그먼트에만 올 수 있습니다: " + code);
                }
            }
        }
    }

    private static String[] split(String code) {
        if (code == null) {
            throw new IllegalArgumentException("권한 코드가 비었습니다.");
        }
        String[] parts = code.split(":", -1);
        if (parts.length != 3) {
            throw new IllegalArgumentException(
                    "권한 코드는 '<domain>:<resource>:<action>' 3파트여야 합니다: " + code);
        }
        return parts;
    }

    private static boolean partMatches(String pattern, String value) {
        if (ANY.equals(pattern) || ANY_DEEP.equals(pattern)) {
            return true;
        }
        String[] p = pattern.split(SEGMENT_SPLIT, -1);
        String[] v = value.split(SEGMENT_SPLIT, -1);

        for (int i = 0; i < p.length; i++) {
            if (ANY_DEEP.equals(p[i])) {
                // 남은 값 세그먼트를 전부 덮는다 — 단 최소 1개는 있어야 한다
                return v.length > i;
            }
            if (i >= v.length) {
                return false;
            }
            if (!ANY.equals(p[i]) && !p[i].equals(v[i])) {
                return false;
            }
        }
        // 패턴을 다 썼는데 값이 남으면 불일치 (page:admin.* vs page:admin.users.detail)
        return p.length == v.length;
    }
}
