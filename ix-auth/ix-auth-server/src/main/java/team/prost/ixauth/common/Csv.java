package team.prost.ixauth.common;

import java.util.ArrayList;
import java.util.List;

/**
 * 최소한의 CSV 읽기 — 일괄 등록이 받는 본문을 줄·칸으로 나눈다.
 *
 * <p><b>라이브러리를 넣지 않은 이유.</b> 여기서 필요한 것은 RFC 4180 의 극히 일부다 —
 * 따옴표로 감싼 칸과 그 안의 쉼표·줄바꿈. 이 제품은 폐쇄망에 설치되므로 의존성 하나가
 * 곧 오프라인 패키지 하나이고, 40줄로 되는 일에 그 값을 치를 이유가 없다.</p>
 *
 * <p>다루지 <b>않는</b> 것: 구분자 변경(세미콜론 CSV)·인코딩 추정. 관리자가 엑셀에서
 * 저장한 UTF-8 쉼표 CSV 를 받는 것이 이 기능의 전부다.</p>
 */
public final class Csv {

    private Csv() {
    }

    /**
     * 줄마다 칸 목록. 빈 줄은 버린다 — 엑셀이 파일 끝에 남기는 빈 줄이 "이메일이 없는
     * 행" 으로 잡혀 실패 목록을 채우면, 진짜 실패가 묻힌다.
     */
    public static List<List<String>> parse(String text) {
        var rows = new ArrayList<List<String>>();
        if (text == null || text.isBlank()) {
            return rows;
        }
        var row = new ArrayList<String>();
        var cell = new StringBuilder();
        boolean quoted = false;

        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (quoted) {
                if (c != '"') {
                    cell.append(c);
                } else if (i + 1 < text.length() && text.charAt(i + 1) == '"') {
                    cell.append('"');       // "" 는 따옴표 한 글자다
                    i++;
                } else {
                    quoted = false;
                }
                continue;
            }
            switch (c) {
                case '"' -> quoted = true;
                case ',' -> {
                    row.add(cell.toString().trim());
                    cell.setLength(0);
                }
                case '\r' -> { /* CRLF 의 CR 은 버린다 — 윈도우에서 만든 파일이 대부분이다 */ }
                case '\n' -> {
                    row.add(cell.toString().trim());
                    cell.setLength(0);
                    addIfNotBlank(rows, row);
                    row = new ArrayList<>();
                }
                default -> cell.append(c);
            }
        }
        row.add(cell.toString().trim());
        addIfNotBlank(rows, row);
        return rows;
    }

    /**
     * 칸 하나를 CSV 로 쓸 수 있게 감싼다.
     *
     * <p>쉼표·따옴표·줄바꿈이 들어 있을 때만 감싼다 — 전부 감싸면 사람이 눈으로 볼 때
     * 읽기 어렵고, 감사 로그 CSV 는 대개 사람이 먼저 훑는다. 따옴표는 두 번 적어
     * 이스케이프한다(RFC 4180). {@link #parse} 가 그대로 되읽을 수 있는 표기다.</p>
     */
    public static String escape(String cell) {
        if (cell == null || cell.isEmpty()) {
            return "";
        }
        boolean needsQuote = cell.indexOf(',') >= 0 || cell.indexOf('"') >= 0
                || cell.indexOf('\n') >= 0 || cell.indexOf('\r') >= 0;
        if (!needsQuote) {
            return cell;
        }
        return '"' + cell.replace("\"", "\"\"") + '"';
    }

    private static void addIfNotBlank(List<List<String>> rows, List<String> row) {
        if (row.stream().anyMatch(s -> !s.isEmpty())) {
            rows.add(List.copyOf(row));
        }
    }
}
