// IX-Auth 앱 측 Spring Boot 클라이언트.
//
// 앱이 이 모듈을 의존성에 넣고 ixauth.client.* 설정만 주면 붙는다.
// 서버(ix-auth-server)를 끌어오지 않는다 — 앱은 인증 서버가 아니다.
plugins {
    java
    id("io.spring.dependency-management")
}

dependencies {
    implementation(project(":ix-auth-common"))

    compileOnly("org.springframework.boot:spring-boot-starter-web")
    compileOnly("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-autoconfigure")

    // JWKS 로컬 검증 — 앱이 매 요청 jar 를 부르지 않게 하는 핵심 (설계 불변식 2)
    implementation("com.nimbusds:nimbus-jose-jwt:9.40")

    // JSON 은 직접 파싱하지 않는다. Spring Boot 4 는 Jackson 3(tools.jackson)을 쓴다
    implementation("tools.jackson.core:jackson-databind")

    compileOnly("org.projectlombok:lombok")
    annotationProcessor("org.projectlombok:lombok")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.boot:spring-boot-starter-web")
    testImplementation("org.springframework.boot:spring-boot-starter-security")
}

dependencyManagement {
    imports {
        mavenBom("org.springframework.boot:spring-boot-dependencies:4.1.0")
    }
}
