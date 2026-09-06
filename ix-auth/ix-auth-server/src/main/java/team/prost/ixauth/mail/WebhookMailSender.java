package team.prost.ixauth.mail;

import lombok.extern.slf4j.Slf4j;
import team.prost.ixauth.config.IxAuthProperties;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;

/**
 * 발송을 앱에 넘긴다 — 사내 메일 시스템을 쓰거나 폐쇄망이라 SMTP 를 열 수 없을 때.
 *
 * <p>jar 는 <b>링크와 용도</b>를 건네고, 앱이 자기 템플릿·발송기로 보낸다.
 * 본문도 함께 주지만 앱이 무시하고 새로 만들어도 된다.</p>
 *
 * <p>보내는 형태:</p>
 * <pre>
 * POST {ixauth.mail.webhook.url}
 * X-IxAuth-Key: ...
 * { "to": "...", "kind": "PASSWORD_RESET", "link": "https://앱/reset-password?token=…",
 *   "subject": "...", "body": "...", "vars": { "name": "…", "productName": "…" } }
 * </pre>
 */
@Slf4j
public class WebhookMailSender implements MailSender {

    private final IxAuthProperties.Mail config;
    private final String serviceKey;
    private final ObjectMapper mapper;
    private final HttpClient http;

    public WebhookMailSender(IxAuthProperties.Mail config, String serviceKey,
                             ObjectMapper mapper) {
        this.config = config;
        this.serviceKey = serviceKey;
        this.mapper = mapper;
        this.http = HttpClient.newBuilder()
                // HTTP/1.1 로 못박는다 — 기본값(HTTP_2)은 평문 h2c 업그레이드를 시도하는데,
                // Next.js 처럼 HTTP/1.1 만 받는 수신기는 그 요청을 파싱하지 못하고 소켓을 끊는다
                // ("header parser received no bytes"). 웹훅은 사내 단순 POST 한 건이라
                // 다중화·헤더압축 이득이 없고 호환만 깨뜨린다.
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(5)).build();
    }

    @Override
    public void send(MailMessage message) {
        var payload = new LinkedHashMap<String, Object>();
        payload.put("to", message.to());
        payload.put("kind", message.kind().name());
        payload.put("link", message.link());
        payload.put("subject", message.subject());
        payload.put("body", message.body());
        // 앱이 자기 템플릿으로 다시 만들 때 어느 언어로 만들지 알아야 한다 (G17).
        // 필드를 더하는 것은 받는 쪽을 깨지 않는다 — 지우거나 이름을 바꾸는 것만 깨뜨린다
        payload.put("locale", message.locale());
        payload.put("vars", message.vars());

        var builder = HttpRequest.newBuilder(URI.create(config.getWebhook().getUrl()))
                .header("Content-Type", "application/json")
                .timeout(config.getWebhook().getTimeout())
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload)));
        if (config.getWebhook().isSendServiceKey()) {
            builder.header("X-IxAuth-Key", serviceKey);
        }

        try {
            HttpResponse<String> res = http.send(builder.build(),
                    HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() >= 400) {
                // 4xx 는 대개 앱 쪽 계약 불일치라 다시 보내도 같은 답이지만, 5xx 는
                // 일시적인 경우가 많다. 구분은 재시도 정책이 하고 여기서는 사실만 알린다
                throw new MailSendException("웹훅 응답 " + res.statusCode());
            }
            log.info("메일 웹훅 전달: to={} kind={}", message.to(), message.kind());
        } catch (java.io.IOException e) {
            throw new MailSendException("웹훅 호출 실패: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            // 인터럽트 상태를 되돌려 놓지 않으면 상위에서 중단 요청을 알아채지 못한다
            Thread.currentThread().interrupt();
            throw new MailSendException("웹훅 호출이 중단됐습니다", e);
        }
    }

    @Override
    public boolean isOperational() {
        return !config.getWebhook().getUrl().isBlank();
    }
}
