package team.prost.ixauth.social;

import team.prost.ixauth.config.IxAuthProperties;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 카카오.
 *
 * <p>이메일이 <b>선택 동의</b> 항목이다. 사용자가 동의하지 않으면 주소가 오지 않으므로,
 * 이메일이 없는 경우를 정상 흐름으로 다뤄야 한다. 대신 검증 여부를 명시적으로 주기
 * 때문에({@code is_email_verified}) 그 신호는 믿을 수 있다.</p>
 */
public class KakaoProvider extends HttpSocialProvider {

    public KakaoProvider(IxAuthProperties.Social.Provider config, ObjectMapper mapper) {
        super(config, mapper);
    }

    @Override
    public Kind kind() {
        return Kind.KAKAO;
    }

    @Override
    protected String authorizeEndpoint() {
        return "https://kauth.kakao.com/oauth/authorize";
    }

    @Override
    protected String tokenEndpoint() {
        return "https://kauth.kakao.com/oauth/token";
    }

    @Override
    protected String profileEndpoint() {
        return "https://kapi.kakao.com/v2/user/me";
    }

    @Override
    protected String defaultScope() {
        return "profile_nickname account_email";
    }

    @Override
    protected SocialProfile parseProfile(JsonNode json) {
        JsonNode account = json.get("kakao_account");
        String email = text(account, "email");

        // 두 조건을 모두 본다 — 유효하지 않은 주소를 '검증됨' 으로 받으면 안 된다
        boolean verified = bool(account, "is_email_verified") && bool(account, "is_email_valid");

        String name = null;
        if (account != null && account.get("profile") != null) {
            name = text(account.get("profile"), "nickname");
        }

        return new SocialProfile(text(json, "id"), email, verified && email != null, name);
    }
}
