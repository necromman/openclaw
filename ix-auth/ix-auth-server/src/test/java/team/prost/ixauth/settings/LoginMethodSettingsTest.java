package team.prost.ixauth.settings;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.config.IxAuthProperties.CaptchaAction;
import team.prost.ixauth.config.IxAuthProperties.StepUpAction;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 로그인 수단 4종의 설정이 <b>화면에서 실제로 바뀌는가</b>.
 *
 * <p>부팅만으로는 reader 만 돌아간다. applier 가 깨져 있으면 "설정했는데 저장이 안 된다"
 * 가 되고, 그건 관리자가 원인을 짚기 가장 어려운 실패다 — 화면은 멀쩡히 뜨기 때문이다.
 * 그래서 읽기·쓰기 왕복을 여기서 고정한다.</p>
 */
class LoginMethodSettingsTest {

    private SettingDefinitions definitions;
    private IxAuthProperties props;

    @BeforeEach
    void setUp() {
        definitions = new SettingDefinitions();
        props = new IxAuthProperties();
    }

    private SettingBinding binding(String key) {
        var found = definitions.find(key);
        assertThat(found).as("정의 미등록 — 관리자가 화면에서 바꿀 수 없다: %s", key).isNotNull();
        return found;
    }

    private String roundTrip(String key, String value) {
        var b = binding(key);
        b.applier().accept(props, value);
        return b.reader().apply(props);
    }

    @Test
    @DisplayName("네 기능의 설정이 모두 등록돼 있다 — 없으면 yml 을 고치고 재시작해야 한다")
    void allRegistered() {
        for (String key : List.of("account.magic-link-enabled", "account.magic-link-token-ttl",
                "mail.magic-link-path", "captcha.enabled", "captcha.provider",
                "captcha.min-score", "captcha.protect", "mfa.step-up-actions")) {
            assertThat(definitions.contains(key)).as("미등록: %s", key).isTrue();
        }
    }

    @Test
    @DisplayName("시크릿은 등록하지 않는다 — 화면에서 편집 가능하면 유출면이 넓어진다")
    void secretsAreNotExposed() {
        assertThat(definitions.contains("captcha.secret-key")).isFalse();
    }

    @Test
    @DisplayName("매직 링크 — 기본은 꺼짐, 수명은 재설정 링크보다 짧다")
    void magicLinkDefaults() {
        assertThat(props.getAccount().isMagicLinkEnabled()).isFalse();
        assertThat(props.getAccount().getMagicLinkTokenTtl())
                .as("링크 자체가 로그인이라 재설정 링크보다 짧아야 한다")
                .isLessThan(props.getAccount().getResetTokenTtl());

        assertThat(roundTrip("account.magic-link-enabled", "true")).isEqualTo("true");
        assertThat(props.getAccount().isMagicLinkEnabled()).isTrue();

        // 화면에는 30m·10m 으로 적는다. PT10M 을 적게 하지 않는다
        roundTrip("account.magic-link-token-ttl", "5m");
        assertThat(props.getAccount().getMagicLinkTokenTtl().toMinutes()).isEqualTo(5);
        roundTrip("mail.magic-link-path", " /login-link ");
        assertThat(props.getMail().getMagicLinkPath()).isEqualTo("/login-link");
    }

    @Test
    @DisplayName("CAPTCHA — 기본은 꺼짐이고 보호 대상에 LOGIN 이 없다")
    void captchaDefaults() {
        assertThat(props.getCaptcha().isEnabled()).isFalse();
        // 로그인이 막히면 이미 쓰고 있는 전원이 못 들어온다 — 무게가 다르다
        assertThat(props.getCaptcha().getProtect())
                .containsExactly(CaptchaAction.SIGNUP, CaptchaAction.PASSWORD_FORGOT);
        assertThat(props.getCaptcha().getMinScore()).isEqualTo(0.5);
    }

    @Test
    @DisplayName("CAPTCHA — 목록·점수·제공자가 화면 표기 그대로 왕복한다")
    void captchaRoundTrip() {
        assertThat(roundTrip("captcha.protect", "signup, login"))
                .isEqualTo("SIGNUP, LOGIN");
        assertThat(props.getCaptcha().getProtect())
                .containsExactly(CaptchaAction.SIGNUP, CaptchaAction.LOGIN);

        assertThat(roundTrip("captcha.protect", "")).isEmpty();
        assertThat(props.getCaptcha().getProtect()).isEmpty();

        roundTrip("captcha.provider", "none");
        assertThat(props.getCaptcha().getProvider())
                .isEqualTo(IxAuthProperties.Captcha.Provider.NONE);

        roundTrip("captcha.min-score", "0.7");
        assertThat(props.getCaptcha().getMinScore()).isEqualTo(0.7);
    }

    @Test
    @DisplayName("점수는 0.0~1.0 밖이면 저장되지 않는다 — 넘기면 아무도 통과하지 못한다")
    void scoreRangeIsEnforced() {
        var b = binding("captcha.min-score");

        assertThatThrownBy(() -> b.applier().accept(props, "1.5"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> b.applier().accept(props, "높게"))
                .isInstanceOf(IllegalArgumentException.class);
        // 실패했으면 기존 값이 그대로여야 한다
        assertThat(props.getCaptcha().getMinScore()).isEqualTo(0.5);
    }

    @Test
    @DisplayName("step-up — 기본은 비어 있고, 모르는 값은 조용히 버리지 않는다")
    void stepUpDefaultsAndParsing() {
        assertThat(props.getMfa().getStepUpActions()).isEmpty();
        assertThat(binding("mfa.step-up-actions").reader().apply(props)).isEmpty();

        assertThat(roundTrip("mfa.step-up-actions", "email_change, mfa_disable"))
                .isEqualTo("EMAIL_CHANGE, MFA_DISABLE");
        assertThat(props.getMfa().getStepUpActions())
                .containsExactly(StepUpAction.EMAIL_CHANGE, StepUpAction.MFA_DISABLE);

        // 오타를 버리면 "설정했는데 안 걸린다" 가 된다 — 보안 설정에서 가장 나쁜 실패다
        assertThatThrownBy(() -> binding("mfa.step-up-actions")
                .applier().accept(props, "EMAIL_CHANGE, TYPO"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
