package team.prost.ixauth.social;

import lombok.extern.slf4j.Slf4j;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
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
 * provider 3종의 공통 뼈대 — OAuth2 authorization code 흐름은 셋 다 같다.
 *
 * <p>다른 것은 엔드포인트 주소와 프로필 응답의 모양뿐이라, 그 둘만 하위에서 채운다.</p>
 */
@Slf4j
public abstract class HttpSocialProvider implements SocialProvider {

    protected final IxAuthProperties.Social.Provider config;
    protected final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5)).build();

    protected HttpSocialProvider(IxAuthProperties.Social.Provider config, ObjectMapper mapper) {
        this.config = config;
        this.mapper = mapper;
    }

    protected abstract String authorizeEndpoint();

    protected abstract String tokenEndpoint();

    protected abstract String profileEndpoint();

    protected abstract String defaultScope();

    protected abstract SocialProfile parseProfile(JsonNode json);

    @Override
    public String authorizeUrl(String redirectUri, String state, String codeChallenge) {
        var params = new LinkedHashMap<String, String>();
        params.put("client_id", config.getClientId());
        params.put("redirect_uri", redirectUri);
        params.put("response_type", "code");
        params.put("state", state);
        params.put("scope", config.getScope().isBlank() ? defaultScope() : config.getScope());
        if (usesPkce() && codeChallenge != null) {
            params.put("code_challenge", codeChallenge);
            params.put("code_challenge_method", "S256");
        }
        return authorizeEndpoint() + "?" + form(params);
    }

    @Override
    public String exchangeCodeForToken(String code, String redirectUri, String codeVerifier) {
        var params = new LinkedHashMap<String, String>();
        params.put("grant_type", "authorization_code");
        params.put("client_id", config.getClientId());
        params.put("code", code);
        params.put("redirect_uri", redirectUri);
        if (!config.getClientSecret().isBlank()) {
            params.put("client_secret", config.getClientSecret());
        }
        if (usesPkce() && codeVerifier != null) {
            params.put("code_verifier", codeVerifier);
        }

        JsonNode json = postForm(tokenEndpoint(), params);
        String token = text(json, "access_token");
        if (token == null || token.isBlank()) {
            // 응답 본문에 client_secret 이 되비칠 수 있으므로 로그에 싣지 않는다
            log.warn("소셜 토큰 교환 실패 — provider={} error={}", kind(), text(json, "error"));
            throw new ApiException(ErrorCode.AUTH_SOCIAL_EXCHANGE_FAILED);
        }
        return token;
    }

    @Override
    public SocialProfile fetchProfile(String accessToken) {
        var req = HttpRequest.newBuilder(URI.create(profileEndpoint()))
                .header("Authorization", "Bearer " + accessToken)
                .header("Accept", "application/json")
                .timeout(Duration.ofSeconds(10))
                .GET().build();
        JsonNode json = send(req);

        SocialProfile profile = parseProfile(json);
        if (profile.subject() == null || profile.subject().isBlank()) {
            throw new ApiException(ErrorCode.AUTH_SOCIAL_PROFILE_FAILED);
        }
        // provider 를 믿지 않기로 설정했으면 '검증됨' 신호를 버린다
        if (!config.isTrustEmailVerified() && profile.emailVerified()) {
            return new SocialProfile(profile.subject(), profile.email(), false, profile.name());
        }
        return profile;
    }

    // ────────────────────── HTTP ──────────────────────

    private JsonNode postForm(String url, Map<String, String> params) {
        var req = HttpRequest.newBuilder(URI.create(url))
                .header("Content-Type", "application/x-www-form-urlencoded;charset=utf-8")
                .header("Accept", "application/json")
                .timeout(Duration.ofSeconds(10))
                .POST(HttpRequest.BodyPublishers.ofString(form(params), StandardCharsets.UTF_8))
                .build();
        return send(req);
    }

    private JsonNode send(HttpRequest request) {
        try {
            HttpResponse<String> res = http.send(request, HttpResponse.BodyHandlers.ofString());
            return mapper.readTree(res.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(ErrorCode.AUTH_SOCIAL_UNREACHABLE);
        } catch (Exception e) {
            log.warn("소셜 provider 호출 실패 — provider={} ({})", kind(), e.getMessage());
            throw new ApiException(ErrorCode.AUTH_SOCIAL_UNREACHABLE);
        }
    }

    protected static String form(Map<String, String> params) {
        var sb = new StringBuilder();
        params.forEach((k, v) -> {
            if (sb.length() > 0) {
                sb.append('&');
            }
            sb.append(URLEncoder.encode(k, StandardCharsets.UTF_8)).append('=')
              .append(URLEncoder.encode(v == null ? "" : v, StandardCharsets.UTF_8));
        });
        return sb.toString();
    }

    protected static String text(JsonNode node, String field) {
        if (node == null) {
            return null;
        }
        JsonNode v = node.get(field);
        return v == null || v.isNull() ? null : v.asString();
    }

    protected static boolean bool(JsonNode node, String field) {
        if (node == null) {
            return false;
        }
        JsonNode v = node.get(field);
        return v != null && !v.isNull() && v.asBoolean();
    }
}
