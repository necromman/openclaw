package team.prost.ixtrust.client.spi;

import java.util.Map;

/**
 * SP 가 refresh/me 응답에 도메인 특화 {@code extra} 필드를 추가할 때 구현하는 SPI.
 *
 * <p>Bean 으로 등록하면 SDK 의 {@link team.prost.ixtrust.client.auth.AuthController#refresh}
 * 가 자동 호출해 {@code LoginResponse.extra} 에 결과를 박는다.
 * Bean 미등록 시 {@code extra = null} (기존 동작 그대로).
 *
 * <p>사용 예 (SP 측):
 * <pre>{@code
 * @Component
 * public class MyExtraProvider implements UserExtraProvider<Long> {
 *     @Override
 *     public Map<String, Object> getExtra(SsoUserInfo<Long> user) {
 *         return Map.of("organizationCode", "PROST", "department", "Engineering");
 *     }
 * }
 * }</pre>
 *
 * @param <ID> User PK type — {@link SsoUserInfo} 의 ID generic 과 동일.
 * @since 1.9.0
 */
@FunctionalInterface
public interface UserExtraProvider<ID> {

    /**
     * 인증된 사용자의 도메인 특화 extra 데이터를 반환한다.
     *
     * @param user 현재 인증된 사용자 (SsoUserInfo 구현체)
     * @return extra map (JSON 직렬화됨). null 반환 시 응답에서 extra 필드 생략.
     */
    Map<String, Object> getExtra(SsoUserInfo<ID> user);
}
