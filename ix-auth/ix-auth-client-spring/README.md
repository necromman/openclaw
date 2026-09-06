# ix-auth-client-spring

IX-Auth 앱 측 Spring Boot 클라이언트.

> 서버(`ix-auth-server`)를 끌어오지 않는다. **앱은 인증 서버가 아니다** — 토큰을 검증하고 권한을 판정할 뿐이다.

---

## 하는 일

| # | | jar 호출 |
|---|---|---|
| 1 | 로그인·갱신·로그아웃 중계 | ✅ 사용자당 하루 몇 번 |
| 2 | **JWKS 공개키로 토큰 로컬 검증** | ❌ **없음** |
| 3 | **L1 권한 로컬 판정** (permission-map 캐시) | ❌ **없음** |
| 4 | L2 인스턴스 권한 | ✅ 파일·문서 접근 시 |

jar 가 잠시 내려가도 ①④만 막히고, **이미 로그인한 사용자의 ②③은 그대로 동작한다** (설계 불변식 2).

---

## 설정

```gradle
implementation("team.prost:ix-auth-client-spring:0.1.0")
```

```yaml
ixauth:
  client:
    base-url: http://ix-auth:9100        # 내부 통신 주소 — 브라우저는 모른다
    service-key: ${IXAUTH_SERVICE_KEY}   # 앱→jar 공유 시크릿
    issuer: https://myapp.example.com    # jar 의 ixauth.jwt.issuer 와 같아야 한다
```

`IxAuthClient` 와 `IxAuthAuthenticationFilter` 빈이 자동으로 만들어진다.

---

## 보안 설정에 꽂기

필터를 SecurityFilterChain 에 넣는 것은 **앱이 직접 한다.** 앱마다 보안 설정이 달라서 임의로 끼워 넣으면 기존 설정과 충돌한다.

```java
@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final IxAuthAuthenticationFilter ixAuthFilter;

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/login", "/health").permitAll()
                // 권한 코드를 그대로 authority 로 쓴다
                .requestMatchers("/api/reports/**").hasAuthority("page:reports:view")
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated())
            .addFilterBefore(ixAuthFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
```

---

## 로그인 중계

브라우저는 IX-Auth 를 직접 호출하지 않는다 (설계 불변식 4). 앱이 중계하고 **앱 도메인 쿠키**로 심는다.

```java
@PostMapping("/api/login")
public ResponseEntity<?> login(@RequestBody LoginRequest req, HttpServletRequest http,
                               HttpServletResponse res) {
    var r = ixAuthClient.login(req.email(), req.password(),
            http.getRemoteAddr(), http.getHeader("User-Agent"));

    var access = ResponseCookie.from("ixauth_at", r.accessToken())
            .httpOnly(true).sameSite("Lax").secure(true).path("/")
            .maxAge(r.expiresIn()).build();
    res.addHeader(HttpHeaders.SET_COOKIE, access.toString());
    // refresh 쿠키도 같은 방식으로

    return ResponseEntity.ok(Map.of("email", r.email(), "roles", r.roles()));
}
```

## 컨트롤러에서 사용자 꺼내기

```java
@GetMapping("/api/me")
public Object me(@AuthenticationPrincipal IxAuthPrincipal user) {
    return Map.of("email", user.email(), "roles", user.roles());
}
```

## L2 인스턴스 권한

```java
var verdict = ixAuthClient.check(user.userId(), "file", "/contracts/2026/a.pdf", "download");
if (!verdict.allowed()) {
    throw new AccessDeniedException("권한이 없습니다.");   // 사유를 노출하지 않는다
}
```

`/contracts/` 에 준 권한이 하위로 **상속**된다. `verdict.matchedKey()` 가 실제로 어느 지점에서 걸렸는지 알려 준다(`/contracts/`).

### 목록 화면 — 항목마다 부르지 않는다

```java
// 요청 순서대로 판정이 돌아온다
var verdicts = ixAuthClient.batchCheck(userId, files.stream()
        .map(f -> Map.of("resourceType", "file", "resourceKey", f, "action", "read"))
        .toList());

// 또는 허용된 키만 받아 필터링
var res = ixAuthClient.listResources(userId, "file", "read");
if (res.truncated()) {
    // 결과가 잘린 것이지 권한이 없는 게 아니다 — 그대로 필터에 쓰면 있는 권한을 없다고 판정한다
}
```

`keys` 에는 **권한이 걸린 지점**이 담긴다(`/contracts/`). 개별 파일은 그 아래로 상속되므로 목록에 직접 나오지 않는다.

### jar 에 닿지 못했을 때

```yaml
ixauth:
  client:
    resource-fallback: DENY     # 기본 — 확인할 수 없으면 막는다 (fail-secure)
    # resource-fallback: L1     # 가용성 우선 — L1 광역 권한으로 대신 판정
```

```java
var verdict = ixAuthClient.checkWithFallback(claims, "file", key, "download");
```

`L1` 은 **개별 리소스의 DENY 예외를 무시한다.** `/contracts/**` 광역 권한이 있으면 `/contracts/secret/` 의 DENY 가 통과된다 — 그 위험을 아는 화면에만 쓴다. Node·Python SDK 의 `fallback: 'deny' | 'l1'` 과 같은 규칙이다.

---

## 주의

1. **`service-key` 를 브라우저로 내보내지 않는다.** 앱 서버만 안다
2. **토큰은 HttpOnly 쿠키로** 심는다
3. 권한 변경은 토큰 재발급 시 전파된다 — 최대 액세스 토큰 수명(기본 15분)만큼 늦다
4. 권한 매칭 규칙은 `ix-auth-common` 의 `PermissionMatcher` 를 서버와 **공유**한다. 규칙이 갈리면 "화면에는 보이는데 API 는 403" 이 난다
