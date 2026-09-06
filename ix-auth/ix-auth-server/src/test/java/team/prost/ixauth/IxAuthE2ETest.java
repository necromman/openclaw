package team.prost.ixauth;

import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import team.prost.ixauth.mfa.Base32;
import team.prost.ixauth.mfa.TotpGenerator;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * E2E — 실제 PostgreSQL 에 붙여 부팅부터 권한 판정까지 왕복 검증한다.
 *
 * <p>핵심은 <b>앱이 JWKS 공개키만으로 토큰을 로컬 검증할 수 있는가</b>다.
 * 이게 되지 않으면 설계 불변식 2(매 요청 jar 호출 금지)가 성립하지 않는다.</p>
 *
 * <p>HTTP 는 JDK 내장 클라이언트를 쓴다 — 상태 코드와 본문을 가공 없이 그대로 본다.</p>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class IxAuthE2ETest {

    private static final String SERVICE_KEY = "test-service-key-must-be-at-least-32-chars";
    private static final String ADMIN_EMAIL = "admin@example.com";
    private static final String ADMIN_PASSWORD = "Adm1n!Passw0rd";

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
        registry.add("ixauth.jwt.issuer", () -> "https://test.example.com");
        registry.add("ixauth.admin.email", () -> ADMIN_EMAIL);
        registry.add("ixauth.admin.password", () -> ADMIN_PASSWORD);

        // 이 테스트는 한 IP(테스트 JVM)에서 수십 번 로그인한다 — 실사용 패턴이 아니다.
        // 필터를 끄지 않고 한도만 올린다. 꺼 버리면 필터가 깨져도 여기서 드러나지 않는다.
        registry.add("ixauth.rate-limit.login-per-minute", () -> 10_000);
        registry.add("ixauth.rate-limit.refresh-per-minute", () -> 10_000);
        registry.add("ixauth.rate-limit.default-per-minute", () -> 10_000);
        // 재발송 쿨다운도 마찬가지 — 연속 시나리오가 서로를 막지 않게 한다
        registry.add("ixauth.account.resend-cooldown", () -> "0s");
    }

    private record Res(int status, JsonNode body, HttpHeadersView headers) {
    }

    private record HttpHeadersView(HttpResponse<String> raw) {
        String get(String name) {
            return raw.headers().firstValue(name).orElse(null);
        }
    }

    // ────────────────────────── 부팅 · 자동 구성 ──────────────────────────

    @Test
    @Order(1)
    @DisplayName("부팅하면 스키마가 자동 생성되고 헬스체크가 UP 이다")
    void bootstrapsSchema() {
        var res = get("/health", null, null);
        assertThat(res.status()).isEqualTo(200);
        assertThat(res.body().get("status").asString()).isEqualTo("UP");
        assertThat(res.body().get("migration").asString()).isEqualTo("OK");
    }

    @Test
    @Order(2)
    @DisplayName("초기 관리자가 자동 생성돼 바로 로그인된다 — SQL 을 손으로 돌릴 필요가 없다")
    void adminSeeded() {
        var body = login(ADMIN_EMAIL, ADMIN_PASSWORD);
        assertThat(body.get("accessToken").asString()).isNotBlank();
        assertThat(body.get("user").get("roles").toString()).contains("ADMIN");
    }

    // ────────────────────── 설계 불변식 2: 앱 로컬 검증 ──────────────────────

    @Test
    @Order(3)
    @DisplayName("JWKS 공개키만으로 토큰이 검증된다 — 앱이 jar 없이 판정할 수 있다")
    void appCanVerifyTokenLocally() throws Exception {
        String token = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();

        // 앱이 하는 일을 그대로 흉내낸다: JWKS 를 받아 서명을 자체 검증
        var jwksRes = get("/.well-known/jwks.json", null, null);
        assertThat(jwksRes.status()).isEqualTo(200);
        JWKSet jwks = JWKSet.parse(jwksRes.body().toString());

        SignedJWT jwt = SignedJWT.parse(token);
        RSAKey key = (RSAKey) jwks.getKeyByKeyId(jwt.getHeader().getKeyID());
        assertThat(key).as("토큰의 kid 가 JWKS 에 있어야 한다").isNotNull();
        assertThat(jwt.verify(new RSASSAVerifier(key.toRSAPublicKey())))
                .as("공개키만으로 서명이 검증돼야 한다").isTrue();

        var claims = jwt.getJWTClaimsSet();
        assertThat(claims.getIssuer()).isEqualTo("https://test.example.com");
        assertThat(claims.getStringListClaim("ixauth_roles")).contains("ADMIN");
        assertThat(claims.getClaim("ixauth_pv"))
                .as("permissions_version 이 실려야 앱이 캐시 무효화를 판단한다").isNotNull();
        assertThat(claims.getClaims())
                .as("권한 목록은 토큰에 담지 않는다 — 역할만").doesNotContainKey("ixauth_permissions");
    }

    // ────────────────────────── 보안 규칙 ──────────────────────────

    @Test
    @Order(4)
    @DisplayName("로그인 실패는 계정 존재 여부를 구분하지 않는다")
    void loginFailureDoesNotLeakAccountExistence() {
        var noAccount = post("/auth/login", serviceKey(),
                Map.of("email", "nobody@example.com", "password", "Whatever!A1"));
        var wrongPassword = post("/auth/login", serviceKey(),
                Map.of("email", ADMIN_EMAIL, "password", "WrongPass!123"));

        assertThat(noAccount.status()).isEqualTo(401);
        assertThat(wrongPassword.status()).isEqualTo(401);

        String codeA = noAccount.body().get("error").get("code").asString();
        String codeB = wrongPassword.body().get("error").get("code").asString();
        assertThat(codeA).isEqualTo("AUTH_INVALID_CREDENTIALS");
        assertThat(codeB).as("두 응답이 구분되면 계정 존재가 새어나간다").isEqualTo(codeA);
    }

    @Test
    @Order(5)
    @DisplayName("서비스 키 없이는 인증 API 를 쓸 수 없다")
    void requiresServiceKey() {
        var res = post("/auth/login", null,
                Map.of("email", ADMIN_EMAIL, "password", ADMIN_PASSWORD));
        assertThat(res.status()).isEqualTo(401);
    }

    @Test
    @Order(6)
    @DisplayName("응답에 스택트레이스나 내부 경로가 실리지 않는다")
    void errorsDoNotLeakInternals() {
        var res = post("/auth/login", serviceKey(),
                Map.of("email", "not-an-email", "password", "x"));
        assertThat(res.status()).isEqualTo(400);
        String raw = res.body().toString();
        assertThat(raw).doesNotContain("team.prost.ixauth", "Exception", "jdbc");
        assertThat(res.body().get("error").get("traceId").asString()).isNotBlank();
    }

    // ────────────────────── refresh 회전 · 재사용 감지 ──────────────────────

    @Test
    @Order(7)
    @DisplayName("refresh 는 회전하고, 옛 토큰을 다시 쓰면 전 세션이 끊긴다")
    void refreshRotatesAndDetectsReuse() {
        var loggedIn = login(ADMIN_EMAIL, ADMIN_PASSWORD);
        String oldRefresh = loggedIn.get("refreshToken").asString();

        var refreshed = post("/auth/refresh", serviceKey(), Map.of("refreshToken", oldRefresh));
        assertThat(refreshed.status()).isEqualTo(200);
        String newRefresh = refreshed.body().get("data").get("refreshToken").asString();
        assertThat(newRefresh).as("회전 — 새 refresh 가 발급돼야 한다").isNotEqualTo(oldRefresh);

        // 옛 토큰 재사용 = 탈취 신호
        var reused = post("/auth/refresh", serviceKey(), Map.of("refreshToken", oldRefresh));
        assertThat(reused.status()).isEqualTo(401);
        assertThat(reused.body().get("error").get("code").asString()).isEqualTo("AUTH_SESSION_REVOKED");

        // 재사용이 감지되면 그 사용자의 모든 세션이 끊긴다 — 방금 받은 새 refresh 도 무효
        var afterPurge = post("/auth/refresh", serviceKey(), Map.of("refreshToken", newRefresh));
        assertThat(afterPurge.status()).isEqualTo(401);
    }

    // ────────────────────────── L1 인가 ──────────────────────────

    @Test
    @Order(8)
    @DisplayName("permission-map 으로 앱이 역할→권한을 캐싱할 수 있다")
    void permissionMapIsCacheable() {
        var res = get("/authz/permission-map", serviceKey(), null);
        assertThat(res.status()).isEqualTo(200);

        var data = res.body().get("data");
        assertThat(data.get("version").asLong()).isPositive();
        assertThat(data.get("roles").get("ADMIN").toString()).contains("ixauth:*:*");
        assertThat(res.headers().get("Cache-Control")).contains("max-age");
        assertThat(res.headers().get("X-IxAuth-Pv")).isNotBlank();
    }

    @Test
    @Order(9)
    @DisplayName("관리 API 는 토큰이 있어야 열린다")
    void adminApiRequiresAuth() {
        String token = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();

        var withToken = get("/admin/users", null, token);
        assertThat(withToken.status()).isEqualTo(200);
        assertThat(withToken.body().get("data").get("items").isArray()).isTrue();

        assertThat(get("/admin/users", null, null).status()).isEqualTo(401);
    }

    @Test
    @Order(10)
    @DisplayName("그룹 경유 역할이 토큰 클레임에 합쳐진다")
    void groupRolesMergeIntoToken() throws Exception {
        String adminToken = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();

        ok(post("/admin/roles", null, adminToken, Map.of("code", "PM", "name", "PM")));
        ok(post("/admin/groups", null, adminToken, Map.of("code", "dev", "name", "개발팀")));

        long groupId = get("/admin/groups", null, adminToken)
                .body().get("data").get(0).get("id").asLong();
        ok(put("/admin/groups/" + groupId + "/roles", adminToken, Map.of("codes", List.of("PM"))));

        // 직접 역할이 없고 그룹에만 속한 사용자
        ok(post("/admin/users", null, adminToken, Map.of(
                "email", "member@example.com", "name", "멤버",
                "password", "Memb3r!Pass", "roles", List.of())));
        long userId = get("/admin/users?q=member@example.com", null, adminToken)
                .body().get("data").get("items").get(0).get("id").asLong();
        ok(post("/admin/groups/" + groupId + "/members", null, adminToken, Map.of("userId", userId)));

        var claims = SignedJWT.parse(
                login("member@example.com", "Memb3r!Pass").get("accessToken").asString())
                .getJWTClaimsSet();

        assertThat(claims.getStringListClaim("ixauth_roles"))
                .as("앱이 그룹→역할 매핑을 몰라도 되도록 jar 가 합쳐서 담는다").contains("PM");
        assertThat(claims.getStringListClaim("ixauth_groups")).contains("dev");
    }

    @Test
    @Order(11)
    @DisplayName("권한을 바꾸면 permissions_version 이 올라간다")
    void permissionsVersionBumps() throws Exception {
        String adminToken = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        long before = get("/authz/permission-map", serviceKey(), null)
                .body().get("data").get("version").asLong();

        Thread.sleep(1100);   // 버전 단위가 초라 경계를 넘긴다

        ok(post("/admin/permissions", null, adminToken,
                Map.of("code", "page:reports:view", "description", "리포트 조회")));

        long pmId = -1;
        for (JsonNode r : get("/admin/roles", null, adminToken).body().get("data")) {
            if ("PM".equals(r.get("code").asString())) {
                pmId = r.get("id").asLong();
            }
        }
        assertThat(pmId).isPositive();
        ok(put("/admin/roles/" + pmId + "/permissions", adminToken,
                Map.of("codes", List.of("page:reports:view"))));

        long after = get("/authz/permission-map", serviceKey(), null)
                .body().get("data").get("version").asLong();
        assertThat(after).as("앱이 캐시를 무효화하려면 버전이 올라가야 한다").isGreaterThan(before);

        // 새로 로그인하면 토큰의 pv 도 따라 올라간다
        var claims = SignedJWT.parse(login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString())
                .getJWTClaimsSet();
        assertThat(((Number) claims.getClaim("ixauth_pv")).longValue()).isEqualTo(after);
    }

    @Test
    @Order(12)
    @DisplayName("등록되지 않은 권한 코드는 부여할 수 없다 (사전 등록제)")
    void unknownPermissionRejected() {
        String adminToken = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        long pmId = -1;
        for (JsonNode r : get("/admin/roles", null, adminToken).body().get("data")) {
            if ("PM".equals(r.get("code").asString())) {
                pmId = r.get("id").asLong();
            }
        }
        var res = put("/admin/roles/" + pmId + "/permissions", adminToken,
                Map.of("codes", List.of("page:nope.not.registered:view")));
        assertThat(res.status()).isEqualTo(400);
        assertThat(res.body().get("error").get("code").asString())
                .isEqualTo("AUTHZ_UNKNOWN_PERMISSION");
    }

    // ────────────────────────── 계정 잠금 ──────────────────────────

    @Test
    @Order(13)
    @DisplayName("연속 실패하면 잠기고, 잠금은 비밀번호가 맞았을 때만 알려준다")
    void lockoutAfterRepeatedFailures() {
        String adminToken = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        ok(post("/admin/users", null, adminToken, Map.of(
                "email", "lock@example.com", "name", "잠금대상",
                "password", "L0ck!Target9", "roles", List.of())));

        for (int i = 0; i < 5; i++) {
            var fail = post("/auth/login", serviceKey(),
                    Map.of("email", "lock@example.com", "password", "Wr0ng!Pass"));
            assertThat(fail.body().get("error").get("code").asString())
                    .as("잠기는 도중에도 이유를 구분하지 않는다")
                    .isEqualTo("AUTH_INVALID_CREDENTIALS");
        }

        // 올바른 비밀번호로 시도해야 비로소 잠금 사실을 알려준다
        var locked = post("/auth/login", serviceKey(),
                Map.of("email", "lock@example.com", "password", "L0ck!Target9"));
        assertThat(locked.status()).isEqualTo(423);
        assertThat(locked.body().get("error").get("code").asString()).isEqualTo("AUTH_ACCOUNT_LOCKED");

        // 관리자가 해제하면 다시 로그인된다
        long userId = get("/admin/users?q=lock@example.com", null, adminToken)
                .body().get("data").get("items").get(0).get("id").asLong();
        ok(post("/admin/users/" + userId + "/unlock", null, adminToken, Map.of()));
        assertThat(post("/auth/login", serviceKey(),
                Map.of("email", "lock@example.com", "password", "L0ck!Target9")).status())
                .isEqualTo(200);
    }

    // ────────────────────── L2 인스턴스 권한 ──────────────────────

    @Test
    @Order(15)
    @DisplayName("폴더에 준 권한이 하위 파일로 상속된다")
    void folderGrantCascades() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        long uid = userId(admin, ADMIN_EMAIL);

        // 상속 전 — 막혀 있다
        assertThat(check(uid, "file", "/contracts/2026/a.pdf", "download").get("allowed").asBoolean())
                .isFalse();

        ok(post("/admin/resource-grants", null, admin, Map.of(
                "subjectType", "USER", "subjectId", uid,
                "resourceType", "file", "resourceKey", "/contracts/",
                "action", "download", "effect", "ALLOW")));

        var d = check(uid, "file", "/contracts/2026/a.pdf", "download");
        assertThat(d.get("allowed").asBoolean()).as("상위 폴더 권한이 하위 파일에 먹어야 한다").isTrue();
        assertThat(d.get("reason").asString()).isEqualTo("GRANT_ALLOW");
        assertThat(d.get("matchedKey").asString()).isEqualTo("/contracts/");
    }

    @Test
    @Order(16)
    @DisplayName("DENY 는 상속된 ALLOW 를 이긴다 — 상속 거리와 무관하게 최종")
    void denyBeatsInheritedAllow() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        long uid = userId(admin, ADMIN_EMAIL);

        ok(post("/admin/resource-grants", null, admin, Map.of(
                "subjectType", "USER", "subjectId", uid,
                "resourceType", "file", "resourceKey", "/contracts/secret/",
                "action", "download", "effect", "DENY")));

        var denied = check(uid, "file", "/contracts/secret/x.pdf", "download");
        assertThat(denied.get("allowed").asBoolean()).isFalse();
        assertThat(denied.get("reason").asString()).isEqualTo("GRANT_DENY");

        // 형제 경로는 영향이 없다 — prefix 조회였다면 여기서 샜을 것
        assertThat(check(uid, "file", "/contracts/2026/a.pdf", "download").get("allowed").asBoolean())
                .as("DENY 는 그 하위에만 적용된다").isTrue();
    }

    @Test
    @Order(17)
    @DisplayName("액션이 다르면 적용되지 않는다")
    void actionScoped() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        long uid = userId(admin, ADMIN_EMAIL);
        assertThat(check(uid, "file", "/contracts/2026/a.pdf", "delete").get("allowed").asBoolean())
                .as("download 권한이 delete 를 열어주면 안 된다").isFalse();
    }

    @Test
    @Order(18)
    @DisplayName("만료된 권한은 무시된다")
    void expiredGrantIgnored() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        long uid = userId(admin, ADMIN_EMAIL);

        ok(post("/admin/resource-grants", null, admin, Map.of(
                "subjectType", "USER", "subjectId", uid,
                "resourceType", "file", "resourceKey", "/expired/e.pdf",
                "action", "read", "effect", "ALLOW",
                "expiresAt", "2020-01-01T00:00:00Z")));

        assertThat(check(uid, "file", "/expired/e.pdf", "read").get("allowed").asBoolean())
                .as("만료된 grant 로 열리면 안 된다").isFalse();
    }

    @Test
    @Order(19)
    @DisplayName("grant 가 없으면 L1 권한으로 폴백한다")
    void fallsBackToL1() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        long uid = userId(admin, ADMIN_EMAIL);

        // ADMIN 은 ixauth:*:* 를 갖는다 → ixauth 도메인 리소스는 L1 폴백으로 열린다
        var d = check(uid, "ixauth", "users", "read");
        assertThat(d.get("allowed").asBoolean()).isTrue();
        assertThat(d.get("reason").asString()).isEqualTo("L1_FALLBACK");
    }

    @Test
    @Order(20)
    @DisplayName("batch-check 로 여러 건을 한 번에 판정한다 (목록 화면 N+1 방지)")
    void batchCheckWorks() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        long uid = userId(admin, ADMIN_EMAIL);

        var res = post("/authz/batch-check", serviceKey(), Map.of(
                "userId", uid,
                "checks", List.of(
                        Map.of("resourceType", "file", "resourceKey", "/contracts/2026/a.pdf", "action", "download"),
                        Map.of("resourceType", "file", "resourceKey", "/contracts/secret/x.pdf", "action", "download"),
                        Map.of("resourceType", "file", "resourceKey", "/nowhere/z.pdf", "action", "download"))));

        assertThat(res.status()).isEqualTo(200);
        var items = res.body().get("data");
        assertThat(items.get(0).get("allowed").asBoolean()).isTrue();    // 상속
        assertThat(items.get(1).get("allowed").asBoolean()).isFalse();   // DENY
        assertThat(items.get(2).get("allowed").asBoolean()).isFalse();   // 매칭 없음
    }

    @Test
    @Order(21)
    @DisplayName("list-resources 는 DENY 로 막힌 키를 빼고 돌려준다")
    void listResourcesExcludesDenied() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        long uid = userId(admin, ADMIN_EMAIL);

        var res = get("/authz/list-resources?userId=" + uid + "&resourceType=file&action=download",
                serviceKey(), null);
        assertThat(res.status()).isEqualTo(200);

        var keys = res.body().get("data").get("keys").toString();
        assertThat(keys).contains("/contracts/");
        assertThat(keys).as("DENY 키는 목록에서 빠져야 한다").doesNotContain("/contracts/secret/");
    }

    @Test
    @Order(22)
    @DisplayName("batch-check 상한을 넘기면 거부한다")
    void batchCheckLimit() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        long uid = userId(admin, ADMIN_EMAIL);

        var many = new java.util.ArrayList<Map<String, Object>>();
        for (int i = 0; i < 101; i++) {
            many.add(Map.of("resourceType", "file", "resourceKey", "/x/" + i, "action", "read"));
        }
        var res = post("/authz/batch-check", serviceKey(), Map.of("userId", uid, "checks", many));
        assertThat(res.status()).isEqualTo(400);
        assertThat(res.body().get("error").get("code").asString()).isEqualTo("AUTHZ_BATCH_TOO_LARGE");
    }

    // ────────────────────────── 감사 로그 ──────────────────────────

    @Test
    @Order(23)
    @DisplayName("주요 이벤트가 감사 로그에 남는다")
    void auditLogRecordsKeyEvents() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        var logs = get("/admin/audit-logs?size=100", null, admin).body().get("data").get("items");

        var types = new java.util.HashSet<String>();
        for (JsonNode a : logs) {
            types.add(a.get("eventType").asString());
        }
        assertThat(types).contains(
                "LOGIN_SUCCESS",        // 로그인
                "LOGIN_FAILURE",        // 실패 시도
                "ACCOUNT_LOCKED",       // 잠금
                "USER_CREATED",         // 사용자 생성
                "PERMISSION_CHANGED");  // 권한·역할·grant 변경
    }

    @Test
    @Order(24)
    @DisplayName("감사 로그에 비밀번호·토큰이 절대 남지 않는다")
    void auditLogNeverLeaksSecrets() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        String raw = get("/admin/audit-logs?size=100", null, admin).body().toString();

        assertThat(raw).doesNotContain(ADMIN_PASSWORD);
        assertThat(raw).doesNotContain("Memb3r!Pass", "L0ck!Target9", "Wr0ng!Pass");
        assertThat(raw).doesNotContain(SERVICE_KEY);
        assertThat(raw).as("JWT 조각이 실리면 안 된다").doesNotContain("eyJ");
        // 실패 로그의 이메일은 마스킹된다
        assertThat(raw).contains("n***@example.com");
    }

    @Test
    @Order(25)
    @DisplayName("감사 로그는 이벤트 타입으로 필터된다")
    void auditLogFilters() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        var res = get("/admin/audit-logs?eventType=LOGIN_SUCCESS&size=20", null, admin);

        assertThat(res.status()).isEqualTo(200);
        var items = res.body().get("data").get("items");
        assertThat(items.size()).isPositive();
        for (JsonNode a : items) {
            assertThat(a.get("eventType").asString()).isEqualTo("LOGIN_SUCCESS");
        }
    }

    @Test
    @Order(26)
    @DisplayName("감사 로그에는 수정·삭제 엔드포인트가 없다 (append-only)")
    void auditLogIsAppendOnly() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        // 존재하지 않는 경로여야 한다 — 405/404 중 무엇이든 2xx 가 아니면 된다
        var del = send(builder("/admin/audit-logs/1", null, admin).DELETE());
        assertThat(del.status()).as("삭제가 열려 있으면 append-only 가 아니다")
                .matches(s -> s < 200 || s > 299);
    }

    // ────────────────────────── 관리 화면 ──────────────────────────

    @Test
    @Order(14)
    @DisplayName("관리 화면이 jar 안에서 서빙된다")
    void adminUiIsBundled() {
        var raw = rawGet("/admin-ui", null, null);
        assertThat(raw.statusCode()).isEqualTo(200);
        assertThat(raw.body()).contains("IX-Auth");
    }

    // ────────────────────────── 2단계 인증 (TOTP) ──────────────────────────

    private static final String MFA_EMAIL = "mfa@example.com";
    private static final String MFA_PASSWORD = "Mfa!Passw0rd1";

    /** 등록 응답에서만 볼 수 있는 값들 — 뒤 시나리오가 이어서 쓴다 */
    private static byte[] mfaSecret;
    private static List<String> mfaBackupCodes;

    @Test
    @Order(27)
    @DisplayName("등록하면 otpauth URI 와 백업 코드를 받고, 아직 켜지지는 않는다")
    void mfaSetupIssuesUriAndBackupCodes() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        ok(post("/admin/users", null, admin, Map.of(
                "email", MFA_EMAIL, "name", "2단계", "password", MFA_PASSWORD,
                "roles", List.of())));

        String token = login(MFA_EMAIL, MFA_PASSWORD).get("accessToken").asString();
        var res = post("/auth/mfa/totp/setup", null, token, Map.of());
        assertThat(res.status()).as("등록 실패: %s", res.body()).isEqualTo(200);

        var data = res.body().get("data");
        String uri = data.get("otpauthUri").asString();
        assertThat(uri).startsWith("otpauth://totp/");
        assertThat(uri).contains("digits=6").contains("period=30");

        var codes = new java.util.ArrayList<String>();
        data.get("backupCodes").forEach(c -> codes.add(c.asString()));
        assertThat(codes).as("휴대폰을 잃어버렸을 때의 유일한 출구다").hasSize(10);

        mfaSecret = Base32.decode(uri.split("secret=")[1].split("&")[0]);
        mfaBackupCodes = List.copyOf(codes);

        var status = get("/auth/mfa/status", null, token).body().get("data");
        assertThat(status.get("enabled").asBoolean()).as("확인 전에는 켜진 것이 아니다").isFalse();
        assertThat(status.get("pendingConfirm").asBoolean()).isTrue();
    }

    @Test
    @Order(28)
    @DisplayName("확인하기 전에는 로그인이 그대로다 — 잘못 스캔해도 계정에서 잠기지 않는다")
    void mfaNotEnforcedBeforeConfirm() {
        assertThat(post("/auth/login", serviceKey(),
                Map.of("email", MFA_EMAIL, "password", MFA_PASSWORD)).status()).isEqualTo(200);
    }

    @Test
    @Order(29)
    @DisplayName("코드를 확인하면 켜지고, 그 뒤 로그인은 토큰 대신 challenge 를 준다")
    void mfaConfirmEnablesAndLoginChallenges() {
        String token = login(MFA_EMAIL, MFA_PASSWORD).get("accessToken").asString();

        var confirmed = post("/auth/mfa/totp/confirm", null, token,
                Map.of("code", codeAt(0)));
        assertThat(confirmed.status()).as("확인 실패: %s", confirmed.body()).isEqualTo(200);
        assertThat(confirmed.body().get("data").get("enabled").asBoolean()).isTrue();
        assertThat(confirmed.body().get("data").get("backupCodesRemaining").asInt()).isEqualTo(10);

        var res = post("/auth/login", serviceKey(),
                Map.of("email", MFA_EMAIL, "password", MFA_PASSWORD));
        assertThat(res.status()).isEqualTo(401);
        assertThat(res.body().get("error").get("code").asString()).isEqualTo("AUTH_MFA_REQUIRED");
        assertThat(res.body().get("error").get("meta").get("challenge").asString())
                .as("앱이 다음 단계를 부르려면 challenge 가 있어야 한다").isNotBlank();
        assertThat(res.body().toString()).as("토큰이 여기서 나가면 2단계가 무의미하다")
                .doesNotContain("accessToken");
    }

    @Test
    @Order(30)
    @DisplayName("challenge 와 코드를 함께 내면 최종 토큰이 나온다")
    void mfaVerifyIssuesTokens() {
        // 확인 때 쓴 스텝은 이미 소모됐다 — 다음 스텝의 코드를 쓴다(허용 범위 ±1 안이다)
        var res = post("/auth/mfa/verify", serviceKey(),
                Map.of("challenge", challengeForMfaUser(), "code", codeAt(1)));

        assertThat(res.status()).as("2단계 실패: %s", res.body()).isEqualTo(200);
        assertThat(res.body().get("data").get("accessToken").asString()).isNotBlank();
        assertThat(res.body().get("data").get("user").get("email").asString())
                .isEqualTo(MFA_EMAIL);
    }

    @Test
    @Order(31)
    @DisplayName("방금 쓴 코드를 다시 내면 거부한다 — 같은 30초 창에서 두 번 통하지 않는다")
    void mfaRejectsReusedCode() {
        var res = post("/auth/mfa/verify", serviceKey(),
                Map.of("challenge", challengeForMfaUser(), "code", codeAt(1)));

        assertThat(res.status()).isEqualTo(401);
        assertThat(res.body().get("error").get("code").asString()).isEqualTo("AUTH_MFA_INVALID");
    }

    @Test
    @Order(32)
    @DisplayName("백업 코드로도 들어갈 수 있고, 그 코드는 소모된다")
    void mfaBackupCodeWorksOnce() {
        String used = mfaBackupCodes.get(0);

        var res = post("/auth/mfa/verify", serviceKey(),
                Map.of("challenge", challengeForMfaUser(), "code", used));
        assertThat(res.status()).as("백업 코드 실패: %s", res.body()).isEqualTo(200);

        String token = res.body().get("data").get("accessToken").asString();
        assertThat(get("/auth/mfa/status", null, token).body().get("data")
                .get("backupCodesRemaining").asInt()).isEqualTo(9);

        var again = post("/auth/mfa/verify", serviceKey(),
                Map.of("challenge", challengeForMfaUser(), "code", used));
        assertThat(again.status()).as("한 번 쓴 백업 코드가 다시 통하면 안 된다").isEqualTo(401);
    }

    @Test
    @Order(33)
    @DisplayName("해제는 현재 비밀번호를 요구하고, 해제하면 비밀번호만으로 다시 로그인된다")
    void mfaDisableRequiresPassword() {
        String token = post("/auth/mfa/verify", serviceKey(),
                Map.of("challenge", challengeForMfaUser(), "code", mfaBackupCodes.get(1)))
                .body().get("data").get("accessToken").asString();

        var wrong = delete("/auth/mfa/totp", token, Map.of("currentPassword", "Wr0ng!Pass"));
        assertThat(wrong.status()).as("비밀번호 없이 끌 수 있으면 이 기능이 있을 이유가 없다")
                .isEqualTo(401);

        assertThat(delete("/auth/mfa/totp", token, Map.of("currentPassword", MFA_PASSWORD))
                .status()).isEqualTo(200);
        assertThat(post("/auth/login", serviceKey(),
                Map.of("email", MFA_EMAIL, "password", MFA_PASSWORD)).status()).isEqualTo(200);
    }

    @Test
    @Order(34)
    @DisplayName("시크릿과 백업 코드는 감사 로그에 남지 않는다")
    void mfaSecretsNeverReachAuditLog() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        String raw = get("/admin/audit-logs?size=200", null, admin).body().toString();

        assertThat(raw).doesNotContain(Base32.encode(mfaSecret));
        for (String code : mfaBackupCodes) {
            assertThat(raw).doesNotContain(code);
        }
        assertThat(raw).contains("MFA_ENABLED", "MFA_VERIFIED", "MFA_DISABLED");
    }

    /** 지금 스텝 + offset 의 코드. 확인·검증에서 서로 다른 스텝을 써야 재사용 검사에 걸리지 않는다 */
    private String codeAt(int offset) {
        return TotpGenerator.code(mfaSecret, TotpGenerator.stepAt(Instant.now()) + offset);
    }

    /** 로그인해서 challenge 만 받아 온다 */
    private String challengeForMfaUser() {
        var res = post("/auth/login", serviceKey(),
                Map.of("email", MFA_EMAIL, "password", MFA_PASSWORD));
        assertThat(res.status()).as("challenge 를 받지 못했다: %s", res.body()).isEqualTo(401);
        return res.body().get("error").get("meta").get("challenge").asString();
    }

    // ────────────────────── 계정 보안 (G3 · G4 · G5 · G20) ──────────────────────

    private static final String CHROME_WINDOWS =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    private static final String SAFARI_IPHONE =
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
                    + "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

    @Test
    @Order(35)
    @DisplayName("세션 목록은 UA 원문과 함께 사람이 알아보는 기기 이름을 준다")
    void sessionListShowsDeviceLabel() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        createUser(admin, "label@example.com", "L4bel!Pass1");

        String token = loginFrom("label@example.com", "L4bel!Pass1", CHROME_WINDOWS, "203.0.113.10")
                .body().get("data").get("accessToken").asString();

        var items = get("/auth/sessions", null, token).body().get("data").get("items");
        JsonNode current = null;
        for (JsonNode s : items) {
            if (s.get("current").asBoolean()) {
                current = s;
            }
        }
        assertThat(current).isNotNull();
        assertThat(current.get("deviceLabel").asString())
                .as("UA 원문만으로는 사용자가 자기 기기를 알아볼 수 없다")
                .isEqualTo("Chrome · Windows");
        assertThat(current.get("userAgent").asString())
                .as("원문도 함께 줘야 표시가 틀렸을 때 대조할 것이 있다").isEqualTo(CHROME_WINDOWS);
    }

    @Test
    @Order(36)
    @DisplayName("처음 보는 기기·IP 의 로그인만 알린다 — 첫 로그인과 아는 기기는 조용하다")
    void notifiesOnlyOnNewDevice() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        String email = "newdevice@example.com";
        String password = "N3wDev!Pass1";
        createUser(admin, email, password);
        long uid = userId(admin, email);

        ok(loginFrom(email, password, CHROME_WINDOWS, "203.0.113.10"));
        assertThat(auditCount(admin, "NEW_DEVICE_LOGIN", uid))
                .as("가입 직후 첫 로그인에 알림이 가면 그건 소음이다").isZero();

        ok(loginFrom(email, password, CHROME_WINDOWS, "203.0.113.10"));
        assertThat(auditCount(admin, "NEW_DEVICE_LOGIN", uid))
                .as("전에 온 적 있는 조합이다").isZero();

        ok(loginFrom(email, password, SAFARI_IPHONE, "203.0.113.10"));
        assertThat(auditCount(admin, "NEW_DEVICE_LOGIN", uid))
                .as("기기가 바뀌면 알린다 — 계정 탈취를 본인이 알아채는 통로다").isEqualTo(1);

        ok(loginFrom(email, password, CHROME_WINDOWS, "198.51.100.4"));
        assertThat(auditCount(admin, "NEW_DEVICE_LOGIN", uid))
                .as("같은 기기라도 IP 가 처음이면 알린다").isEqualTo(2);
    }

    @Test
    @Order(37)
    @DisplayName("동시 세션 상한을 넘기면 가장 오래된 것부터 끊는다 — 방금 로그인한 세션은 산다")
    void concurrentSessionLimitEvictsOldest() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        String email = "limit@example.com";
        String password = "L1mit!Pass12";
        createUser(admin, email, password);
        long uid = userId(admin, email);

        // 기본값 0 = 제한 없음. 여러 기기를 쓰는 사람이 기본 설정으로 잘려 나가면 안 된다
        loginFrom(email, password, CHROME_WINDOWS, "203.0.113.11");
        loginFrom(email, password, SAFARI_IPHONE, "203.0.113.12");
        String token = loginFrom(email, password, CHROME_WINDOWS, "203.0.113.13")
                .body().get("data").get("accessToken").asString();
        assertThat(activeSessions(token).size())
                .as("기본값에서는 아무것도 끊기지 않는다").isEqualTo(3);

        setSetting(admin, "account.max-concurrent-sessions", "1");
        try {
            String newToken = loginFrom(email, password, CHROME_WINDOWS, "203.0.113.14")
                    .body().get("data").get("accessToken").asString();

            var left = activeSessions(newToken);
            assertThat(left.size()).as("상한 1 이면 하나만 남는다").isEqualTo(1);
            assertThat(left.get(0).get("current").asBoolean())
                    .as("★남은 하나가 방금 로그인한 세션이어야 한다 — 아니면 로그인하자마자 튕긴다★")
                    .isTrue();
            assertThat(auditCount(admin, "SESSION_EVICTED", uid))
                    .as("사용자에겐 '갑자기 로그아웃됐다' 로 보인다. 남기지 않으면 문의에 답할 수 없다")
                    .isPositive();
        } finally {
            setSetting(admin, "account.max-concurrent-sessions", "0");
        }
    }

    @Test
    @Order(38)
    @DisplayName("탈퇴는 기본으로 꺼져 있다 — 켜지 않은 인스턴스에서 계정이 닫히면 안 된다")
    void selfDeleteIsClosedByDefault() {
        String email = "keep@example.com";
        String password = "K33p!Pass123";
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        createUser(admin, email, password);
        String token = login(email, password).get("accessToken").asString();

        var res = post("/auth/account/delete", null, token, Map.of("currentPassword", password));
        assertThat(res.status()).isEqualTo(403);
        assertThat(res.body().get("error").get("code").asString())
                .as("AUTHZ_FORBIDDEN 과 나눠야 앱이 탈퇴 화면 자체를 감출 수 있다")
                .isEqualTo("AUTH_SELF_DELETE_DISABLED");

        // 서비스 키만으로 남의 계정을 닫을 수 있으면 앱 서버를 쥔 쪽이 전부 지울 수 있다
        assertThat(post("/auth/account/delete", serviceKey(),
                Map.of("currentPassword", password)).status()).isEqualTo(401);
    }

    @Test
    @Order(39)
    @DisplayName("유예 모드 — 세션은 즉시 끊기고, 그 사이 로그인하면 탈퇴가 취소된다")
    void selfDeleteGracePeriodIsCancelledByLogin() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        String email = "grace@example.com";
        String password = "Gr4ce!Pass12";
        createUser(admin, email, password);
        long uid = userId(admin, email);

        setSetting(admin, "account.self-delete-mode", "GRACE");
        try {
            var session = login(email, password);
            String token = session.get("accessToken").asString();

            assertThat(post("/auth/account/delete", null, token,
                    Map.of("currentPassword", "Wr0ng!Pass")).status())
                    .as("자리를 비운 사이 남이 계정을 닫을 수 있으면 안 된다").isEqualTo(401);

            var res = post("/auth/account/delete", null, token,
                    Map.of("currentPassword", password));
            assertThat(res.status()).as("탈퇴 실패: %s", res.body()).isEqualTo(200);
            assertThat(res.body().get("data").get("mode").asString()).isEqualTo("GRACE");
            assertThat(res.body().get("data").get("effectiveAt").asString())
                    .as("언제 비활성이 되는지 알려 주지 않으면 사용자가 취소 시점을 모른다")
                    .isNotBlank();

            assertThat(post("/auth/refresh", serviceKey(),
                    Map.of("refreshToken", session.get("refreshToken").asString())).status())
                    .as("탈퇴 요청은 모든 세션을 끊는다").isEqualTo(401);

            // 유예 중에는 아직 들어올 수 있다 — 그게 취소 수단이다
            assertThat(post("/auth/login", serviceKey(),
                    Map.of("email", email, "password", password)).status()).isEqualTo(200);
            assertThat(auditCount(admin, "SELF_DELETE_CANCELED", uid))
                    .as("홧김에 누른 경우를 로그인 한 번으로 되돌릴 수 있어야 한다").isEqualTo(1);
        } finally {
            setSetting(admin, "account.self-delete-mode", "DISABLED");
        }
    }

    @Test
    @Order(40)
    @DisplayName("즉시 모드 — 로그인할 수 없게 되지만 계정 행은 지우지 않는다")
    void selfDeleteImmediateDisablesButKeepsRow() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        String email = "bye@example.com";
        String password = "By3!Pass1234";
        createUser(admin, email, password);

        setSetting(admin, "account.self-delete-mode", "IMMEDIATE");
        try {
            String token = login(email, password).get("accessToken").asString();
            var res = post("/auth/account/delete", null, token,
                    Map.of("currentPassword", password));
            assertThat(res.status()).as("탈퇴 실패: %s", res.body()).isEqualTo(200);
            assertThat(res.body().get("data").get("mode").asString()).isEqualTo("IMMEDIATE");

            var after = post("/auth/login", serviceKey(),
                    Map.of("email", email, "password", password));
            assertThat(after.status()).isEqualTo(403);
            assertThat(after.body().get("error").get("code").asString())
                    .isEqualTo("AUTH_ACCOUNT_DISABLED");

            var found = get("/admin/users?q=" + email, null, admin)
                    .body().get("data").get("items");
            assertThat(found.size())
                    .as("★물리 삭제하면 감사 로그의 참조가 끊기고 같은 주소로 재가입해 이력을 지울 수 있다★")
                    .isEqualTo(1);
            assertThat(found.get(0).get("status").asString()).isEqualTo("DISABLED");
        } finally {
            setSetting(admin, "account.self-delete-mode", "DISABLED");
        }
    }

    @Test
    @Order(41)
    @DisplayName("관리자 2단계 초기화 — 반드시 감사 로그에 남는다")
    void adminMfaResetIsAlwaysAudited() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        String email = "lostphone@example.com";
        String password = "L0st!Phone12";
        createUser(admin, email, password);
        long uid = userId(admin, email);

        // 휴대폰과 백업 코드를 모두 잃은 상황을 만든다 — 2단계를 켜 두고 코드를 버린다
        String token = login(email, password).get("accessToken").asString();
        String uri = post("/auth/mfa/totp/setup", null, token, Map.of())
                .body().get("data").get("otpauthUri").asString();
        byte[] secret = Base32.decode(uri.split("secret=")[1].split("&")[0]);
        ok(post("/auth/mfa/totp/confirm", null, token,
                Map.of("code", TotpGenerator.code(secret, TotpGenerator.stepAt(Instant.now())))));
        assertThat(post("/auth/login", serviceKey(), Map.of("email", email, "password", password))
                .status()).as("2단계가 켜졌는지 먼저 확인한다").isEqualTo(401);

        var res = post("/admin/users/" + uid + "/mfa-reset", null, admin, Map.of());
        assertThat(res.status()).as("초기화 실패: %s", res.body()).isEqualTo(200);
        assertThat(res.body().get("data").get("reset").asBoolean()).isTrue();

        assertThat(post("/auth/login", serviceKey(), Map.of("email", email, "password", password))
                .status()).as("초기화했으면 비밀번호만으로 들어와야 한다").isEqualTo(200);
        assertThat(auditCount(admin, "MFA_RESET_BY_ADMIN", uid))
                .as("★관리자가 조용히 남의 2단계를 끄는 일이 없어야 한다★").isEqualTo(1);

        // 권한 없이는 열리지 않는다 — 아무나 남의 2단계를 끌 수 있으면 2단계가 무의미하다
        assertThat(post("/admin/users/" + uid + "/mfa-reset", null, token, Map.of()).status())
                .isEqualTo(403);
    }

    // ────────────────────── 약관 (G6) ──────────────────────

    @Test
    @Order(42)
    @DisplayName("약관 — 새 버전을 게시해도 로그인은 되고, 재동의 신호만 실린다")
    void termsRequireReagreementWithoutBlockingLogin() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        String email = "terms@example.com";
        String password = "T3rms!Pass12";
        createUser(admin, email, password);

        setSetting(admin, "terms.enabled", "true");
        try {
            long v1 = createTerm(admin, "service", "이용약관 v1", "첫 본문");
            assertThat(publicTerms().size())
                    .as("★초안이 새어 나가면 다듬는 중인 문안이 가입 화면에 뜬다★").isZero();

            ok(post("/admin/terms/" + v1 + "/publish", null, admin, Map.of()));
            assertThat(publicTerms().size()).isEqualTo(1);
            assertThat(publicTerms().get(0).get("version").asInt()).isEqualTo(1);

            // 로그인을 막지 않는다 — 막으면 게시하는 순간 전원이 못 들어온다
            var res = post("/auth/login", serviceKey(),
                    Map.of("email", email, "password", password));
            assertThat(res.status()).as("약관 미동의로 로그인을 막으면 안 된다").isEqualTo(200);
            String token = res.body().get("data").get("accessToken").asString();
            assertThat(res.body().get("data").get("termsAgreementRequired").toString())
                    .contains("service");

            var agreed = post("/auth/terms/agree", null, token,
                    Map.of("agreements", Map.of("service", true)));
            ok(agreed);
            assertThat(agreed.body().get("data").get("pending").size())
                    .as("동의 화면을 닫아도 되는지 앱이 바로 판단할 수 있어야 한다").isZero();
            assertThat(login(email, password).get("termsAgreementRequired").size()).isZero();

            long v2 = createTerm(admin, "service", "이용약관 v2", "고친 본문");
            assertThat(termView(admin, v2).get("version").asInt())
                    .as("버전은 서버가 매긴다 — 관리자가 넣으면 중복·건너뜀이 생긴다").isEqualTo(2);
            ok(post("/admin/terms/" + v2 + "/publish", null, admin, Map.of()));
            assertThat(login(email, password).get("termsAgreementRequired").toString())
                    .as("개정본에 동의받지 않았는데 그대로 두면 증빙이 성립하지 않는다")
                    .contains("service");

            // 이력은 지우지 않는다
            assertThat(get("/auth/terms/agreements", null, token)
                    .body().get("data").get("items").size()).isEqualTo(1);
            assertThat(delete("/admin/terms/" + v1, admin, Map.of()).status())
                    .as("★동의 이력이 있는 약관을 지울 수 있으면 증빙이 아니다★").isEqualTo(409);
            assertThat(delete("/admin/terms/" + v2, admin, Map.of()).status())
                    .as("아무도 동의하지 않은 것은 치울 수 있어야 한다 — 오타 난 초안이 쌓인다")
                    .isEqualTo(204);
        } finally {
            setSetting(admin, "terms.enabled", "false");
        }
    }

    @Test
    @Order(43)
    @DisplayName("가입 — 필수 약관에 동의하지 않으면 계정 자체가 만들어지지 않는다")
    void signupRequiresTermsAgreement() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        setSetting(admin, "terms.enabled", "true");
        try {
            String email = "signup-terms@example.com";
            var refused = post("/auth/signup", serviceKey(), Map.of(
                    "email", email, "password", "S1gnup!Pass12", "name", "약관"));
            assertThat(refused.status()).isEqualTo(400);
            assertThat(refused.body().get("error").get("code").asString())
                    .isEqualTo("AUTH_TERMS_REQUIRED");
            assertThat(refused.body().get("error").get("details").toString())
                    .as("어느 것이 빠졌는지 알려 줘야 앱이 그 체크박스를 짚어 준다")
                    .contains("service");
            assertThat(userCount(admin, email))
                    .as("★막혔는데 계정이 남으면 같은 주소로 다시 가입할 수 없게 된다★").isZero();

            ok(post("/auth/signup", serviceKey(), Map.of(
                    "email", email, "password", "S1gnup!Pass12", "name", "약관",
                    "agreements", Map.of("service", true))));
            assertThat(userCount(admin, email)).isEqualTo(1);
        } finally {
            setSetting(admin, "terms.enabled", "false");
        }
    }

    // ────────────────────── 비밀번호 재사용 이력 (G9) ──────────────────────

    @Test
    @Order(44)
    @DisplayName("최근 N개 재사용 금지 — 0 이면 검사하지 않되 직전 것은 늘 막는다")
    void passwordHistoryBlocksRecentReuse() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        String email = "pwhist@example.com";

        // 켜고 나서 만든다. 켜기 전에 쓰던 비밀번호는 이력에 없으므로 걸리지 않는다 —
        // 이건 결함이 아니라 이 기능의 경계다(없는 것을 소급해서 만들 수는 없다)
        setSetting(admin, "password.history-count", "3");
        try {
            createUser(admin, email, "H1st!Pass001");
            changePassword(login(email, "H1st!Pass001"), "H1st!Pass001", "H1st!Pass002");
            changePassword(login(email, "H1st!Pass002"), "H1st!Pass002", "H1st!Pass003");

            String token = login(email, "H1st!Pass003").get("accessToken").asString();
            var reused = post("/auth/password/change", null, token, Map.of(
                    "currentPassword", "H1st!Pass003", "newPassword", "H1st!Pass001"));
            assertThat(reused.status()).isEqualTo(400);
            assertThat(reused.body().get("error").get("code").asString())
                    .isEqualTo("AUTH_PASSWORD_REUSED");
            assertThat(reused.body().get("error").get("message").asString())
                    .as("몇 개까지 막히는지 알려 주지 않으면 사용자가 계속 헤맨다").contains("3");
        } finally {
            setSetting(admin, "password.history-count", "0");
        }

        // 꺼면 다시 쓸 수 있다 — 이 설정 하나로만 동작이 갈린다
        String token = login(email, "H1st!Pass003").get("accessToken").asString();
        ok(post("/auth/password/change", null, token, Map.of(
                "currentPassword", "H1st!Pass003", "newPassword", "H1st!Pass001")));

        token = login(email, "H1st!Pass001").get("accessToken").asString();
        var sameAsCurrent = post("/auth/password/change", null, token, Map.of(
                "currentPassword", "H1st!Pass001", "newPassword", "H1st!Pass001"));
        assertThat(sameAsCurrent.body().get("error").get("code").asString())
                .as("이력을 꺼도 직전 것은 늘 막는다 — 현재 해시와의 비교라 보관이 필요 없다")
                .isEqualTo("AUTH_PASSWORD_REUSED");
    }

    // ────────────────────── 사용자 속성 스키마 (G12) ──────────────────────

    @Test
    @Order(45)
    @DisplayName("속성 정의 — 타입을 검사하고 정규화한다. 정의에 없는 키는 설정이 정한다")
    void userAttributesAreValidatedAgainstDefinitions() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        ok(post("/admin/user-attributes", null, admin, Map.of(
                "key", "dept", "label", "부서", "type", "ENUM",
                "required", true, "options", "개발,영업")));
        ok(post("/admin/user-attributes", null, admin, Map.of(
                "key", "headcount", "label", "인원", "type", "NUMBER")));
        String email = "attrs@example.com";
        try {
            var badEnum = createWithAttributes(admin, email, Map.of("dept", "총무"));
            assertThat(badEnum.status()).isEqualTo(400);
            assertThat(badEnum.body().get("error").get("details").toString())
                    .contains("attributes.dept");
            assertThat(createWithAttributes(admin, email, Map.of()).status())
                    .as("필수 속성이 빠지면 만들어지지 않는다").isEqualTo(400);

            var created = createWithAttributes(admin, email,
                    Map.of("dept", "개발", "headcount", "3"));
            ok(created);
            assertThat(created.body().get("data").get("attributes").get("headcount").isNumber())
                    .as("★문자열 \"3\" 이 그대로 저장되면 읽는 쪽이 두 경우를 다 다뤄야 한다★")
                    .isTrue();

            long uid = userId(admin, email);
            var withExtra = Map.<String, Object>of("attributes",
                    Map.of("dept", "영업", "nickname", "길동"));
            ok(patch("/admin/users/" + uid, admin, withExtra));

            setSetting(admin, "account.strict-attributes", "true");
            assertThat(patch("/admin/users/" + uid, admin, withExtra).status())
                    .as("켜면 정의에 없는 키가 거부된다").isEqualTo(400);
            ok(patch("/admin/users/" + uid, admin, Map.of("name", "속성2")));
        } finally {
            setSetting(admin, "account.strict-attributes", "false");
            delete("/admin/user-attributes/dept", admin, Map.of());
            delete("/admin/user-attributes/headcount", admin, Map.of());
        }
    }

    // ────────────────────── CSV 일괄 등록 (G13) ──────────────────────

    @Test
    @Order(46)
    @DisplayName("일괄 등록 — 한 줄이 틀려도 나머지는 들어가고, 상한을 넘으면 통째로 거절한다")
    void bulkImportIsRowIndependent() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        String csv = """
                email,name,roles
                bulk1@example.com,벌크1,USER
                not-an-email,벌크2,USER
                bulk3@example.com,벌크3,"ADMIN,USER"
                """;

        setSetting(admin, "account.bulk-import-max", "2");
        try {
            assertThat(postCsv("/admin/users/bulk?invite=false", admin, csv).status())
                    .as("상한이 없으면 요청 하나로 서버를 세울 수 있다").isEqualTo(400);
            assertThat(userCount(admin, "bulk1@example.com"))
                    .as("상한에 걸리면 한 건도 만들지 않는다 — 일부만 들어간 것을 알아채기 어렵다")
                    .isZero();
        } finally {
            setSetting(admin, "account.bulk-import-max", "500");
        }

        var res = postCsv("/admin/users/bulk?invite=false", admin, csv);
        ok(res);
        var summary = res.body().get("data");
        assertThat(summary.get("total").asInt()).isEqualTo(3);
        assertThat(summary.get("created").asInt())
                .as("★한 줄이 틀렸다고 나머지가 안 들어가면 아무도 이 기능을 쓰지 않는다★")
                .isEqualTo(2);
        assertThat(summary.get("failed").asInt()).isEqualTo(1);
        assertThat(summary.get("results").toString())
                .as("어느 줄이 왜 실패했는지 없으면 300줄을 눈으로 훑게 된다")
                .contains("\"line\":3").contains("not-an-email");

        // 비밀번호 없이 만들어졌으므로 초대 전까지는 아무도 그 계정으로 들어올 수 없다
        var made = get("/admin/users?q=bulk1@example.com", null, admin)
                .body().get("data").get("items").get(0);
        assertThat(made.get("status").asString()).isEqualTo("PENDING");
        assertThat(made.get("roles").toString()).contains("USER");

        // 같은 파일을 다시 올리면 중복은 실패하고 새것만 들어간다
        var again = postCsv("/admin/users/bulk?invite=false", admin, csv);
        assertThat(again.body().get("data").get("created").asInt()).isZero();

        // JSON 배열 형태도 같은 것을 받는다 — 스크립트로 만드는 쪽은 이쪽이 자연스럽다
        var json = post("/admin/users/bulk", null, admin, Map.of(
                "users", List.of(Map.of("email", "bulk4@example.com", "name", "벌크4")),
                "invite", false));
        ok(json);
        assertThat(json.body().get("data").get("created").asInt()).isEqualTo(1);
    }

    @Test
    @Order(47)
    @DisplayName("새 정책은 전부 관리 화면에서 켜고 끌 수 있다 (설정 미등록 = 배포본이 갈라진다)")
    void newPoliciesAreAllSettings() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        var keys = new java.util.ArrayList<String>();
        get("/admin/settings", null, admin).body().get("data").get("items")
                .forEach(i -> keys.add(i.get("key").asString()));

        assertThat(keys).as("정의에 없으면 yml 을 고치고 재시작해야 한다 = 동적 설정이 아니다")
                .contains("terms.enabled", "terms.require-on-signup",
                        "terms.reagreement-required", "password.history-count",
                        "password.check-breached", "account.strict-attributes",
                        "account.bulk-import-max");
    }

    // ────────────────── 목록 역할 필터 · 관리자 잠금 (2026-08-21) ──────────────────

    @Test
    @Order(48)
    @DisplayName("?role= 이 실제로 거른다 — 그룹 경유 역할도 잡히고, 없는 코드는 빈 목록이다")
    void userListFiltersByRole() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();

        ok(post("/admin/roles", null, admin, Map.of("code", "AUDITOR", "name", "감사자")));
        ok(post("/admin/groups", null, admin, Map.of("code", "audit-team", "name", "감사팀")));
        long groupId = groupId(admin, "audit-team");
        ok(put("/admin/groups/" + groupId + "/roles", admin, Map.of("codes", List.of("AUDITOR"))));

        // ① 직접 부여 ② 그룹 경유 ③ 아무 역할 없음
        ok(post("/admin/users", null, admin, Map.of(
                "email", "auditor-direct@example.com", "name", "직접",
                "password", "Aud1t!Direct", "roles", List.of("AUDITOR"))));
        ok(post("/admin/users", null, admin, Map.of(
                "email", "auditor-group@example.com", "name", "그룹",
                "password", "Aud1t!Group0", "roles", List.of())));
        ok(post("/admin/users", null, admin, Map.of(
                "email", "auditor-none@example.com", "name", "무관",
                "password", "Aud1t!None00", "roles", List.of())));
        ok(post("/admin/groups/" + groupId + "/members", null, admin,
                Map.of("userId", userId(admin, "auditor-group@example.com"))));

        var emails = emailsOf(get("/admin/users?role=AUDITOR&size=100", null, admin));
        assertThat(emails)
                .as("응답 roles 에 보이는 것은 그룹에서 온 것이어도 반드시 잡혀야 한다")
                .contains("auditor-direct@example.com", "auditor-group@example.com")
                .doesNotContain("auditor-none@example.com");

        // 필터가 무시되면 전체 목록이 나온다 — 그게 이 결함의 증상이었다
        long all = get("/admin/users?size=1", null, admin).body().get("data").get("total").asLong();
        long filtered = get("/admin/users?role=AUDITOR&size=1", null, admin)
                .body().get("data").get("total").asLong();
        assertThat(filtered).isLessThan(all);

        assertThat(get("/admin/users?role=NOSUCHROLE&size=1", null, admin)
                .body().get("data").get("total").asLong())
                .as("없는 코드는 400 이 아니라 빈 목록이다").isZero();

        // q·status 와 AND 로 겹친다
        assertThat(emailsOf(get("/admin/users?role=AUDITOR&q=direct&size=100", null, admin)))
                .containsExactly("auditor-direct@example.com");
    }

    @Test
    @Order(49)
    @DisplayName("관리자가 건 LOCKED 는 로그인을 막고, 세션을 끊고, 로그인으로 풀리지 않는다")
    void adminLockBlocksLogin() {
        String admin = login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
        createUser(admin, "adminlock@example.com", "Adm1n!Locked9");
        long id = userId(admin, "adminlock@example.com");

        String refresh = login("adminlock@example.com", "Adm1n!Locked9")
                .get("refreshToken").asString();

        ok(patch("/admin/users/" + id, admin, Map.of("status", "LOCKED")));

        var view = get("/admin/users/" + id, null, admin).body().get("data");
        assertThat(view.get("status").asString()).isEqualTo("LOCKED");
        assertThat(view.get("lockedUntil").isNull())
                .as("관리자 잠금에는 풀리는 시각이 없다 — 그 부재가 자동 잠금과의 구분 기준이다")
                .isTrue();

        var blocked = post("/auth/login", serviceKey(),
                Map.of("email", "adminlock@example.com", "password", "Adm1n!Locked9"));
        assertThat(blocked.status()).isEqualTo(423);
        assertThat(blocked.body().get("error").get("code").asString())
                .isEqualTo("AUTH_ACCOUNT_LOCKED");
        assertThat(blocked.body().get("error").path("meta").path("lockedUntil").isMissingNode())
                .as("풀리는 시각이 없다 — 기다리면 된다고 안내하면 영영 기다리게 된다").isTrue();

        assertThat(get("/admin/users/" + id, null, admin).body().get("data")
                .get("status").asString())
                .as("로그인 시도 한 번으로 잠금이 사라지면 안 된다").isEqualTo("LOCKED");

        assertThat(post("/auth/refresh", serviceKey(), Map.of("refreshToken", refresh)).status())
                .as("이미 들어와 있던 세션도 끊긴다 — 아니면 차단이 다음 로그인까지 미뤄진다")
                .isNotEqualTo(200);

        assertThat(emailsOf(get("/admin/users?status=LOCKED&size=100", null, admin)))
                .contains("adminlock@example.com");

        ok(post("/admin/users/" + id + "/unlock", null, admin, Map.of()));
        assertThat(post("/auth/login", serviceKey(),
                Map.of("email", "adminlock@example.com", "password", "Adm1n!Locked9")).status())
                .as("푸는 경로는 관리자에게 있다").isEqualTo(200);
    }

    private long groupId(String adminToken, String code) {
        for (JsonNode g : get("/admin/groups", null, adminToken).body().get("data")) {
            if (code.equals(g.get("code").asString())) {
                return g.get("id").asLong();
            }
        }
        throw new IllegalStateException("그룹 없음: " + code);
    }

    private List<String> emailsOf(Res res) {
        var out = new java.util.ArrayList<String>();
        res.body().get("data").get("items").forEach(i -> out.add(i.get("email").asString()));
        return out;
    }

    // ────────────────────── 가입·정책 헬퍼 ──────────────────────

    private List<JsonNode> publicTerms() {
        var out = new java.util.ArrayList<JsonNode>();
        get("/auth/terms", serviceKey(), null).body().get("data").get("items").forEach(out::add);
        return out;
    }

    private long createTerm(String adminToken, String code, String title, String body) {
        var res = post("/admin/terms", null, adminToken, Map.of(
                "code", code, "title", title, "body", body, "required", true));
        ok(res);
        return res.body().get("data").get("id").asLong();
    }

    private JsonNode termView(String adminToken, long id) {
        return get("/admin/terms/" + id, null, adminToken).body().get("data");
    }

    private Res createWithAttributes(String adminToken, String email,
                                     Map<String, Object> attributes) {
        return post("/admin/users", null, adminToken, Map.of(
                "email", email, "name", "속성", "password", "Attr!Pass123",
                "attributes", attributes));
    }

    private void changePassword(JsonNode session, String current, String next) {
        ok(post("/auth/password/change", null, session.get("accessToken").asString(),
                Map.of("currentPassword", current, "newPassword", next)));
    }

    private long userCount(String adminToken, String email) {
        return get("/admin/users?q=" + email, null, adminToken)
                .body().get("data").get("total").asLong();
    }

    // ────────────────────── 계정 보안 헬퍼 ──────────────────────

    private void createUser(String adminToken, String email, String password) {
        ok(post("/admin/users", null, adminToken, Map.of(
                "email", email, "name", email.split("@")[0], "password", password,
                "roles", List.of())));
    }

    /** 앱이 최종 사용자 정보를 실어 보내는 경로 그대로 — jar 는 앱 뒤에 있어 직접 알 수 없다 */
    private Res loginFrom(String email, String password, String userAgent, String ip) {
        return post("/auth/login", serviceKey(), Map.of(
                "email", email, "password", password, "userAgent", userAgent, "ip", ip));
    }

    private List<JsonNode> activeSessions(String token) {
        var out = new java.util.ArrayList<JsonNode>();
        get("/auth/sessions", null, token).body().get("data").get("items").forEach(out::add);
        return out;
    }

    private long auditCount(String adminToken, String eventType, long userId) {
        return get("/admin/audit-logs?size=100&eventType=" + eventType + "&userId=" + userId,
                null, adminToken).body().get("data").get("total").asLong();
    }

    /** 설정은 재시작 없이 바뀐다 — 그 사실 자체가 여기서 함께 검증된다 */
    private void setSetting(String adminToken, String key, String value) {
        var res = put("/admin/settings/" + key, adminToken, Map.of("value", value));
        assertThat(res.status()).as("설정 변경 실패(%s=%s): %s", key, value, res.body())
                .isEqualTo(200);
    }

    // ────────────────────────── HTTP 헬퍼 ──────────────────────────

    /** L2 판정 헬퍼 */
    private JsonNode check(long userId, String type, String key, String action) {
        var res = post("/authz/check", serviceKey(), Map.of(
                "userId", userId, "resourceType", type, "resourceKey", key, "action", action));
        assertThat(res.status()).as("check 실패: %s", res.body()).isEqualTo(200);
        return res.body().get("data");
    }

    private long userId(String adminToken, String email) {
        return get("/admin/users?q=" + email, null, adminToken)
                .body().get("data").get("items").get(0).get("id").asLong();
    }

    private JsonNode login(String email, String password) {
        var res = post("/auth/login", serviceKey(), Map.of("email", email, "password", password));
        assertThat(res.status()).as("로그인 실패: %s", res.body()).isEqualTo(200);
        return res.body().get("data");
    }

    private void ok(Res res) {
        assertThat(res.status()).as("요청 실패: %s", res.body()).isBetween(200, 299);
    }

    private String serviceKey() {
        return SERVICE_KEY;
    }

    private Res get(String path, String svcKey, String bearer) {
        var raw = rawGet(path, svcKey, bearer);
        return toRes(raw);
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

    private Res patch(String path, String bearer, Map<String, Object> body) {
        return send(builder(path, null, bearer).method("PATCH",
                HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(body))));
    }

    /**
     * CSV 본문 그대로 보낸다 — JSON 이 아니므로 {@link #post} 를 쓸 수 없다.
     *
     * <p>charset 을 명시한다. 빼면 한글 이름이 서버의 기본 인코딩에 따라 깨질 수 있고,
     * 그건 이 기능을 실제로 쓰는 방식(엑셀에서 저장한 명단)에서 바로 드러난다.</p>
     */
    private Res postCsv(String path, String bearer, String csv) {
        return send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "text/csv;charset=UTF-8")
                .header("Authorization", "Bearer " + bearer)
                .timeout(Duration.ofSeconds(15))
                .POST(HttpRequest.BodyPublishers.ofString(csv)));
    }

    /** 본문 있는 DELETE — 2단계 해제가 현재 비밀번호를 함께 받는다 */
    private Res delete(String path, String bearer, Map<String, Object> body) {
        return send(builder(path, null, bearer).method("DELETE",
                HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(body))));
    }

    private HttpResponse<String> rawGet(String path, String svcKey, String bearer) {
        try {
            return CLIENT.send(builder(path, svcKey, bearer).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
        } catch (Exception e) {
            throw new IllegalStateException("요청 실패: " + path, e);
        }
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
            return toRes(CLIENT.send(builder.build(), HttpResponse.BodyHandlers.ofString()));
        } catch (Exception e) {
            throw new IllegalStateException("요청 실패", e);
        }
    }

    private Res toRes(HttpResponse<String> raw) {
        JsonNode node = (raw.body() == null || raw.body().isBlank())
                ? MAPPER.createObjectNode()
                : MAPPER.readTree(raw.body());
        return new Res(raw.statusCode(), node, new HttpHeadersView(raw));
    }
}
