package team.prost.ixauth.config;

import java.util.Locale;

/**
 * 실행 중인 앱 DB 의 SQL 방언.
 *
 * <p>IX-Auth 는 앱 DB 를 공유한다(설계 불변식 3). 그런데 마이그레이션·네이티브 SQL 이
 * PostgreSQL 전용이면 MariaDB 를 쓰는 앱은 인증 서버만을 위해 PG 를 따로 띄워야 하고,
 * 그것은 불변식 3 의 정신("전용 DB 를 띄우지 않는다")에 정면으로 어긋난다.</p>
 *
 * <p>그래서 방언이 실제로 갈리는 소수의 네이티브 SQL 지점만 이 enum 으로 분기한다.
 * 정책 분기(CLAUDE.md 3-1 금지 대상)가 아니라 DB 벤더라는 기술 사실의 분기다 —
 * 관리자가 바꿀 수 있는 값이 아니므로 설정 화면에 올리지 않는다.</p>
 */
public enum DbDialect {

    POSTGRESQL,
    MARIADB;

    /**
     * JDBC URL 로 방언을 정한다.
     *
     * <p>{@code jdbc:mariadb:}·{@code jdbc:mysql:} 만 MariaDB 로 보고, 그 외(H2 포함)는
     * 전부 기본인 PostgreSQL 로 둔다 — H2 는 PG 호환 모드로 쓰는 것이 이 저장소의 전제다.</p>
     */
    public static DbDialect fromJdbcUrl(String url) {
        String lower = url == null ? "" : url.toLowerCase(Locale.ROOT);
        if (lower.startsWith("jdbc:mariadb:") || lower.startsWith("jdbc:mysql:")) {
            return MARIADB;
        }
        return POSTGRESQL;
    }
}
