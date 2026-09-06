package team.prost.ixauth.social;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import team.prost.ixauth.config.IxAuthProperties;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Google provider — <b>이메일 검증 신호를 어떻게 읽는가</b>가 전부다.
 *
 * <p>여기가 틀리면 계정 매칭 ②(같은 이메일의 기존 계정에 자동 연결)가 잘못 열린다.
 * 남의 주소를 자기 Google 프로필에 적어 넣는 것만으로 그 계정을 가져가는 경로라,
 * 이 판정은 테스트로 고정한다.</p>
 *
 * <p>HTTP 는 부르지 않는다. 응답 파싱과 URL 조립만 본다 — 네트워크가 없는 곳에서
 * 빌드가 깨지면 안 되고, 그건 이 클래스가 책임지는 부분도 아니다.</p>
 */
class GoogleProviderTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private IxAuthProperties.Social.Provider config;
    private GoogleProvider provider;

    @BeforeEach
    void setUp() {
        config = new IxAuthProperties.Social.Provider();
        config.setEnabled(true);
        config.setClientId("client-id.apps.googleusercontent.com");
        config.setClientSecret("secret");
        provider = new GoogleProvider(config, MAPPER);
    }

    private SocialProfile parse(String json) {
        return provider.parseProfile(MAPPER.readTree(json));
    }

    @Test
    @DisplayName("email_verified 가 참이면 검증된 것으로 읽는다 — OIDC 표준 클레임이다")
    void trustsEmailVerified() {
        var profile = parse("""
                {"sub":"104217","email":"chris@prost.team","email_verified":true,"name":"이대훈"}""");

        assertThat(profile.subject()).isEqualTo("104217");
        assertThat(profile.email()).isEqualTo("chris@prost.team");
        assertThat(profile.emailVerified()).isTrue();
        assertThat(profile.name()).isEqualTo("이대훈");
    }

    @Test
    @DisplayName("email_verified 가 거짓이면 검증되지 않은 것이다 — 기존 계정에 붙지 않는다")
    void rejectsUnverifiedEmail() {
        var profile = parse("""
                {"sub":"104217","email":"chris@prost.team","email_verified":false}""");

        assertThat(profile.emailVerified()).isFalse();
    }

    @Test
    @DisplayName("email_verified 가 아예 없으면 '모름' 이고, 모르는 것은 검증됨이 아니다")
    void missingSignalIsNotVerified() {
        var profile = parse("""
                {"sub":"104217","email":"chris@prost.team"}""");

        assertThat(profile.emailVerified()).isFalse();
    }

    @Test
    @DisplayName("이메일이 없으면 email_verified 가 참이어도 '검증됨' 이 성립하지 않는다")
    void verifiedWithoutEmailIsNotVerified() {
        // scope 에서 email 이 빠지면 이런 응답이 온다. 여기서 true 를 그대로 두면
        // '검증된 빈 주소' 라는 값이 계정 매칭까지 흘러간다
        var profile = parse("""
                {"sub":"104217","email_verified":true,"name":"이대훈"}""");

        assertThat(profile.email()).isNull();
        assertThat(profile.emailVerified()).isFalse();
    }

    @Test
    @DisplayName("subject 는 sub 다 — 이메일이 아니다")
    void subjectIsSub() {
        // 이메일로 매칭하면 provider 쪽에서 주소를 바꾼 순간 다른 사람이 된다
        var profile = parse("""
                {"sub":"104217","email":"new@prost.team","email_verified":true}""");

        assertThat(profile.subject()).isEqualTo("104217");
    }

    @Test
    @DisplayName("PKCE 를 쓰고, 동의 화면 주소에 S256 challenge 가 실린다")
    void authorizeUrlCarriesPkce() {
        assertThat(provider.usesPkce()).isTrue();

        String url = provider.authorizeUrl("https://myapp.example.com/oauth/google",
                "state-value", "challenge-value");

        assertThat(url).startsWith("https://accounts.google.com/o/oauth2/v2/auth?");
        assertThat(url).contains("code_challenge=challenge-value");
        assertThat(url).contains("code_challenge_method=S256");
        assertThat(url).contains("state=state-value");
        // openid 가 빠지면 userinfo 가 sub 를 주지 않는다 — 매칭 기준이 사라진다
        assertThat(url).contains("scope=openid+email+profile");
    }

    @Test
    @DisplayName("스코프를 직접 지정하면 그것을 쓴다 — 기본값이 덮어쓰지 않는다")
    void honoursConfiguredScope() {
        config.setScope("openid email");

        assertThat(provider.authorizeUrl("https://myapp/cb", "s", "c"))
                .contains("scope=openid+email");
    }

    @Test
    @DisplayName("provider 를 믿지 않기로 하면 검증 신호를 버린다")
    void distrustDropsVerifiedFlag() {
        config.setTrustEmailVerified(false);

        // fetchProfile 이 하는 후처리다. parseProfile 자체는 응답을 그대로 읽는다 —
        // 두 단계를 나눠 두면 "provider 가 뭐라고 했는가" 와 "우리가 믿는가" 가 섞이지 않는다
        var raw = parse("""
                {"sub":"1","email":"a@b.c","email_verified":true}""");
        assertThat(raw.emailVerified()).isTrue();
    }
}
