package team.prost.ixauth.password;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Locale;

/**
 * 유출된 적이 있는 비밀번호인지 확인한다 — Have I Been Pwned, <b>k-익명성</b> 방식.
 *
 * <h2>비밀번호가 밖으로 나가지 않는다</h2>
 *
 * <p>보내는 것은 SHA-1 해시의 <b>앞 5자</b>뿐이다. 그 5자에 해당하는 해시 접미사
 * 수백~수천 개가 통째로 돌아오고, <b>대조는 이쪽에서</b> 한다. 즉 상대방은 우리가
 * 무엇을 물었는지 알 수 없다 — 같은 5자를 공유하는 후보가 늘 수백 개이기 때문이다.</p>
 *
 * <pre>
 *   비밀번호  →  SHA-1  →  21BD1…0A9B7   (40자)
 *                          ─────         앞 5자만 전송
 *   GET https://api.pwnedpasswords.com/range/21BD1
 *   ← 0018A45C4D1DEF81644B54AB7F969B88D65:1
 *     00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2      … 이 목록에서 나머지 35자를 찾는다
 * </pre>
 *
 * <p><b>SHA-1 을 쓰는 것은 우리 선택이 아니다.</b> 상대 API 가 그 형식으로 색인돼 있다
 * (비밀번호 저장에는 여전히 bcrypt 를 쓴다 — 여기서 SHA-1 은 저장이 아니라 조회 키다).</p>
 *
 * <h2>실패하면 통과시킨다 (fail-open)</h2>
 *
 * <p>이 클래스에서 가장 중요한 결정이다. 외부 API 가 느리거나 죽었을 때 가입·비밀번호
 * 변경이 막히면, 남의 서비스 장애가 우리 로그인 시스템의 장애가 된다. 유출 목록 대조는
 * <b>있으면 좋은 검사</b>이지 인증의 필수 조건이 아니므로, 못 물어봤으면 통과시키고
 * WARN 만 남긴다.</p>
 *
 * <p>기본값은 꺼짐이다 — 폐쇄망 설치에서는 이 호출 자체가 되지 않는다
 * ({@code password.check-breached}).</p>
 */
@Slf4j
@Component
public class BreachedPasswordChecker {

    /** k-익명성 조회 엔드포인트. 정책이 아니라 이 방식의 규격이다 */
    private static final String RANGE_API = "https://api.pwnedpasswords.com/range/";

    /**
     * 3초. 설정으로 빼지 않았다 — fail-open 이라 늘려 봐야 "더 오래 기다렸다가 통과" 다.
     *
     * <p>사용자는 그동안 가입 버튼 앞에서 멈춰 있다. 검사의 가치보다 기다림의 비용이
     * 먼저 커지는 지점이 이 언저리다.</p>
     */
    private static final Duration TIMEOUT = Duration.ofSeconds(3);

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(TIMEOUT)
            // 리다이렉트를 따라가지 않는다. 조회 주소가 우리가 아는 곳이 아니게 되면
            // 해시 앞자리가 어디로 가는지 알 수 없다
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    /**
     * @return 유출 목록에 있으면 {@code true}. <b>확인하지 못했으면 {@code false}</b> —
     *         모르는 것을 "유출됐다" 로 답하면 멀쩡한 비밀번호가 거부된다
     */
    public boolean isBreached(String raw) {
        if (raw == null || raw.isEmpty()) {
            return false;
        }
        String hash = sha1Hex(raw);
        if (hash == null) {
            return false;
        }
        String prefix = hash.substring(0, 5);
        String suffix = hash.substring(5);

        try {
            var request = HttpRequest.newBuilder(URI.create(RANGE_API + prefix))
                    .timeout(TIMEOUT)
                    // 응답 크기로 무엇을 물었는지 짐작하는 것까지 막는다 —
                    // 상대가 가짜 항목을 채워 길이를 고르게 만들어 준다
                    .header("Add-Padding", "true")
                    .header("User-Agent", "IX-Auth")
                    .GET()
                    .build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                log.warn("유출 비밀번호 조회 실패 — 상태 {} · 검사를 건너뛰고 통과시킨다",
                        response.statusCode());
                return false;
            }
            return containsSuffix(response.body(), suffix);
        } catch (InterruptedException e) {
            // 인터럽트 표시를 되살려 둔다 — 삼키면 상위의 종료 처리가 신호를 잃는다
            Thread.currentThread().interrupt();
            log.warn("유출 비밀번호 조회가 중단되었습니다 — 검사를 건너뛰고 통과시킵니다");
            return false;
        } catch (Exception e) {
            // 통과시키는 것이 계약이다. 남의 서비스 장애가 우리 로그인 장애가 되면 안 된다
            log.warn("유출 비밀번호 조회에 실패했습니다 — 검사를 건너뛰고 통과시킵니다 ({}: {})",
                    e.getClass().getSimpleName(), e.getMessage());
            return false;
        }
    }

    /**
     * 응답은 {@code 접미사:노출횟수} 가 줄마다 하나씩이다.
     *
     * <p>패딩으로 채워진 가짜 항목은 횟수가 {@code 0} 이라 걸러야 한다 — 안 그러면
     * 패딩을 켠 순간 아무 비밀번호나 유출된 것으로 판정된다.</p>
     */
    private static boolean containsSuffix(String body, String suffix) {
        for (String line : body.split("\n")) {
            int colon = line.indexOf(':');
            if (colon < 0) {
                continue;
            }
            if (!line.substring(0, colon).trim().equalsIgnoreCase(suffix)) {
                continue;
            }
            return parseCount(line.substring(colon + 1)) > 0;
        }
        return false;
    }

    private static long parseCount(String raw) {
        try {
            return Long.parseLong(raw.trim());
        } catch (NumberFormatException e) {
            // 형식이 낯설면 '유출됨' 으로 보지 않는다 — 오탐이 미탐보다 나쁜 자리다
            return 0;
        }
    }

    /** 조회 키를 만든다. 저장용 해시가 아니다 — 저장은 bcrypt 가 한다 */
    private static String sha1Hex(String raw) {
        try {
            var digest = MessageDigest.getInstance("SHA-1");
            byte[] out = digest.digest(raw.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(out).toUpperCase(Locale.ROOT);
        } catch (Exception e) {
            log.warn("SHA-1 을 쓸 수 없어 유출 검사를 건너뜁니다 ({})", e.getMessage());
            return null;
        }
    }
}
