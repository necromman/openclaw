package team.prost.ixauth.common;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * 현재 요청의 클라이언트 정보 추출 — 감사 로그용.
 *
 * <p>IX-Auth 는 <b>앱 뒤에 있다</b>. 앱이 중계하므로 {@code getRemoteAddr()} 는 앱 서버의
 * 주소일 뿐 최종 사용자의 IP 가 아니다. 그래서 순서를 이렇게 둔다:</p>
 *
 * <ol>
 *   <li>호출자가 명시적으로 넘긴 값 (앱이 `/auth/login` 본문에 실어 보내는 최종 사용자 IP)</li>
 *   <li>{@code X-Forwarded-For} 의 첫 항목</li>
 *   <li>{@code X-Real-IP}</li>
 *   <li>{@code getRemoteAddr()}</li>
 * </ol>
 *
 * <p>jar 는 외부에 노출되지 않고 앱만 호출하므로(설계 불변식 4) 이 헤더들을 신뢰할 수 있다.
 * 인터넷에 직접 노출한다면 스푸핑이 가능하므로 그 자체가 설계 위반이다.</p>
 */
@Component
public class ClientInfo {

    private static final String LOOPBACK_V4 = "127.0.0.1";

    /** 명시값이 있으면 그것을, 없으면 현재 요청에서 뽑는다 */
    public String ip(String explicit) {
        if (hasText(explicit)) {
            return normalize(explicit);
        }
        return ipOf(currentRequest());
    }

    /**
     * 요청을 이미 들고 있는 곳(필터 등)에서 쓴다.
     *
     * <p>필터는 자기 {@code request} 가 있는데 {@code RequestContextHolder} 를 거칠
     * 이유가 없다. 거치면 홀더가 아직 세팅되기 전에 도는 필터에서 null 을 받는다.</p>
     */
    public String ipOf(HttpServletRequest req) {
        if (req == null) {
            return null;
        }
        String forwarded = req.getHeader("X-Forwarded-For");
        if (hasText(forwarded)) {
            // "client, proxy1, proxy2" — 맨 앞이 최종 사용자
            return normalize(forwarded.split(",")[0].trim());
        }
        String real = req.getHeader("X-Real-IP");
        if (hasText(real)) {
            return normalize(real);
        }
        return normalize(req.getRemoteAddr());
    }

    public String userAgent(String explicit) {
        if (hasText(explicit)) {
            return truncate(explicit);
        }
        HttpServletRequest req = currentRequest();
        return req == null ? null : truncate(req.getHeader("User-Agent"));
    }

    /**
     * IPv6 루프백을 IPv4 표기로 통일한다.
     *
     * <p>같은 로컬 접속이 {@code ::1} 과 {@code 0:0:0:0:0:0:0:1} 두 가지로 찍히면
     * 감사 로그를 IP 로 묶어 보기 어렵다.</p>
     */
    private String normalize(String ip) {
        if (!hasText(ip)) {
            return null;
        }
        String v = ip.trim();
        if ("::1".equals(v) || "0:0:0:0:0:0:0:1".equals(v)) {
            return LOOPBACK_V4;
        }
        // IPv4-mapped IPv6 (::ffff:192.168.0.1) 은 뒤쪽 IPv4 만 남긴다
        if (v.startsWith("::ffff:") && v.indexOf('.') > 0) {
            return v.substring("::ffff:".length());
        }
        return v.length() > 45 ? v.substring(0, 45) : v;
    }

    private String truncate(String ua) {
        if (!hasText(ua)) {
            return null;
        }
        return ua.length() > 500 ? ua.substring(0, 500) : ua;
    }

    private HttpServletRequest currentRequest() {
        var attrs = RequestContextHolder.getRequestAttributes();
        return (attrs instanceof ServletRequestAttributes sra) ? sra.getRequest() : null;
    }

    private boolean hasText(String s) {
        return s != null && !s.isBlank();
    }
}
