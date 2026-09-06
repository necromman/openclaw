package team.prost.ixauth;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import team.prost.ixauth.mail.MailService;
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
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.verify;

/**
 * 매직 링크 로그인 — 실제 PostgreSQL 에 붙여 <b>메일에 실린 토큰으로 끝까지</b> 돌린다.
 *
 * <p>본 E2E({@code IxAuthE2ETest})와 파일을 나눈 이유는 하나다 — 이 흐름은
 * {@code account.magic-link-enabled} 가 켜져 있어야 하는데, 그건 기본이 꺼짐이고
 * 본 E2E 는 <b>기본값 그대로의 동작</b>을 검증하는 자리다. 한 컨텍스트에서 켜 두면
 * 그쪽 검사의 전제가 흐려진다.</p>
 *
 * <p><b>{@code MailService} 를 spy 로 감싸 원문 토큰을 가로챈다.</b> 그러지 않으면
 * 토큰을 알 방법이 없다 — DB 에는 SHA-256 해시만 있고(그것이 이 표의 규칙이다),
 * 평문은 메일로만 나간다. spy 는 실제 동작을 그대로 통과시키므로 발송 경로도 함께 돈다.</p>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class MagicLinkE2ETest {

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

    /** 실제 발송을 막지 않는다 — 원문 토큰만 들여다본다 */
    @MockitoSpyBean
    MailService mailService;

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("ixauth.service-key", () -> SERVICE_KEY);
        registry.add("ixauth.jwt.issuer", () -> "https://test.example.com");
        registry.add("ixauth.admin.email", () -> ADMIN_EMAIL);
        registry.add("ixauth.admin.password", () -> ADMIN_PASSWORD);

        registry.add("ixauth.account.magic-link-enabled", () -> true);
        registry.add("ixauth.mail.app-base-url", () -> "https://myapp.example.com");

        // 한 IP(테스트 JVM)에서 수십 번 친다 — 실사용 패턴이 아니다.
        // 필터를 끄지 않고 한도만 올린다. 꺼 버리면 필터가 깨져도 여기서 드러나지 않는다
        registry.add("ixauth.rate-limit.login-per-minute", () -> 10_000);
        registry.add("ixauth.rate-limit.default-per-minute", () -> 10_000);
        registry.add("ixauth.account.resend-cooldown", () -> "0s");
    }

    // ────────────────────────── 검사 ──────────────────────────

    @Test
    @DisplayName("메일의 링크로 비밀번호 없이 로그인된다 — 그리고 그 링크는 한 번만 통한다")
    void magicLinkLogsInOnceAndOnlyOnce() {
        String admin = adminToken();
        String email = unique("magic");
        createUser(admin, email);

        String token = requestAndCaptureToken(email);
        assertThat(token).as("메일로 나갈 원문 토큰이 없다").isNotBlank();

        var res = post("/auth/magic-link/verify", Map.of("token", token));
        assertThat(res.status()).as("응답: %s", res.body()).isEqualTo(200);

        var data = res.body().get("data");
        assertThat(data.get("accessToken").asString()).isNotBlank();
        assertThat(data.get("refreshToken").asString()).isNotBlank();
        assertThat(data.get("user").get("email").asString()).isEqualTo(email);

        // 재사용 — 1회용이 아니면 메일함에 남은 링크가 영구 로그인 수단이 된다
        var again = post("/auth/magic-link/verify", Map.of("token", token));
        assertThat(again.status()).as("★같은 링크로 두 번 로그인됐다★").isEqualTo(401);
        assertThat(errorCode(again)).isEqualTo("AUTH_TOKEN_EXPIRED");
    }

    @Test
    @DisplayName("새 링크를 받으면 앞선 링크는 죽는다 — 옛 메일 하나가 새어도 소용없게")
    void newLinkInvalidatesTheOldOne() {
        String email = unique("rotate");
        createUser(adminToken(), email);

        String first = requestAndCaptureToken(email);
        String second = requestAndCaptureToken(email);
        assertThat(second).isNotEqualTo(first);

        var stale = post("/auth/magic-link/verify", Map.of("token", first));
        assertThat(stale.status()).as("★옛 링크가 아직 살아 있다★").isEqualTo(401);
        assertThat(post("/auth/magic-link/verify", Map.of("token", second)).status())
                .isEqualTo(200);
    }

    @Test
    @DisplayName("계정이 없어도 같은 응답이다 — 다르면 이 화면이 가입자 명부가 된다")
    void doesNotRevealWhetherAccountExists() {
        var known = post("/auth/magic-link/request", Map.of("email", ADMIN_EMAIL));
        var unknown = post("/auth/magic-link/request",
                Map.of("email", unique("nobody")));

        assertThat(unknown.status()).isEqualTo(known.status());
        assertThat(unknown.body().toString()).isEqualTo(known.body().toString());
    }

    @Test
    @DisplayName("위조 토큰과 다른 용도의 토큰은 통하지 않는다")
    void rejectsForgedAndForeignTokens() {
        assertThat(post("/auth/magic-link/verify",
                Map.of("token", "forged-" + UUID.randomUUID())).status()).isEqualTo(401);

        // 재설정 토큰으로 로그인되면, 가장 수명이 긴 링크가 곧 로그인 수단이 된다
        String email = unique("foreign");
        createUser(adminToken(), email);
        clearInvocations(mailService);
        post("/auth/password/forgot", Map.of("email", email));

        var captor = ArgumentCaptor.forClass(String.class);
        verify(mailService, atLeastOnce())
                .sendPasswordReset(anyString(), anyString(), captor.capture());
        String resetToken = captor.getValue();

        var res = post("/auth/magic-link/verify", Map.of("token", resetToken));
        assertThat(res.status()).as("★재설정 링크로 로그인이 됐다★").isEqualTo(401);
        assertThat(errorCode(res)).isEqualTo("AUTH_TOKEN_INVALID");
    }

    @Test
    @DisplayName("★2단계를 켠 계정은 매직 링크로도 코드를 한 번 더 받는다 — 우회로가 되면 안 된다★")
    void doesNotBypassMfa() {
        String email = unique("magicmfa");
        String password = "M4gic!Pass12";
        createUser(adminToken(), email, password);

        // 2단계 등록 — 여기까지는 비밀번호 로그인으로 한다
        String token = login(email, password).get("accessToken").asString();
        String uri = post("/auth/mfa/totp/setup", token, Map.of())
                .body().get("data").get("otpauthUri").asString();
        byte[] secret = Base32.decode(uri.split("secret=")[1].split("&")[0]);
        assertThat(post("/auth/mfa/totp/confirm", token,
                Map.of("code", code(secret, 0))).status()).isEqualTo(200);

        // 이제 매직 링크로 들어가 본다
        var res = post("/auth/magic-link/verify",
                Map.of("token", requestAndCaptureToken(email)));
        assertThat(res.status())
                .as("★메일 한 통으로 2단계가 통째로 우회된다★").isEqualTo(401);
        assertThat(errorCode(res)).isEqualTo("AUTH_MFA_REQUIRED");

        String challenge = res.body().get("error").get("meta").get("challenge").asString();
        assertThat(challenge).isNotBlank();

        // 로그인 2단계와 완전히 같은 경로로 이어진다 — 앱은 화면을 새로 만들지 않아도 된다
        var verified = post("/auth/mfa/verify",
                Map.of("challenge", challenge, "code", code(secret, 1)));
        assertThat(verified.status()).as("응답: %s", verified.body()).isEqualTo(200);
        assertThat(verified.body().get("data").get("accessToken").asString()).isNotBlank();
    }

    @Test
    @DisplayName("기능을 끄면 요청 자체가 막힌다 — 앱은 그 신호로 버튼을 감춘다")
    void disabledFeatureIsRejected() {
        String admin = adminToken();
        setSetting(admin, "account.magic-link-enabled", "false");
        try {
            var res = post("/auth/magic-link/request", Map.of("email", ADMIN_EMAIL));
            assertThat(res.status()).isEqualTo(403);
            assertThat(errorCode(res)).isEqualTo("AUTHZ_FORBIDDEN");
        } finally {
            setSetting(admin, "account.magic-link-enabled", "true");
        }
    }

    // ────────────────────────── 헬퍼 ──────────────────────────

    /** 요청을 보내고 메일로 나간 <b>원문</b> 토큰을 가로챈다 */
    private String requestAndCaptureToken(String email) {
        clearInvocations(mailService);
        var res = post("/auth/magic-link/request", Map.of("email", email));
        assertThat(res.status()).as("요청 응답: %s", res.body()).isEqualTo(200);

        var captor = ArgumentCaptor.forClass(String.class);
        verify(mailService, atLeastOnce())
                .sendMagicLink(anyString(), anyString(), captor.capture());
        return captor.getValue();
    }

    private String code(byte[] secret, int stepOffset) {
        return TotpGenerator.code(secret, TotpGenerator.stepAt(Instant.now()) + stepOffset);
    }

    private static String unique(String prefix) {
        return prefix + "-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    }

    private String adminToken() {
        return login(ADMIN_EMAIL, ADMIN_PASSWORD).get("accessToken").asString();
    }

    private JsonNode login(String email, String password) {
        var res = post("/auth/login", Map.of("email", email, "password", password));
        assertThat(res.status()).as("로그인 실패: %s", res.body()).isEqualTo(200);
        return res.body().get("data");
    }

    private void createUser(String adminToken, String email) {
        createUser(adminToken, email, "M4gic!Pass12");
    }

    private void createUser(String adminToken, String email, String password) {
        var res = post("/admin/users", adminToken, Map.of(
                "email", email, "name", email.split("@")[0], "password", password));
        assertThat(res.status()).as("계정 생성 실패: %s", res.body()).isIn(200, 201);
    }

    private void setSetting(String adminToken, String key, String value) {
        var req = builder("/admin/settings/" + key, null, adminToken)
                .method("PUT", body(Map.of("value", value)));
        assertThat(send(req).status()).as("설정 변경 실패(%s=%s)", key, value).isEqualTo(200);
    }

    private static String errorCode(Res res) {
        return res.body().get("error").get("code").asString();
    }

    // ── HTTP ──

    private record Res(int status, JsonNode body) {
    }

    /** 서비스 키로 부르는 경로 */
    private Res post(String path, Map<String, Object> payload) {
        return send(builder(path, SERVICE_KEY, null).POST(body(payload)));
    }

    /** access token 으로 부르는 경로 */
    private Res post(String path, String bearer, Map<String, Object> payload) {
        return send(builder(path, null, bearer).POST(body(payload)));
    }

    private static HttpRequest.BodyPublisher body(Map<String, Object> payload) {
        return HttpRequest.BodyPublishers.ofString(MAPPER.writeValueAsString(payload));
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
            var raw = CLIENT.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            JsonNode node = (raw.body() == null || raw.body().isBlank())
                    ? MAPPER.createObjectNode()
                    : MAPPER.readTree(raw.body());
            return new Res(raw.statusCode(), node);
        } catch (Exception e) {
            throw new IllegalStateException("요청 실패", e);
        }
    }
}
