package team.prost.ixauth.social;

/**
 * provider 가 알려 준 사용자.
 *
 * @param subject       provider 의 <b>불변</b> 식별자. 계정 매칭의 유일한 기준이다 —
 *                      이메일은 바뀌고, 바뀐 주소가 남에게 재할당될 수도 있다
 * @param email         이메일 (없을 수 있다 — 카카오는 선택 동의 항목이다)
 * @param emailVerified provider 가 <b>검증했다고 명시</b>했는가.
 *                      명시하지 않으면 false 다. "모름" 을 "검증됨" 으로 취급하면,
 *                      남의 이메일을 자기 소셜 계정에 적어 넣는 것만으로 그 계정을
 *                      가져갈 수 있게 된다
 * @param name          표시 이름
 */
public record SocialProfile(String subject, String email, boolean emailVerified, String name) {
}
