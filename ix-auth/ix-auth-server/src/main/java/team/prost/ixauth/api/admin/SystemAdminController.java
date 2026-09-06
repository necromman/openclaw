package team.prost.ixauth.api.admin;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import team.prost.ixauth.common.ApiResponse;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.VerificationToken;
import team.prost.ixauth.repository.UserRepository;
import team.prost.ixauth.repository.VerificationTokenRepository;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 시스템 상태 — 설정이 실제로 어떻게 걸려 있는지 화면에서 확인한다.
 *
 * <p>메일 설정이 잘못돼 있으면 "비밀번호 찾기를 눌렀는데 메일이 안 온다" 는 형태로만
 * 드러나고, 원인은 부팅 로그에만 남는다. 운영자가 로그를 보지 않아도 알 수 있어야 한다.</p>
 */
@RestController
@RequestMapping("/admin/system")
@RequiredArgsConstructor
public class SystemAdminController {

    private final IxAuthProperties properties;
    private final VerificationTokenRepository tokenRepository;
    private final UserRepository userRepository;
    private final AdminGuard guard;
    private final team.prost.ixauth.common.ClientIpGuard clientIpGuard;

    /** 설정 요약. <b>시크릿은 값이 아니라 설정 여부만</b> 돌려준다 */
    @GetMapping("/status")
    public ApiResponse<Map<String, Object>> status() {
        guard.require(AdminGuard.USERS_READ);

        var mail = properties.getMail();
        var account = properties.getAccount();
        var rate = properties.getRateLimit();

        var out = new LinkedHashMap<String, Object>();
        out.put("mode", properties.getMode().name());

        var mailInfo = new LinkedHashMap<String, Object>();
        mailInfo.put("transport", mail.getTransport().name());
        mailInfo.put("from", mail.getFrom());
        mailInfo.put("appBaseUrl", mail.getAppBaseUrl());
        // 메일이 실제로 사용자에게 닿는 상태인가 — 이 둘이 핵심이다
        mailInfo.put("deliverable", isDeliverable(mail));
        mailInfo.put("smtpHost", mail.getSmtp().getHost());
        mailInfo.put("smtpConfigured", !mail.getSmtp().getHost().isBlank());
        mailInfo.put("webhookConfigured", !mail.getWebhook().getUrl().isBlank());
        mailInfo.put("resetPath", mail.getResetPath());
        mailInfo.put("verifyPath", mail.getVerifyPath());
        mailInfo.put("invitePath", mail.getInvitePath());
        out.put("mail", mailInfo);

        var accountInfo = new LinkedHashMap<String, Object>();
        accountInfo.put("signupMode", account.getSignupMode().name());
        accountInfo.put("signupVerification", account.getSignupVerification().name());
        accountInfo.put("signupAllowedDomains", account.getSignupAllowedDomains());
        accountInfo.put("requireEmailVerification", account.isRequireEmailVerification());
        accountInfo.put("resetTokenTtl", account.getResetTokenTtl().toString());
        accountInfo.put("inviteTokenTtl", account.getInviteTokenTtl().toString());
        accountInfo.put("revokeSessionsOnPasswordChange",
                account.isRevokeSessionsOnPasswordChange());
        out.put("account", accountInfo);

        var rateInfo = new LinkedHashMap<String, Object>();
        rateInfo.put("enabled", rate.isEnabled());
        rateInfo.put("loginPerMinute", rate.getLoginPerMinute());
        rateInfo.put("defaultPerMinute", rate.getDefaultPerMinute());
        out.put("rateLimit", rateInfo);

        var lockout = properties.getLockout();
        out.put("lockout", Map.of("enabled", lockout.isEnabled(),
                "maxAttempts", lockout.getMaxAttempts(),
                "duration", lockout.getDuration().toString()));

        // 연동이 실방문자 IP 를 넘기고 있는가. detections 가 0 이 아니면 감사 로그가
        // 경유지 주소로 쌓이는 중이다 (docs/guides/client-ip.md)
        out.put("clientIpGuard", clientIpGuard.snapshot());

        return ApiResponse.ok(out);
    }

    /**
     * 발급된 메일 토큰 현황.
     *
     * <p><b>토큰 값은 절대 돌려주지 않는다.</b> DB 에도 해시만 있지만, 설령 있어도
     * 관리자가 남의 재설정 링크를 볼 수 있으면 그것이 곧 계정 탈취 경로다.
     * 여기서 보이는 것은 "누구에게 · 무슨 용도로 · 언제 나갔고 · 썼는가" 뿐이다.</p>
     */
    @GetMapping("/verification-tokens")
    public ApiResponse<List<Map<String, Object>>> tokens(
            @RequestParam(required = false) VerificationToken.Purpose purpose,
            @RequestParam(defaultValue = "50") int size) {
        guard.require(AdminGuard.USERS_READ);

        Instant now = Instant.now();
        int capped = Math.min(Math.max(size, 1), 200);

        return ApiResponse.ok(tokenRepository.findAll().stream()
                .filter(t -> purpose == null || t.getPurpose() == purpose)
                .sorted((a, b) -> b.getCreatedAt().compareTo(a.getCreatedAt()))
                .limit(capped)
                .<Map<String, Object>>map(t -> {
                    var m = new LinkedHashMap<String, Object>();
                    m.put("id", t.getId());
                    m.put("purpose", t.getPurpose().name());
                    m.put("email", userRepository.findById(t.getUserId())
                            .map(u -> u.getEmail()).orElse("(삭제됨)"));
                    m.put("createdAt", t.getCreatedAt());
                    m.put("expiresAt", t.getExpiresAt());
                    m.put("usedAt", t.getUsedAt());
                    // 지금 그 링크가 통하는가 — 운영에서 가장 자주 묻는 질문이다
                    m.put("usable", t.isUsable(now));
                    // EMAIL_CHANGE 의 '바꿀 주소'. 다른 용도에서는 비어 있다
                    m.put("payload", t.getPayload());
                    return m;
                })
                .toList());
    }

    private boolean isDeliverable(IxAuthProperties.Mail mail) {
        if (mail.getAppBaseUrl().isBlank()) {
            return false;   // 링크를 만들 수 없다
        }
        return switch (mail.getTransport()) {
            case SMTP -> !mail.getSmtp().getHost().isBlank();
            case WEBHOOK -> !mail.getWebhook().getUrl().isBlank();
            case LOG -> false;   // 로그에만 남는다 = 사용자에게 닿지 않는다
        };
    }
}
