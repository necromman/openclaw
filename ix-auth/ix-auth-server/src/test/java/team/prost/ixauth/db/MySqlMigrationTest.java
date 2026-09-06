package team.prost.ixauth.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * MySQL 8 방언 마이그레이션 검증 — {@code db/migration/mysql} 이 실 MySQL 8 위에서
 * 끝까지 적용되는지.
 *
 * <p>이 테스트가 있는 이유는 mariadb/ 사본을 MySQL 에 그대로 붙였을 때 실제로 부팅이
 * 막혔기 때문이다 (2026-08-20 늘봄 PoC). 두 곳에서 걸렸고 둘 다 Java 테스트로는
 * 잡히지 않는 SQL 문법 문제였다:</p>
 * <ul>
 *   <li>{@code JSON NOT NULL DEFAULT '{}'} → ERROR 1101 (JSON 은 리터럴 기본값 금지)</li>
 *   <li>{@code CREATE TABLE groups} → ERROR 1064 (GROUPS 는 8.0.2+ 예약어)</li>
 * </ul>
 *
 * <p>root 로 접속하는 이유는 MariaDB 쪽과 같다 — 운영과 동일하게 Flyway 가
 * {@code ixauth} 데이터베이스를 직접 만들게 한다.</p>
 */
@Testcontainers
class MySqlMigrationTest {

    private static final int EXPECTED_MIGRATIONS = 13;

    @Container
    private static final MySQLContainer<?> DB = new MySQLContainer<>("mysql:8.0");

    @Test
    void mysqlMigrationsApplyCleanly() throws Exception {
        var result = Flyway.configure()
                .dataSource(DB.getJdbcUrl(), "root", DB.getPassword())
                .locations("classpath:db/migration/mysql")
                .schemas("ixauth")
                .defaultSchema("ixauth")
                .createSchemas(true)
                .table("ixauth_flyway_history")
                .load()
                .migrate();

        assertThat(result.success).isTrue();
        assertThat(result.migrationsExecuted).isEqualTo(EXPECTED_MIGRATIONS);

        try (Connection connection =
                     DriverManager.getConnection(DB.getJdbcUrl(), "root", DB.getPassword())) {
            try (ResultSet tables = connection.createStatement().executeQuery(
                    "select count(*) from information_schema.tables where table_schema = 'ixauth'")) {
                assertThat(tables.next()).isTrue();
                assertThat(tables.getInt(1)).isGreaterThanOrEqualTo(20);
            }
            // 예약어 회피가 이름 자체로 이뤄졌는지 — 백틱 우회였다면 groups 가 남는다
            try (ResultSet named = connection.createStatement().executeQuery(
                    "select table_name from information_schema.tables"
                            + " where table_schema = 'ixauth' and table_name in ('groups','ixauth_groups')")) {
                assertThat(named.next()).isTrue();
                assertThat(named.getString(1)).isEqualTo("ixauth_groups");
                assertThat(named.next()).isFalse();
            }
        }
    }
}
