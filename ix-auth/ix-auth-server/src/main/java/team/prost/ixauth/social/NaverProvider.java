package team.prost.ixauth.social;

import team.prost.ixauth.config.IxAuthProperties;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 네이버.
 *
 * <p><b>이메일 검증 여부를 주지 않는다.</b> 그래서 {@code emailVerified} 는 항상 false 고,
 * 기존 계정에 자동 연결되지 않는다 — 남의 주소를 적어 넣는 것만으로 그 계정을 가져가는
 * 일을 막기 위해서다. 네이버로 들어온 사용자를 기존 계정에 붙이려면 관리자가 수동으로
 * 연결하거나, 로그인한 상태에서 본인이 연결해야 한다.</p>
 *
 * <p>이는 네이버가 주소를 확인하지 않는다는 뜻이 아니라, <b>확인했다는 신호를 API 로
 * 주지 않는다</b>는 뜻이다. 모르는 것을 안다고 가정하지 않는다.</p>
 */
public class NaverProvider extends HttpSocialProvider {

    public NaverProvider(IxAuthProperties.Social.Provider config, ObjectMapper mapper) {
        super(config, mapper);
    }

    @Override
    public Kind kind() {
        return Kind.NAVER;
    }

    @Override
    protected String authorizeEndpoint() {
        return "https://nid.naver.com/oauth2.0/authorize";
    }

    @Override
    protected String tokenEndpoint() {
        return "https://nid.naver.com/oauth2.0/token";
    }

    @Override
    protected String profileEndpoint() {
        return "https://openapi.naver.com/v1/nid/me";
    }

    @Override
    protected String defaultScope() {
        return "";   // 네이버는 앱 설정에서 제공 항목을 정한다
    }

    @Override
    protected SocialProfile parseProfile(JsonNode json) {
        // 실제 값은 response 안에 있다
        JsonNode r = json.get("response");
        return new SocialProfile(
                text(r, "id"),
                text(r, "email"),
                false,          // 검증 신호를 주지 않는다 — 모르는 것은 false 다
                text(r, "name"));
    }
}
