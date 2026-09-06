package team.prost.ixauth;

import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 사용자 대리(impersonation) — 실제 PostgreSQL 에 붙여 계약 전 항목을 왕복 검증한다.
 *
 * <p>본 E2E({@code IxAuthE2ETest})와 파일을 나눈 이유 — 저쪽은 <b>기본값 그대로의 동작</b>을
 * 지키는 자리다. 이 흐름은 계정을 여럿 만들고 대상 계정을 비활성으로 바꾸므로, 한
 * 컨텍스트에 섞으면 그쪽 검사의 전제가 흐려진다.</p>
 *
 * <p>검증하는 것은 다섯 가지다: ① 대상 사용자의 토큰이 나온다 ② access token 에 표준
 * {@code act} 클레임이 실린다 ③ refresh 회전에도 {@code act} 가 살아남고 대리 창이
 * 늘어나지 않는다 ④ 대리 세션은 민감 작업을 하지 못한다 ⑤ 시작이 감사 로그에 남고
 * 세션이 관리 화면에 보이며 끊긴다.</p>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class ImpersonationE2ETest {

    private static final String SERVICE_KEY = "test-service-key-must-be-at-least-32-chars";
    private static final String ADMIN_EMAIL = "admin@example.com";
    private static final String ADMIN_PASSWORD = "Adm1n!Passw0rd";
    private static final String USER_PASSWORD = "Us3r!Passw0rd";
    private static final String ISSUER = "https://test.example.com";

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5)).build();

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @LocalServerPort
    int port;

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("ixauth.service-key", () -> SERVICE_KEY);
        registry.add("ixauth.jwt.issuer", () -> ISSUER);
        registry.add("ixauth.admin.email", () -> ADMIN_EMAIL);
        registry.add("ixauth.admin.password", () -> ADMIN_PASSWORD);

        // 한 IP(테스트 JVM)에서 수십 번 로그인한다 — 실사용 패턴이 아니다.
        // 끄지 않고 한도만 올린다. 꺼 버리면 필터가 깨져도 여기서 드러나지 않는다
        registry.add("ixauth.rate-limit.login-per-minute", () -> 10_000);
        registry.add("ixauth.rate-limit.refresh-per-minute", () -> 10_000);
        registry.add("ixauth.rate-limit.default-per-minute", () -> 10_000);
    }

    // ────────────────────────── ① 대상 사용자의 토큰 ──────────────────────────

    @Test
    @DisplayName("대리하면 대상 사용자의 토큰이 나오고 /auth/me 가 대상을 가리킨다")
    void issuesTargetTokens() {
        String adminToken = adminToken();
        var target = createUser();

        var res = post("/admin/users/" + target.id() + "/impersonate", null, adminToken, Map.of());
        assertThat(res.status()).isEqualTo(200);

        var data = res.body().get("data");
        assertThat(data.get("accessToken").asString()).isNotBlank();
        assertThat(data.get("refreshToken").asString()).isNotBlank();
        assertThat(data.get("expiresIn").asLong()).isPositive();
        assertThat(data.get("user").get("email").asString()).isEqualTo(target.email());
        assertThat(data.get("impersonator").get("email").asString()).isEqualTo(ADMIN_EMAIL);

        // 앱이 실제로 하는 일 — 받은 토큰으로 그 사람이 된다
        var me = get("/auth/me", SERVICE_KEY, data.get("accessToken").asString());
        assertThat(me.status()).isEqualTo(200);
        assertThat(me.body().get("data").get("email").asString()).isEqualTo(target.email());
    }

    // ────────────────────────── ② act 클레임 ──────────────────────────

    @Test
    @DisplayName("access token 에 표준 act 클레임이 실리고 JWKS 공개키로 검증된다")
    void carriesActClaim() throws Exception {
        String adminToken = adminToken();
        long adminId = Long.parseLong(
                get("/auth/me", SERVICE_KEY, adminToken).body().get("data").get("id").asString());
        var target = createUser();

        String token = post("/admin/users/" + target.id() + "/impersonate", null, adminToken,
                Map.of()).body().get("data").get("accessToken").asString();

        JWKSet jwks = JWKSet.parse(get("/.well-known/jwks.json", null, null).body().toString());
        SignedJWT jwt = SignedJWT.parse(token);
        RSAKey key = (RSAKey) jwks.getKeyByKeyId(jwt.getHeader().getKeyID());
        assertThat(jwt.verify(new RSASSAVerifier(key.toRSAPublicKey()))).isTrue();

        var claims = jwt.getJWTClaimsSet();
        assertThat(claims.getSubject())
                .as("sub 는 대리 대상이다 — 앱은 대상의 권한으로 동작해야 한다")
                .isEqualTo(String.valueOf(target.id()));

        var act = claims.getJSONObjectClaim("act");
        assertThat(act).as("대리 세션에는 act 가 있어야 한다").isNotNull();
        assertThat(act.get("sub")).isEqualTo(String.valueOf(adminId));
        assertThat(act.get("email")).isEqualTo(ADMIN_EMAIL);
    }

    @Test
    @DisplayName("평범한 로그인 토큰에는 act 가 없다 — 유무로 대리를 판단할 수 있어야 한다")
    void plainLoginHasNoAct() throws Exception {
        var claims = SignedJWT.parse(adminToken()).getJWTClaimsSet();
        assertThat(claims.getClaims()).doesNotContainKey("act");
    }

    // ────────────────────── ③ refresh 회전 ──────────────────────

    @Test
    @DisplayName("refresh 회전에도 act 가 유지되고 대리 창이 늘어나지 않는다")
    void refreshKeepsActWithoutExtendingWindow() throws Exception {
        String adminToken = adminToken();
        var target = createUser();

        var started = post("/admin/users/" + target.id() + "/impersonate", null, adminToken,
                Map.of()).body().get("data");
        String refreshToken = started.get("refreshToken").asString();

        var rotated = post("/auth/refresh", SERVICE_KEY, Map.of("refreshToken", refreshToken));
        assertThat(rotated.status()).isEqualTo(200);

        var claims = SignedJWT.parse(
                rotated.body().get("data").get("accessToken").asString()).getJWTClaimsSet();
        var act = claims.getJSONObjectClaim("act");
        assertThat(act).as("회전했다고 대리 사실이 사라지면 감사 추적이 끊긴다").isNotNull();
        assertThat(act.get("email")).isEqualTo(ADMIN_EMAIL);

        // 회전으로 만료가 늘어나면 ttl 이 '수명' 이 아니라 '유휴 시간' 이 된다.
        // 세션 목록의 만료 시각이 처음 것과 같아야 한다
        var sessions = get("/admin/users/" + target.id() + "/sessions", null, adminToken)
                .body().get("data");
        var expiries = impersonatedRows(sessions).stream()
                .map(s -> s.get("expiresAt").asString()).toList();
        assertThat(expiries).as("회전 전후 두 행의 만료가 같아야 한다").hasSize(2);
        assertThat(expiries.get(0)).isEqualTo(expiries.get(1));
    }

    // ────────────────────── ④ 민감 작업 차단 ──────────────────────

    @Test
    @DisplayName("대리 토큰으로는 관리 API·재대리·비밀번호 변경을 할 수 없다")
    void impersonatedSessionCannotDoSensitiveWork() {
        String adminToken = adminToken();
        var target = createUser();
        String impersonated = post("/admin/users/" + target.id() + "/impersonate", null,
                adminToken, Map.of()).body().get("data").get("accessToken").asString();

        // 관리 API — 대상이 관리 권한을 갖고 있지 않아도, 갖고 있어도 막힌다
        var admin = get("/admin/users", null, impersonated);
        assertThat(admin.status()).isEqualTo(403);
        assertThat(admin.body().get("error").get("code").asString())
                .isEqualTo("IMPERSONATION_ACTION_FORBIDDEN");

        // 재대리 — 대리 세션이 또 다른 사람으로 갈아타면 사슬을 되짚을 수 없다
        var again = post("/admin/users/" + target.id() + "/impersonate", null, impersonated,
                Map.of());
        assertThat(again.status()).isEqualTo(403);
        assertThat(again.body().get("error").get("code").asString())
                .isEqualTo("IMPERSONATION_ACTION_FORBIDDEN");

        // 비밀번호 변경 — 바꿔 버리면 본인이 못 들어온다
        var password = post("/auth/password/change", SERVICE_KEY, impersonated,
                Map.of("currentPassword", USER_PASSWORD, "newPassword", "N3w!Passw0rd!x"));
        assertThat(password.status()).isEqualTo(403);
        assertThat(password.body().get("error").get("code").asString())
                .isEqualTo("IMPERSONATION_ACTION_FORBIDDEN");

        // 탈퇴 — 되돌릴 수 없는 일이다
        var delete = post("/auth/account/delete", SERVICE_KEY, impersonated,
                Map.of("currentPassword", USER_PASSWORD));
        assertThat(delete.status()).isEqualTo(403);

        // 읽기는 막지 않는다 — 그게 대리의 목적이다
        assertThat(get("/auth/me", SERVICE_KEY, impersonated).status()).isEqualTo(200);
        assertThat(get("/auth/sessions", SERVICE_KEY, impersonated).status()).isEqualTo(200);
    }

    // ────────────────────── 제약 ──────────────────────

    @Test
    @DisplayName("자기 자신은 대리할 수 없다 (400) · 활성이 아닌 대상도 안 된다 (409)")
    void rejectsSelfAndInactiveTarget() {
        String adminToken = adminToken();
        long adminId = Long.parseLong(
                get("/auth/me", SERVICE_KEY, adminToken).body().get("data").get("id").asString());

        var self = post("/admin/users/" + adminId + "/impersonate", null, adminToken, Map.of());
        assertThat(self.status()).isEqualTo(400);
        assertThat(self.body().get("error").get("code").asString()).isEqualTo("IMPERSONATION_SELF");

        var target = createUser();
        assertThat(delete("/admin/users/" + target.id(), adminToken).status()).isEqualTo(204);

        var disabled = post("/admin/users/" + target.id() + "/impersonate", null, adminToken,
                Map.of());
        assertThat(disabled.status()).isEqualTo(409);
        assertThat(disabled.body().get("error").get("code").asString())
                .isEqualTo("IMPERSONATION_TARGET_NOT_ACTIVE");

        var missing = post("/admin/users/999999/impersonate", null, adminToken, Map.of());
        assertThat(missing.status()).isEqualTo(404);
    }

    @Test
    @DisplayName("전용 권한이 없으면 users:write 를 갖고 있어도 대리할 수 없다")
    void requiresDedicatedPermission() {
        String adminToken = adminToken();

        // ixauth:users:write 만 가진 역할 — 사용자를 고칠 수는 있어도 사용자가 될 수는 없다
        String roleCode = "USERADMIN_" + UUID.randomUUID().toString().substring(0, 8);
        var role = post("/admin/roles", null, adminToken,
                Map.of("code", roleCode, "name", "사용자 관리자"));
        assertThat(role.status()).isEqualTo(200);
        String roleId = role.body().get("data").get("id").asString();
        assertThat(put("/admin/roles/" + roleId + "/permissions", adminToken,
                Map.of("codes", List.of("ixauth:users:read", "ixauth:users:write")))
                .status()).isEqualTo(200);

        var operator = createUser(List.of(roleCode));
        var target = createUser();
        String operatorToken = loginToken(operator.email());

        var res = post("/admin/users/" + target.id() + "/impersonate", null, operatorToken,
                Map.of());
        assertThat(res.status()).isEqualTo(403);
        assertThat(res.body().get("error").get("code").asString())
                .as("전용 코드를 쓰지 않으면 users:write 하나로 남의 계정이 된다")
                .isEqualTo("AUTHZ_FORBIDDEN");
    }

    // ────────────────────── ⑤ 감사 로그 · 세션 관리 ──────────────────────

    @Test
    @DisplayName("시작은 감사 로그에 남고, 대리 세션은 관리 화면에 보이며 끊을 수 있다")
    void auditedAndRevocable() {
        String adminToken = adminToken();
        long adminId = Long.parseLong(
                get("/auth/me", SERVICE_KEY, adminToken).body().get("data").get("id").asString());
        var target = createUser();

        var data = post("/admin/users/" + target.id() + "/impersonate", null, adminToken,
                Map.of()).body().get("data");
        String impersonated = data.get("accessToken").asString();
        String refreshToken = data.get("refreshToken").asString();

        // 감사 로그 — userId 는 대상, actorId 는 관리자
        var audit = get("/admin/audit-logs?eventType=IMPERSONATION_STARTED&userId=" + target.id(),
                null, adminToken);
        assertThat(audit.status()).isEqualTo(200);
        var items = audit.body().get("data").get("items");
        assertThat(items.size()).isEqualTo(1);
        assertThat(items.get(0).get("actorId").asLong()).isEqualTo(adminId);
        assertThat(items.get(0).get("detail").get("targetEmail").asString())
                .isEqualTo(target.email());
        assertThat(items.get(0).get("ip").asString()).isNotBlank();

        // 세션 목록 — 일반 세션과 같은 자리에 보이되 대리임이 드러난다
        var sessions = get("/admin/users/" + target.id() + "/sessions", null, adminToken);
        var impersonatedRows = impersonatedRows(sessions.body().get("data"));
        assertThat(impersonatedRows).hasSize(1);
        assertThat(impersonatedRows.get(0).get("impersonatorEmail").asString())
                .isEqualTo(ADMIN_EMAIL);
        assertThat(impersonatedRows.get(0).get("active").asBoolean()).isTrue();

        // 해지 — 일반 세션과 같은 방법으로 끊긴다
        assertThat(delete("/admin/users/" + target.id() + "/sessions", adminToken).status())
                .isEqualTo(200);
        assertThat(post("/auth/refresh", SERVICE_KEY, Map.of("refreshToken", refreshToken))
                .status()).as("끊긴 뒤에는 회전도 되지 않는다").isEqualTo(401);
        // access token 은 만료 전까지 살아 있다(설계 불변식 2) — 세션 목록만 확인한다
        assertThat(impersonated).isNotBlank();
    }

    // ────────────────────────── 도우미 ──────────────────────────

    private record CreatedUser(String id, String email) {
    }

    /** 세션 목록에서 대리 행만 — Jackson 배열 순회를 한 곳에 모은다 */
    private static List<JsonNode> impersonatedRows(JsonNode sessions) {
        var rows = new java.util.ArrayList<JsonNode>();
        sessions.forEach(s -> {
            if (s.get("impersonated").asBoolean()) {
                rows.add(s);
            }
        });
        return rows;
    }

    private String adminToken() {
        return post("/auth/login", SERVICE_KEY,
                Map.of("email", ADMIN_EMAIL, "password", ADMIN_PASSWORD))
                .body().get("data").get("accessToken").asString();
    }

    private String loginToken(String email) {
        return post("/auth/login", SERVICE_KEY, Map.of("email", email, "password", USER_PASSWORD))
                .body().get("data").get("accessToken").asString();
    }

    private CreatedUser createUser() {
        return createUser(List.of("USER"));
    }

    private CreatedUser createUser(List<String> roles) {
        String email = "imp-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        var res = post("/admin/users", null, adminToken(), Map.of(
                "email", email, "name", "대상 사용자",
                "password", USER_PASSWORD, "roles", roles));
        assertThat(res.status()).as("사용자 생성 실패: " + res.body()).isEqualTo(200);
        return new CreatedUser(res.body().get("data").get("id").asString(), email);
    }

    private record Res(int status, JsonNode body) {
    }

    private Res get(String path, String svcKey, String bearer) {
        return send(builder(path, svcKey, bearer).GET());
    }

    private Res post(String path, String svcKey, Map<String, Object> body) {
        return post(path, svcKey, null, body);
    }

    private Res post(String path, String svcKey, String bearer, Map<String, Object> body) {
        return send(builder(path, svcKey, bearer)
                .POST(HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(body))));
    }

    private Res put(String path, String bearer, Map<String, Object> body) {
        return send(builder(path, null, bearer)
                .PUT(HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(body))));
    }

    private Res delete(String path, String bearer) {
        return send(builder(path, null, bearer).DELETE());
    }

    private HttpRequest.Builder builder(String path, String svcKey, String bearer) {
        var b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(15));
        if (svcKey != null) {
            b.header("X-IxAuth-Key", svcKey);
        }
        if (bearer != null) {
            b.header("Authorization", "Bearer " + bearer);
        }
        return b;
    }

    private Res send(HttpRequest.Builder builder) {
        try {
            HttpResponse<String> raw =
                    CLIENT.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            JsonNode node = (raw.body() == null || raw.body().isBlank())
                    ? MAPPER.createObjectNode()
                    : MAPPER.readTree(raw.body());
            return new Res(raw.statusCode(), node);
        } catch (Exception e) {
            throw new IllegalStateException("요청 실패", e);
        }
    }
}
