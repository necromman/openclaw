package team.prost.ixauth;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import team.prost.ixauth.domain.Term;
import team.prost.ixauth.service.TermTemplates;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 표준 약관 문안이 "그대로 게시해도 되는 것처럼" 보이지 않아야 한다. */
class TermTemplatesTest {

    private final List<Term> templates = TermTemplates.standard();

    @Test
    @DisplayName("국내 가입 화면의 네 가지가 모두 있고, 필수/선택이 구분돼 있다")
    void coversStandardSet() {
        assertThat(templates).extracting(Term::getCode)
                .containsExactly("service", "privacy", "age", "marketing");
        // 광고성 정보 수신만 선택이다 — 필수로 두면 동의를 강요하는 것이 된다
        assertThat(templates).filteredOn(t -> !t.isRequired())
                .extracting(Term::getCode).containsExactly("marketing");
    }

    @Test
    @DisplayName("검토 없이 게시하지 못하게, 채워야 할 자리가 본문에 드러나 있다")
    void marksPlaceholdersForReview() {
        for (Term t : templates) {
            assertThat(t.getBody()).as("%s 본문", t.getCode())
                    .startsWith("※ 이 문안은 표준 예시다.");
        }
        // 서비스마다 달라지는 값은 비워 둔다 — 그대로 게시하면 사용자 눈에 대괄호가 보인다
        assertThat(find("service").getBody()).contains("[회사명]", "[서비스명]");
        assertThat(find("privacy").getBody()).contains("[5년]", "[이름]");
    }

    @Test
    @DisplayName("초안으로만 들어간다 — 불러오는 즉시 사용자에게 보이면 안 된다")
    void seedsAsDraft() {
        assertThat(templates).allSatisfy(t -> assertThat(t.getPublishedAt()).isNull());
    }

    @Test
    @DisplayName("표시 순서가 필수 먼저, 선택 나중이다")
    void ordersRequiredFirst() {
        int lastRequired = templates.stream().filter(Term::isRequired)
                .mapToInt(Term::getDisplayOrder).max().orElseThrow();
        int firstOptional = templates.stream().filter(t -> !t.isRequired())
                .mapToInt(Term::getDisplayOrder).min().orElseThrow();
        assertThat(firstOptional).isGreaterThan(lastRequired);
    }

    private Term find(String code) {
        return templates.stream().filter(t -> t.getCode().equals(code)).findFirst().orElseThrow();
    }
}
