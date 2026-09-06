package team.prost.ixauth;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.MailDelivery;
import team.prost.ixauth.mail.MailService;
import team.prost.ixauth.mail.MailTemplateService;
import team.prost.ixauth.repository.MailDeliveryRepository;
import team.prost.ixauth.repository.SigningKeyRepository;
import team.prost.ixauth.repository.UserRepository;
import team.prost.ixauth.security.SigningKeyService;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 운영 기능의 실제 DB 검증 — 서명 키 회전(G19) · 메일 이력과 재시도(G21) · 템플릿(G16 · G17).
 *
 * <p>이 셋은 <b>HTTP 로는 확인할 수 없다.</b> 회전은 새벽 배치가 돌아야 보이고, 발송 실패는
 * 진짜 SMTP 가 죽어야 나오며, 템플릿은 실제로 나간 본문을 봐야 확인된다. 그래서 살아 있는
 * PostgreSQL 에 붙여 그 자리를 직접 만든다.</p>
 */
@SpringBootTest
@Testcontainers
class OperationsIntegrationTest {

    private static final String SERVICE_KEY = "test-service-key-must-be-at-least-32-chars";

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("ixauth.service-key", () -> SERVICE_KEY);
        registry.add("ixauth.jwt.issuer", () -> "https://ops-test.example.com");
        registry.add("ixauth.admin.email", () -> "admin@example.com");
        registry.add("ixauth.admin.password", () -> "Adm1n!Passw0rd");
        registry.add("ixauth.mail.app-base-url", () -> "https://app.example.com");
    }

    @Autowired
    SigningKeyService signingKeyService;
    @Autowired
    SigningKeyRepository signingKeyRepository;
    @Autowired
    MailService mailService;
    @Autowired
    MailTemplateService templateService;
    @Autowired
    MailDeliveryRepository deliveryRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    IxAuthProperties properties;
    @Autowired
    org.springframework.jdbc.core.JdbcTemplate jdbcTemplate;

    // ────────────────────── G19 서명 키 회전 ──────────────────────

    @Test
    @DisplayName("주기를 넘긴 키는 회전되고, 구 키는 즉시 버려지지 않는다")
    void rotatesButKeepsOldKeyPublishable() {
        var before = signingKeyService.ensureActiveKey();
        // 회전 주기를 넘긴 상태를 만든다 — 배치는 나이만 본다
        backdate(before.getKid(), properties.getJwt().getKeyRotationDays() + 1);

        signingKeyService.rotateIfDue();

        var after = signingKeyRepository.findActive().orElseThrow();
        assertThat(after.getKid()).isNotEqualTo(before.getKid());

        // 구 키를 즉시 지우면 방금 발급된 access token 이 한꺼번에 검증 실패한다
        var publishable = signingKeyRepository.findPublishable().stream()
                .map(k -> k.getKid()).toList();
        assertThat(publishable).contains(before.getKid(), after.getKid());
        assertThat(signingKeyService.jwks().get("keys").toString()).contains(before.getKid());
    }

    @Test
    @DisplayName("구 키는 access 수명이 지난 뒤에야 JWKS 에서 내려간다")
    void retiresOnlyAfterAccessTokenLifetime() {
        var old = signingKeyService.ensureActiveKey();
        backdate(old.getKid(), properties.getJwt().getKeyRotationDays() + 1);
        signingKeyService.rotateIfDue();
        var current = signingKeyRepository.findActive().orElseThrow();

        // 방금 회전했다 — 구 키로 서명된 토큰이 아직 살아 있으므로 내리면 안 된다
        assertThat(signingKeyService.retireSuperseded()).isZero();

        // 현재 키가 access 수명보다 오래됐다면 구 키의 토큰은 모두 만료됐다
        backdateMinutes(current.getKid(), properties.getJwt().getAccessTtl().toMinutes() + 10);
        assertThat(signingKeyService.retireSuperseded()).isPositive();
        assertThat(signingKeyRepository.findById(old.getKid()).orElseThrow().getRetiredAt())
                .isNotNull();
        assertThat(signingKeyService.jwks().get("keys").toString())
                .doesNotContain(old.getKid());
    }

    @Test
    @DisplayName("주기가 0 이면 회전하지 않는다 — 껐다는 뜻이다")
    void doesNotRotateWhenDisabled() {
        var before = signingKeyService.ensureActiveKey();
        backdate(before.getKid(), 3650);
        int original = properties.getJwt().getKeyRotationDays();
        try {
            properties.getJwt().setKeyRotationDays(0);
            signingKeyService.rotateIfDue();
            assertThat(signingKeyRepository.findActive().orElseThrow().getKid())
                    .isEqualTo(before.getKid());
        } finally {
            properties.getJwt().setKeyRotationDays(original);
        }
    }

    /**
     * 키를 과거로 돌린다.
     *
     * <p>엔티티로 바꾸지 않는 이유 — {@code created_at} 은 {@code updatable = false} 다.
     * 발급 시각이 나중에 바뀌면 회전 판정 자체가 흔들리므로 그게 맞고, 그래서 이 테스트만
     * SQL 로 직접 돌린다.</p>
     */
    private void backdate(String kid, long days) {
        backdateTo(kid, Instant.now().minus(days, ChronoUnit.DAYS));
    }

    private void backdateMinutes(String kid, long minutes) {
        backdateTo(kid, Instant.now().minus(minutes, ChronoUnit.MINUTES));
    }

    private void backdateTo(String kid, Instant at) {
        jdbcTemplate.update("update signing_keys set created_at = ? where kid = ?",
                java.sql.Timestamp.from(at), kid);
    }

    // ────────────────────── G21 발송 이력 ──────────────────────

    @Test
    @DisplayName("발송하면 이력이 남고, 본문·링크는 남지 않는다")
    void recordsDeliveryWithoutBodyOrLink() {
        mailService.sendPasswordReset("history@example.com", "이력", "raw-token-should-not-be-stored");

        var row = latestFor("history@example.com");
        assertThat(row.getKind()).isEqualTo("PASSWORD_RESET");
        assertThat(row.getSubject()).doesNotContain("raw-token-should-not-be-stored");
        // transport 기본값은 LOG — 실제로 나가지 않았다는 사실이 상태로 드러나야 한다
        assertThat(row.getStatus()).isEqualTo(MailDelivery.Status.SKIPPED);
        assertThat(row.getAttempts()).isEqualTo(1);
    }

    @Test
    @DisplayName("SMTP 가 죽어 있으면 실패로 남는다 — 삼키고 끝내지 않는다")
    void recordsFailureWhenTransportBroken() {
        var mail = properties.getMail();
        var originalTransport = mail.getTransport();
        String originalHost = mail.getSmtp().getHost();
        try {
            mail.setTransport(IxAuthProperties.Mail.Transport.SMTP);
            // 열려 있지 않은 포트 — 실제로 연결이 실패한다
            mail.getSmtp().setHost("127.0.0.1");
            mail.getSmtp().setPort(1);
            mail.getSmtp().setTimeout(java.time.Duration.ofMillis(500));

            mailService.sendPasswordChanged("broken@example.com", "실패");

            var row = latestFor("broken@example.com");
            assertThat(row.getStatus())
                    .isIn(MailDelivery.Status.FAILED, MailDelivery.Status.GAVE_UP);
            assertThat(row.getLastError()).isNotBlank();
            assertThat(row.getSentAt()).isNull();
        } finally {
            mail.setTransport(originalTransport);
            mail.getSmtp().setHost(originalHost);
        }
    }

    // ────────────────────── G16 · G17 템플릿과 언어 ──────────────────────

    @Test
    @DisplayName("템플릿을 고치면 그 제목으로 나가고, 초기화하면 되돌아간다")
    void templateOverrideAppliesAndResets() {
        templateService.save("PASSWORD_CHANGED", "ko", "[{productName}] 고친 제목",
                "{name} 님 본문", null);
        mailService.sendPasswordChanged("tpl@example.com", "템플릿");
        assertThat(latestFor("tpl@example.com").getSubject()).contains("고친 제목");

        templateService.reset("PASSWORD_CHANGED", "ko", null);
        mailService.sendPasswordChanged("tpl2@example.com", "템플릿");
        assertThat(latestFor("tpl2@example.com").getSubject()).contains("비밀번호가 변경되었습니다");
    }

    @Test
    @DisplayName("사용자 속성 locale 이 en 이면 영어로 나간다")
    void picksLocaleFromUserAttribute() {
        var user = new team.prost.ixauth.domain.User("english@example.com", "English", null);
        user.setAttributes(new java.util.HashMap<>(java.util.Map.of("locale", "en-US")));
        userRepository.save(user);

        mailService.sendPasswordChanged("english@example.com", "English");

        var row = latestFor("english@example.com");
        assertThat(row.getLocale()).isEqualTo("en");
        assertThat(row.getSubject()).contains("password was changed");
    }

    private MailDelivery latestFor(String email) {
        var page = deliveryRepository.search("", "", email,
                org.springframework.data.domain.PageRequest.of(0, 1));
        assertThat(page.getContent()).as("%s 앞으로 나간 이력", email).isNotEmpty();
        return page.getContent().get(0);
    }
}
