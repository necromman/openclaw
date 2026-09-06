package team.prost.ixauth;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 잘못된 경로·메서드가 어떤 응답이 되는가.
 *
 * <p>실측에서 <b>없는 경로가 전부 500 + 스택트레이스</b>로 나오는 것을 발견해 넣은 자리다.
 * 두 가지가 함께 망가진다 — 클라이언트는 500 을 "서버 고장" 으로 읽어 재시도하고,
 * 오타·봇 스캔 하나하나가 ERROR 로그가 되어 진짜 장애를 덮는다.</p>
 *
 * <p>관리 콘솔 정적 파일을 서빙하기 때문에 매핑되지 않은 요청은 정적 리소스 탐색까지 간 뒤
 * {@code NoResourceFoundException} 으로 끝난다 — 그래서 그 예외까지 잡아야 한다.</p>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class ErrorRoutingTest {

    private static final String SERVICE_KEY = "test-service-key-must-be-at-least-32-chars";
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
        registry.add("ixauth.jwt.issuer", () -> "https://err-test.example.com");
        registry.add("ixauth.admin.email", () -> "admin@example.com");
        registry.add("ixauth.admin.password", () -> "Adm1n!Passw0rd");
    }

    private HttpResponse<String> send(String method, String path) {
        try {
            var req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                    .header("Content-Type", "application/json")
                    .header("X-IxAuth-Key", SERVICE_KEY)
                    .method(method, HttpRequest.BodyPublishers.ofString("{}"))
                    .timeout(Duration.ofSeconds(10))
                    .build();
            return CLIENT.send(req, HttpResponse.BodyHandlers.ofString());
        } catch (IOException | InterruptedException e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    @DisplayName("없는 경로는 404 다 — 500 이면 클라이언트가 재시도하고 로그가 오염된다")
    void unknownPathIsNotFound() {
        for (String path : new String[]{
                "/auth/no-such-thing",
                "/admin/no-such-thing",
                "/admin/terms/00000000-0000-0000-0000-000000000000/unpublish"}) {
            var res = send("POST", path);
            assertThat(res.statusCode()).as("POST %s", path).isEqualTo(404);
            assertThat(res.body()).contains("NOT_FOUND");
            // 응답에 내부 구조가 새지 않아야 한다
            assertThat(res.body()).doesNotContain("Exception").doesNotContain("team.prost");
        }
    }

    @Test
    @DisplayName("경로는 맞고 메서드가 다르면 405 이고 Allow 헤더로 허용 메서드를 알려준다")
    void wrongMethodIsMethodNotAllowed() {
        // /auth/login 은 POST 만 받는다
        var res = send("DELETE", "/auth/login");
        assertThat(res.statusCode()).isEqualTo(405);
        assertThat(res.body()).contains("METHOD_NOT_ALLOWED");
        assertThat(res.headers().firstValue("Allow").orElse("")).contains("POST");
    }

    @Test
    @DisplayName("살아 있는 경로는 그대로 동작한다 — 위 두 핸들러가 정상 라우팅을 가로채지 않는다")
    void realEndpointStillWorks() {
        var res = send("GET", "/health");
        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body()).contains("UP");
    }
}
