plugins {
    id("org.springframework.boot")
    id("io.spring.dependency-management")
}

dependencies {
    implementation(project(":ix-auth-common"))

    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    // 비밀번호 찾기·이메일 인증 메일. jar 가 직접 보내는 것이 기본이다 —
    // 앱에 떠넘기면 프로젝트마다 발송 코드를 다시 만들게 된다
    implementation("org.springframework.boot:spring-boot-starter-mail")

    // 스키마 자동 마이그레이션 — 부팅 시 ixauth 스키마를 스스로 만든다 (제품의 존재 이유 중 하나)
    //
    // ⚠ Spring Boot 4 는 Flyway 자동설정을 spring-boot-flyway 로 분리했다.
    //   flyway-core 만 넣으면 의존성은 있는데 마이그레이션이 조용히 실행되지 않는다
    //   (2026-08-08 실측: 부팅은 되고 Hibernate validate 단계에서 missing table 로만 드러남).
    implementation("org.springframework.boot:spring-boot-flyway")
    implementation("org.flywaydb:flyway-core")
    runtimeOnly("org.flywaydb:flyway-database-postgresql")
    runtimeOnly("org.postgresql:postgresql")
    // 앱 DB 가 MariaDB/MySQL 인 프로젝트 지원 — 불변식 3(앱 DB 공유)을 PG 가 아닌 앱에서도
    // 성립시킨다. 마이그레이션은 db/migration/{vendor} 로 방언별 분리(application.yml)
    runtimeOnly("org.flywaydb:flyway-mysql")
    runtimeOnly("org.mariadb.jdbc:mariadb-java-client")
    // MySQL 8 은 MariaDB 와 방언이 갈린다(JSON 리터럴 DEFAULT 금지 · GROUPS 예약어 ·
    // UUID 타입 없음). Flyway 는 JDBC URL 로 vendor 를 정하므로 MySQL 은 jdbc:mysql:// 로
    // 붙어야 db/migration/mysql 을 탄다 — 그러려면 이 드라이버가 있어야 한다
    // (mariadb 드라이버는 mysql 스킴을 기본으로 받지 않는다). docs/contract/config.md §3
    runtimeOnly("com.mysql:mysql-connector-j")
    // 개발 편의용 임베디드 (ixauth.db.embedded=true). 운영에서는 부팅 거부
    runtimeOnly("com.h2database:h2")

    // JWT — 직접 구현하지 않는다 (rules/coding-style.md 보안 규칙 1)
    implementation("com.nimbusds:nimbus-jose-jwt:9.40")

    compileOnly("org.projectlombok:lombok")
    annotationProcessor("org.projectlombok:lombok")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.security:spring-security-test")
    testImplementation("org.testcontainers:junit-jupiter:1.20.4")
    testImplementation("org.testcontainers:postgresql:1.20.4")
    testImplementation("org.testcontainers:mariadb:1.20.4")
    testImplementation("org.testcontainers:mysql:1.20.4")
    testCompileOnly("org.projectlombok:lombok")
    testAnnotationProcessor("org.projectlombok:lombok")
}

tasks.named<org.springframework.boot.gradle.tasks.bundling.BootJar>("bootJar") {
    archiveFileName.set("ix-auth.jar")
}
