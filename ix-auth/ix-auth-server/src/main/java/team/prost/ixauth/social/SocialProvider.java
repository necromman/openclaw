package team.prost.ixauth.social;

/**
 * 외부 인증 제공자 하나.
 *
 * <p>provider 마다 엔드포인트와 프로필 응답 모양이 다르다. 그 차이를 여기서 흡수하고,
 * 위쪽은 {@link SocialProfile} 하나만 본다.</p>
 */
public interface SocialProvider {

    Kind kind();

    /** 사용자를 보낼 동의 화면 주소 */
    String authorizeUrl(String redirectUri, String state, String codeChallenge);

    /** {@code code} 를 access token 으로 바꾼다 */
    String exchangeCodeForToken(String code, String redirectUri, String codeVerifier);

    /** access token 으로 프로필을 가져온다 */
    SocialProfile fetchProfile(String accessToken);

    /** PKCE 를 쓰는가 — 쓰지 않는 provider 는 code_verifier 를 만들지 않는다 */
    default boolean usesPkce() {
        return false;
    }

    enum Kind {
        // 값은 DB 에 문자열로 저장된다(EnumType.STRING). 새 provider 는 **뒤에 더한다** —
        // 순서를 바꿔도 저장값은 그대로지만, 이름을 바꾸면 이미 연결된 identity 를 못 읽는다
        MICROSOFT, KAKAO, NAVER, GOOGLE;

        public static Kind of(String raw) {
            for (Kind k : values()) {
                if (k.name().equalsIgnoreCase(raw)) {
                    return k;
                }
            }
            throw new IllegalArgumentException("지원하지 않는 provider: " + raw);
        }
    }
}
