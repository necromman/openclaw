package team.prost.ixauth.mfa;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.config.IxAuthProperties.StepUpAction;
import team.prost.ixauth.service.MfaService;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * step-up 재인증 — <b>기본이 "요구하지 않음" 이라는 것</b>과 <b>2단계를 켜지 않은
 * 계정을 막지 않는다는 것</b>을 고정한다.
 *
 * <p>둘 중 하나라도 어긋나면 업그레이드하는 순간 비밀번호 변경·탈퇴 화면이 전부
 * 실패한다. 그건 보안 강화가 아니라 장애다.</p>
 */
class StepUpVerifierTest {

    private static final long USER = 42L;

    private IxAuthProperties props;
    private MfaService mfaService;
    private StepUpVerifier verifier;

    @BeforeEach
    void setUp() {
        props = new IxAuthProperties();
        mfaService = mock(MfaService.class);
        verifier = new StepUpVerifier(mfaService, props);
    }

    private void require(StepUpAction... actions) {
        props.getMfa().setStepUpActions(List.of(actions));
    }

    @Test
    @DisplayName("기본은 비어 있다 — 아무 작업에도 코드를 요구하지 않는다")
    void emptyByDefault() {
        assertThat(props.getMfa().getStepUpActions()).isEmpty();

        assertThatCode(() -> verifier.require(
                StepUpAction.PASSWORD_CHANGE, USER, null, "1.2.3.4", "UA"))
                .doesNotThrowAnyException();
        verify(mfaService, never()).verifyStepUpCode(anyLong(), anyString(), any(), any());
    }

    @Test
    @DisplayName("목록에 없는 작업은 그대로 통과한다")
    void unlistedActionPasses() {
        require(StepUpAction.MFA_DISABLE);

        assertThatCode(() -> verifier.require(
                StepUpAction.PASSWORD_CHANGE, USER, null, null, null))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("2단계를 켜지 않은 계정은 요구하지 않는다 — 요구할 코드 자체가 없다")
    void skipsWhenMfaNotActive() {
        require(StepUpAction.PASSWORD_CHANGE);
        when(mfaService.isActive(USER)).thenReturn(false);

        // 여기서 막으면 그 사람은 비밀번호조차 바꿀 수 없게 된다. 전원에게 강제하려면
        // mfa.mode = REQUIRED_ALL 이 그 수단이지 이 설정이 아니다
        assertThatCode(() -> verifier.require(
                StepUpAction.PASSWORD_CHANGE, USER, null, null, null))
                .doesNotThrowAnyException();
        verify(mfaService, never()).verifyStepUpCode(anyLong(), anyString(), any(), any());
    }

    @Test
    @DisplayName("필요한데 코드가 없으면 AUTH_MFA_REQUIRED — challenge 는 붙지 않는다")
    void demandsCodeWhenRequired() {
        require(StepUpAction.EMAIL_CHANGE);
        when(mfaService.isActive(USER)).thenReturn(true);

        assertThatThrownBy(() -> verifier.require(
                StepUpAction.EMAIL_CHANGE, USER, "  ", null, null))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getCode())
                .isEqualTo(ErrorCode.AUTH_MFA_REQUIRED);
    }

    @Test
    @DisplayName("meta 로 로그인 2단계와 구분된다 — challenge 가 없고 stepUp 이 있다")
    void metaTellsStepUpApartFromLoginChallenge() {
        require(StepUpAction.ACCOUNT_DELETE);
        when(mfaService.isActive(USER)).thenReturn(true);

        ApiException thrown = null;
        try {
            verifier.require(StepUpAction.ACCOUNT_DELETE, USER, null, null, null);
        } catch (ApiException e) {
            thrown = e;
        }

        assertThat(thrown).isNotNull();
        // 앱은 이 차이로 "코드를 받아 같은 요청을 다시 보내라" 와
        // "로그인 2단계로 가라" 를 구분한다
        assertThat(thrown.getMeta()).containsEntry("stepUp", "ACCOUNT_DELETE");
        assertThat(thrown.getMeta()).doesNotContainKey("challenge");
    }

    @Test
    @DisplayName("코드가 오면 검증에 넘긴다 — 재사용 차단은 그쪽 경로가 이미 한다")
    void delegatesCodeVerification() {
        require(StepUpAction.MFA_DISABLE);
        when(mfaService.isActive(USER)).thenReturn(true);
        when(mfaService.verifyStepUpCode(USER, "492013", "1.2.3.4", "UA")).thenReturn(true);

        assertThatCode(() -> verifier.require(
                StepUpAction.MFA_DISABLE, USER, "492013", "1.2.3.4", "UA"))
                .doesNotThrowAnyException();
        verify(mfaService).verifyStepUpCode(USER, "492013", "1.2.3.4", "UA");
    }

    @Test
    @DisplayName("isRequired 로 앱이 코드 입력 칸을 그릴지 미리 판단할 수 있다")
    void exposesWhetherRequired() {
        require(StepUpAction.PASSWORD_CHANGE, StepUpAction.MFA_DISABLE);

        assertThat(verifier.isRequired(StepUpAction.PASSWORD_CHANGE)).isTrue();
        assertThat(verifier.isRequired(StepUpAction.EMAIL_CHANGE)).isFalse();
    }
}
