package team.prost.ixauth.mail;

import team.prost.ixauth.mail.MailMessage.Kind;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 코드에 들어 있는 기본 메일 템플릿 — 관리자가 고치지 않았을 때 쓰인다.
 *
 * <p><b>ko 본문은 이 기능이 생기기 전과 한 글자도 다르지 않다.</b> 템플릿 편집(G16)과
 * 다국어(G17)는 "고칠 수 있게" 하는 것이지 "기본을 바꾸는" 것이 아니다. 이미 운영 중인
 * 설치의 메일 문구가 업그레이드로 달라지면, 그건 고객에게 통보 없이 얼굴을 바꾸는 일이다.</p>
 *
 * <p>기본 템플릿을 {@code ko}·{@code en} 두 벌만 두는 이유 — 그 이상은 우리가 품질을
 * 보증할 수 없다. 다른 언어가 필요하면 관리자가 템플릿을 넣고, 없는 언어로 요청이 오면
 * {@code mail.default-locale} 로 폴백한다.</p>
 */
public final class MailTemplates {

    public static final String KO = "ko";
    public static final String EN = "en";

    /** 기본 템플릿이 있는 언어. 그 밖의 언어는 관리자가 넣어야 한다 */
    public static final List<String> BUILT_IN_LOCALES = List.of(KO, EN);

    /** key = {@code KIND|locale} */
    private static final Map<String, Template> DEFAULTS = new LinkedHashMap<>();

    static {
        koLinks();
        koNotices();
        enLinks();
        enNotices();
    }

    private MailTemplates() {
    }

    /**
     * 제목과 본문 한 벌.
     *
     * @param subject 자리표시자가 들어 있는 제목 (`[{productName}] …`)
     * @param body    자리표시자가 들어 있는 본문 (평문)
     */
    public record Template(String subject, String body) {
    }

    /**
     * 기본 템플릿. 그 언어가 없으면 {@code fallbackLocale} 로, 그것도 없으면 ko 로 내려간다.
     *
     * <p>메일이 <b>안 나가는 것보다는</b> 다른 언어로라도 나가는 편이 낫다 — 링크를 받지
     * 못하면 사용자는 계정을 되찾을 수 없다.</p>
     */
    public static Template defaultOf(Kind kind, String locale, String fallbackLocale) {
        var found = DEFAULTS.get(key(kind, locale));
        if (found == null) {
            found = DEFAULTS.get(key(kind, fallbackLocale));
        }
        return found == null ? DEFAULTS.get(key(kind, KO)) : found;
    }

    /** 기본 템플릿이 있는가 — 관리 화면이 "코드 기본값" 을 보여 줄 때 쓴다 */
    public static Template builtIn(Kind kind, String locale) {
        return DEFAULTS.get(key(kind, locale));
    }

    /**
     * 언어 코드 정리 — {@code ko-KR} · {@code KO} 를 {@code ko} 로 본다.
     *
     * <p>사용자 속성은 앱이 채우는 값이라 표기가 제각각으로 들어온다. 여기서 맞춰 두지
     * 않으면 {@code ko-KR} 인 사람만 조용히 기본 언어로 떨어진다.</p>
     */
    public static String normalizeLocale(String raw, String fallback) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        String v = raw.trim().toLowerCase(Locale.ROOT).replace('_', '-');
        int dash = v.indexOf('-');
        return dash > 0 ? v.substring(0, dash) : v;
    }

    /**
     * 자리표시자 치환.
     *
     * <p>{@code String.format} 을 쓰지 않는 이유 — 포맷 문자열의 {@code %n} 은 서버 OS 에
     * 따라 줄바꿈이 달라진다. 메일 본문이 서버마다 달라지면 안 된다.</p>
     *
     * <p>모르는 자리표시자는 <b>그대로 둔다.</b> 지우면 관리자가 오타를 냈을 때
     * ({@code {nmae}}) 본문에서 글자만 사라져 무엇이 잘못됐는지 알 수 없다.</p>
     */
    public static String fill(String text, Map<String, String> vars) {
        if (text == null) {
            return "";
        }
        String out = text;
        for (var e : vars.entrySet()) {
            out = out.replace("{" + e.getKey() + "}", e.getValue() == null ? "" : e.getValue());
        }
        return out;
    }

    private static String key(Kind kind, String locale) {
        return kind.name() + "|" + (locale == null ? "" : locale);
    }

    private static void put(Kind kind, String locale, String subject, String body) {
        DEFAULTS.put(key(kind, locale), new Template(subject, body));
    }

    // ────────────────────── 한국어 ──────────────────────

    /** 링크가 있는 메일 — 이 링크가 닿지 않으면 사용자는 계정을 되찾을 수 없다 */
    private static void koLinks() {
        put(Kind.PASSWORD_RESET, KO, "[{productName}] 비밀번호 재설정", """
                {name} 님, 안녕하세요.

                비밀번호를 재설정하려면 아래 주소를 여세요. 이 링크는 {expiresIn} 뒤에 만료됩니다.

                {link}

                본인이 요청하지 않았다면 이 메일을 무시하세요. 비밀번호는 바뀌지 않습니다.""");

        put(Kind.EMAIL_VERIFY, KO, "[{productName}] 이메일 주소 확인", """
                {name} 님, 안녕하세요.

                아래 주소를 열어 이메일을 확인해 주세요. 이 링크는 {expiresIn} 뒤에 만료됩니다.

                {link}""");

        put(Kind.EMAIL_CHANGE, KO, "[{productName}] 새 이메일 주소 확인", """
                {name} 님, 안녕하세요.

                이 주소를 계정의 새 이메일로 쓰려면 아래를 열어 확인해 주세요.
                확인하기 전까지는 기존 주소가 그대로 쓰입니다. 링크는 {expiresIn} 뒤에 만료됩니다.

                {link}""");

        put(Kind.INVITE, KO, "[{productName}] 초대", """
                {name} 님, 안녕하세요.

                {inviter}{productName} 에 초대되었습니다. 아래 주소를 열어 비밀번호를 정하면
                시작할 수 있습니다. 이 링크는 {expiresIn} 뒤에 만료됩니다.

                {link}""");

        put(Kind.ACCOUNT_EXISTS, KO, "[{productName}] 이미 가입된 주소입니다", """
                {name} 님, 안녕하세요.

                이 주소로 가입을 시도한 기록이 있습니다. 이미 {productName} 계정이 있어
                새로 만들지 않았습니다.

                비밀번호가 기억나지 않는다면 아래에서 재설정할 수 있습니다.
                이 링크는 {expiresIn} 뒤에 만료됩니다.

                {link}

                본인이 시도한 것이 아니라면 이 메일을 무시하세요. 아무것도 바뀌지 않았습니다.""");

        put(Kind.MAGIC_LINK, KO, "[{productName}] 로그인 링크", """
                {name} 님, 안녕하세요.

                아래 주소를 열면 비밀번호 없이 {productName} 에 로그인됩니다.
                이 링크는 {expiresIn} 뒤에 만료되고, 한 번만 쓸 수 있습니다.

                {link}

                이 링크는 그 자체가 로그인 수단입니다. 다른 사람에게 전달하지 마세요.
                본인이 요청하지 않았다면 이 메일을 무시하세요 — 아무 일도 일어나지 않습니다.""");
    }

    /** 링크가 없는 알림 — 무슨 일이 있었는지 알리는 것이 목적이다 */
    private static void koNotices() {
        put(Kind.PASSWORD_CHANGED, KO, "[{productName}] 비밀번호가 변경되었습니다", """
                {name} 님, 안녕하세요.

                계정의 비밀번호가 변경되었습니다.
                본인이 변경한 것이 아니라면 즉시 비밀번호를 재설정하고 관리자에게 알려 주세요.""");

        put(Kind.SIGNUP_APPROVED, KO, "[{productName}] 가입이 승인되었습니다", """
                {name} 님, 안녕하세요.

                {productName} 가입이 승인되었습니다. 이제 로그인할 수 있습니다.""");

        put(Kind.NEW_DEVICE_LOGIN, KO, "[{productName}] 새 기기에서 로그인되었습니다", """
                {name} 님, 안녕하세요.

                평소와 다른 기기 또는 위치에서 {productName} 계정에 로그인되었습니다.

                  시각   {at}
                  기기   {device}
                  IP     {ip}

                본인이 로그인한 것이라면 아무것도 하지 않아도 됩니다.

                본인이 아니라면 지금 바로 비밀번호를 바꾸고, 모든 기기에서 로그아웃하세요.
                이 메일의 주소를 누르지 말고, 평소 쓰던 경로로 직접 들어가서 하세요.""");

        put(Kind.ACCOUNT_DELETE_REQUESTED, KO, "[{productName}] 탈퇴 요청이 접수되었습니다", """
                {name} 님, 안녕하세요.

                {productName} 계정의 탈퇴 요청이 접수되었습니다.
                계정은 {at} 에 비활성화됩니다.

                마음이 바뀌면 그 전에 한 번만 로그인하세요 — 탈퇴가 취소됩니다.
                본인이 요청한 것이 아니라면 지금 로그인해 취소하고 비밀번호를 바꾸세요.""");

        put(Kind.ACCOUNT_DELETED, KO, "[{productName}] 탈퇴 처리가 완료되었습니다", """
                {name} 님, 안녕하세요.

                {productName} 계정이 비활성화되었습니다. 더 이상 로그인할 수 없습니다.

                본인이 요청한 것이 아니라면 즉시 관리자에게 알려 주세요.""");

        put(Kind.MFA_RESET, KO, "[{productName}] 2단계 인증이 초기화되었습니다", """
                {name} 님, 안녕하세요.

                관리자가 {productName} 계정의 2단계 인증을 초기화했습니다.
                이제 비밀번호만으로 로그인되며, 인증 앱에 남아 있는 항목은 더 이상 쓰이지 않습니다.

                보안을 위해 로그인한 뒤 2단계 인증을 다시 등록하세요.
                본인이 요청한 것이 아니라면 즉시 관리자에게 확인하세요.""");
    }

    // ────────────────────── English ──────────────────────

    private static void enLinks() {
        put(Kind.PASSWORD_RESET, EN, "[{productName}] Reset your password", """
                Hello {name},

                Open the link below to reset your password. It expires in {expiresIn}.

                {link}

                If you did not request this, ignore this email. Your password will not change.""");

        put(Kind.EMAIL_VERIFY, EN, "[{productName}] Verify your email address", """
                Hello {name},

                Open the link below to verify your email address. It expires in {expiresIn}.

                {link}""");

        put(Kind.EMAIL_CHANGE, EN, "[{productName}] Confirm your new email address", """
                Hello {name},

                Open the link below to use this address for your account.
                Until you confirm, the previous address stays in use. The link expires in {expiresIn}.

                {link}""");

        put(Kind.INVITE, EN, "[{productName}] You have been invited", """
                Hello {name},

                {inviter}You have been invited to {productName}. Open the link below to set your
                password and get started. The link expires in {expiresIn}.

                {link}""");

        put(Kind.ACCOUNT_EXISTS, EN, "[{productName}] This address is already registered", """
                Hello {name},

                Someone tried to sign up with this address. A {productName} account already
                exists, so no new account was created.

                If you forgot your password, you can reset it below.
                The link expires in {expiresIn}.

                {link}

                If this was not you, ignore this email. Nothing has changed.""");

        put(Kind.MAGIC_LINK, EN, "[{productName}] Your sign-in link", """
                Hello {name},

                Open the link below to sign in to {productName} without a password.
                It expires in {expiresIn} and can be used only once.

                {link}

                This link is itself a means of signing in. Do not forward it to anyone.
                If you did not request it, ignore this email — nothing will happen.""");
    }

    private static void enNotices() {
        put(Kind.PASSWORD_CHANGED, EN, "[{productName}] Your password was changed", """
                Hello {name},

                The password for your account was changed.
                If this was not you, reset your password immediately and tell your administrator.""");

        put(Kind.SIGNUP_APPROVED, EN, "[{productName}] Your sign-up was approved", """
                Hello {name},

                Your {productName} sign-up was approved. You can sign in now.""");

        put(Kind.NEW_DEVICE_LOGIN, EN, "[{productName}] New sign-in to your account", """
                Hello {name},

                Your {productName} account was signed in to from an unfamiliar device or location.

                  Time     {at}
                  Device   {device}
                  IP       {ip}

                If this was you, no action is needed.

                If it was not, change your password now and sign out of every device.
                Do not use the address in this email — go there the way you normally do.""");

        put(Kind.ACCOUNT_DELETE_REQUESTED, EN, "[{productName}] Account deletion requested", """
                Hello {name},

                We received a request to delete your {productName} account.
                The account will be deactivated on {at}.

                If you change your mind, just sign in once before then — the request is cancelled.
                If this was not you, sign in now to cancel it and change your password.""");

        put(Kind.ACCOUNT_DELETED, EN, "[{productName}] Your account has been deactivated", """
                Hello {name},

                Your {productName} account has been deactivated. You can no longer sign in.

                If you did not request this, tell your administrator immediately.""");

        put(Kind.MFA_RESET, EN, "[{productName}] Two-factor authentication was reset", """
                Hello {name},

                An administrator reset two-factor authentication on your {productName} account.
                Your password alone now signs you in, and the entry left in your authenticator
                app is no longer used.

                Please set up two-factor authentication again after you sign in.
                If you did not request this, check with your administrator immediately.""");
    }
}
