package team.prost.ixauth;

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
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 연합 신원 교환 — 실제 PostgreSQL 에 붙여 계약 전 항목을 왕복 검증한다.
 *
 * <p>본 E2E({@code IxAuthE2ETest})와 파일을 나눈 이유 — 저쪽은 <b>기본값 그대로의
 * 동작</b>을 지키는 자리이고, 연합은 기본이 꺼짐이다. 켜 둔 컨텍스트를 섞으면
 * 그쪽 검사의 전제가 흐려진다.</p>
 *
 * <p>검증하는 것은 여섯 가지다: ① 처음 보는 신원이면 계정을 만들고 로그인 봉투를 준다
 * ② 매칭 기준은 이메일이 아니라 {@code (provider, subject)} 다 ③ 같은 이메일의 기존
 * 계정에 연결된다 ④ 허용 목록에 없는 provider 와 꺼진 기능은 막힌다 ⑤ 계정 상태
 * 게이트가 비밀번호 로그인과 같이 걸린다 ⑥ {@code ixauth_idp} 클레임이 회전에도 남는다.</p>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class FederatedExchangeE2ETest {

    private static final String SERVICE_KEY = "test-service-key-must-be-at-least-32-chars";
    private static final String ADMIN_EMAIL = "admin@example.com";
    private static final String ADMIN_PASSWORD = "Adm1n!Passw0rd";
    private static final String USER_PASSWORD = "Us3r!Passw0rd";
    private static final String ISSUER = "https://test.example.com";
    private static final String PROVIDER = "nexus-hub";

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

        registry.add("ixauth.federation.enabled", () -> true);
        // 대문자로 적어도 같은 provider 로 본다 — 정규화가 실제로 도는지 여기서 굳힌다
        registry.add("ixauth.federation.allowed-providers", () -> "Nexus-Hub");

        // 한 IP(테스트 JVM)에서 수십 번 로그인한다 — 실사용 패턴이 아니다.
        // 끄지 않고 한도만 올린다. 꺼 버리면 필터가 깨져도 여기서 드러나지 않는다
        registry.add("ixauth.rate-limit.login-per-minute", () -> 10_000);
        registry.add("ixauth.rate-limit.refresh-per-minute", () -> 10_000);
        registry.add("ixauth.rate-limit.default-per-minute", () -> 10_000);
    }

    // ────────────────────── ① 처음 보는 신원 → JIT 생성 ──────────────────────

    @Test
    @DisplayName("처음 보는 신원이면 계정을 만들고 로그인과 같은 봉투를 준다")
    void provisionsOnFirstSight() {
        String email = randomEmail();
        String subject = randomSubject();

        var res = exchange(PROVIDER, subject, email, "홍길동");
        assertThat(res.status()).as(String.valueOf(res.body())).isEqualTo(200);

        var data = res.body().get("data");
        for (String field : new String[] {"accessToken", "refreshToken", "expiresIn", "user"}) {
            assertThat(data.has(field)).as(field + " 가 없다 — 로그인과 같은 봉투여야 한다").isTrue();
        }
        assertThat(data.get("user").get("email").asString()).isEqualTo(email);
        assertThat(data.get("user").get("name").asString()).isEqualTo("홍길동");
        assertThat(roleCodes(data.get("user").get("roles"))).contains("USER");

        // 비밀번호가 없고 이메일은 인증된 것으로 표시된다 —
        // 표시하지 않으면 require-email-verification 을 켠 설치에서 곧바로 못 들어온다
        var detail = get("/admin/users/" + data.get("user").get("id").asString() + "/detail",
                adminToken()).body().get("data");
        assertThat(detail.get("status").asString()).isEqualTo("ACTIVE");
        assertThat(detail.get("emailVerified").asBoolean()).isTrue();

        var federated = detail.get("federatedIdentities");
        assertThat(federated.size()).as("관리 상세에 연합 신원이 보여야 한다").isEqualTo(1);
        assertThat(federated.get(0).get("provider").asString())
                .as("허용 목록에 Nexus-Hub 로 적었어도 소문자로 정규화해 저장한다")
                .isEqualTo(PROVIDER);
        assertThat(federated.get(0).get("subject").asString()).isEqualTo(subject);
    }

    // ────────────────────── ② 매칭 기준은 subject ──────────────────────

    @Test
    @DisplayName("같은 subject 면 이메일이 바뀌어도 같은 사용자다")
    void matchesBySubjectNotEmail() {
        String subject = randomSubject();
        String first = exchange(PROVIDER, subject, randomEmail(), "홍길동")
                .body().get("data").get("user").get("id").asString();

        // 외부 IdP 에서 주소를 바꾼 사람이 다시 들어온다
        var again = exchange(PROVIDER, subject, randomEmail(), "홍길동");
        assertThat(again.status()).isEqualTo(200);
        assertThat(again.body().get("data").get("user").get("id").asString())
                .as("★subject 가 같은데 계정이 새로 생기면 한 사람이 둘이 된다★")
                .isEqualTo(first);
    }

    // ────────────────────── ③ 이메일로 기존 계정 연결 ──────────────────────

    @Test
    @DisplayName("같은 이메일의 계정이 있으면 그 계정에 연결한다")
    void linksToExistingAccountByEmail() {
        var existing = createUser();

        var res = exchange(PROVIDER, randomSubject(), existing.email(), "기존 사용자");
        assertThat(res.status()).as(String.valueOf(res.body())).isEqualTo(200);
        assertThat(res.body().get("data").get("user").get("id").asString())
                .isEqualTo(existing.id());

        var audit = get("/admin/audit-logs?eventType=FEDERATED_LINK&userId=" + existing.id(),
                adminToken()).body().get("data").get("items");
        assertThat(audit.size()).as("연결은 계정 인수가 일어나는 지점이다 — 기록이 남아야 한다")
                .isEqualTo(1);
        assertThat(audit.get(0).get("detail").get("provider").asString()).isEqualTo(PROVIDER);
    }

    @Test
    @DisplayName("link-by-email 을 끄면 같은 이메일이어도 409 이고 계정이 새로 생기지 않는다")
    void refusesEmailLinkWhenDisabled() {
        var existing = createUser();
        withSetting("federation.link-by-email", "false", () -> {
            var res = exchange(PROVIDER, randomSubject(), existing.email(), "기존 사용자");
            assertThat(res.status()).isEqualTo(409);
            assertThat(errorCode(res)).isEqualTo("AUTH_FEDERATION_LINK_DENIED");
        });
    }

    @Test
    @DisplayName("auto-provision 을 끄면 처음 보는 사람은 404 다")
    void refusesProvisionWhenDisabled() {
        withSetting("federation.auto-provision", "false", () -> {
            var res = exchange(PROVIDER, randomSubject(), randomEmail(), "새 사람");
            assertThat(res.status()).isEqualTo(404);
            assertThat(errorCode(res)).isEqualTo("AUTH_FEDERATION_NO_ACCOUNT");
        });
    }

    // ────────────────────── ④ 게이트 — provider · 스위치 ──────────────────────

    @Test
    @DisplayName("허용 목록에 없는 provider 는 403 이고 꺼 두면 전부 403 이다")
    void gatesProviderAndSwitch() {
        var res = exchange("some-other-idp", randomSubject(), randomEmail(), "남");
        assertThat(res.status()).isEqualTo(403);
        assertThat(errorCode(res))
                .as("★허용 목록을 무시하면 이름만 바꿔 오는 모든 요청이 통과한다★")
                .isEqualTo("AUTH_FEDERATION_PROVIDER_NOT_ALLOWED");

        withSetting("federation.enabled", "false", () -> {
            var off = exchange(PROVIDER, randomSubject(), randomEmail(), "홍길동");
            assertThat(off.status()).isEqualTo(403);
            assertThat(errorCode(off)).isEqualTo("AUTH_FEDERATION_DISABLED");
        });
    }

    @Test
    @DisplayName("서비스 키가 없으면 401 이다 — 이 경로의 신뢰 근거는 그 키 하나뿐이다")
    void requiresServiceKey() {
        var res = send(HttpRequest.newBuilder(URI.create(url("/auth/federated/exchange")))
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(15))
                .POST(HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(
                        Map.of("provider", PROVIDER, "subject", randomSubject(),
                                "email", randomEmail())))));
        assertThat(res.status()).isEqualTo(401);
    }

    // ────────────────────── ⑤ 계정 상태 게이트 ──────────────────────

    @Test
    @DisplayName("비활성 계정은 연합으로도 들어오지 못한다")
    void appliesAccountStatusGate() {
        String email = randomEmail();
        String subject = randomSubject();
        String userId = exchange(PROVIDER, subject, email, "홍길동")
                .body().get("data").get("user").get("id").asString();

        var patched = patch("/admin/users/" + userId, adminToken(), Map.of("status", "DISABLED"));
        assertThat(patched.status()).isEqualTo(200);

        var res = exchange(PROVIDER, subject, email, "홍길동");
        assertThat(res.status())
                .as("★여기를 열어 두면 관리자가 건 차단이 외부 로그인 한 번으로 우회된다★")
                .isEqualTo(403);
        assertThat(errorCode(res)).isEqualTo("AUTH_ACCOUNT_DISABLED");
    }

    // ────────────────────── ⑥ ixauth_idp 클레임 ──────────────────────

    @Test
    @DisplayName("연합 토큰에는 ixauth_idp 가 실리고 회전해도 남는다")
    void carriesIdpClaimAcrossRotation() {
        var data = exchange(PROVIDER, randomSubject(), randomEmail(), "홍길동")
                .body().get("data");

        assertThat(claim(data.get("accessToken").asString(), "ixauth_idp")).isEqualTo(PROVIDER);

        var rotated = post("/auth/refresh", SERVICE_KEY, null,
                Map.of("refreshToken", data.get("refreshToken").asString()));
        assertThat(rotated.status()).isEqualTo(200);
        assertThat(claim(rotated.body().get("data").get("accessToken").asString(), "ixauth_idp"))
                .as("★회전하면 어느 IdP 로 들어왔는지가 사라진다 — 앱이 그 뒤를 설명할 수 없다★")
                .isEqualTo(PROVIDER);
    }

    @Test
    @DisplayName("자체 인증 토큰에는 ixauth_idp 가 없다")
    void omitsIdpClaimForLocalLogin() {
        assertThat(claim(adminToken(), "ixauth_idp"))
                .as("★늘 붙어 있으면 앱이 유무가 아니라 내용으로 판단하게 된다★")
                .isNull();
    }

    // ────────────────────────── 도우미 ──────────────────────────

    private record CreatedUser(String id, String email) {
    }

    private Res exchange(String provider, String subject, String email, String name) {
        var body = new HashMap<String, Object>();
        body.put("provider", provider);
        body.put("subject", subject);
        body.put("email", email);
        body.put("name", name);
        body.put("ip", "203.0.113.7");
        body.put("userAgent", "Mozilla/5.0 (conformance)");
        return post("/auth/federated/exchange", SERVICE_KEY, null, body);
    }

    /**
     * 설정을 잠깐 바꿨다가 되돌린다.
     *
     * <p>되돌리기를 {@code finally} 에 두는 이유 — 검사가 중간에 실패하면 그 설정이 켜진
     * 채로 남고, 다음 검사가 무엇 때문에 깨졌는지 알 수 없게 된다.</p>
     */
    private void withSetting(String key, String value, Runnable body) {
        String token = adminToken();
        assertThat(put("/admin/settings/" + key, token, Map.of("value", value)).status())
                .isEqualTo(200);
        try {
            body.run();
        } finally {
            send(builder("/admin/settings/" + key, null, token).DELETE());
        }
    }

    private static String randomEmail() {
        return "fed-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    }

    private static String randomSubject() {
        return "sub-" + UUID.randomUUID();
    }

    private static java.util.List<String> roleCodes(JsonNode roles) {
        var out = new java.util.ArrayList<String>();
        roles.forEach(r -> out.add(r.asString()));
        return out;
    }

    private static String errorCode(Res res) {
        return res.body().get("error").get("code").asString();
    }

    /** 토큰의 클레임 하나 — 없으면 null */
    private static Object claim(String token, String name) {
        try {
            return SignedJWT.parse(token).getJWTClaimsSet().getClaim(name);
        } catch (Exception e) {
            throw new IllegalStateException("토큰 파싱 실패", e);
        }
    }

    private String adminToken() {
        return post("/auth/login", SERVICE_KEY, null,
                Map.of("email", ADMIN_EMAIL, "password", ADMIN_PASSWORD))
                .body().get("data").get("accessToken").asString();
    }

    private CreatedUser createUser() {
        String email = randomEmail();
        var res = post("/admin/users", null, adminToken(), Map.of(
                "email", email, "name", "기존 사용자",
                "password", USER_PASSWORD, "roles", java.util.List.of("USER")));
        assertThat(res.status()).as("사용자 생성 실패: " + res.body()).isEqualTo(200);
        return new CreatedUser(res.body().get("data").get("id").asString(), email);
    }

    private record Res(int status, JsonNode body) {
    }

    private Res get(String path, String bearer) {
        return send(builder(path, null, bearer).GET());
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

    private String url(String path) {
        return "http://localhost:" + port + path;
    }

    private HttpRequest.Builder builder(String path, String svcKey, String bearer) {
        var b = HttpRequest.newBuilder(URI.create(url(path)))
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
