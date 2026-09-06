package team.prost.ixauth.settings;

import team.prost.ixauth.config.IxAuthProperties;

import java.util.function.BiConsumer;
import java.util.function.Function;

/**
 * 정의 + 값을 읽고 쓰는 방법.
 *
 * <p><b>왜 리플렉션을 쓰지 않는가</b> — 키 문자열로 필드를 찾으면 이름이 바뀌는 순간
 * 런타임에 조용히 깨진다. 함수로 묶어 두면 컴파일러가 잡는다.</p>
 *
 * <p><b>왜 {@link IxAuthProperties} 에 되쓰는가</b> — 기존 코드가 이미
 * {@code properties.getAccount().getSignupMode()} 로 읽고 있다. 서비스마다 조회 방식을
 * 바꾸면 "어떤 건 yml 을, 어떤 건 DB 를 본다" 는 상태가 생기고 그게 더 위험하다.
 * 한 곳(이 객체)만 최신으로 유지하면 읽는 쪽은 아무것도 몰라도 된다.</p>
 */
public record SettingBinding(
        SettingDefinition definition,
        /** 현재 값 → 문자열 (화면 표시·비교용) */
        Function<IxAuthProperties, String> reader,
        /** 문자열 → 설정 객체에 반영. 값이 잘못되면 예외를 던져 저장 자체를 막는다 */
        BiConsumer<IxAuthProperties, String> applier) {

    public String key() {
        return definition.key();
    }
}
