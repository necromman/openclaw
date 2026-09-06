package team.prost.ixauth.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.hibernate.autoconfigure.HibernatePropertiesCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** {@link DbDialect} 를 스프링 빈으로 노출한다 — 방언 분기 지점(레이트리밋·감사 이력)이 주입받는다. */
@Configuration
public class DbDialectConfig {

    @Bean
    DbDialect dbDialect(@Value("${spring.datasource.url}") String jdbcUrl) {
        return DbDialect.fromJdbcUrl(jdbcUrl);
    }

    /**
     * MariaDB 에서는 {@code hibernate.default_schema} 를 걷어낸다.
     *
     * <p>MariaDB/MySQL 은 "스키마"가 JDBC 메타데이터상 카탈로그(=데이터베이스)라서,
     * PostgreSQL 용으로 걸어 둔 {@code default_schema=ixauth} 가 있으면 Hibernate 스키마
     * 검증이 현재 데이터베이스에서 표를 찾지 못하고 부팅을 거부한다(실측:
     * {@code missing table [audit_logs]}). MariaDB 모드의 접속 규약은 <b>URL 이 ixauth
     * 데이터베이스를 직접 가리키는 것</b>이므로(docs/contract/config.md §3 — 같은 서버의
     * 별도 데이터베이스, {@code createDatabaseIfNotExist=true} 로 자동 생성) 기본 스키마
     * 지정 자체가 필요 없다. 네이티브 SQL(레이트리밋·감사 이력·이력 정리)도 같은 이유로
     * 커넥션의 현재 데이터베이스를 그대로 탄다.</p>
     */
    @Bean
    HibernatePropertiesCustomizer mariadbSchemaNeutralizer(DbDialect dialect) {
        return hibernateProperties -> {
            if (dialect == DbDialect.MARIADB) {
                hibernateProperties.remove("hibernate.default_schema");
            }
        };
    }
}
