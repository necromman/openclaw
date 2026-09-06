package team.prost.ixauth.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import team.prost.ixauth.common.ClientInfo;
import team.prost.ixauth.config.IxAuthProperties;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 속도 제한 — E2E 는 한도를 올려 두므로 필터 자체는 여기서 고정한다.
 *
 * <p>한도를 올린 채로만 돌리면 필터가 깨져도 드러나지 않는다.</p>
 */
class RateLimitFilterTest {

    private static final String LOGIN = "/auth/login";

    private RateLimitFilter filter(int loginPerMinute) {
        var props = new IxAuthProperties();
        props.setServiceKey("test-service-key-at-least-32-characters");
        props.getRateLimit().setLoginPerMinute(loginPerMinute);
        props.getRateLimit().setDefaultPerMinute(loginPerMinute);
        return new RateLimitFilter(props, new ClientInfo(), new ObjectMapper());
    }

    private int hit(RateLimitFilter f, String path, String ip) throws Exception {
        var req = new MockHttpServletRequest("POST", path);
        req.setRemoteAddr(ip);
        var res = new MockHttpServletResponse();
        FilterChain chain = (a, b) -> ((HttpServletResponse) b).setStatus(200);
        f.doFilter(req, res, chain);
        return res.getStatus();
    }

    @Test
    @DisplayName("한도를 넘으면 429 와 Retry-After 를 준다")
    void rejectsOverLimit() throws Exception {
        var f = filter(3);
        assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(200);
        assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(200);
        assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(200);

        var req = new MockHttpServletRequest("POST", LOGIN);
        req.setRemoteAddr("1.1.1.1");
        var res = new MockHttpServletResponse();
        f.doFilter(req, res, (a, b) -> ((HttpServletResponse) b).setStatus(200));

        assertThat(res.getStatus()).isEqualTo(429);
        assertThat(res.getHeader("Retry-After")).isNotNull();
        assertThat(res.getContentAsString()).contains("RATE_LIMITED");
    }

    @Test
    @DisplayName("IP 가 다르면 서로의 한도를 쓰지 않는다")
    void countsPerIp() throws Exception {
        var f = filter(2);
        assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(200);
        assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(200);
        assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(429);

        // 다른 IP 는 영향을 받지 않는다 — 한 명이 모두를 막을 수 있으면 그것이 DoS 다
        assertThat(hit(f, LOGIN, "2.2.2.2")).isEqualTo(200);
    }

    @Test
    @DisplayName("메일을 유발하는 요청은 로그인과 다른 버킷이다")
    void separatesMailBucket() throws Exception {
        var f = filter(2);
        assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(200);
        assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(200);
        assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(429);

        // 로그인이 막혔다고 비밀번호 찾기까지 막히면, 메일 폭탄을 보내는 쪽이
        // 남의 로그인을 막을 수 있게 된다
        assertThat(hit(f, "/auth/password/forgot", "1.1.1.1")).isEqualTo(200);
    }

    @Test
    @DisplayName("헬스체크와 JWKS 는 제한 밖 — 제한이 장애를 만들면 안 된다")
    void skipsHealthAndJwks() {
        var f = filter(1);
        assertThat(skips(f, "/health")).isTrue();
        assertThat(skips(f, "/.well-known/jwks.json")).isTrue();
        assertThat(skips(f, "/admin-ui/index.html")).isTrue();
        assertThat(skips(f, LOGIN)).isFalse();
    }

    @Test
    @DisplayName("enabled=false 면 세지 않는다")
    void canBeDisabled() throws Exception {
        var props = new IxAuthProperties();
        props.setServiceKey("test-service-key-at-least-32-characters");
        props.getRateLimit().setEnabled(false);
        props.getRateLimit().setLoginPerMinute(1);
        var f = new RateLimitFilter(props, new ClientInfo(), new ObjectMapper());

        for (int i = 0; i < 5; i++) {
            assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(200);
        }
    }

    @Test
    @DisplayName("storage=DATABASE 면 공용 카운터에서 센다 — 인스턴스가 여럿이어도 한 한도다")
    void countsInSharedStoreWhenDatabase() throws Exception {
        var props = new IxAuthProperties();
        props.setServiceKey("test-service-key-at-least-32-characters");
        props.getRateLimit().setLoginPerMinute(2);
        props.getRateLimit().setStorage(IxAuthProperties.RateLimit.Storage.DATABASE);

        var shared = org.mockito.Mockito.mock(RateLimitCounters.class);
        org.mockito.Mockito.when(shared.increment(org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyLong())).thenReturn(1, 2, 3);

        var f = new RateLimitFilter(props, new ClientInfo(), new ObjectMapper(), shared);
        assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(200);
        assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(200);
        assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(429);
    }

    @Test
    @DisplayName("공용 카운터가 죽으면 메모리로 되돌아가 센다 — 그냥 통과시키지 않는다")
    void fallsBackToMemoryWhenSharedStoreFails() throws Exception {
        var props = new IxAuthProperties();
        props.setServiceKey("test-service-key-at-least-32-characters");
        props.getRateLimit().setLoginPerMinute(2);
        props.getRateLimit().setStorage(IxAuthProperties.RateLimit.Storage.DATABASE);

        var shared = org.mockito.Mockito.mock(RateLimitCounters.class);
        org.mockito.Mockito.when(shared.increment(org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.anyLong()))
                .thenThrow(new IllegalStateException("DB 없음"));

        // DB 가 흔들리는 동안 문이 열리면 그때가 무차별 대입에 가장 좋은 순간이 된다
        var f = new RateLimitFilter(props, new ClientInfo(), new ObjectMapper(), shared);
        assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(200);
        assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(200);
        assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(429);
    }

    @Test
    @DisplayName("기본은 MEMORY — 공용 저장소가 있어도 부르지 않는다")
    void memoryIsTheDefault() throws Exception {
        var props = new IxAuthProperties();
        props.setServiceKey("test-service-key-at-least-32-characters");
        props.getRateLimit().setLoginPerMinute(5);
        assertThat(props.getRateLimit().getStorage())
                .isEqualTo(IxAuthProperties.RateLimit.Storage.MEMORY);

        var shared = org.mockito.Mockito.mock(RateLimitCounters.class);
        var f = new RateLimitFilter(props, new ClientInfo(), new ObjectMapper(), shared);
        assertThat(hit(f, LOGIN, "1.1.1.1")).isEqualTo(200);
        // 로그인 경로에 DB 왕복이 붙지 않는다는 것이 기본값의 이유다
        org.mockito.Mockito.verifyNoInteractions(shared);
    }

    private boolean skips(RateLimitFilter f, String path) {
        var req = new MockHttpServletRequest("GET", path);
        try {
            var m = RateLimitFilter.class.getDeclaredMethod("shouldNotFilter",
                    HttpServletRequest.class);
            m.setAccessible(true);
            return (boolean) m.invoke(f, req);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
