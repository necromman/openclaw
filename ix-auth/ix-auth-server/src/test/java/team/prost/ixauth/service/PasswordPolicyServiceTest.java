package team.prost.ixauth.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.password.BreachedPasswordChecker;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PasswordPolicyServiceTest {

    private IxAuthProperties props;
    private PasswordPolicyService service;

    /**
     * 유출 검사는 기본이 꺼짐이라 이 검사에서는 외부로 나가지 않는다.
     *
     * <p>켜졌을 때의 동작은 아래 {@link #breachCheckIsOffByDefault()} 에서 대역으로 고정한다 —
     * 진짜 HIBP 를 부르는 테스트를 두면 네트워크가 없는 곳에서 빌드가 깨진다.</p>
     */
    private static final class AlwaysBreached extends BreachedPasswordChecker {
        @Override
        public boolean isBreached(String raw) {
            return true;
        }
    }

    @BeforeEach
    void setUp() {
        props = new IxAuthProperties();   // 기본값: 10자·대문자·숫자·특수문자
        service = new PasswordPolicyService(props, new AlwaysBreached());
    }

    @Test
    @DisplayName("유출 검사는 기본이 꺼짐 — 켜야만 거부한다")
    void breachCheckIsOffByDefault() {
        assertThatCode(() -> service.validate("Str0ng!Pass9")).doesNotThrowAnyException();

        props.getPassword().setCheckBreached(true);
        assertThatThrownBy(() -> service.validate("Str0ng!Pass9"))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getCode())
                .isEqualTo(ErrorCode.AUTH_PASSWORD_BREACHED);
    }

    @Test
    @DisplayName("형식이 틀리면 유출 검사까지 가지 않는다 — 거절될 값으로 외부를 두드리지 않는다")
    void formatFailureShortCircuitsBreachCheck() {
        props.getPassword().setCheckBreached(true);
        assertThatThrownBy(() -> service.validate("short"))
                .extracting(e -> ((ApiException) e).getCode())
                .isEqualTo(ErrorCode.AUTH_PASSWORD_POLICY);
    }

    @Test
    @DisplayName("정책을 만족하면 통과")
    void accepts() {
        assertThatCode(() -> service.validate("Str0ng!Pass9")).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("짧으면 거부하고 위반 항목을 알려준다")
    void rejectsShort() {
        assertThatThrownBy(() -> service.validate("Ab1!x"))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getCode())
                .isEqualTo(ErrorCode.AUTH_PASSWORD_POLICY);
    }

    @Test
    @DisplayName("위반이 여러 개면 모두 details 에 담는다")
    void reportsAllViolations() {
        var thrown = org.junit.jupiter.api.Assertions.assertThrows(
                ApiException.class, () -> service.validate("aaaaaaaaaaa"));
        assertThat(thrown.getDetails()).hasSize(3);   // 대문자·숫자·특수문자
    }

    @Test
    @DisplayName("null 도 안전하게 거부한다")
    void rejectsNull() {
        assertThatThrownBy(() -> service.validate(null)).isInstanceOf(ApiException.class);
    }
}
