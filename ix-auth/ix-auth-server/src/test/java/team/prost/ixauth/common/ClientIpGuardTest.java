package team.prost.ixauth.common;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import team.prost.ixauth.config.IxAuthProperties;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 잘못된 연동 감지.
 *
 * <p>이 판정이 틀리면 두 가지로 나빠진다 - 진짜 사고(경유지 주소가 감사 로그에 굳는 것)를
 * 놓치거나, 정상 주소마다 경고를 찍어 아무도 로그를 읽지 않게 만들거나.</p>
 */
class ClientIpGuardTest {

    @Test
    @DisplayName("사설망·링크로컬은 방문자 주소일 수 없다. 도커 브리지·리버스 프록시의 주소다")
    void privateRangesAreFlagged() {
        assertThat(ClientIpGuard.classify("172.19.0.1")).isEqualTo(ClientIpGuard.Reason.PRIVATE);
        assertThat(ClientIpGuard.classify("10.0.3.14")).isEqualTo(ClientIpGuard.Reason.PRIVATE);
        assertThat(ClientIpGuard.classify("192.168.1.20")).isEqualTo(ClientIpGuard.Reason.PRIVATE);
        assertThat(ClientIpGuard.classify("169.254.1.1")).isEqualTo(ClientIpGuard.Reason.LINK_LOCAL);
        assertThat(ClientIpGuard.classify("127.0.0.1")).isEqualTo(ClientIpGuard.Reason.LOOPBACK);
        assertThat(ClientIpGuard.classify("::1")).isEqualTo(ClientIpGuard.Reason.LOOPBACK);
        assertThat(ClientIpGuard.classify("fd00::1")).isEqualTo(ClientIpGuard.Reason.PRIVATE);
    }

    @Test
    @DisplayName("Cloudflare 엣지 대역은 XFF 첫 조각을 그대로 믿었다는 신호다")
    void cloudflareEdgeIsFlagged() {
        assertThat(ClientIpGuard.classify("172.70.100.5")).isEqualTo(ClientIpGuard.Reason.CDN_EDGE);
        assertThat(ClientIpGuard.classify("104.16.0.1")).isEqualTo(ClientIpGuard.Reason.CDN_EDGE);
        assertThat(ClientIpGuard.classify("108.162.192.9")).isEqualTo(ClientIpGuard.Reason.CDN_EDGE);
        assertThat(ClientIpGuard.classify("103.21.244.1")).isEqualTo(ClientIpGuard.Reason.CDN_EDGE);
    }

    @Test
    @DisplayName("평범한 공인 주소는 건드리지 않는다. 소음이 되면 아무도 로그를 안 읽는다")
    void publicAddressesPass() {
        assertThat(ClientIpGuard.classify("203.0.113.7")).isNull();
        assertThat(ClientIpGuard.classify("8.8.8.8")).isNull();
        assertThat(ClientIpGuard.classify("172.15.255.254")).isNull();   // 사설망 바로 앞
        assertThat(ClientIpGuard.classify("172.32.0.1")).isNull();       // 사설망 바로 뒤
        assertThat(ClientIpGuard.classify("2001:db8::1")).isNull();
        assertThat(ClientIpGuard.classify(null)).isNull();
        assertThat(ClientIpGuard.classify("unknown")).isNull();
    }

    @Test
    @DisplayName("감지는 매번 세고 로그는 원인별로 억제한다. 끄면 아무것도 세지 않는다")
    void countsEveryDetectionAndRemembersTheLastOne() {
        var props = new IxAuthProperties();
        var guard = new ClientIpGuard(props);

        guard.inspect("LOGIN_SUCCESS", "172.19.0.1");
        guard.inspect("LOGIN_SUCCESS", "172.19.0.1");
        guard.inspect("LOGIN_SUCCESS", "127.0.0.1");     // 기본값은 루프백을 넘긴다

        var snapshot = guard.snapshot();
        assertThat(snapshot.get("mode")).isEqualTo("WARN");
        assertThat(snapshot.get("detections")).isEqualTo(2L);
        assertThat(snapshot.get("lastIp")).isEqualTo("172.19.0.1");
        assertThat(snapshot.get("lastReason")).isEqualTo("PRIVATE");
        assertThat(snapshot.get("lastEvent")).isEqualTo("LOGIN_SUCCESS");

        props.getAudit().setClientIpGuard(IxAuthProperties.Audit.ClientIpGuardMode.OFF);
        guard.inspect("LOGIN_SUCCESS", "172.19.0.1");
        assertThat(guard.snapshot().get("detections")).isEqualTo(2L);

        props.getAudit().setClientIpGuard(IxAuthProperties.Audit.ClientIpGuardMode.STRICT);
        guard.inspect("LOGIN_SUCCESS", "127.0.0.1");
        assertThat(guard.snapshot().get("detections")).isEqualTo(3L);
        assertThat(guard.snapshot().get("lastReason")).isEqualTo("LOOPBACK");
    }
}
