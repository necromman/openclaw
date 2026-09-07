plugins {
    java
    id("org.springframework.boot") version "4.1.0" apply false
    id("io.spring.dependency-management") version "1.1.7" apply false
    id("com.github.spotbugs") version "6.0.21" apply false
}

allprojects {
    group = "team.prost"
    version = "0.1.0-SNAPSHOT+openclaw.1"

    repositories {
        // 1순위: GitLab 그룹 Package Registry (사내 캐시)
        val ciJobToken = System.getenv("CI_JOB_TOKEN")
        val pat = System.getenv("GITLAB_PROST_TOKEN")
        val token = ciJobToken ?: pat
        if (!token.isNullOrBlank()) {
            maven {
                name = "GitLabCache"
                url = uri("https://git.prost.kr/api/v4/groups/181/-/packages/maven/")
                credentials(HttpHeaderCredentials::class) {
                    name = if (ciJobToken != null) "Job-Token" else "Private-Token"
                    value = token
                }
                authentication { create<HttpHeaderAuthentication>("header") }
            }
        }

        // 2순위: Maven Central
        mavenCentral()
    }
}

// IX-Trust 와 달리 Shibboleth 저장소를 두지 않는다 — OpenSAML(SAML IdP)은 제품 경계 밖이다.
// .claude/rules/product-boundary.md

subprojects {
    apply(plugin = "java")
    apply(plugin = "jacoco")
    apply(plugin = "checkstyle")
    apply(plugin = "com.github.spotbugs")

    java {
        toolchain {
            languageVersion = JavaLanguageVersion.of(21)
        }
    }

    tasks.withType<JavaCompile> {
        options.encoding = "UTF-8"
        options.compilerArgs.addAll(listOf("-parameters", "-Xlint:deprecation", "-Xlint:unchecked"))
    }

    tasks.withType<Test> {
        useJUnitPlatform()
        finalizedBy(tasks.named("jacocoTestReport"))
    }

    tasks.withType<JacocoReport> {
        dependsOn(tasks.named("test"))
        reports {
            xml.required = true   // CI 커버리지 파싱용
            html.required = true
            csv.required = false
        }
    }

    extensions.configure<CheckstyleExtension> {
        toolVersion = "10.12.4"
        configFile = file("${rootDir}/config/checkstyle/checkstyle.xml")
        maxWarnings = 0
    }

    extensions.configure<com.github.spotbugs.snom.SpotBugsExtension> {
        toolVersion.set("4.8.6")
        excludeFilter.set(file("${rootDir}/config/spotbugs/exclude.xml"))
        effort.set(com.github.spotbugs.snom.Effort.MAX)
        reportLevel.set(com.github.spotbugs.snom.Confidence.MEDIUM)
    }

    tasks.withType<com.github.spotbugs.snom.SpotBugsTask>().configureEach {
        reports.create("html") {
            required.set(true)
            outputLocation.set(layout.buildDirectory.file("reports/spotbugs/${name}.html"))
        }
        reports.create("xml") {
            required.set(true)
            outputLocation.set(layout.buildDirectory.file("reports/spotbugs/${name}.xml"))
        }
    }

    // test source set 은 완화된 config (JUnit 관행 허용)
    tasks.withType<Checkstyle>().configureEach {
        if (name.endsWith("Test")) {
            configFile = file("${rootDir}/config/checkstyle/checkstyle-test.xml")
        }
    }
}
