package team.prost.ixauth.common;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * CSV 쓰기·읽기 — 감사 로그 내보내기(G14)가 만든 파일을 우리 파서가 되읽을 수 있어야 한다.
 *
 * <p>되읽지 못하면 "내보낸 것을 다시 올릴 수 없는" 상태가 되고, 그건 대개 쓰는 쪽이
 * 이스케이프를 빠뜨렸다는 뜻이다.</p>
 */
class CsvTest {

    @Test
    @DisplayName("평범한 값은 감싸지 않는다 — 사람이 먼저 눈으로 훑는 파일이다")
    void plainCellStaysPlain() {
        assertThat(Csv.escape("LOGIN_SUCCESS")).isEqualTo("LOGIN_SUCCESS");
        assertThat(Csv.escape("")).isEmpty();
        assertThat(Csv.escape(null)).isEmpty();
    }

    @Test
    @DisplayName("쉼표·따옴표·줄바꿈이 있으면 감싸고 따옴표는 두 번 적는다")
    void quotesWhenNeeded() {
        assertThat(Csv.escape("a,b")).isEqualTo("\"a,b\"");
        assertThat(Csv.escape("say \"hi\"")).isEqualTo("\"say \"\"hi\"\"\"");
        assertThat(Csv.escape("line1\nline2")).isEqualTo("\"line1\nline2\"");
    }

    @Test
    @DisplayName("내보낸 줄을 그대로 되읽을 수 있다")
    void roundTrip() {
        String detail = "{\"key\":\"account.signup-mode\",\"before\":\"OPEN\"}";
        String line = String.join(",", Csv.escape("1"), Csv.escape("LOGIN_SUCCESS"),
                Csv.escape("Mozilla/5.0 (Windows NT 10.0; Win64, x64)"), Csv.escape(detail));

        var rows = Csv.parse(line);
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0)).containsExactly("1", "LOGIN_SUCCESS",
                "Mozilla/5.0 (Windows NT 10.0; Win64, x64)", detail);
    }
}
