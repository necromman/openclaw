package team.prost.ixauth.client;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import lombok.extern.slf4j.Slf4j;
import tools.jackson.databind.ObjectMapper;
import team.prost.ixauth.common.PermissionMatcher;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.concurrent.atomic.AtomicReference;

/**
 * IX-Auth 앱 측 클라이언트.
 *
 * <p>하는 일은 네 가지뿐이다:</p>
 * <ol>
 *   <li>로그인·갱신·로그아웃 중계</li>
 *   <li><b>JWKS 공개키로 토큰 로컬 검증</b> — 여기서 jar 를 부르지 않는다 (설계 불변식 2)</li>
 *   <li><b>L1 권한 로컬 판정</b> — permission-map 캐시</li>
 *   <li>L2 인스턴스 권한 조회 — 파일·문서처럼 빈도가 낮은 경로에만</li>
 * </ol>
 *
 * <p>jar 가 잠시 내려가도 ①④만 막히고, 이미 로그인한 사용자의 ②③은 그대로 동작한다.</p>
 */
@Slf4j
public class IxAuthClient {

    private final IxAuthClientProperties props;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5)).build();

    /** JWKS 캐시 — kid → 공개키 */
    private final AtomicReference<CachedJwks> jwks = new AtomicReference<>(null);
    /** 역할 → 권한 맵 + 버전 */
    private final AtomicReference<PermissionMap> permissionMap =
            new AtomicReference<>(new PermissionMap(0L, Map.of()));

    public IxAuthClient(IxAuthClientProperties props) {
        this(props, new ObjectMapper());
    }

    /** 앱이 자기 ObjectMapper 설정(날짜 형식 등)을 쓰게 하려면 이쪽 */
    public IxAuthClient(IxAuthClientProperties props, ObjectMapper mapper) {
        this.props = props;
        this.mapper = mapper;
    }

    private record CachedJwks(JWKSet set, Instant loadedAt) {
    }

    public record PermissionMap(long version, Map<String, List<String>> roles) {
    }

    public record LoginResult(String accessToken, String refreshToken, long expiresIn,
                              String userId, String email, String name,
                              List<String> roles, List<String> groups) {
    }

    public record ResourceVerdict(boolean allowed, String reason, String matchedKey) {
    }

    /** {@code truncated} 가 참이면 결과가 잘린 것 — 권한 없음과 구분해야 한다 */
    public record ResourceKeys(List<String> keys, boolean truncated) {
    }

    /** IX-Auth 에 닿지 못했을 때 — 앱은 이걸 503 으로 다루면 된다 */
    public static class IxAuthUnreachableException extends RuntimeException {
        public IxAuthUnreachableException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    // ────────────────────── 1) 인증 중계 ──────────────────────

    public LoginResult login(String email, String password, String ip, String userAgent) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("email", email);
        body.put("password", password);
        if (ip != null) {
            body.put("ip", ip);
        }
        if (userAgent != null) {
            body.put("userAgent", userAgent);
        }
        var data = post("/auth/login", toJson(body));

        @SuppressWarnings("unchecked")
        Map<String, Object> user = (Map<String, Object>) data.get("user");
        return new LoginResult(
                str(data.get("accessToken")), str(data.get("refreshToken")),
                num(data.get("expiresIn")),
                str(user.get("id")), str(user.get("email")), str(user.get("name")),
                strList(user.get("roles")), strList(user.get("groups")));
    }

    public LoginResult refresh(String refreshToken) {
        var data = post("/auth/refresh", toJson(Map.of("refreshToken", refreshToken)));
        return new LoginResult(str(data.get("accessToken")), str(data.get("refreshToken")),
                num(data.get("expiresIn")), null, null, null, List.of(), List.of());
    }

    public void logout(String refreshToken) {
        post("/auth/logout", toJson(Map.of("refreshToken", refreshToken)));
    }

    // ── 계정 라이프사이클 ──

    /**
     * 재설정 메일 요청. <b>계정이 없어도 성공한다</b> — 그것이 계약이다.
     *
     * <p>다르게 답하면 이 화면이 가입자 명부를 조회하는 도구가 된다.</p>
     */
    public void forgotPassword(String email) {
        post("/auth/password/forgot", toJson(Map.of("email", email)));
    }

    public void resetPassword(String token, String newPassword) {
        post("/auth/password/reset", toJson(Map.of("token", token, "newPassword", newPassword)));
    }

    /** access token 이 필요하다 — 서비스 키만으로는 남의 비밀번호를 바꿀 수 없다 */
    public void changePassword(String accessToken, String currentPassword, String newPassword) {
        authedPost("/auth/password/change", accessToken,
                toJson(Map.of("currentPassword", currentPassword, "newPassword", newPassword)));
    }

    public void requestEmailVerification(String email) {
        post("/auth/email/verify/request", toJson(Map.of("email", email)));
    }

    public void verifyEmail(String token) {
        post("/auth/email/verify", toJson(Map.of("token", token)));
    }

    public void changeEmail(String accessToken, String newEmail, String currentPassword) {
        authedPost("/auth/email/change", accessToken,
                toJson(Map.of("newEmail", newEmail, "currentPassword", currentPassword)));
    }

    public void acceptInvite(String token, String password, String name) {
        var body = new LinkedHashMap<String, Object>();
        body.put("token", token);
        body.put("password", password);
        if (name != null) {
            body.put("name", name);
        }
        post("/auth/invite/accept", toJson(body));
    }

    // ── 내 세션 ──

    public List<Map<String, Object>> listSessions(String accessToken) {
        var data = parseData(send(requestBuilder("/auth/sessions")
                .header("Authorization", "Bearer " + accessToken).GET().build()));
        Object items = data.get("items");
        if (!(items instanceof List<?> list)) {
            return List.of();
        }
        return list.stream().filter(Map.class::isInstance)
                .map(o -> asStringMap((Map<?, ?>) o)).toList();
    }

    public void revokeSession(String accessToken, String sessionId) {
        send(requestBuilder("/auth/sessions/" + enc(sessionId))
                .header("Authorization", "Bearer " + accessToken).DELETE().build());
    }

    public void revokeAllSessions(String accessToken) {
        send(requestBuilder("/auth/sessions")
                .header("Authorization", "Bearer " + accessToken).DELETE().build());
    }

    // ────────────── 2) 토큰 로컬 검증 (네트워크 없음) ──────────────

    /**
     * 토큰을 검증하고 클레임을 돌려준다.
     *
     * <p>JWKS 가 캐시돼 있으면 네트워크를 타지 않는다. 이것이 IX-Auth 가 앱의
     * 성능·가용성에 영향을 주지 않는 이유다.</p>
     */
    public JWTClaimsSet verify(String token) throws IxAuthTokenException {
        try {
            SignedJWT jwt = SignedJWT.parse(token);
            RSAKey key = keyFor(jwt.getHeader().getKeyID());
            if (key == null || !jwt.verify(new RSASSAVerifier(key.toRSAPublicKey()))) {
                throw new IxAuthTokenException("서명 검증 실패");
            }
            JWTClaimsSet claims = jwt.getJWTClaimsSet();

            Instant now = Instant.now();
            long skew = props.getClockSkew().toSeconds();
            if (claims.getExpirationTime() == null
                    || claims.getExpirationTime().toInstant().plusSeconds(skew).isBefore(now)) {
                throw new IxAuthTokenException("만료된 토큰");
            }
            if (!props.getIssuer().isBlank() && !props.getIssuer().equals(claims.getIssuer())) {
                throw new IxAuthTokenException("issuer 불일치");
            }
            String aud = props.effectiveAudience();
            if (!aud.isBlank() && (claims.getAudience() == null || !claims.getAudience().contains(aud))) {
                throw new IxAuthTokenException("audience 불일치");
            }
            return claims;
        } catch (IxAuthTokenException e) {
            throw e;
        } catch (Exception e) {
            throw new IxAuthTokenException("토큰을 해석할 수 없습니다");
        }
    }

    /** 토큰이 유효하지 않을 때. 앱은 401 로 다루면 된다 */
    public static class IxAuthTokenException extends Exception {
        public IxAuthTokenException(String message) {
            super(message);
        }
    }

    private RSAKey keyFor(String kid) {
        CachedJwks cached = jwks.get();
        boolean stale = cached == null
                || cached.loadedAt().plus(props.getJwksCache()).isBefore(Instant.now());

        if (!stale && cached.set().getKeyByKeyId(kid) != null) {
            return (RSAKey) cached.set().getKeyByKeyId(kid);
        }
        // 모르는 kid = 키가 회전됐을 수 있다. 한 번 다시 받는다 (계약 token.md §4)
        loadJwks();
        CachedJwks now = jwks.get();
        return now == null ? null : (RSAKey) now.set().getKeyByKeyId(kid);
    }

    private synchronized void loadJwks() {
        try {
            String body = get("/.well-known/jwks.json");
            jwks.set(new CachedJwks(JWKSet.parse(body), Instant.now()));
        } catch (Exception e) {
            log.warn("JWKS 를 받지 못했습니다 — {}", e.getMessage());
        }
    }

    // ────────────── 3) L1 권한 (로컬 판정) ──────────────

    public PermissionMap loadPermissionMap() {
        var data = getJson("/authz/permission-map");
        long version = num(data.get("version"));

        @SuppressWarnings("unchecked")
        Map<String, Object> raw = (Map<String, Object>) data.get("roles");
        Map<String, List<String>> roles = new LinkedHashMap<>();
        raw.forEach((k, v) -> roles.put(k, strList(v)));

        var map = new PermissionMap(version, roles);
        permissionMap.set(map);
        return map;
    }

    /** 토큰의 pv 가 캐시보다 크면 맵이 낡았다 — 폴링 없이 이 신호만으로 갱신 */
    public void refreshMapIfStale(JWTClaimsSet claims) {
        try {
            Object pv = claims.getClaim("ixauth_pv");
            if (pv instanceof Number n && n.longValue() > permissionMap.get().version()) {
                loadPermissionMap();
            }
        } catch (Exception e) {
            log.debug("permission-map 갱신 실패 — {}", e.getMessage());
        }
    }

    public boolean hasPermission(JWTClaimsSet claims, String requiredCode) {
        return PermissionMatcher.anyMatches(effectivePermissions(claims), requiredCode);
    }

    public List<String> effectivePermissions(JWTClaimsSet claims) {
        List<String> roles;
        try {
            roles = claims.getStringListClaim("ixauth_roles");
        } catch (Exception e) {
            return List.of();
        }
        if (roles == null || roles.isEmpty()) {
            return List.of();
        }
        var map = permissionMap.get().roles();
        var perms = new TreeSet<String>();
        roles.forEach(r -> perms.addAll(map.getOrDefault(r, List.of())));
        return List.copyOf(perms);
    }

    public long permissionMapVersion() {
        return permissionMap.get().version();
    }

    // ────────────── 4) L2 인스턴스 권한 (jar 조회) ──────────────

    public ResourceVerdict check(String userId, String resourceType, String resourceKey, String action) {
        var data = post("/authz/check", toJson(Map.of(
                "userId", userId, "resourceType", resourceType,
                "resourceKey", resourceKey, "action", action)));
        return toVerdict(data);
    }

    /**
     * jar 미도달 시의 동작까지 정한 판정.
     *
     * <p>{@code ixauth.client.resource-fallback} 이 {@code L1} 이면 L1 광역 권한으로
     * 대신 판정하고, 기본값 {@code DENY} 면 예외를 그대로 올린다(fail-secure).
     * Node·Python SDK 의 {@code fallback: 'deny' | 'l1'} 과 같은 규칙이다.</p>
     */
    public ResourceVerdict checkWithFallback(JWTClaimsSet claims, String resourceType,
                                             String resourceKey, String action) {
        try {
            return check(claims.getSubject(), resourceType, resourceKey, action);
        } catch (IxAuthUnreachableException e) {
            if (props.getResourceFallback() != IxAuthClientProperties.ResourceFallback.L1) {
                throw e;
            }
            // 경로 앞의 '/' 는 권한코드 문법에 없다 — file:/a/b:read 가 아니라 file:a/b:read
            String code = resourceType + ":" + stripLeadingSlash(resourceKey) + ":" + action;
            boolean allowed = hasPermission(claims, code);
            log.warn("IX-Auth 미도달 — L1 폴백 판정 {} = {}", code, allowed);
            return new ResourceVerdict(allowed, "L1_FALLBACK", null);
        }
    }

    /**
     * 목록 화면용 일괄 판정.
     *
     * <p>행마다 {@link #check} 를 부르면 N+1 이다. 목록에서는 반드시 이쪽을 쓴다.</p>
     */
    public List<ResourceVerdict> batchCheck(String userId, List<Map<String, String>> checks) {
        // 이 응답만 data 가 배열이다 — 요청 순서대로 온다
        String body = send(requestBuilder("/authz/batch-check")
                .POST(HttpRequest.BodyPublishers.ofString(
                        toJson(Map.of("userId", userId, "checks", checks))))
                .build());
        if (body == null || body.isBlank()) {
            return List.of();
        }
        Map<?, ?> root = mapper.readValue(body, Map.class);
        if (!(root.get("data") instanceof List<?> list)) {
            return List.of();
        }
        return list.stream()
                .filter(Map.class::isInstance)
                .map(o -> toVerdict(asStringMap((Map<?, ?>) o)))
                .toList();
    }

    /**
     * 허용된 리소스 키를 받아 온다 — 목록을 앱에서 필터링할 때.
     *
     * <p>{@code truncated} 가 참이면 <b>결과가 잘린 것</b>이지 권한이 없는 게 아니다.
     * 그대로 필터에 쓰면 있는 권한을 없다고 판정한다.</p>
     */
    public ResourceKeys listResources(String userId, String resourceType, String action) {
        var data = getJson("/authz/list-resources?userId=" + enc(userId)
                + "&resourceType=" + enc(resourceType) + "&action=" + enc(action));
        return new ResourceKeys(strList(data.get("keys")),
                Boolean.TRUE.equals(data.get("truncated")));
    }

    private ResourceVerdict toVerdict(Map<String, Object> data) {
        Object matched = data.get("matchedKey");
        return new ResourceVerdict(
                Boolean.TRUE.equals(data.get("allowed")),
                str(data.get("reason")),
                matched == null ? null : matched.toString());
    }

    private static String stripLeadingSlash(String key) {
        return key != null && key.startsWith("/") ? key.substring(1) : key;
    }

    private static String enc(String v) {
        return URLEncoder.encode(v == null ? "" : v, StandardCharsets.UTF_8);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asStringMap(Map<?, ?> m) {
        return (Map<String, Object>) m;
    }

    // ────────────────────── HTTP ──────────────────────

    private Map<String, Object> authedPost(String path, String accessToken, String json) {
        return parseData(send(requestBuilder(path)
                .header("Authorization", "Bearer " + accessToken)
                .POST(HttpRequest.BodyPublishers.ofString(json)).build()));
    }

    private Map<String, Object> post(String path, String json) {
        return parseData(send(requestBuilder(path)
                .POST(HttpRequest.BodyPublishers.ofString(json)).build()));
    }

    private Map<String, Object> getJson(String path) {
        return parseData(send(requestBuilder(path).GET().build()));
    }

    private String get(String path) {
        return send(requestBuilder(path).GET().build());
    }

    private HttpRequest.Builder requestBuilder(String path) {
        return HttpRequest.newBuilder(URI.create(props.getBaseUrl() + path))
                .header("Content-Type", "application/json")
                .header("X-IxAuth-Key", props.getServiceKey())
                .timeout(Duration.ofSeconds(10));
    }

    private String send(HttpRequest request) {
        try {
            HttpResponse<String> res = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() >= 400) {
                throw new IllegalStateException("IX-Auth 응답 " + res.statusCode() + ": " + res.body());
            }
            return res.body();
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IxAuthUnreachableException("IX-Auth 에 연결할 수 없습니다.", e);
        }
    }

    /** 계약상 성공 응답은 {"data": {...}} 로 감싸여 온다 (http-api.md §1) */
    @SuppressWarnings("unchecked")
    private Map<String, Object> parseData(String body) {
        if (body == null || body.isBlank()) {
            return Map.of();
        }
        Map<String, Object> root = mapper.readValue(body, Map.class);
        Object data = root.get("data");
        return data instanceof Map<?, ?> d ? (Map<String, Object>) d : root;
    }

    private String toJson(Map<String, ?> map) {
        return mapper.writeValueAsString(map);
    }

    private String str(Object o) {
        return o == null ? null : o.toString();
    }

    private long num(Object o) {
        return o instanceof Number n ? n.longValue() : 0L;
    }

    @SuppressWarnings("unchecked")
    private List<String> strList(Object o) {
        if (o instanceof List<?> l) {
            return l.stream().map(String::valueOf).toList();
        }
        return List.of();
    }
}
