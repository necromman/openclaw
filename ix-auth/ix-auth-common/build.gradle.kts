// 서버와 앱 측 SDK 가 함께 쓰는 최소 공용 코드.
//
// 여기 있는 것은 <b>양쪽이 반드시 같아야 하는 것</b>뿐이다. 권한 매칭 규칙이 갈리면
// 앱의 판정과 jar 의 판정이 어긋나 "화면에는 보이는데 API 는 403" 같은 일이 난다.
//
// 의존성을 두지 않는다 — 앱이 이 모듈 때문에 무언가를 끌어오게 하지 않는다.
plugins {
    java
}

dependencies {
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testImplementation("org.junit.jupiter:junit-jupiter-params:5.11.4")
    testImplementation("org.assertj:assertj-core:3.26.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
