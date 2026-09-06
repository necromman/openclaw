package team.prost.ixauth.common;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 권한 매칭 — docs/contract/authz.md §2 의 예시를 그대로 고정한다.
 *
 * <p>이 규칙은 서버와 앱 측 SDK 가 공유한다. 여기가 깨지면 "화면에는 보이는데 API 는 403"
 * 같은 일이 난다. 계약이 바뀌지 않는 한 이 테스트도 바뀌지 않는다.</p>
 */
class PermissionMatcherTest {

    @ParameterizedTest(name = "{0} ⊇ {1} → {2}")
    @CsvSource({
            // 계약 문서에 명시된 예시
            "page:*:view,               page:admin.users:view,         true",
            "page:admin.*:view,         page:admin.users:view,         true",
            "page:admin.*:view,         page:admin.users.detail:view,  false",
            "page:admin.**:view,        page:admin.users.detail:view,  true",
            "file:contracts/**:download,file:contracts/2026/a.pdf:download, true",
            "*:*:*,                     page:admin.users:view,         true",
            // 경계
            "page:admin.users:view,     page:admin.users:view,         true",
            "page:admin.users:view,     page:admin.users:edit,         false",
            "page:admin.users:*,        page:admin.users:edit,         true",
            "board:notice:write,        board:notice:read,             false",
            "file:contracts/**:download,file:public/a.pdf:download,    false",
            // '**' 는 최소 한 세그먼트를 요구한다
            "page:admin.**:view,        page:admin:view,               false",
    })
    void matches(String pattern, String required, boolean expected) {
        assertThat(PermissionMatcher.matches(pattern.trim(), required.trim())).isEqualTo(expected);
    }

    @Test
    @DisplayName("부여된 권한 중 하나라도 걸리면 허용")
    void anyMatches() {
        var granted = List.of("board:notice:read", "page:admin.**:view");
        assertThat(PermissionMatcher.anyMatches(granted, "page:admin.users:view")).isTrue();
        assertThat(PermissionMatcher.anyMatches(granted, "page:admin.users:edit")).isFalse();
        assertThat(PermissionMatcher.anyMatches(List.of(), "page:x:view")).isFalse();
        assertThat(PermissionMatcher.anyMatches(null, "page:x:view")).isFalse();
    }

    @Test
    @DisplayName("3파트가 아니면 거부한다")
    void rejectsMalformed() {
        assertThatThrownBy(() -> PermissionMatcher.matches("page:view", "page:x:view"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("'**' 중간 배치는 등록 시 거부한다 (계약 §8)")
    void rejectsMiddleDoubleStar() {
        assertThatThrownBy(() -> PermissionMatcher.validateCode("page:a.**.c:view"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("마지막 세그먼트");
    }

    @Test
    @DisplayName("빈 세그먼트는 거부한다")
    void rejectsEmptySegment() {
        assertThatThrownBy(() -> PermissionMatcher.validateCode("page:a..c:view"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("정상 코드는 통과한다")
    void acceptsValid() {
        PermissionMatcher.validateCode("page:admin.users:view");
        PermissionMatcher.validateCode("file:contracts/**:download");
        PermissionMatcher.validateCode("*:*:*");
    }
}
