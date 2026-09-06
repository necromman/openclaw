package team.prost.ixtrust.client.spi;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * IX-Trust OIDC 인증 시 전달되는 사용자 속성.
 * {@link SsoUserProvider#findOrCreateByOidc(OidcAttributes)} 에서 사용.
 *
 * <p>IX-Trust UserInfo / ID Token 에서 추출한 claim 을 SP 에 전달하는 불변 캐리어.
 * SP 는 이 값을 이용해 사용자 생성·갱신 + ssoId 동기화를 수행한다.
 *
 * @param userId       IX-Trust 사용자 고유 ID (user_id claim). null 이면 IX-Trust 가 미발급.
 * @param email        이메일 (email claim / sub fallback)
 * @param name         이름 (name claim)
 * @param orgId        조직 코드 (org_id claim). 없으면 null.
 * @param orgType      조직 유형 (org_type claim). 없으면 null.
 * @param roles        역할 코드 집합 (roles claim). 비어 있으면 {"USER"}.
 * @param department   부서명 (department claim). 없으면 null.
 * @param position     직급명 (position claim). 없으면 null.
 * @param phoneNumber  전화번호 (phone_number claim). 없으면 null.
 * @param employeeNumber 사원번호 (employee_number claim). 없으면 null.
 * @since 1.9.2
 */
public record OidcAttributes(
        String userId,
        String email,
        String name,
        String orgId,
        String orgType,
        Set<String> roles,
        String department,
        String position,
        String phoneNumber,
        String employeeNumber
) {
    public OidcAttributes {
        if (roles == null || roles.isEmpty()) {
            roles = Set.of("USER");
        }
    }

    /**
     * IX-Trust OIDC 프로필을 JSON 문자열로 직렬화.
     * SP entity 의 {@code oidcProfile} TEXT 컬럼에 저장해 refresh/me 에서 IX-Trust 데이터 서빙.
     * 외부 JSON 라이브러리 의존 없이 수동 직렬화.
     */
    public String toJson() {
        var m = new LinkedHashMap<String, Object>();
        putIfNotNull(m, "userId", userId);
        putIfNotNull(m, "email", email);
        putIfNotNull(m, "name", name);
        putIfNotNull(m, "orgId", orgId);
        putIfNotNull(m, "orgType", orgType);
        if (roles != null && !roles.isEmpty()) {
            m.put("roles", roles);
        }
        putIfNotNull(m, "department", department);
        putIfNotNull(m, "position", position);
        putIfNotNull(m, "phoneNumber", phoneNumber);
        putIfNotNull(m, "employeeNumber", employeeNumber);
        return mapToJson(m);
    }

    /**
     * 저장된 JSON 을 Map 으로 복원 — ExtraProvider 에서 extra 에 병합용.
     */
    public static Map<String, Object> parseJson(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        var result = new LinkedHashMap<String, Object>();
        String inner = json.strip();
        if (inner.startsWith("{")) {
            inner = inner.substring(1);
        }
        if (inner.endsWith("}")) {
            inner = inner.substring(0, inner.length() - 1);
        }
        for (String pair : splitJsonPairs(inner)) {
            String trimmed = pair.strip();
            int colon = trimmed.indexOf(':');
            if (colon < 0) {
                continue;
            }
            String key = unquote(trimmed.substring(0, colon).strip());
            String val = trimmed.substring(colon + 1).strip();
            if (val.startsWith("[")) {
                result.put(key, val);
            } else {
                result.put(key, unquote(val));
            }
        }
        return result;
    }

    private static void putIfNotNull(Map<String, Object> m, String k, String v) {
        if (v != null) {
            m.put(k, v);
        }
    }

    private static String mapToJson(Map<String, Object> m) {
        var sb = new StringBuilder("{");
        boolean first = true;
        for (var e : m.entrySet()) {
            if (!first) {
                sb.append(",");
            }
            first = false;
            sb.append("\"").append(e.getKey()).append("\":");
            Object v = e.getValue();
            if (v instanceof Set<?> set) {
                sb.append("[");
                boolean f2 = true;
                for (Object item : set) {
                    if (!f2) {
                        sb.append(",");
                    }
                    f2 = false;
                    sb.append("\"").append(item).append("\"");
                }
                sb.append("]");
            } else {
                sb.append("\"").append(v).append("\"");
            }
        }
        sb.append("}");
        return sb.toString();
    }

    private static java.util.List<String> splitJsonPairs(String s) {
        var result = new java.util.ArrayList<String>();
        int depth = 0;
        int start = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '[') {
                depth++;
            } else if (c == ']') {
                depth--;
            } else if (c == ',' && depth == 0) {
                result.add(s.substring(start, i));
                start = i + 1;
            }
        }
        if (start < s.length()) {
            result.add(s.substring(start));
        }
        return result;
    }

    private static String unquote(String s) {
        if (s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"")) {
            return s.substring(1, s.length() - 1);
        }
        return s;
    }
}
