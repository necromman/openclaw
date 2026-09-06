package team.prost.ixauth.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MariaDBContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * MariaDB 방언 마이그레이션 검증 — {@code db/migration/mariadb} 가 실 MariaDB 위에서
 * 끝까지 적용되는지, 그리고 이미 적용된 설치본이 새 버전으로 이어 올라가는지.
 *
 * <p>PostgreSQL 쪽은 기존 통합 테스트가 계속 지킨다. 이 테스트의 존재 이유는 방언 사본이
 * 원본과 <b>함께 늙게</b> 만드는 것이다 — postgresql/ 에 새 버전을 추가하고 mariadb/ 를
 * 잊으면 여기서 개수 불일치로 깨진다.</p>
 *
 * <p>root 로 접속하는 이유 — 운영과 동일하게 {@code create-schemas} 로 {@code ixauth}
 * 스키마(MariaDB 에서는 데이터베이스)를 Flyway 가 직접 만들게 하는데, 컨테이너 기본
 * 사용자는 자기 데이터베이스 밖을 만들 권한이 없다.</p>
 */
@Testcontainers
class MariaDbMigrationTest {

    private static final int EXPECTED_MIGRATIONS = 13;

    /**
     * 업그레이드 경로의 출발점 — 운영 설치본 두 곳이 이 버전까지 적용돼 있다.
     *
     * <p>고정 숫자로 두는 이유 — {@code EXPECTED_MIGRATIONS - 1} 로 적어 두면
     * 마이그레이션이 하나 늘 때마다 <b>출발점도 함께 밀린다.</b> 그러면 이 검사는
     * '이미 깔려 있는 DB' 가 아니라 '바로 직전 버전' 만 보게 되고, 정작 확인하려던
     * V1 체크섬 불변은 검증되지 않는다.</p>
     */
    private static final int UPGRADE_BASELINE = 11;

    @Container
    private static final MariaDBContainer<?> DB = new MariaDBContainer<>("mariadb:11.4");

    @Test
    void mariadbMigrationsApplyCleanly() throws Exception {
        var result = Flyway.configure()
                .dataSource(DB.getJdbcUrl(), "root", DB.getPassword())
                .locations("classpath:db/migration/mariadb")
                .schemas("ixauth")
                .defaultSchema("ixauth")
                .createSchemas(true)
                .table("ixauth_flyway_history")
                .load()
                .migrate();

        assertThat(result.success).isTrue();
        assertThat(result.migrationsExecuted).isEqualTo(EXPECTED_MIGRATIONS);

        try (Connection connection =
                     DriverManager.getConnection(DB.getJdbcUrl(), "root", DB.getPassword());
             ResultSet tables = connection.createStatement().executeQuery(
                     "select count(*) from information_schema.tables where table_schema = 'ixauth'")) {
            assertThat(tables.next()).isTrue();
            assertThat(tables.getInt(1)).isGreaterThanOrEqualTo(20);
        }
    }

    /**
     * 업그레이드 경로 — 이미 V11 까지 적용된 DB 가 새 버전에서 깨지지 않는가.
     *
     * <p>운영 설치본 두 곳(MariaDB 11.4)이 정확히 이 상태다. 새로 만든 DB 에 전부 적용해
     * 보는 것만으로는 <b>기존 표를 옮기는</b> V12 를 검증하지 못한다 — 새 DB 에서는 옮길
     * 표가 이미 최종 이름일 수도 있기 때문이다. 그래서 옛 버전까지만 적용한 상태를 만들고
     * 거기서 이어 올린다.</p>
     *
     * <p>V1 의 체크섬을 바꾸지 않았다는 것도 여기서 함께 증명된다 — 바꿨다면 두 번째
     * migrate 가 validate 단계에서 거부된다.</p>
     */
    @Test
    void upgradesFromExistingV11Installation() throws Exception {
        var baseline = Flyway.configure()
                .dataSource(DB.getJdbcUrl(), "root", DB.getPassword())
                .locations("classpath:db/migration/mariadb")
                .schemas("ixauth_upgrade")
                .defaultSchema("ixauth_upgrade")
                .createSchemas(true)
                .table("ixauth_flyway_history")
                .target("11")
                .load()
                .migrate();
        assertThat(baseline.migrationsExecuted).isEqualTo(UPGRADE_BASELINE);

        try (Connection connection =
                     DriverManager.getConnection(DB.getJdbcUrl(), "root", DB.getPassword());
             ResultSet legacy = connection.createStatement().executeQuery(
                     "select count(*) from information_schema.tables"
                             + " where table_schema = 'ixauth_upgrade' and table_name = 'groups'")) {
            assertThat(legacy.next()).isTrue();
            assertThat(legacy.getInt(1)).as("V11 시점에는 옛 이름이 있어야 한다").isEqualTo(1);
        }

        var upgrade = Flyway.configure()
                .dataSource(DB.getJdbcUrl(), "root", DB.getPassword())
                .locations("classpath:db/migration/mariadb")
                .schemas("ixauth_upgrade")
                .defaultSchema("ixauth_upgrade")
                .table("ixauth_flyway_history")
                .load()
                .migrate();
        assertThat(upgrade.success).isTrue();
        assertThat(upgrade.migrationsExecuted)
                .isEqualTo(EXPECTED_MIGRATIONS - UPGRADE_BASELINE);

        try (Connection connection =
                     DriverManager.getConnection(DB.getJdbcUrl(), "root", DB.getPassword());
             ResultSet renamed = connection.createStatement().executeQuery(
                     "select table_name from information_schema.tables"
                             + " where table_schema = 'ixauth_upgrade'"
                             + " and table_name in ('groups','ixauth_groups')")) {
            assertThat(renamed.next()).isTrue();
            assertThat(renamed.getString(1)).isEqualTo("ixauth_groups");
            assertThat(renamed.next()).isFalse();
        }
    }
}
