package team.prost.ixauth.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;
import team.prost.ixauth.common.ApiResponse;
import team.prost.ixauth.common.ClientInfo;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * IP 기준 요청 속도 제한.
 *
 * <p>계정 잠금만으로는 부족하다. 잠금은 <b>계정당</b>이라, 한 곳에서 수천 개
 * 계정에 한 번씩 흔한 비밀번호를 시도하는 방식(password spraying)은 어느 계정도
 * 잠그지 못한 채 통과한다. 비밀번호 찾기 남용도 마찬가지다.</p>
 *
 * <p><b>기본은 메모리에 센다.</b> 전용 Redis 를 두지 않는 것이 설계 불변식 3 이므로,
 * 인스턴스를 여러 개 띄우면 한도는 인스턴스별로 적용된다 — 2대면 실질 한도가 2배다.
 * 그것이 곤란한 설치는 {@code ixauth.rate-limit.storage=DATABASE} 로 공용 DB 에서 센다
 * (G26). 기본을 메모리로 두는 이유는 DB 왕복이 <b>로그인 경로</b>에 붙기 때문이다.</p>
 *
 * <p>어느 쪽이든 여기서 막는 것은 <b>무차별 대입의 속도</b>이지 정확한 쿼터가 아니다.
 * 정밀한 전역 제한이 필요하면 앞단(리버스 프록시·WAF)에서 거는 것이 맞다.</p>
 */
@Slf4j
public class RateLimitFilter extends OncePerRequestFilter {

    /** 이 창 단위로 카운터를 버린다 — 슬라이딩이 아니라 고정 창이다 (단순함이 낫다) */
    private static final long WINDOW_SECONDS = 60;
    /** 창이 넘어갈 때 청소한다. 이 크기를 넘으면 강제로 비운다 (메모리 방어) */
    private static final int MAX_TRACKED = 50_000;

    private final IxAuthProperties properties;
    private final ClientInfo clientInfo;
    private final ObjectMapper mapper;

    /** {@code storage=DATABASE} 일 때만 쓴다. {@code null} 이면 메모리로만 센다 */
    private final RateLimitCounters shared;

    private final ConcurrentHashMap<String, AtomicInteger> counters = new ConcurrentHashMap<>();
    private volatile long windowStart = Instant.now().getEpochSecond() / WINDOW_SECONDS;

    /** 테스트·메모리 전용 — 공용 저장소 없이 만든다 */
    public RateLimitFilter(IxAuthProperties properties, ClientInfo clientInfo,
                           ObjectMapper mapper) {
        this(properties, clientInfo, mapper, null);
    }

    public RateLimitFilter(IxAuthProperties properties, ClientInfo clientInfo,
                           ObjectMapper mapper, RateLimitCounters shared) {
        this.properties = properties;
        this.clientInfo = clientInfo;
        this.mapper = mapper;
        this.shared = shared;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        var config = properties.getRateLimit();
        if (!config.isEnabled()) {
            chain.doFilter(request, response);
            return;
        }

        rollWindowIfNeeded();

        String path = request.getRequestURI();
        int limit = limitFor(path, config);
        String key = clientInfo.ipOf(request) + "|" + bucketOf(path);

        int used = count(key, config.getStorage());
        if (used > limit) {
            reject(response, limit);
            return;
        }
        chain.doFilter(request, response);
    }

    /**
     * 이 창에서 지금까지 몇 번인가.
     *
     * <p>공용 DB 가 답하지 못하면 <b>메모리로 되돌아가 센다.</b> 그냥 통과시키면
     * DB 가 흔들리는 동안 무차별 대입에 문이 열리고, 그렇다고 막으면 DB 장애가
     * 로그인 전면 중단이 된다 — 둘 다 나쁘다. 인스턴스별로라도 세는 쪽이 낫다.</p>
     */
    private int count(String key, IxAuthProperties.RateLimit.Storage storage) {
        if (storage == IxAuthProperties.RateLimit.Storage.DATABASE && shared != null) {
            try {
                return shared.increment(key, windowStart);
            } catch (Exception e) {
                log.warn("속도 제한 카운터를 DB 에서 세지 못해 인스턴스 메모리로 대신합니다 — {}",
                        e.getMessage());
            }
        }
        return counters.computeIfAbsent(key, k -> new AtomicInteger()).incrementAndGet();
    }

    private void rollWindowIfNeeded() {
        long now = Instant.now().getEpochSecond() / WINDOW_SECONDS;
        if (now != windowStart || counters.size() > MAX_TRACKED) {
            long previous = windowStart;
            windowStart = now;
            counters.clear();
            purgeShared(now, previous);
        }
    }

    /**
     * 지난 창의 DB 행을 치운다 — 창이 넘어갈 때만, 그것도 실제로 넘어갔을 때만.
     *
     * <p>이것을 하지 않으면 요청이 온 IP 수만큼 행이 영원히 남는다. 실패해도 넘어간다 —
     * 청소를 못 했다고 로그인을 막을 이유가 없다.</p>
     */
    private void purgeShared(long now, long previous) {
        if (shared == null || now == previous
                || properties.getRateLimit().getStorage()
                        != IxAuthProperties.RateLimit.Storage.DATABASE) {
            return;
        }
        try {
            shared.purgeBefore(now);
        } catch (Exception e) {
            log.debug("속도 제한 카운터 정리 실패 — {}", e.getMessage());
        }
    }

    /**
     * 경로를 버킷으로 묶는다.
     *
     * <p>재설정·인증 메일 요청을 로그인과 같은 버킷에 두면, 메일 폭탄을 보내는 쪽이
     * 남의 로그인까지 막을 수 있다. 그래서 분리한다.</p>
     */
    private String bucketOf(String path) {
        // 2단계 확인은 로그인의 뒷부분이다. 같은 버킷에 두지 않으면 6자리 코드를
        // 분당 600번(기본 한도) 시도할 수 있게 된다.
        // 매직 링크 확인도 토큰을 세션으로 바꾸는 자리라 같은 버킷에 둔다
        if (path.startsWith("/auth/login") || path.startsWith("/auth/mfa/verify")
                || path.startsWith("/auth/magic-link/verify")) {
            return "login";
        }
        if (path.startsWith("/auth/refresh")) {
            return "refresh";
        }
        // 메일을 유발하는 요청. 매직 링크 요청이 여기 없으면 남의 주소로 '로그인 링크'
        // 메일을 퍼부을 수 있고, 그건 재설정 메일 폭탄과 정확히 같은 문제다
        if (path.startsWith("/auth/password/forgot")
                || path.startsWith("/auth/email/verify/request")
                || path.startsWith("/auth/magic-link/request")
                || path.startsWith("/auth/signup")) {
            return "mail";
        }
        return "default";
    }

    private int limitFor(String path, IxAuthProperties.RateLimit config) {
        return switch (bucketOf(path)) {
            case "login" -> config.getLoginPerMinute();
            case "refresh" -> config.getRefreshPerMinute();
            // 메일을 유발하는 요청은 로그인보다 더 좁게 — 한 번에 한 통이면 충분하다
            case "mail" -> Math.max(1, config.getLoginPerMinute() / 2);
            default -> config.getDefaultPerMinute();
        };
    }

    private void reject(HttpServletResponse response, int limit) throws IOException {
        var code = ErrorCode.RATE_LIMITED;
        response.setStatus(code.getStatus().value());
        // 계약(errors.md)이 요구한다 — 앱이 언제 다시 시도할지 알 수 있어야 한다
        response.setHeader("Retry-After", String.valueOf(WINDOW_SECONDS));
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        mapper.writeValue(response.getOutputStream(), ApiResponse.fail(
                new ApiResponse.ErrorBody(code.name(), code.getDefaultMessage(),
                        UUID.randomUUID().toString(), null)));
        log.debug("요청 속도 제한 — 한도 {}/분", limit);
    }

    /** 관리 화면 정적 자산과 헬스체크까지 세면 화면 한 번 열 때 한도가 소진된다 */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return path.startsWith(properties.getAdminUi().getPath())
                || path.equals("/health")
                || path.equals("/.well-known/jwks.json");
    }

    /** 테스트·진단용 — 지금 창에서 무엇이 얼마나 쓰였는지 */
    public Map<String, Integer> snapshot() {
        var out = new java.util.LinkedHashMap<String, Integer>();
        counters.forEach((k, v) -> out.put(k, v.get()));
        return out;
    }
}
