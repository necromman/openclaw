package team.prost.ixauth.social;

import team.prost.ixauth.config.IxAuthProperties;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Microsoft (Entra ID / Microsoft 계정).
 *
 * <p>{@code tenant} 로 범위가 갈린다 — {@code organizations} 는 조직 계정만,
 * {@code common} 은 개인 계정도 받는다. 사내용이라면 <b>자기 테넌트 ID</b>를 넣는 것이
 * 맞다. {@code common} 으로 두면 아무 Microsoft 계정이나 동의 화면을 통과한다.</p>
 */
public class MicrosoftProvider extends HttpSocialProvider {

    public MicrosoftProvider(IxAuthProperties.Social.Provider config, ObjectMapper mapper) {
        super(config, mapper);
    }

    @Override
    public Kind kind() {
        return Kind.MICROSOFT;
    }

    @Override
    public boolean usesPkce() {
        return true;
    }

    private String tenant() {
        return config.getTenant().isBlank() ? "common" : config.getTenant();
    }

    @Override
    protected String authorizeEndpoint() {
        return "https://login.microsoftonline.com/" + tenant() + "/oauth2/v2.0/authorize";
    }

    @Override
    protected String tokenEndpoint() {
        return "https://login.microsoftonline.com/" + tenant() + "/oauth2/v2.0/token";
    }

    @Override
    protected String profileEndpoint() {
        return "https://graph.microsoft.com/v1.0/me";
    }

    @Override
    protected String defaultScope() {
        return "openid profile email User.Read";
    }

    @Override
    protected SocialProfile parseProfile(JsonNode json) {
        String email = text(json, "mail");
        if (email == null || email.isBlank()) {
            // 조직 계정에서 mail 이 비어 있는 경우가 흔하다. UPN 이 대개 주소 형태다
            String upn = text(json, "userPrincipalName");
            email = upn != null && upn.contains("@") ? upn : null;
        }

        // Graph /me 는 "이 주소를 검증했는가" 를 주지 않는다. 다만 조직 테넌트로
        // 제한한 경우, 그 주소는 테넌트 관리자가 발급한 것이므로 신뢰할 수 있다.
        // common/organizations 로 열어 두면 그 보장이 없다.
        boolean tenantScoped = !"common".equalsIgnoreCase(tenant())
                && !"consumers".equalsIgnoreCase(tenant());

        return new SocialProfile(
                text(json, "id"),
                email,
                tenantScoped && email != null,
                text(json, "displayName"));
    }
}
