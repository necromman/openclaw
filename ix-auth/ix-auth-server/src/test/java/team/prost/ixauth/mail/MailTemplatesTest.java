package team.prost.ixauth.mail;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import team.prost.ixauth.mail.MailMessage.Kind;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 기본 메일 템플릿 — 빠진 용도가 있으면 <b>그 메일만 조용히 안 나간다.</b>
 *
 * <p>새 {@code Kind} 를 더하고 템플릿을 빠뜨리는 것이 이 구조에서 가장 나기 쉬운 실수라,
 * enum 을 전부 훑어서 고정한다.</p>
 */
class MailTemplatesTest {

    @ParameterizedTest
    @EnumSource(Kind.class)
    @DisplayName("모든 용도에 ko·en 기본 템플릿이 있다")
    void everyKindHasBuiltInTemplates(Kind kind) {
        for (String locale : MailTemplates.BUILT_IN_LOCALES) {
            var template = MailTemplates.builtIn(kind, locale);
            assertThat(template)
                    .as("%s / %s 기본 템플릿", kind, locale)
                    .isNotNull();
            assertThat(template.subject()).isNotBlank();
            assertThat(template.body()).isNotBlank();
            // 제목에 제품명이 없으면 받은 사람이 어느 서비스에서 온 메일인지 알 수 없다
            assertThat(template.subject()).contains("{productName}");
        }
    }

    @Test
    @DisplayName("링크가 있어야 하는 메일에는 {link} 자리표시자가 있다")
    void linkKindsCarryLinkPlaceholder() {
        var withLink = new Kind[] {Kind.PASSWORD_RESET, Kind.EMAIL_VERIFY, Kind.EMAIL_CHANGE,
                Kind.INVITE, Kind.ACCOUNT_EXISTS, Kind.MAGIC_LINK};
        for (Kind kind : withLink) {
            for (String locale : MailTemplates.BUILT_IN_LOCALES) {
                // 링크가 빠지면 사용자는 계정을 되찾을 방법이 없다 — 본문만 오는 셈이다
                assertThat(MailTemplates.builtIn(kind, locale).body())
                        .as("%s / %s", kind, locale)
                        .contains("{link}");
            }
        }
    }

    @Test
    @DisplayName("없는 언어는 폴백 언어로, 그것도 없으면 ko 로 내려간다")
    void fallsBackWhenLocaleMissing() {
        var french = MailTemplates.defaultOf(Kind.PASSWORD_RESET, "fr", MailTemplates.EN);
        assertThat(french).isEqualTo(MailTemplates.builtIn(Kind.PASSWORD_RESET, MailTemplates.EN));

        var unknownBoth = MailTemplates.defaultOf(Kind.PASSWORD_RESET, "fr", "de");
        assertThat(unknownBoth)
                .isEqualTo(MailTemplates.builtIn(Kind.PASSWORD_RESET, MailTemplates.KO));
    }

    @Test
    @DisplayName("모르는 자리표시자는 지우지 않고 그대로 남긴다")
    void keepsUnknownPlaceholders() {
        // 지우면 관리자가 {nmae} 로 오타를 냈을 때 글자만 사라져 원인을 못 찾는다
        String out = MailTemplates.fill("{name} / {nmae}", Map.of("name", "홍길동"));
        assertThat(out).isEqualTo("홍길동 / {nmae}");
    }

    @Test
    @DisplayName("null 값은 빈 문자열로 채운다 — 본문에 null 이 보이면 안 된다")
    void nullValueBecomesEmpty() {
        var vars = new java.util.HashMap<String, String>();
        vars.put("link", null);
        assertThat(MailTemplates.fill("[{link}]", vars)).isEqualTo("[]");
    }

    @Test
    @DisplayName("ko-KR · KO 는 ko 로 본다")
    void normalizesLocale() {
        assertThat(MailTemplates.normalizeLocale("ko-KR", "en")).isEqualTo("ko");
        assertThat(MailTemplates.normalizeLocale("EN", "ko")).isEqualTo("en");
        assertThat(MailTemplates.normalizeLocale("en_US", "ko")).isEqualTo("en");
        assertThat(MailTemplates.normalizeLocale("  ", "ko")).isEqualTo("ko");
        assertThat(MailTemplates.normalizeLocale(null, "ko")).isEqualTo("ko");
    }
}
