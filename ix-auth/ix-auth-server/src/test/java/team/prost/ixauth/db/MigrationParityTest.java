package team.prost.ixauth.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.File;
import java.net.URL;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.junit.jupiter.api.Test;

/**
 * 방언 폴더 세 벌의 <b>파일 이름이 같은가</b>.
 *
 * <p>컨테이너를 띄우는 검증(MariaDbMigrationTest·MySqlMigrationTest)보다 먼저 깨져야 하는
 * 것이 이것이다. postgresql/ 에 V13 을 추가하고 mariadb/·mysql/ 을 잊으면, 그 방언을 쓰는
 * 설치본은 <b>부팅은 되고</b> Hibernate validate 단계에서야 missing table 로 드러난다 —
 * 그때는 이미 배포된 뒤다.</p>
 *
 * <p>내용까지 비교하지는 않는다. 방언이 다르니 내용은 당연히 다르고, 무엇이 왜 다른지는
 * 각 파일 머리말 주석이 진다.</p>
 */
class MigrationParityTest {

    private static final List<String> VENDORS = List.of("postgresql", "mariadb", "mysql");

    @Test
    void everyVendorHasTheSameMigrationFiles() {
        List<String> reference = migrationNames(VENDORS.get(0));

        assertThat(reference).isNotEmpty();
        for (String vendor : VENDORS) {
            assertThat(migrationNames(vendor))
                    .as("db/migration/%s 의 마이그레이션 목록", vendor)
                    .isEqualTo(reference);
        }
    }

    private List<String> migrationNames(String vendor) {
        URL url = getClass().getClassLoader().getResource("db/migration/" + vendor);
        assertThat(url).as("db/migration/%s 가 클래스패스에 없다", vendor).isNotNull();
        File[] files = new File(url.getPath()).listFiles((dir, name) -> name.endsWith(".sql"));
        return Arrays.stream(Objects.requireNonNull(files))
                .map(File::getName)
                .sorted()
                .toList();
    }
}
