package team.prost.ixauth.captcha;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import team.prost.ixauth.config.IxAuthProperties;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Google reCAPTCHA v3.
 *
 * <p>v3 는 사용자에게 아무것도 묻지 않고 <b>0.0~1.0 점수</b>만 준다. 그래서 "통과했다"
 * 가 아니라 "얼마나 사람 같은가" 를 우리가 판단해야 하고, 그 경계가
 * {@code captcha.min-score} 다.</p>
 *
 * <p><b>시크릿은 요청 본문으로만 나간다.</b> 쿼리스트링에 실으면 프록시·액세스 로그에
 * 그대로 남는다.</p>
 *
 * <p>타임아웃이 짧은 것(3초)은 의도다. 이 호출은 사용자가 가입 버튼 앞에서 기다리는
 * 시간이고, 어차피 못 물어보면 통과시킨다({@link CaptchaGuard}) — 더 오래 기다렸다가
 * 통과시키는 것은 아무에게도 이득이 없다. 유출 비밀번호 조회와 같은 판단이다.</p>
 */
@Slf4j
@Component
public class RecaptchaVerifier implements CaptchaVerifier {

    /** 규격이 정한 주소다. 정책이 아니라 이 provider 를 쓴다는 것의 정의다 */
    private static final String VERIFY_API = "https://www.google.com/recaptcha/api/siteverify";
    private static final Duration TIMEOUT = Duration.ofSeconds(3);

    private final IxAuthProperties properties;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(TIMEOUT)
            // 리다이렉트를 따라가지 않는다 — 시크릿이 우리가 아는 곳 밖으로 가면 안 된다
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    public RecaptchaVerifier(IxAuthProperties properties, ObjectMapper mapper) {
        this.properties = properties;
        this.mapper = mapper;
    }

    @Override
    public IxAuthProperties.Captcha.Provider provider() {
        return IxAuthProperties.Captcha.Provider.RECAPTCHA;
    }

    @Override
    public Result verify(String token, String remoteIp) {
        var config = properties.getCaptcha();
        if (config.getSecretKey() == null || config.getSecretKey().isBlank()) {
            // 켜 놓고 키를 안 넣은 상태. 거부하면 설정 실수 하나로 가입이 통째로 막힌다
            return Result.unavailable("captcha.secret-key 미설정");
        }

        JsonNode json;
        try {
            json = post(config.getSecretKey(), token, remoteIp);
        } catch (InterruptedException e) {
            // 인터럽트 표시를 되살린다 — 삼키면 상위의 종료 처리가 신호를 잃는다
            Thread.currentThread().interrupt();
            return Result.unavailable("검증 호출 중단");
        } catch (Exception e) {
            return Result.unavailable(e.getClass().getSimpleName() + ": " + e.getMessage());
        }

        return judge(json, config.getMinScore());
    }

    /**
     * 응답을 점수로 판정한다.
     *
     * <p>{@code success=false} 는 <b>거부</b>다(위조·만료·이미 쓴 토큰). 이건 provider 가
     * 정상적으로 답한 판정이라 fail-open 대상이 아니다 — 못 물어본 것과 다르다.</p>
     */
    private static Result judge(JsonNode json, double minScore) {
        boolean success = json != null && json.get("success") != null
                && json.get("success").asBoolean();
        if (!success) {
            return Result.fail("success=false " + errorCodes(json), -1);
        }

        JsonNode scoreNode = json.get("score");
        if (scoreNode == null || scoreNode.isNull()) {
            // v2 키를 v3 자리에 넣으면 점수가 없다. 점수가 없으면 success 만 보고 통과시킨다 —
            // v2 는 사용자가 실제로 체크박스를 눌러 성공한 것이므로 그 자체가 판정이다
            return Result.pass(-1);
        }
        double score = scoreNode.asDouble();
        return score >= minScore
                ? Result.pass(score)
                : Result.fail("score " + score + " < " + minScore, score);
    }

    private JsonNode post(String secret, String token, String remoteIp) throws Exception {
        var form = new LinkedHashMap<String, String>();
        form.put("secret", secret);
        form.put("response", token == null ? "" : token);
        if (remoteIp != null && !remoteIp.isBlank()) {
            form.put("remoteip", remoteIp);
        }

        var request = HttpRequest.newBuilder(URI.create(VERIFY_API))
                .header("Content-Type", "application/x-www-form-urlencoded;charset=utf-8")
                .header("Accept", "application/json")
                .timeout(TIMEOUT)
                .POST(HttpRequest.BodyPublishers.ofString(encode(form), StandardCharsets.UTF_8))
                .build();

        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new IllegalStateException("상태 " + response.statusCode());
        }
        return mapper.readTree(response.body());
    }

    /** 로그에만 남긴다 — 응답에 실으면 어느 조건에 걸렸는지가 그대로 힌트가 된다 */
    private static String errorCodes(JsonNode json) {
        JsonNode codes = json == null ? null : json.get("error-codes");
        return codes == null ? "" : codes.toString();
    }

    private static String encode(Map<String, String> form) {
        var sb = new StringBuilder();
        form.forEach((k, v) -> {
            if (sb.length() > 0) {
                sb.append('&');
            }
            sb.append(URLEncoder.encode(k, StandardCharsets.UTF_8)).append('=')
              .append(URLEncoder.encode(v, StandardCharsets.UTF_8));
        });
        return sb.toString();
    }
}
