package team.prost.ixauth.api;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 헬스체크 — DB 연결 + 마이그레이션 상태.
 *
 * <p>하나라도 실패면 503 + {@code status: DOWN} (docs/contract/http-api.md §5).</p>
 */
@RestController
@RequiredArgsConstructor
@Slf4j
public class HealthController {

    private final DataSource dataSource;
    private final org.springframework.core.env.Environment environment;

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> body = new LinkedHashMap<>();
        boolean dbUp = checkDb();
        boolean migrationOk = dbUp && checkMigration();

        body.put("status", (dbUp && migrationOk) ? "UP" : "DOWN");
        body.put("db", dbUp ? "UP" : "DOWN");
        body.put("migration", migrationOk ? "OK" : "FAILED");
        body.put("version", environment.getProperty("ixauth.version", "0.1.0-SNAPSHOT"));

        return ResponseEntity.status((dbUp && migrationOk) ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
                .body(body);
    }

    private boolean checkDb() {
        try (var conn = dataSource.getConnection()) {
            return conn.isValid(2);
        } catch (Exception e) {
            log.warn("헬스체크 — DB 연결 실패: {}", e.getMessage());
            return false;
        }
    }

    /** baseline 테이블이 실제로 있는지 본다 — 마이그레이션이 돌지 않으면 여기서 걸린다 */
    private boolean checkMigration() {
        try (var conn = dataSource.getConnection();
             var st = conn.createStatement()) {
            st.executeQuery("select 1 from users where 1 = 0").close();
            return true;
        } catch (Exception e) {
            log.warn("헬스체크 — 마이그레이션 미적용 추정: {}", e.getMessage());
            return false;
        }
    }
}
