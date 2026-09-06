package team.prost.ixauth.social;

import team.prost.ixauth.config.IxAuthProperties;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Google (OpenID Connect).
 *
 * <p>넷 중 <b>유일하게 이메일 검증 여부를 규격으로</b> 준다({@code email_verified}).
 * OIDC 표준 클레임이라 provider 가 임의로 뜻을 바꿀 수 없고, Google 은 그 값을
 * 실제로 채운다. 그래서 이 신호는 믿을 수 있고, 같은 이메일의 기존 계정에
 * 자동 연결(②)이 성립한다 — 네이버가 붙지 못하는 것과 대비된다.</p>
 *
 * <p><b>PKCE 를 쓴다.</b> code 를 가로챈 쪽이 code_verifier 없이는 토큰으로 바꿀 수
 * 없게 한다. 앱 콜백이 브라우저 히스토리·리퍼러에 남는 경로라 값이 있다.</p>
 *
 * <p>주의 — Google 계정은 <b>누구나 만들 수 있다.</b> Microsoft 처럼 테넌트로 범위를
 * 좁히는 수단이 없으므로, 사내용이라면 {@code social.auto-signup} 을 끄고 초대받은
 * 계정에만 붙게 하거나 {@code account.signup-allowed-domains} 로 도메인을 건다.
 * Workspace 도메인 제한은 provider 쪽 파라미터({@code hd})가 아니라 우리 쪽 정책으로
 * 거는 것이 맞다 — {@code hd} 는 힌트일 뿐 강제가 아니다.</p>
 */
public class GoogleProvider extends HttpSocialProvider {

    public GoogleProvider(IxAuthProperties.Social.Provider config, ObjectMapper mapper) {
        super(config, mapper);
    }

    @Override
    public Kind kind() {
        return Kind.GOOGLE;
    }

    @Override
    public boolean usesPkce() {
        return true;
    }

    @Override
    protected String authorizeEndpoint() {
        return "https://accounts.google.com/o/oauth2/v2/auth";
    }

    @Override
    protected String tokenEndpoint() {
        return "https://oauth2.googleapis.com/token";
    }

    @Override
    protected String profileEndpoint() {
        return "https://www.googleapis.com/oauth2/v3/userinfo";
    }

    @Override
    protected String defaultScope() {
        // openid 가 없으면 userinfo 가 sub 를 주지 않는다 — 매칭 기준이 사라진다
        return "openid email profile";
    }

    @Override
    protected SocialProfile parseProfile(JsonNode json) {
        String email = text(json, "email");

        // 이메일이 없는데 '검증됨' 은 성립하지 않는다. 두 조건을 함께 본다 —
        // scope 에서 email 이 빠지면 email_verified 만 남는 응답이 올 수 있다
        boolean verified = bool(json, "email_verified") && email != null && !email.isBlank();

        // subject 는 sub 다. id_token 을 따로 파싱하지 않는 이유 — 이 흐름에서
        // access token 은 우리가 방금 교환해 받은 것이라 출처가 확실하고,
        // userinfo 는 그 토큰으로만 열린다. 서명 검증을 한 겹 더 둘 이유가 없다
        return new SocialProfile(text(json, "sub"), email, verified, text(json, "name"));
    }
}
