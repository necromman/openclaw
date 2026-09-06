package team.prost.ixauth.captcha;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.config.IxAuthProperties.CaptchaAction;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * CAPTCHA 게이트 — <b>실패는 거부, 미도달은 통과</b>라는 비대칭을 여기서 고정한다.
 *
 * <p>이 비대칭이 무너지는 두 방향이 모두 사고다. 실패를 통과시키면 기능이 없는 것과
 * 같고, 미도달을 거부하면 Google 장애가 우리 가입 장애가 된다. 코드를 고치다 어느
 * 한쪽으로 기울기 쉬운 자리라 테스트로 못 박는다.</p>
 */
class CaptchaGuardTest {

    /** 판정을 통째로 지정하는 대역. 진짜 reCAPTCHA 를 부르면 네트워크 없는 곳에서 깨진다 */
    private static final class StubVerifier implements CaptchaVerifier {
        private Result next = Result.pass(0.9);
        private int calls;

        @Override
        public IxAuthProperties.Captcha.Provider provider() {
            return IxAuthProperties.Captcha.Provider.RECAPTCHA;
        }

        @Override
        public Result verify(String token, String remoteIp) {
            calls++;
            return next;
        }
    }

    private IxAuthProperties props;
    private StubVerifier verifier;
    private CaptchaGuard guard;

    @BeforeEach
    void setUp() {
        props = new IxAuthProperties();
        verifier = new StubVerifier();
        guard = new CaptchaGuard(props, List.of(verifier));
    }

    private void enable(CaptchaAction... actions) {
        props.getCaptcha().setEnabled(true);
        props.getCaptcha().setProtect(List.of(actions));
    }

    // ────────────────────── 기본값 ──────────────────────

    @Test
    @DisplayName("기본은 꺼짐 — 토큰이 없어도 지금까지처럼 통과한다")
    void offByDefault() {
        // 이것이 깨지면 업그레이드하는 순간 전원의 가입·로그인이 400 이 된다
        assertThat(props.getCaptcha().isEnabled()).isFalse();
        assertThatCode(() -> guard.require(CaptchaAction.SIGNUP, null, "203.0.113.7"))
                .doesNotThrowAnyException();
        assertThat(verifier.calls).isZero();
    }

    @Test
    @DisplayName("기본 보호 대상에 LOGIN 이 없다 — 로그인이 막히면 이미 쓰는 전원이 못 들어온다")
    void loginIsNotProtectedByDefault() {
        assertThat(props.getCaptcha().getProtect())
                .containsExactly(CaptchaAction.SIGNUP, CaptchaAction.PASSWORD_FORGOT);
    }

    @Test
    @DisplayName("켜져 있어도 목록에 없는 경로는 검증하지 않는다")
    void onlyListedActions() {
        enable(CaptchaAction.SIGNUP);

        assertThatCode(() -> guard.require(CaptchaAction.LOGIN, null, null))
                .doesNotThrowAnyException();
        assertThat(verifier.calls).isZero();
    }

    // ────────────────────── 판정 ──────────────────────

    @Test
    @DisplayName("토큰이 없으면 거부한다 — 없다고 통과시키면 공격자도 빼고 보내면 그만이다")
    void missingTokenIsRejected() {
        enable(CaptchaAction.SIGNUP);

        assertThatThrownBy(() -> guard.require(CaptchaAction.SIGNUP, "  ", "203.0.113.7"))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getCode())
                .isEqualTo(ErrorCode.AUTH_CAPTCHA_REQUIRED);
    }

    @Test
    @DisplayName("봇으로 판정되면 거부한다 (fail-closed)")
    void failedVerificationIsRejected() {
        enable(CaptchaAction.SIGNUP);
        verifier.next = CaptchaVerifier.Result.fail("score 0.1 < 0.5", 0.1);

        assertThatThrownBy(() -> guard.require(CaptchaAction.SIGNUP, "token", null))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getCode())
                .isEqualTo(ErrorCode.AUTH_CAPTCHA_FAILED);
    }

    @Test
    @DisplayName("provider 에 닿지 못하면 통과시킨다 (fail-open) — 남의 장애가 우리 장애가 되면 안 된다")
    void unavailableProviderPassesThrough() {
        enable(CaptchaAction.SIGNUP);
        verifier.next = CaptchaVerifier.Result.unavailable("Timeout");

        assertThatCode(() -> guard.require(CaptchaAction.SIGNUP, "token", null))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("사람으로 판정되면 통과한다")
    void passedVerificationGoesThrough() {
        enable(CaptchaAction.SIGNUP, CaptchaAction.LOGIN);
        verifier.next = CaptchaVerifier.Result.pass(0.9);

        assertThatCode(() -> guard.require(CaptchaAction.LOGIN, "token", "203.0.113.7"))
                .doesNotThrowAnyException();
        assertThat(verifier.calls).isEqualTo(1);
    }

    // ────────────────────── 설정 실수 ──────────────────────

    @Test
    @DisplayName("구현이 없는 provider 를 골라도 막지 않는다 — 설정 실수로 가입이 멈추면 안 된다")
    void unknownProviderPassesThrough() {
        enable(CaptchaAction.SIGNUP);
        // NONE 구현(NoopCaptchaVerifier)을 등록하지 않은 상태 = provider 를 못 찾는 상황
        props.getCaptcha().setProvider(IxAuthProperties.Captcha.Provider.NONE);

        assertThatCode(() -> guard.require(CaptchaAction.SIGNUP, "token", null))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("NONE 구현은 '검증 안 함' 이지 '통과 판정' 이 아니다")
    void noopReportsUnavailableNotPass() {
        // PASS 로 답하면 "검증해서 사람으로 판정했다" 가 되어 로그·지표가 거짓이 된다
        var result = new NoopCaptchaVerifier().verify("anything", null);

        assertThat(result.outcome()).isEqualTo(CaptchaVerifier.Outcome.UNAVAILABLE);
    }

    @Test
    @DisplayName("isProtected 로 앱이 위젯을 그릴지 미리 판단할 수 있다")
    void exposesWhetherProtected() {
        enable(CaptchaAction.LOGIN);

        assertThat(guard.isProtected(CaptchaAction.LOGIN)).isTrue();
        assertThat(guard.isProtected(CaptchaAction.SIGNUP)).isFalse();
    }
}
