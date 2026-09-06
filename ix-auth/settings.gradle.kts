plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "ix-auth"

include("ix-auth-common")         // 서버·SDK 공용 (권한 매칭 규칙)
include("ix-auth-server")         // jar 본체
include("ix-auth-client-spring")  // 앱 측 Spring Boot 클라이언트

// 아래는 이후 Phase 에서 추가
// include("ix-auth-embedded")    // Spring Boot in-process 임베드 [P4]
// include("ix-auth-sdk-spring")  // 앱 측 토큰 검증 SDK [P2]
