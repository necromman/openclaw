package team.prost.ixauth.mail;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.mail.MailMessage.Kind;
import team.prost.ixauth.repository.UserRepository;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 링크를 만들고, 템플릿을 고르고, 통로로 넘긴다.
 *
 * <p>링크가 가리키는 곳은 <b>앱</b>이다. jar 는 외부에 노출되지 않으므로
 * (설계 불변식 4) 사용자의 브라우저가 jar 주소를 열 수 없다. 앱이 그 화면을
 * 두고, 사용자가 입력한 새 비밀번호를 토큰과 함께 jar 로 중계한다.</p>
 *
 * <p>본문은 {@link MailTemplateService} 가 고른다 — 관리자가 고쳐 둔 것이 있으면
 * 그것, 없으면 코드 기본값이다(G16). 언어는 사용자 속성 {@code locale} 이 정하고,
 * 없으면 {@code mail.default-locale} 이다(G17).</p>
 *
 * <p>실제 발송·이력·재시도는 {@link MailDeliveryService} 가 한다(G21).
 * <b>발송 실패는 여기까지 올라오지 않는다</b> — 재설정 응답은 계정 존재 여부를
 * 감춰야 하고, 그 답이 SMTP 상태에 따라 갈리면 감추는 의미가 없다.</p>
 */
@Slf4j
@Service
public class MailService {

    /** 메일에 적는 시각의 표시 형식. 사용자가 "언제" 를 즉시 읽을 수 있어야 한다 */
    private static final DateTimeFormatter KST = DateTimeFormatter
            .ofPattern("yyyy-MM-dd HH:mm 'KST'").withZone(ZoneId.of("Asia/Seoul"));

    /** 사용자 속성에서 언어를 읽는 키. 앱이 채우는 값이라 표기는 정규화해서 본다 */
    private static final String LOCALE_ATTRIBUTE = "locale";

    private final IxAuthProperties properties;
    private final MailTemplateService templateService;
    private final MailDeliveryService deliveryService;
    private final UserRepository userRepository;

    public MailService(IxAuthProperties properties, MailTemplateService templateService,
                       MailDeliveryService deliveryService, UserRepository userRepository) {
        this.properties = properties;
        this.templateService = templateService;
        this.deliveryService = deliveryService;
        this.userRepository = userRepository;
        warnIfNotOperational();
    }

    private void warnIfNotOperational() {
        var mail = properties.getMail();
        if (!deliveryService.isOperational()) {
            log.warn("메일이 발송되지 않는 설정입니다 (transport={}). "
                            + "비밀번호 찾기·이메일 인증·초대가 사용자에게 닿지 않습니다.",
                    mail.getTransport());
        }
        if (mail.getAppBaseUrl().isBlank()) {
            log.warn("ixauth.mail.app-base-url 이 비어 있습니다. "
                    + "메일 링크를 만들 수 없어 비밀번호 찾기가 동작하지 않습니다.");
        }
    }

    // ────────────────────── 각 용도 ──────────────────────

    public void sendPasswordReset(String to, String name, String rawToken) {
        var ttl = properties.getAccount().getResetTokenTtl();
        send(Kind.PASSWORD_RESET, to, vars(name, human(ttl)),
                link(properties.getMail().getResetPath(), rawToken));
    }

    public void sendEmailVerification(String to, String name, String rawToken) {
        var ttl = properties.getAccount().getVerifyTokenTtl();
        send(Kind.EMAIL_VERIFY, to, vars(name, human(ttl)),
                link(properties.getMail().getVerifyPath(), rawToken));
    }

    /** 이메일 변경 — 확인 메일은 <b>새 주소</b>로 간다. 옛 주소로 보내면 확인이 되지 않는다 */
    public void sendEmailChange(String newEmail, String name, String rawToken) {
        var ttl = properties.getAccount().getVerifyTokenTtl();
        send(Kind.EMAIL_CHANGE, newEmail, vars(name, human(ttl)),
                link(properties.getMail().getVerifyPath(), rawToken));
    }

    public void sendInvite(String to, String name, String inviterName, String rawToken) {
        var ttl = properties.getAccount().getInviteTokenTtl();
        var v = vars(name, human(ttl));
        v.put("inviterName", inviterName == null ? "" : inviterName);
        // 본문에 그대로 끼워 넣을 조각. 초대한 사람이 없으면 문장이 자연스럽게 이어져야 한다
        v.put("inviter", inviterName == null || inviterName.isBlank()
                ? "" : inviterName + " 님이 회원님을 ");
        send(Kind.INVITE, to, v, link(properties.getMail().getInvitePath(), rawToken));
    }

    /**
     * 비밀번호가 바뀌었음을 알린다.
     *
     * <p>링크가 없는 메일이다. 본인이 바꾼 게 아니라면 이 메일이 유일한 신호이므로,
     * 발송을 생략하지 않는다.</p>
     */
    public void sendPasswordChanged(String to, String name) {
        send(Kind.PASSWORD_CHANGED, to, vars(name, null), null);
    }

    /**
     * 이미 계정이 있는 주소로 가입을 시도했을 때.
     *
     * <p>가입 응답은 "계정이 이미 있다" 를 알려 주지 않는다 — 알려 주면 그 화면이
     * 가입자 명부 조회 도구가 된다. 대신 <b>그 주소의 주인에게만</b> 사실을 알린다.
     * 주인이 아니라면 "누가 내 주소로 가입을 시도했다" 는 신호가 되기도 한다.</p>
     *
     * <p>재설정 메일을 대신 보내지 않는 이유 — 요청한 적 없는 "비밀번호 재설정" 메일은
     * 받는 사람을 혼란스럽게 한다. 링크는 같지만 맥락을 정확히 적는다.</p>
     */
    public void sendAccountExists(String to, String name, String rawToken) {
        var ttl = properties.getAccount().getResetTokenTtl();
        send(Kind.ACCOUNT_EXISTS, to, vars(name, human(ttl)),
                link(properties.getMail().getResetPath(), rawToken));
    }

    /** 승인제에서 관리자가 승인했을 때. 이 메일이 없으면 사용자는 언제 쓸 수 있는지 모른다 */
    public void sendSignupApproved(String to, String name) {
        send(Kind.SIGNUP_APPROVED, to, vars(name, null), null);
    }

    /**
     * 새 기기·새 IP 에서 로그인되었음을 알린다.
     *
     * <p><b>계정을 빼앗겼다는 사실을 사용자가 스스로 알아챌 수 있는 거의 유일한 통로다.</b>
     * 세션 목록에도 같은 정보가 있지만 그건 들여다봐야 보이고, 남의 계정을 쓰는 쪽은
     * 사용자가 들여다볼 이유를 만들지 않는다. 이 메일은 찾아간다.</p>
     *
     * <p>링크를 넣지 않는다. "본인이 아니면 여기를 누르세요" 는 그대로 피싱 메일의
     * 생김새이고, 진짜와 가짜를 구분하는 법을 사용자에게서 빼앗는다.</p>
     */
    public void sendNewDeviceLogin(String to, String name, Instant at, String ip, String device) {
        var v = vars(name, null);
        v.put("at", when(at));
        v.put("ip", blankToDash(ip));
        v.put("device", blankToDash(device));
        send(Kind.NEW_DEVICE_LOGIN, to, v, null);
    }

    /**
     * 탈퇴 접수 — 유예 모드. <b>되돌리는 방법</b>을 반드시 적는다.
     *
     * <p>유예를 두는 이유가 홧김에 누른 것을 되돌리기 위해서인데, 되돌리는 방법을
     * 알려 주지 않으면 유예는 그저 늦게 지워지는 것에 지나지 않는다.</p>
     */
    public void sendAccountDeleteRequested(String to, String name, Instant effectiveAt) {
        var v = vars(name, null);
        v.put("at", when(effectiveAt));
        send(Kind.ACCOUNT_DELETE_REQUESTED, to, v, null);
    }

    /** 탈퇴 완료 — 계정이 비활성이 됐다. 요청하지 않았다면 이 메일이 유일한 신호다 */
    public void sendAccountDeleted(String to, String name) {
        send(Kind.ACCOUNT_DELETED, to, vars(name, null), null);
    }

    /**
     * 관리자가 2단계 인증을 초기화했음을 알린다.
     *
     * <p><b>이 메일은 끌 수 없다.</b> 관리자가 조용히 남의 2단계를 끌 수 있으면
     * 2단계는 관리자 앞에서 아무것도 막지 못한다. 본인이 요청하지 않은 초기화는
     * 이 메일로만 드러난다.</p>
     */
    public void sendMfaReset(String to, String name) {
        send(Kind.MFA_RESET, to, vars(name, null), null);
    }

    /**
     * 비밀번호 없이 로그인하는 링크.
     *
     * <p><b>이 메일이 다른 것과 다른 점: 링크가 곧 로그인이다.</b> 재설정 링크는 손에
     * 넣어도 새 비밀번호를 정해야 하고 그 순간 본인에게 변경 알림이 나가지만, 이것은
     * 누르는 즉시 세션이 열린다. 그래서 본문에 두 가지를 반드시 적는다 —
     * <b>짧은 수명</b>과 <b>요청하지 않았다면 무시하라</b>는 안내다.</p>
     *
     * <p>전달받은 사람이 대신 눌러 주는 상황("링크 좀 보내 줘")을 막을 방법은 제품에
     * 없다. 그래서 "다른 사람에게 전달하지 말라" 를 명시한다 — 기술이 못 막는 것은
     * 문장으로라도 알린다.</p>
     */
    public void sendMagicLink(String to, String name, String rawToken) {
        var ttl = properties.getAccount().getMagicLinkTokenTtl();
        send(Kind.MAGIC_LINK, to, vars(name, human(ttl)),
                link(properties.getMail().getMagicLinkPath(), rawToken));
    }

    // ────────────────────── 조립 ──────────────────────

    /**
     * 템플릿을 고르고 채워서 발송에 넘긴다.
     *
     * <p>자리표시자 이름은 WEBHOOK 모드로 넘기는 {@code vars} 의 키와 같다 — 그래야
     * 본문과 웹훅이 어긋나지 않는다. 앱이 자기 템플릿으로 다시 만들 때 같은 이름을 쓴다.</p>
     */
    private void send(Kind kind, String to, Map<String, String> vars, String link) {
        String locale = localeFor(to);
        var template = templateService.resolve(kind, locale);

        var filled = new LinkedHashMap<>(vars);
        filled.put("productName", properties.getMail().getProductName());
        filled.put("link", link == null ? "" : link);

        deliveryService.send(new MailMessage(to,
                MailTemplates.fill(template.subject(), filled),
                MailTemplates.fill(template.body(), filled),
                kind, link, filled, locale));
    }

    /**
     * 이 주소의 주인이 쓰는 언어.
     *
     * <p>사용자 속성 {@code locale} 을 먼저 보고, 없으면 {@code mail.default-locale} 이다.
     * 아직 계정이 없는 주소(이메일 변경의 새 주소 등)도 있으므로 조회가 비는 것은 정상이다 —
     * <b>언어를 못 읽었다고 메일을 못 보내면 안 된다.</b></p>
     */
    private String localeFor(String to) {
        String fallback = MailTemplates.normalizeLocale(
                properties.getMail().getDefaultLocale(), MailTemplates.KO);
        try {
            return userRepository.findByEmailIgnoreCase(to)
                    .map(u -> u.getAttributes())
                    .map(a -> a.get(LOCALE_ATTRIBUTE))
                    .map(String::valueOf)
                    .map(v -> MailTemplates.normalizeLocale(v, fallback))
                    .filter(v -> !v.isBlank())
                    .orElse(fallback);
        } catch (Exception e) {
            log.debug("메일 언어를 읽지 못해 기본값을 씁니다 — {}", e.getMessage());
            return fallback;
        }
    }

    /**
     * 메일에 적을 시각 — KST 로 보여 준다 (.claude/rules/coding-style.md: 저장은 UTC, 표시는 KST).
     *
     * <p>표시 시간대를 설정으로 빼지 않았다. 언어별로 시간대를 고르려면 사용자마다
     * 시간대를 들고 있어야 하는데, 그건 이 제품이 가진 정보가 아니다.</p>
     */
    private static String when(Instant at) {
        return at == null ? "" : KST.format(at);
    }

    /** 표에 빈칸을 남기지 않는다 — 값이 없는 것인지 화면이 깨진 것인지 알 수 없게 된다 */
    private static String blankToDash(String value) {
        return (value == null || value.isBlank()) ? "-" : value;
    }

    private String link(String path, String rawToken) {
        String base = properties.getMail().getAppBaseUrl();
        if (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base + path + "?token=" + URLEncoder.encode(rawToken, StandardCharsets.UTF_8);
    }

    private Map<String, String> vars(String name, String expiresIn) {
        var v = new LinkedHashMap<String, String>();
        v.put("name", name == null ? "" : name);
        v.put("productName", properties.getMail().getProductName());
        if (expiresIn != null) {
            v.put("expiresIn", expiresIn);
        }
        return v;
    }

    /** "30분" · "1일" 처럼 읽히게 — 메일에 PT30M 이 보이면 안 된다 */
    private static String human(Duration d) {
        long days = d.toDays();
        if (days > 0 && d.equals(Duration.ofDays(days))) {
            return days + "일";
        }
        long hours = d.toHours();
        if (hours > 0 && d.equals(Duration.ofHours(hours))) {
            return hours + "시간";
        }
        return d.toMinutes() + "분";
    }
}
