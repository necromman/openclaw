package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.Csv;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 사용자 일괄 등록 — 초기 도입 때 수백 명을 손으로 넣을 수 없다.
 *
 * <p>이 클래스의 설계는 두 문장으로 요약된다.</p>
 *
 * <ul>
 *   <li><b>한 줄이 틀렸다고 전체가 실패하지 않는다.</b> 300명 명단에서 이메일 하나가
 *       잘못됐다고 299명이 안 들어가면, 관리자는 그 하나를 찾아 고치고 전부 다시
 *       올려야 한다. 그러면 이미 들어간 계정이 중복 오류를 내고, 결국 아무도 이 기능을
 *       쓰지 않게 된다. 그래서 <b>행마다 독립된 트랜잭션</b>이다</li>
 *   <li><b>비밀번호를 만들지 않는다.</b> 관리자가 정한 비밀번호를 수백 명에게 전달할
 *       안전한 경로가 없다. 초대 링크를 보내 본인이 정하게 한다 — 기존 초대 흐름
 *       그대로다</li>
 * </ul>
 *
 * <p>이 클래스에 {@code @Transactional} 이 <b>없는 것이 의도</b>다. 붙이면 한 행의 실패가
 * 트랜잭션 전체를 rollback-only 로 만들어, 뒤 행이 성공해도 마지막에 통째로 되돌아간다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BulkUserImportService {

    /** roles 칸 안에서 역할을 나누는 문자. 쉼표는 CSV 구분자와 겹쳐 따옴표 안에서만 쓸 수 있다 */
    private static final String ROLE_SEPARATORS = "[,;|]";

    /**
     * 이메일 형식 검사.
     *
     * <p>이 경로는 컨트롤러의 {@code @Email} 을 지나지 않는다 — CSV 한 덩어리로 들어오기
     * 때문이다. 여기서 보지 않으면 오타 난 주소가 그대로 계정이 되고, 초대 메일은 영영
     * 닿지 않는다. 엄밀한 RFC 5322 가 아니라 <b>사람의 오타</b>를 잡는 수준이다 —
     * 형식이 맞아도 없는 주소일 수 있고, 그건 초대 메일이 판정한다.</p>
     */
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s.]+(\\.[^@\\s.]+)+$");

    private final UserAdminService userAdminService;
    private final AccountService accountService;
    private final IxAuthProperties properties;
    private final AuditService auditService;

    /**
     * @param line 원본에서 몇 번째 줄이었는지. 관리자가 파일을 열어 그 줄을 찾을 수 있어야
     *             한다 — 실패 사유만 주고 어디인지 안 알려 주면 300줄을 눈으로 훑게 된다
     */
    public record Row(int line, String email, String name, List<String> roles,
                      Map<String, Object> attributes) {
    }

    /** @param status {@code CREATED} · {@code FAILED} */
    public record RowResult(int line, String email, String status, Long userId, String error) {
    }

    public record Summary(int total, int created, int failed, int invited,
                          List<RowResult> results) {
    }

    /** 실행 주체 — 감사 로그의 actor 와 초대 메일에 적힐 이름 */
    public record Actor(Long userId, String name) {
    }

    // ────────────────────── 실행 ──────────────────────

    public Summary importRows(List<Row> rows, boolean invite, Actor actor) {
        assertWithinLimit(rows);

        var results = new ArrayList<RowResult>(rows.size());
        int created = 0;
        int invited = 0;
        for (Row row : rows) {
            var result = importOne(row, invite, actor);
            results.add(result);
            if ("CREATED".equals(result.status())) {
                created++;
                if (invite) {
                    invited++;
                }
            }
        }

        int failed = results.size() - created;
        auditService.record(AuditService.USERS_BULK_IMPORTED, null, actor.userId(), null, null,
                Map.of("total", results.size(), "created", created, "failed", failed,
                        "invited", invited));
        log.info("일괄 등록 — 총 {}건 · 성공 {} · 실패 {} (actor={})",
                results.size(), created, failed, actor.userId());
        return new Summary(results.size(), created, failed, invited, List.copyOf(results));
    }

    /**
     * 한 행. 여기서 <b>모든 예외를 잡는다</b> — 이 메서드 밖으로 나가면 나머지 행이 죽는다.
     */
    private RowResult importOne(Row row, boolean invite, Actor actor) {
        if (row.email() == null || row.email().isBlank()) {
            return new RowResult(row.line(), row.email(), "FAILED", null, "이메일이 없습니다.");
        }
        if (!EMAIL.matcher(row.email().trim()).matches()) {
            return new RowResult(row.line(), row.email(), "FAILED", null,
                    "이메일 형식이 올바르지 않습니다.");
        }
        try {
            String name = (row.name() == null || row.name().isBlank())
                    ? row.email().split("@")[0] : row.name().trim();
            // 비밀번호를 주지 않는다 = 초대 방식. 계정은 PENDING 으로 만들어진다
            var user = userAdminService.create(row.email().trim(), name, null,
                    row.roles(), row.attributes(), actor.userId());
            if (invite) {
                sendInviteQuietly(user.getId(), actor);
            }
            return new RowResult(row.line(), row.email(), "CREATED", user.getId(), null);
        } catch (ApiException e) {
            return new RowResult(row.line(), row.email(), "FAILED", null, e.getMessage());
        } catch (Exception e) {
            // 예상 못 한 예외도 그 줄에서 멈춘다. 원문을 응답에 싣지 않는다 —
            // 내부 경로·SQL 이 새어 나가는 자리다 (docs/contract/errors.md)
            log.warn("일괄 등록 실패 — line={} ({}: {})",
                    row.line(), e.getClass().getSimpleName(), e.getMessage());
            return new RowResult(row.line(), row.email(), "FAILED", null,
                    "처리 중 오류가 발생했습니다.");
        }
    }

    /**
     * 초대 메일 실패는 <b>계정 생성을 되돌리지 않는다.</b>
     *
     * <p>메일 하나가 안 나갔다고 계정을 지우면, 관리자는 무엇이 들어갔고 무엇이 아닌지
     * 알 수 없게 된다. 계정은 남기고 관리자가 그 사람만 다시 초대하면 된다.</p>
     */
    private void sendInviteQuietly(Long userId, Actor actor) {
        try {
            accountService.sendInvite(userId, actor.name(), actor.userId(), null, null);
        } catch (Exception e) {
            log.warn("일괄 등록 — 초대 메일 발송 실패 user={} ({})", userId, e.getMessage());
        }
    }

    private void assertWithinLimit(List<Row> rows) {
        int max = Math.max(1, properties.getAccount().getBulkImportMax());
        if (rows.size() > max) {
            // 앞의 max 건만 처리하지 않는다 — 일부만 들어간 것을 관리자가 알아채기 어렵다
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "한 번에 등록할 수 있는 건수(" + max + ")를 넘었습니다. 나눠서 올리세요.",
                    List.of(Map.of("field", "users",
                            "reason", rows.size() + "건 · 상한 " + max + "건")));
        }
    }

    // ────────────────────── CSV ──────────────────────

    /**
     * {@code email,name,roles} 세 칸. 첫 줄이 머리글이면 건너뛴다.
     *
     * <p>역할이 여럿이면 {@code "ADMIN,USER"} 처럼 따옴표로 감싸거나
     * {@code ADMIN;USER} · {@code ADMIN|USER} 로 적는다 — 엑셀에서 따옴표를 넣는 것이
     * 생각보다 어렵기 때문에 대체 구분자를 함께 받는다.</p>
     *
     * <p>줄 번호는 <b>머리글을 건너뛰어도 원본 기준</b>으로 센다. 결과에 적힌 번호로
     * 관리자가 파일을 열어 그 줄을 바로 찾을 수 있어야 한다.</p>
     */
    public static List<Row> parseCsv(String csv) {
        var rows = Csv.parse(csv);
        var out = new ArrayList<Row>();
        int line = 0;
        for (var cells : rows) {
            line++;
            if (line == 1 && isHeader(cells)) {
                continue;
            }
            out.add(new Row(line,
                    cell(cells, 0),
                    cell(cells, 1),
                    splitRoles(cell(cells, 2)),
                    Map.of()));
        }
        return out;
    }

    private static boolean isHeader(List<String> cells) {
        return !cells.isEmpty() && "email".equalsIgnoreCase(cells.get(0).trim());
    }

    private static String cell(List<String> cells, int index) {
        return index < cells.size() ? cells.get(index) : null;
    }

    private static List<String> splitRoles(String raw) {
        if (raw == null || raw.isBlank()) {
            // null 이면 UserAdminService 가 기본 역할(USER)을 붙인다
            return null;
        }
        return Arrays.stream(raw.split(ROLE_SEPARATORS))
                .map(String::trim).filter(s -> !s.isEmpty()).toList();
    }
}
