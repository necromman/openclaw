package team.prost.ixauth.common;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import team.prost.ixauth.config.IxAuthProperties;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 잘못된 연동을 서버가 스스로 알아챈다.
 *
 * <p>IX-Auth 는 앱 뒤에 있어서 방문자의 주소를 스스로 알 수 없다. 앱이 넘기는 값이
 * 유일한 근거이고, 앱이 경유지 주소(도커 브리지 · 리버스 프록시 · CDN 엣지)를 넘기면
 * 감사 로그와 세션 목록에 그 경유지가 박힌 채로 굳는다. <b>사후에 진짜 주소를 되찾을
 * 방법은 없다.</b> 그런데 이 실수는 화면에서 아무 증상도 내지 않아, 사고가 나서 로그를
 * 뒤질 때에야 드러난다.</p>
 *
 * <p>그래서 감사 기록이 남는 순간 IP 를 보고 <b>방문자일 수 없는 주소</b>면 시스템
 * 로그에 경고를 띄운다. 연동을 만든 사람(사람이든 AI 든)이 개발 중에 바로 알아채는 것이
 * 목적이다. 판정 결과가 기록을 바꾸지는 않는다 - 넘어온 값을 그대로 적고 경고만 붙인다.</p>
 *
 * <p>바로잡는 방법은 {@code docs/guides/client-ip.md} 에 있다.</p>
 *
 * <p>켜고 끄는 것은 설정 {@code ixauth.audit.client-ip-guard} 다
 * ({@code WARN} 기본 · {@code OFF} 끔 · {@code STRICT} 루프백까지 경고).
 * 기본값이 루프백을 넘기는 이유: 로컬 개발에서는 앱도 jar 도 같은 호스트라 방문자가
 * 실제로 {@code 127.0.0.1} 이다. 그것까지 경고하면 개발 중 모든 로그인이 경고를 찍고,
 * 그렇게 늘 켜져 있는 경고는 곧 아무도 읽지 않는다.</p>
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ClientIpGuard {

    /** 같은 원인으로 로그가 폭주하지 않게 억제하는 간격 */
    private static final long SUPPRESS_WINDOW_MS = 10 * 60 * 1000L;

    /**
     * Cloudflare 공개 IPv4 대역.
     *
     * <p>정책이 아니라 <b>사실</b>이라 상수로 둔다. 이 대역이 감사 IP 로 올라왔다는 것은
     * 앱이 XFF 첫 조각을 그대로 믿었다는 뜻이다 - Cloudflare 뒤에서는 그 자리가 엣지
     * 서버 주소로 채워져 나가는 구성이 흔하다.</p>
     */
    private static final List<Cidr> CDN_EDGE_RANGES = List.of(
            "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "162.158.0.0/15",
            "131.0.72.0/22", "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20",
            "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "173.245.48.0/20",
            "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22").stream()
            .map(Cidr::of).toList();

    private static final List<Cidr> PRIVATE_RANGES = List.of(
            "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16").stream()
            .map(Cidr::of).toList();

    private static final Cidr LINK_LOCAL_RANGE = Cidr.of("169.254.0.0/16");
    private static final Cidr LOOPBACK_RANGE = Cidr.of("127.0.0.0/8");

    private final IxAuthProperties properties;

    private final Map<String, Long> lastLoggedAt = new ConcurrentHashMap<>();
    private final Map<String, AtomicLong> countByReason = new ConcurrentHashMap<>();
    private final AtomicLong detections = new AtomicLong();

    private volatile Instant lastAt;
    private volatile String lastIp;
    private volatile String lastReason;
    private volatile String lastEvent;

    /**
     * 감사 IP 를 보고 방문자일 수 없는 주소면 경고한다.
     *
     * <p><b>절대 예외를 던지지 않는다.</b> 진단 장치가 본업(감사 기록)을 깨뜨리면
     * 장치를 둔 것이 손해다.</p>
     */
    public void inspect(String eventType, String ip) {
        try {
            var mode = properties.getAudit().getClientIpGuard();
            if (mode == IxAuthProperties.Audit.ClientIpGuardMode.OFF || ip == null || ip.isBlank()) {
                return;
            }
            Reason reason = classify(ip);
            if (reason == null) {
                return;
            }
            if (reason == Reason.LOOPBACK
                    && mode != IxAuthProperties.Audit.ClientIpGuardMode.STRICT) {
                return;
            }
            record(eventType, ip, reason);
        } catch (Exception e) {
            log.debug("[client-ip-guard] 판정 실패 ({})", e.getMessage());
        }
    }

    private void record(String eventType, String ip, Reason reason) {
        detections.incrementAndGet();
        lastAt = Instant.now();
        lastIp = ip;
        lastReason = reason.name();
        lastEvent = eventType;

        String key = eventType + "|" + reason.name();
        long total = countByReason.computeIfAbsent(key, k -> new AtomicLong()).incrementAndGet();
        if (!shouldLog(key)) {
            return;
        }
        log.warn("[client-ip-guard] {} 의 감사 IP {} 은 {} - {} "
                        + "(docs/guides/client-ip.md · 이 원인 누적 {}건, 10분에 한 번만 알립니다)",
                eventType, ip, reason.what, reason.how, total);
    }

    /** 같은 이벤트·같은 원인이면 10분에 한 번만 찍는다 */
    private boolean shouldLog(String key) {
        long now = System.currentTimeMillis();
        Long previous = lastLoggedAt.get(key);
        if (previous != null && now - previous < SUPPRESS_WINDOW_MS) {
            return false;
        }
        lastLoggedAt.put(key, now);
        return true;
    }

    /**
     * 운영 상태 한 칸 - {@code GET /admin/system/status} 가 그대로 실어 준다.
     *
     * <p>로그를 보지 않는 운영자도 "연동이 IP 를 잘못 넘기고 있다" 를 화면에서 본다.</p>
     */
    public Map<String, Object> snapshot() {
        var out = new LinkedHashMap<String, Object>();
        out.put("mode", properties.getAudit().getClientIpGuard().name());
        out.put("detections", detections.get());
        out.put("lastAt", lastAt == null ? null : lastAt.toString());
        out.put("lastIp", lastIp);
        out.put("lastReason", lastReason);
        out.put("lastEvent", lastEvent);
        return out;
    }

    /**
     * 방문자일 수 없는 주소인지 가른다.
     *
     * @return 걸리면 사유, 정상적인 공인 주소면 {@code null}
     */
    public static Reason classify(String ip) {
        if (ip == null || ip.isBlank()) {
            return null;
        }
        String v = ip.trim();
        Long v4 = toV4(v);
        if (v4 == null) {
            return classifyV6(v);
        }
        if (LOOPBACK_RANGE.contains(v4)) {
            return Reason.LOOPBACK;
        }
        if (LINK_LOCAL_RANGE.contains(v4)) {
            return Reason.LINK_LOCAL;
        }
        for (Cidr range : PRIVATE_RANGES) {
            if (range.contains(v4)) {
                return Reason.PRIVATE;
            }
        }
        for (Cidr range : CDN_EDGE_RANGES) {
            if (range.contains(v4)) {
                return Reason.CDN_EDGE;
            }
        }
        return null;
    }

    /** IPv6 는 대역 표가 필요 없다 - 루프백·링크로컬·유니크로컬 세 갈래면 충분하다 */
    private static Reason classifyV6(String v) {
        String lower = v.toLowerCase(java.util.Locale.ROOT);
        if (!lower.contains(":")) {
            return null;
        }
        if ("::1".equals(lower) || "0:0:0:0:0:0:0:1".equals(lower)) {
            return Reason.LOOPBACK;
        }
        if (lower.startsWith("fe8") || lower.startsWith("fe9")
                || lower.startsWith("fea") || lower.startsWith("feb")) {
            return Reason.LINK_LOCAL;
        }
        // fc00::/7 - 유니크 로컬 (IPv4 의 사설망에 해당)
        if (lower.startsWith("fc") || lower.startsWith("fd")) {
            return Reason.PRIVATE;
        }
        return null;
    }

    /** 점 넷으로 된 IPv4 만 숫자로 바꾼다. 아니면 {@code null} */
    private static Long toV4(String v) {
        String[] parts = v.split("\\.");
        if (parts.length != 4) {
            return null;
        }
        long value = 0;
        for (String part : parts) {
            if (part.isEmpty() || part.length() > 3) {
                return null;
            }
            int octet = 0;
            for (int i = 0; i < part.length(); i++) {
                char c = part.charAt(i);
                if (c < '0' || c > '9') {
                    return null;
                }
                octet = octet * 10 + (c - '0');
            }
            if (octet > 255) {
                return null;
            }
            value = (value << 8) | octet;
        }
        return value;
    }

    /**
     * 경고 문구의 두 조각 - <b>무엇이 이상한가</b>와 <b>어떻게 고치는가</b>.
     *
     * <p>원인만 적고 해법을 안 적으면 읽은 사람이 다시 검색해야 한다. 한 줄에 둘 다 담는다.</p>
     */
    public enum Reason {

        PRIVATE("사설망 주소입니다",
                "연동 앱이 실방문자 IP 를 넘기지 않았습니다. "
                        + "로그인은 본문 ip, 갱신·로그아웃은 X-Forwarded-For 헤더로 전달하세요"),

        LINK_LOCAL("링크로컬 주소입니다",
                "연동 앱이 실방문자 IP 를 넘기지 않았습니다. "
                        + "로그인은 본문 ip, 갱신·로그아웃은 X-Forwarded-For 헤더로 전달하세요"),

        LOOPBACK("루프백 주소입니다",
                "앱과 jar 가 같은 호스트인 로컬 개발이라면 정상입니다. "
                        + "아니라면 연동 앱이 실방문자 IP 를 넘기지 않은 것입니다"),

        CDN_EDGE("Cloudflare 엣지 주소입니다",
                "X-Forwarded-For 첫 조각 대신 CF-Connecting-IP 를 우선하세요");

        private final String what;
        private final String how;

        Reason(String what, String how) {
            this.what = what;
            this.how = how;
        }

        public String what() {
            return what;
        }

        public String how() {
            return how;
        }
    }

    /** IPv4 대역 하나. 문자열 비교 대신 마스크 한 번으로 판정한다 */
    private record Cidr(long network, long mask) {

        static Cidr of(String spec) {
            String[] parts = spec.split("/");
            int bits = Integer.parseInt(parts[1]);
            long mask = bits == 0 ? 0L : (0xFFFFFFFFL << (32 - bits)) & 0xFFFFFFFFL;
            Long network = toV4(parts[0]);
            if (network == null) {
                throw new IllegalArgumentException("잘못된 대역: " + spec);
            }
            return new Cidr(network & mask, mask);
        }

        boolean contains(long ip) {
            return (ip & mask) == network;
        }
    }
}
