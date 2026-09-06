package team.prost.ixauth.settings;

import org.springframework.stereotype.Component;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.settings.SettingDefinition.Option;
import team.prost.ixauth.settings.SettingDefinition.Type;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.Function;

/**
 * 관리자가 바꿀 수 있는 설정의 전체 목록.
 *
 * <p><b>여기 등록하면 관리 화면이 저절로 생긴다.</b> 화면을 따로 만들지 않는 이유 —
 * 설정이 늘 때마다 화면 작업이 따라붙으면 결국 둘이 어긋난다.</p>
 *
 * <p><b>여기 없는 설정은 관리자가 바꿀 수 없다.</b> yml 을 고치고 재시작해야 한다.
 * 시크릿(client-secret · SMTP 비밀번호 · service-key)은 <b>의도적으로</b> 넣지 않는다 —
 * 화면에서 편집 가능하게 만들면 DB·감사로그·백업으로 유출면이 넓어지고, 관리자 계정
 * 하나가 뚫리면 전부 새어 나간다.</p>
 */
@Component
public class SettingDefinitions {

    private final Map<String, SettingBinding> bindings = new LinkedHashMap<>();

    public SettingDefinitions() {
        defineSignup();
        defineSocial();
        defineSecurity();
        defineMfa();
        defineAccountOps();
        defineAccountSecurity();
        defineAccountData();
        defineTerms();
        defineMail();
        defineMailTransport();
        defineMailPaths();
        definePassword();
        definePasswordChecks();
        defineToken();
        defineAudit();
        defineMailDelivery();
        defineOperations();
        defineMagicLink();
        defineCaptcha();
        defineStepUp();
        defineImpersonation();
        defineFederation();
    }

    private void defineSignup() {

        add(SettingDefinition.of("account.signup-mode", Type.ENUM)
                        .group("가입")
                        .label("가입 방식")
                        .help("초대 전용이면 관리자가 만든 계정만 쓸 수 있다. "
                                + "즉시 가입은 누구나 바로, 승인제는 가입 후 관리자가 승인해야 활성화된다.")
                        .options(new Option("CLOSED", "초대 전용 — 관리자가 만든 계정만"),
                                new Option("OPEN", "즉시 가입 — 가입하면 바로 사용"),
                                new Option("APPROVAL", "승인제 — 가입 후 관리자 승인 필요"))
                        .warning("'즉시 가입' 은 주소를 아는 누구나 계정을 만들 수 있다는 뜻이다. "
                                + "사내 시스템이라면 아래 도메인 제한을 함께 건다.")
                        .build(),
                p -> p.getAccount().getSignupMode().name(),
                (p, v) -> p.getAccount().setSignupMode(
                        IxAuthProperties.SignupMode.valueOf(v.toUpperCase())));

        add(SettingDefinition.of("account.signup-verification", Type.ENUM)
                        .group("가입")
                        .label("가입 시 본인확인")
                        .help("이메일은 링크를 눌러야 가입이 끝난다. PASS 는 통신사 실명확인으로, "
                                + "별도 연동이 설정돼 있어야 동작한다.")
                        .options(new Option("NONE", "없음 — 신원이 이미 보장된 폐쇄망 등"),
                                new Option("EMAIL", "이메일 인증"),
                                new Option("PASS", "PASS 본인확인 (연동 필요)"))
                        .build(),
                p -> p.getAccount().getSignupVerification().name(),
                (p, v) -> p.getAccount().setSignupVerification(
                        IxAuthProperties.SignupVerification.valueOf(v.toUpperCase())));

        add(SettingDefinition.of("account.signup-allowed-domains", Type.LIST)
                        .group("가입")
                        .label("가입 허용 이메일 도메인")
                        .help("쉼표로 구분한다 (예: prost.kr, prost.team). "
                                + "비우면 제한이 없다 — 사내 서비스를 열 때 이것만으로 상당 부분 걸러진다.")
                        .build(),
                p -> String.join(", ", p.getAccount().getSignupAllowedDomains()),
                (p, v) -> p.getAccount().setSignupAllowedDomains(splitList(v)));

        add(SettingDefinition.of("account.require-email-verification", Type.BOOLEAN)
                        .group("가입")
                        .label("이메일 인증을 마쳐야 로그인")
                        .help("미인증 계정은 로그인 시 안내를 받는다. 가입을 열었다면 함께 켜는 것을 권한다 "
                                + "— 남의 주소로 가입하는 것을 막는다.")
                        .warning("켜는 순간 아직 인증하지 않은 기존 사용자가 로그인하지 못한다. "
                                + "사용자 목록에서 미인증 계정을 먼저 확인한다.")
                        .build(),
                p -> String.valueOf(p.getAccount().isRequireEmailVerification()),
                (p, v) -> p.getAccount().setRequireEmailVerification(Boolean.parseBoolean(v)));

    }

    private void defineSocial() {

        add(SettingDefinition.of("social.enabled", Type.BOOLEAN)
                        .group("소셜 로그인")
                        .label("소셜 로그인 사용")
                        .help("provider 별 켜기와 키는 환경변수로 설정한다. 키는 화면에서 다루지 않는다.")
                        .build(),
                p -> String.valueOf(p.getSocial().isEnabled()),
                (p, v) -> p.getSocial().setEnabled(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("social.auto-signup", Type.BOOLEAN)
                        .group("소셜 로그인")
                        .label("처음 보는 소셜 계정을 자동 생성")
                        .help("끄면 이미 등록된 사용자만 소셜로 로그인할 수 있다.")
                        .warning("켜면 그 provider 계정을 가진 누구나 들어온다. "
                                + "Microsoft 는 테넌트를 조직 ID 로 고정했는지 함께 확인한다.")
                        .build(),
                p -> String.valueOf(p.getSocial().isAutoSignup()),
                (p, v) -> p.getSocial().setAutoSignup(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("social.auto-link-verified-email", Type.BOOLEAN)
                        .group("소셜 로그인")
                        .label("검증된 이메일이면 기존 계정에 연결")
                        .help("provider 가 '이 주소를 검증했다' 고 명시한 경우에만 적용된다. "
                                + "네이버처럼 신호를 주지 않는 곳은 이 값과 무관하게 연결되지 않는다.")
                        .build(),
                p -> String.valueOf(p.getSocial().isAutoLinkVerifiedEmail()),
                (p, v) -> p.getSocial().setAutoLinkVerifiedEmail(Boolean.parseBoolean(v)));

    }

    private void defineSecurity() {

        add(SettingDefinition.of("lockout.enabled", Type.BOOLEAN)
                        .group("보안")
                        .label("로그인 실패 시 계정 잠금")
                        .build(),
                p -> String.valueOf(p.getLockout().isEnabled()),
                (p, v) -> p.getLockout().setEnabled(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("lockout.max-attempts", Type.INTEGER)
                        .group("보안")
                        .label("잠기기까지 허용할 실패 횟수")
                        .help("너무 낮으면 오타 몇 번에 잠긴다. 무차별 대입은 속도 제한이 함께 막는다.")
                        .build(),
                p -> String.valueOf(p.getLockout().getMaxAttempts()),
                (p, v) -> p.getLockout().setMaxAttempts(Integer.parseInt(v)));

        add(SettingDefinition.of("lockout.duration", Type.DURATION)
                        .group("보안")
                        .label("잠금 지속 시간")
                        .help("`15m` · `1h` 형식. 지나면 자동으로 풀린다.")
                        .build(),
                p -> p.getLockout().getDuration().toString(),
                (p, v) -> p.getLockout().setDuration(parseDuration(v)));

        add(SettingDefinition.of("rate-limit.enabled", Type.BOOLEAN)
                        .group("보안")
                        .label("요청 속도 제한")
                        .help("계정 잠금은 계정당이라, 수천 계정에 흔한 비밀번호를 한 번씩 시도하는 방식을 "
                                + "막지 못한다. 그것을 막는 것이 이쪽이다.")
                        .warning("끄면 무차별 대입 속도에 제한이 없어진다.")
                        .build(),
                p -> String.valueOf(p.getRateLimit().isEnabled()),
                (p, v) -> p.getRateLimit().setEnabled(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("lockout.reset-window", Type.DURATION)
                        .group("보안")
                        .label("실패 횟수 초기화 간격")
                        .help("이 시간 동안 실패가 없으면 카운터를 0 으로 되돌린다. "
                                + "없으면 며칠에 걸친 오타가 누적돼 잠긴다.")
                        .build(),
                p -> p.getLockout().getResetWindow().toString(),
                (p, v) -> p.getLockout().setResetWindow(parseDuration(v)));

        add(SettingDefinition.of("rate-limit.login-per-minute", Type.INTEGER)
                        .group("보안")
                        .label("IP 당 분당 로그인 시도")
                        .build(),
                p -> String.valueOf(p.getRateLimit().getLoginPerMinute()),
                (p, v) -> p.getRateLimit().setLoginPerMinute(Integer.parseInt(v)));

        add(SettingDefinition.of("rate-limit.refresh-per-minute", Type.INTEGER)
                        .group("보안")
                        .label("IP 당 분당 토큰 갱신")
                        .help("사용자가 여러 탭을 열면 갱신이 몰린다. 로그인보다 넉넉해야 한다.")
                        .build(),
                p -> String.valueOf(p.getRateLimit().getRefreshPerMinute()),
                (p, v) -> p.getRateLimit().setRefreshPerMinute(Integer.parseInt(v)));

        add(SettingDefinition.of("rate-limit.default-per-minute", Type.INTEGER)
                        .group("보안")
                        .label("IP 당 분당 그 밖의 요청")
                        .build(),
                p -> String.valueOf(p.getRateLimit().getDefaultPerMinute()),
                (p, v) -> p.getRateLimit().setDefaultPerMinute(Integer.parseInt(v)));

    }

    private void defineMfa() {

        add(SettingDefinition.of("mfa.mode", Type.ENUM)
                        .group("2단계 인증")
                        .label("2단계 인증 요구 범위")
                        .help("인증 앱(TOTP)으로 로그인 시 6자리 코드를 한 번 더 받는다. "
                                + "시크릿은 환경변수 ixauth.mfa.encryption-key 로 암호화해 저장하며 "
                                + "(미설정 시 service-key 에서 파생) 화면에서는 다루지 않는다.")
                        .options(new Option("OPTIONAL", "선택 — 사용자가 스스로 켠다"),
                                new Option("REQUIRED_ADMIN", "관리 권한자는 필수"),
                                new Option("REQUIRED_ALL", "전원 필수"))
                        .warning("필수로 바꿔도 아직 등록하지 않은 사람의 로그인을 막지는 않는다. "
                                + "막으면 전원이 잠기기 때문이다 — 대신 로그인 응답에 "
                                + "mfaSetupRequired=true 를 실어 보내므로, 앱이 그 신호를 받아 "
                                + "등록 화면으로 보내야 실제로 강제된다. "
                                + "소셜 로그인은 provider 가 이미 본인확인을 한 것으로 보아 "
                                + "이 요구를 적용하지 않는다.")
                        .build(),
                p -> p.getMfa().getMode().name(),
                (p, v) -> p.getMfa().setMode(
                        IxAuthProperties.MfaMode.valueOf(v.toUpperCase(java.util.Locale.ROOT))));

        add(SettingDefinition.of("mfa.backup-code-count", Type.INTEGER)
                        .group("2단계 인증")
                        .label("백업 코드 개수")
                        .help("등록할 때 한 번만 보여 주는 1회용 코드다. 휴대폰을 잃어버렸을 때의 "
                                + "유일한 출구이므로 0 으로 두지 않는다.")
                        .build(),
                p -> String.valueOf(p.getMfa().getBackupCodeCount()),
                (p, v) -> p.getMfa().setBackupCodeCount(Integer.parseInt(v)));

        add(SettingDefinition.of("mfa.issuer", Type.STRING)
                        .group("2단계 인증")
                        .label("인증 앱에 표시할 이름")
                        .help("사용자의 인증 앱 목록에 이 이름으로 뜬다. 비우면 메일 제품명을 쓴다. "
                                + "이미 등록한 사람의 항목 이름은 바뀌지 않는다.")
                        .build(),
                p -> p.getMfa().getIssuer(),
                (p, v) -> p.getMfa().setIssuer(v.trim()));

        add(SettingDefinition.of("mfa.challenge-ttl", Type.DURATION)
                        .group("2단계 인증")
                        .label("2단계 입력 제한 시간")
                        .help("비밀번호가 맞은 뒤 코드를 넣기까지 허용할 시간. 이 사이에는 비밀번호를 "
                                + "이미 통과한 상태이므로 길게 잡을수록 위험하다.")
                        .build(),
                p -> p.getMfa().getChallengeTtl().toString(),
                (p, v) -> p.getMfa().setChallengeTtl(parseDuration(v)));

        add(SettingDefinition.of("mfa.admin-reset", Type.BOOLEAN)
                        .group("2단계 인증")
                        .label("관리자가 남의 2단계를 초기화할 수 있다")
                        .help("휴대폰과 백업 코드를 모두 잃은 사람의 복구 경로다. 끄면 그 사람은 "
                                + "다시는 들어올 수 없고, 남는 수단은 DB 직접 수정뿐이라 오히려 "
                                + "흔적이 남지 않는다. 그래서 기본은 켬이다.")
                        .warning("초기화는 항상 감사 로그에 남고 본인에게 메일이 나간다 — 이 두 가지는 "
                                + "끌 수 없다. 관리자가 조용히 남의 2단계를 끄는 일이 없어야 한다.")
                        .build(),
                p -> String.valueOf(p.getMfa().isAdminReset()),
                (p, v) -> p.getMfa().setAdminReset(Boolean.parseBoolean(v)));
    }

    private void defineAccountOps() {

        add(SettingDefinition.of("account.revoke-sessions-on-password-change", Type.BOOLEAN)
                        .group("계정 운영")
                        .label("비밀번호 변경 시 모든 기기에서 로그아웃")
                        .help("비밀번호를 바꾸는 목적은 대개 '누가 내 계정을 쓰는 것 같다' 다. "
                                + "세션을 남기면 그 목적이 달성되지 않는다.")
                        .build(),
                p -> String.valueOf(p.getAccount().isRevokeSessionsOnPasswordChange()),
                (p, v) -> p.getAccount().setRevokeSessionsOnPasswordChange(
                        Boolean.parseBoolean(v)));

        add(SettingDefinition.of("account.reset-token-ttl", Type.DURATION)
                        .group("계정 운영")
                        .label("비밀번호 재설정 링크 수명")
                        .help("길수록 메일함이 유출됐을 때의 창이 넓어진다.")
                        .build(),
                p -> p.getAccount().getResetTokenTtl().toString(),
                (p, v) -> p.getAccount().setResetTokenTtl(parseDuration(v)));

        add(SettingDefinition.of("account.verify-token-ttl", Type.DURATION)
                        .group("계정 운영")
                        .label("이메일 인증 링크 수명")
                        .build(),
                p -> p.getAccount().getVerifyTokenTtl().toString(),
                (p, v) -> p.getAccount().setVerifyTokenTtl(parseDuration(v)));

        add(SettingDefinition.of("account.invite-token-ttl", Type.DURATION)
                        .group("계정 운영")
                        .label("초대 링크 수명")
                        .build(),
                p -> p.getAccount().getInviteTokenTtl().toString(),
                (p, v) -> p.getAccount().setInviteTokenTtl(parseDuration(v)));

        add(SettingDefinition.of("account.resend-cooldown", Type.DURATION)
                        .group("계정 운영")
                        .label("메일 재발송 최소 간격")
                        .help("없으면 남의 주소로 메일을 무한히 보낼 수 있다.")
                        .build(),
                p -> p.getAccount().getResendCooldown().toString(),
                (p, v) -> p.getAccount().setResendCooldown(parseDuration(v)));

    }

    /**
     * 계정 보안 — 로그인 알림 · 동시 세션 상한 · 본인 탈퇴.
     *
     * <p>{@link #defineAccountOps()} 와 같은 그룹으로 묶어 화면에서는 이어져 보인다.
     * 메서드를 나눈 것은 길이 제한(80줄) 때문이다.</p>
     */
    private void defineAccountSecurity() {

        add(SettingDefinition.of("account.notify-new-device", Type.BOOLEAN)
                        .group("계정 운영")
                        .label("새 기기·새 IP 로그인 시 메일로 알림")
                        .help("계정을 빼앗겼을 때 사용자가 스스로 알아챌 수 있는 거의 유일한 수단이다. "
                                + "세션 목록은 들여다봐야 보이지만 이 메일은 찾아온다. "
                                + "가입 후 첫 로그인에는 보내지 않는다 — 모두에게 가면 소음이 된다.")
                        .warning("끄면 남이 내 계정으로 들어와도 사용자가 알 방법이 사실상 없다.")
                        .build(),
                p -> String.valueOf(p.getAccount().isNotifyNewDevice()),
                (p, v) -> p.getAccount().setNotifyNewDevice(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("account.max-concurrent-sessions", Type.INTEGER)
                        .group("계정 운영")
                        .label("계정당 동시 로그인 상한")
                        .help("초과하면 가장 오래된 세션부터 끊는다. 0 이면 제한하지 않는다 — "
                                + "PC·휴대폰·태블릿을 함께 쓰는 사람이 대부분이라 이것이 기본값이다.")
                        .warning("1~2 처럼 낮게 걸면 여러 기기를 쓰는 사용자가 영문도 모르고 "
                                + "로그아웃된다. 계정 공유를 막을 목적이라면 그 사실을 먼저 공지한다.")
                        .build(),
                p -> String.valueOf(p.getAccount().getMaxConcurrentSessions()),
                (p, v) -> p.getAccount().setMaxConcurrentSessions(Integer.parseInt(v)));

        add(SettingDefinition.of("account.self-delete-mode", Type.ENUM)
                        .group("계정 운영")
                        .label("본인 탈퇴")
                        .help("어느 쪽이든 계정을 지우지 않고 비활성으로 둔다. 지우면 감사 로그의 "
                                + "참조가 끊기고, 같은 주소로 다시 가입해 이력을 지울 수 있다.")
                        .options(new Option("DISABLED", "사용 안 함 — 관리자만 계정을 닫는다"),
                                new Option("IMMEDIATE", "즉시 — 요청 즉시 비활성"),
                                new Option("GRACE", "유예 후 — 그 사이 로그인하면 취소"))
                        .warning("'즉시' 는 되돌릴 수 없다. 홧김에 누른 사용자를 돌려세울 수 있는 쪽은 "
                                + "'유예 후' 다.")
                        .build(),
                p -> p.getAccount().getSelfDeleteMode().name(),
                (p, v) -> p.getAccount().setSelfDeleteMode(
                        IxAuthProperties.SelfDeleteMode.valueOf(
                                v.toUpperCase(java.util.Locale.ROOT))));

        add(SettingDefinition.of("account.self-delete-grace", Type.DURATION)
                        .group("계정 운영")
                        .label("탈퇴 유예 기간")
                        .help("이 시간이 지나면 비활성이 된다. 그 전에 로그인하면 탈퇴가 취소된다.")
                        .shownWhen("account.self-delete-mode", "GRACE")
                        .build(),
                p -> p.getAccount().getSelfDeleteGrace().toString(),
                (p, v) -> p.getAccount().setSelfDeleteGrace(parseDuration(v)));
    }

    /**
     * 사용자 데이터 취급 — 속성 검증 · 일괄 등록.
     *
     * <p>{@link #defineAccountOps()} 와 같은 그룹이다. 메서드를 나눈 것은 길이 제한(80줄)
     * 때문이지, 화면에서 따로 보이지는 않는다.</p>
     */
    private void defineAccountData() {

        add(SettingDefinition.of("account.strict-attributes", Type.BOOLEAN)
                        .group("계정 운영")
                        .label("정의에 없는 사용자 속성은 거부")
                        .help("사용자 탭의 '속성 정의' 에 등록한 키만 받는다. 정의가 하나도 "
                                + "없으면 이 값과 무관하게 아무 검사도 하지 않는다.")
                        .warning("켜는 순간, 정의에 없는 키를 담아 보내던 기존 앱의 사용자 "
                                + "생성·수정이 전부 400 이 된다. 먼저 쓰이는 키를 모두 "
                                + "정의에 등록하고 켠다 — 그래서 기본은 끔이다.")
                        .build(),
                p -> String.valueOf(p.getAccount().isStrictAttributes()),
                (p, v) -> p.getAccount().setStrictAttributes(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("account.bulk-import-max", Type.INTEGER)
                        .group("계정 운영")
                        .label("일괄 등록 1회 상한 (건)")
                        .help("`POST /admin/users/bulk` 가 한 번에 받는 최대 행 수. "
                                + "상한이 없으면 요청 하나로 서버를 세울 수 있다. "
                                + "초과분을 잘라 처리하지 않고 요청 전체를 거절한다 — "
                                + "일부만 들어간 것을 관리자가 알아채기 어렵다.")
                        .build(),
                p -> String.valueOf(p.getAccount().getBulkImportMax()),
                (p, v) -> p.getAccount().setBulkImportMax(Integer.parseInt(v)));
    }

    /**
     * 약관 동의.
     *
     * <p>대외 서비스에는 사실상 필수이고 사내 인스턴스에는 아예 없다. 그 둘을 같은 jar
     * 하나로 덮으려면 기능 전체가 스위치여야 한다.</p>
     */
    private void defineTerms() {

        add(SettingDefinition.of("terms.enabled", Type.BOOLEAN)
                        .group("약관")
                        .label("약관 동의 사용")
                        .help("끄면 약관 조회·동의 API 가 빈 결과를 주고 로그인 응답의 "
                                + "termsAgreementRequired 도 항상 비어 있다. 등록해 둔 약관과 "
                                + "동의 이력은 그대로 남는다 — 껐다고 증빙을 지우지 않는다.")
                        .build(),
                p -> String.valueOf(p.getTerms().isEnabled()),
                (p, v) -> p.getTerms().setEnabled(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("terms.require-on-signup", Type.BOOLEAN)
                        .group("약관")
                        .label("가입할 때 필수 약관 동의를 받는다")
                        .help("동의 없이 가입을 시도하면 AUTH_TERMS_REQUIRED(400) 이고, "
                                + "응답의 details 에 어떤 코드가 빠졌는지 실린다. "
                                + "끄면 가입은 되고 첫 로그인 응답에 재동의 요구가 실린다.")
                        .shownWhen("terms.enabled", "true")
                        .build(),
                p -> String.valueOf(p.getTerms().isRequireOnSignup()),
                (p, v) -> p.getTerms().setRequireOnSignup(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("terms.reagreement-required", Type.BOOLEAN)
                        .group("약관")
                        .label("필수 약관의 새 버전이 나오면 다시 받는다")
                        .help("로그인은 그대로 되고, 응답에 termsAgreementRequired 로 코드 "
                                + "목록이 실린다. 앱이 그 신호를 받아 동의 화면으로 보내야 "
                                + "실제로 강제된다 — 2단계 인증의 mfaSetupRequired 와 같은 방식이다.")
                        .warning("로그인을 막지 않는 이유는 막으면 새 버전을 게시하는 순간 "
                                + "전원이 못 들어오기 때문이다. 끄면 옛 버전에만 동의한 "
                                + "사용자가 그대로 남아, 개정된 내용은 동의받은 적이 없게 된다.")
                        .shownWhen("terms.enabled", "true")
                        .build(),
                p -> String.valueOf(p.getTerms().isReagreementRequired()),
                (p, v) -> p.getTerms().setReagreementRequired(Boolean.parseBoolean(v)));
    }

    private void defineMail() {

        add(SettingDefinition.of("mail.transport", Type.ENUM)
                        .group("메일")
                        .label("메일 전송 방식")
                        .help("SMTP 는 IX-Auth 가 직접 보낸다. 메일서버 위임은 앱(또는 사내 메일 시스템)의 "
                                + "엔드포인트로 넘겨 그쪽이 보내게 한다 — 폐쇄망이거나 사내 발송 규격을 "
                                + "따라야 할 때 쓴다.")
                        .options(new Option("SMTP", "SMTP 직접 발송"),
                                new Option("WEBHOOK", "메일서버에 위임 (웹훅)"),
                                new Option("LOG", "발송 안 함 - 링크를 로그에만 (개발용)"))
                        .warning("'발송 안 함' 이면 비밀번호 찾기·이메일 인증·초대 링크가 "
                                + "사용자에게 닿지 않는다. 운영에서는 쓰지 않는다.")
                        .build(),
                p -> p.getMail().getTransport().name(),
                (p, v) -> p.getMail().setTransport(
                        IxAuthProperties.Mail.Transport.valueOf(v.toUpperCase())));

        add(SettingDefinition.of("mail.from", Type.STRING)
                        .group("메일")
                        .label("보내는 사람")
                        .help("표시 이름을 함께 쓸 수 있다: IX-Auth <no-reply@example.com>")
                        .build(),
                p -> p.getMail().getFrom(),
                (p, v) -> p.getMail().setFrom(v.trim()));

    }

    private void defineMailTransport() {

        add(SettingDefinition.of("mail.smtp.host", Type.STRING)
                        .group("메일")
                        .label("SMTP 호스트")
                        .help("비어 있으면 발송되지 않는다.")
                        .shownWhen("mail.transport", "SMTP")
                        .build(),
                p -> p.getMail().getSmtp().getHost(),
                (p, v) -> p.getMail().getSmtp().setHost(v.trim()));

        add(SettingDefinition.of("mail.smtp.port", Type.INTEGER)
                        .group("메일")
                        .label("SMTP 포트")
                        .help("STARTTLS 는 보통 587, SSL 은 465.")
                        .shownWhen("mail.transport", "SMTP")
                        .build(),
                p -> String.valueOf(p.getMail().getSmtp().getPort()),
                (p, v) -> p.getMail().getSmtp().setPort(Integer.parseInt(v)));

        add(SettingDefinition.of("mail.smtp.username", Type.STRING)
                        .group("메일")
                        .label("SMTP 사용자")
                        .help("비우면 인증 없이 보낸다. 비밀번호는 여기서 다루지 않는다 - "
                                + "환경변수 IXAUTH_MAIL_SMTP_PASSWORD 로 넣는다.")
                        .shownWhen("mail.transport", "SMTP")
                        .build(),
                p -> p.getMail().getSmtp().getUsername(),
                (p, v) -> p.getMail().getSmtp().setUsername(v.trim()));

        add(SettingDefinition.of("mail.smtp.starttls", Type.BOOLEAN)
                        .group("메일")
                        .label("STARTTLS 사용")
                        .shownWhen("mail.transport", "SMTP")
                        .build(),
                p -> String.valueOf(p.getMail().getSmtp().isStarttls()),
                (p, v) -> p.getMail().getSmtp().setStarttls(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("mail.smtp.ssl", Type.BOOLEAN)
                        .group("메일")
                        .label("SSL 사용 (465 포트)")
                        .shownWhen("mail.transport", "SMTP")
                        .build(),
                p -> String.valueOf(p.getMail().getSmtp().isSsl()),
                (p, v) -> p.getMail().getSmtp().setSsl(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("mail.webhook.url", Type.STRING)
                        .group("메일")
                        .label("메일서버 엔드포인트")
                        .help("IX-Auth 가 이 주소로 POST 한다. 받는 쪽은 to·kind·link 를 가지고 "
                                + "자기 템플릿으로 보내면 된다 - 본문도 함께 주지만 무시해도 좋다.")
                        .shownWhen("mail.transport", "WEBHOOK")
                        .build(),
                p -> p.getMail().getWebhook().getUrl(),
                (p, v) -> p.getMail().getWebhook().setUrl(v.trim()));

        add(SettingDefinition.of("mail.webhook.send-service-key", Type.BOOLEAN)
                        .group("메일")
                        .label("서비스 키를 함께 보낸다")
                        .help("받는 쪽이 요청의 출처를 확인할 수 있게 한다. 끄면 아무나 그 엔드포인트를 "
                                + "호출할 수 있으므로, 끌 거라면 다른 방법으로 막아야 한다.")
                        .shownWhen("mail.transport", "WEBHOOK")
                        .build(),
                p -> String.valueOf(p.getMail().getWebhook().isSendServiceKey()),
                (p, v) -> p.getMail().getWebhook().setSendServiceKey(Boolean.parseBoolean(v)));

    }

    private void defineMailPaths() {

        add(SettingDefinition.of("mail.app-base-url", Type.STRING)
                        .group("메일")
                        .label("앱 주소 (메일 링크가 가리킬 곳)")
                        .help("IX-Auth 주소가 아니라 사용자가 브라우저로 여는 앱 주소다. "
                                + "비어 있으면 비밀번호 찾기 링크를 만들 수 없다.")
                        .build(),
                p -> p.getMail().getAppBaseUrl(),
                (p, v) -> p.getMail().setAppBaseUrl(v.trim()));

        add(SettingDefinition.of("mail.product-name", Type.STRING)
                        .group("메일")
                        .label("제품명 (메일 제목·본문)")
                        .build(),
                p -> p.getMail().getProductName(),
                (p, v) -> p.getMail().setProductName(v.trim()));

        add(SettingDefinition.of("mail.reset-path", Type.STRING)
                        .group("메일")
                        .label("앱의 비밀번호 재설정 화면 경로")
                        .help("앱이 이 경로에 화면을 두고 토큰을 받는다.")
                        .build(),
                p -> p.getMail().getResetPath(),
                (p, v) -> p.getMail().setResetPath(v.trim()));

        add(SettingDefinition.of("mail.verify-path", Type.STRING)
                        .group("메일")
                        .label("앱의 이메일 확인 화면 경로")
                        .build(),
                p -> p.getMail().getVerifyPath(),
                (p, v) -> p.getMail().setVerifyPath(v.trim()));

        add(SettingDefinition.of("mail.invite-path", Type.STRING)
                        .group("메일")
                        .label("앱의 초대 수락 화면 경로")
                        .build(),
                p -> p.getMail().getInvitePath(),
                (p, v) -> p.getMail().setInvitePath(v.trim()));
    }

    private void definePassword() {

        add(SettingDefinition.of("password.min-length", Type.INTEGER)
                        .group("비밀번호 정책")
                        .label("최소 길이")
                        .help("길이가 복잡도보다 효과가 크다. 12자 이상을 권한다.")
                        .build(),
                p -> String.valueOf(p.getPassword().getMinLength()),
                (p, v) -> p.getPassword().setMinLength(Integer.parseInt(v)));

        add(SettingDefinition.of("password.require-uppercase", Type.BOOLEAN)
                        .group("비밀번호 정책")
                        .label("대문자 포함 필수")
                        .build(),
                p -> String.valueOf(p.getPassword().isRequireUppercase()),
                (p, v) -> p.getPassword().setRequireUppercase(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("password.require-digit", Type.BOOLEAN)
                        .group("비밀번호 정책")
                        .label("숫자 포함 필수")
                        .build(),
                p -> String.valueOf(p.getPassword().isRequireDigit()),
                (p, v) -> p.getPassword().setRequireDigit(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("password.require-special", Type.BOOLEAN)
                        .group("비밀번호 정책")
                        .label("특수문자 포함 필수")
                        .help("복잡도를 높게 걸수록 사용자가 메모에 적어 두는 쪽으로 간다. "
                                + "길이를 늘리는 편이 대체로 안전하다.")
                        .build(),
                p -> String.valueOf(p.getPassword().isRequireSpecial()),
                (p, v) -> p.getPassword().setRequireSpecial(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("password.bcrypt-strength", Type.INTEGER)
                        .group("비밀번호 정책")
                        .label("해시 강도 (bcrypt cost)")
                        .help("높을수록 느리고 안전하다. 10~12 가 일반적이며, 바꿔도 기존 해시는 "
                                + "그대로 두고 다음 로그인 때 새 강도로 다시 해싱한다.")
                        .build(),
                p -> String.valueOf(p.getPassword().getBcryptStrength()),
                (p, v) -> p.getPassword().setBcryptStrength(Integer.parseInt(v)));

        add(SettingDefinition.of("password.rehash-on-login", Type.BOOLEAN)
                        .group("비밀번호 정책")
                        .label("로그인 시 옛 해시를 현행으로 재해싱")
                        .help("다른 시스템에서 옮겨온 계정을 조용히 현행 방식으로 바꾼다. "
                                + "사용자는 아무것도 하지 않는다.")
                        .build(),
                p -> String.valueOf(p.getPassword().isRehashOnLogin()),
                (p, v) -> p.getPassword().setRehashOnLogin(Boolean.parseBoolean(v)));
    }

    /**
     * 비밀번호를 <b>내용으로</b> 거르는 검사 두 가지 — 재사용 이력 · 유출 목록.
     *
     * <p>{@link #definePassword()} 와 같은 그룹이다. 메서드를 나눈 것은 길이 제한(80줄) 때문이다.</p>
     */
    private void definePasswordChecks() {

        add(SettingDefinition.of("password.history-count", Type.INTEGER)
                        .group("비밀번호 정책")
                        .label("최근 N개 비밀번호 재사용 금지")
                        .help("0 이면 이력을 검사하지 않는다. 0 이어도 <b>직전</b> 비밀번호는 "
                                + "언제나 막는다. 공공·금융 요구사항에서 흔히 3~5 를 요구한다.")
                        .warning("기본이 0 인 이유는 이력을 남기는 것 자체가 보관하는 개인정보를 "
                                + "늘리기 때문이다. 요구받지 않는다면 켜지 않는 편이 낫다.")
                        .build(),
                p -> String.valueOf(p.getPassword().getHistoryCount()),
                (p, v) -> p.getPassword().setHistoryCount(Integer.parseInt(v)));

        add(SettingDefinition.of("password.check-breached", Type.BOOLEAN)
                        .group("비밀번호 정책")
                        .label("유출된 적이 있는 비밀번호를 거부")
                        .help("Have I Been Pwned 에 SHA-1 해시의 <b>앞 5자만</b> 보내고 나머지는 "
                                + "받아온 목록과 이쪽에서 대조한다(k-익명성). 비밀번호도, 온전한 "
                                + "해시도 밖으로 나가지 않는다.")
                        .warning("외부 API 를 부르므로 폐쇄망에서는 쓸 수 없다 — 그래서 기본이 "
                                + "끔이다. 조회에 실패하면 가입·변경을 막지 않고 통과시킨다"
                                + "(WARN 로그). 외부 서비스 장애로 로그인 시스템이 멈추면 안 된다.")
                        .build(),
                p -> String.valueOf(p.getPassword().isCheckBreached()),
                (p, v) -> p.getPassword().setCheckBreached(Boolean.parseBoolean(v)));
    }

    private void defineToken() {

        add(SettingDefinition.of("jwt.access-ttl", Type.DURATION)
                        .group("토큰·세션")
                        .label("액세스 토큰 수명")
                        .help("앱이 토큰을 스스로 검증하므로, 발급된 토큰은 만료 전까지 취소할 수 없다. "
                                + "그 대가를 짧은 수명으로 치른다. 15분을 권한다.")
                        .warning("길게 잡으면 권한을 회수해도 그 시간만큼 유효하다.")
                        .build(),
                p -> p.getJwt().getAccessTtl().toString(),
                (p, v) -> p.getJwt().setAccessTtl(parseDuration(v)));

        add(SettingDefinition.of("jwt.refresh-ttl", Type.DURATION)
                        .group("토큰·세션")
                        .label("리프레시 토큰 수명 (로그인 유지 기간)")
                        .help("이 기간 동안 재로그인 없이 쓴다. 길수록 편하고, 짧을수록 안전하다.")
                        .build(),
                p -> p.getJwt().getRefreshTtl().toString(),
                (p, v) -> p.getJwt().setRefreshTtl(parseDuration(v)));

        add(SettingDefinition.of("jwt.clock-skew", Type.DURATION)
                        .group("토큰·세션")
                        .label("시계 오차 허용")
                        .help("앱 서버와 IX-Auth 의 시간이 조금 어긋나도 토큰이 거부되지 않게 한다.")
                        .build(),
                p -> p.getJwt().getClockSkew().toString(),
                (p, v) -> p.getJwt().setClockSkew(parseDuration(v)));

        add(SettingDefinition.of("authz.permission-map-cache", Type.DURATION)
                        .group("토큰·세션")
                        .label("권한 맵 캐시 수명")
                        .help("앱이 권한 목록을 캐싱하는 시간. 권한을 바꾸면 토큰의 버전 신호로 "
                                + "즉시 갱신되므로 길게 잡아도 된다.")
                        .build(),
                p -> p.getAuthz().getPermissionMapCache().toString(),
                (p, v) -> p.getAuthz().setPermissionMapCache(parseDuration(v)));

        add(SettingDefinition.of("authz.fallback-on-unavailable", Type.ENUM)
                        .group("토큰·세션")
                        .label("IX-Auth 미도달 시 파일 권한 판정")
                        .help("파일·문서 권한을 물을 수 없을 때의 동작.")
                        .options(new Option("deny", "거부 - 확인할 수 없으면 막는다"),
                                new Option("l1", "역할 권한으로 대신 판정"))
                        .warning("'역할 권한으로 대신' 은 개별 리소스의 거부 예외를 무시한다.")
                        .build(),
                p -> p.getAuthz().getFallbackOnUnavailable(),
                (p, v) -> p.getAuthz().setFallbackOnUnavailable(
                        v.trim().toLowerCase(java.util.Locale.ROOT)));
    }

    private void defineAudit() {

        add(SettingDefinition.of("audit.retention-days", Type.INTEGER)
                        .group("감사 로그")
                        .label("보존 기간 (일)")
                        .help("0 이면 무기한 보존한다. 매일 새벽에 지난 것을 정리한다.")
                        .build(),
                p -> String.valueOf(p.getAudit().getRetentionDays()),
                (p, v) -> p.getAudit().setRetentionDays(Integer.parseInt(v)));

        add(SettingDefinition.of("audit.log-failed-login", Type.BOOLEAN)
                        .group("감사 로그")
                        .label("로그인 실패도 기록")
                        .help("끄면 무차별 대입 시도의 흔적이 남지 않는다.")
                        .build(),
                p -> String.valueOf(p.getAudit().isLogFailedLogin()),
                (p, v) -> p.getAudit().setLogFailedLogin(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("audit.client-ip-guard", Type.ENUM)
                        .group("감사 로그")
                        .label("잘못된 연동 감지")
                        .help("감사 IP 가 방문자일 수 없는 주소(사설망·링크로컬·CDN 엣지 대역)면 "
                                + "시스템 로그에 경고한다. 앱이 경유지 주소를 넘기면 감사 로그가 "
                                + "그 경유지로 굳는데, 이 실수는 화면에 아무 증상도 내지 않아 "
                                + "사고 조사 때에야 드러난다. 고치는 법은 docs/guides/client-ip.md.")
                        .options(new Option("WARN", "경고 - 사설망·CDN 엣지 (기본)"),
                                new Option("STRICT", "엄격 - 루프백까지 경고"),
                                new Option("OFF", "끔"))
                        .warning("기본값은 루프백(127.0.0.1)을 넘긴다. 로컬 개발에서는 방문자가 "
                                + "실제로 루프백이기 때문이다. 앱과 jar 가 다른 호스트인 운영에서는 "
                                + "STRICT 로 두면 그 경우도 잡는다.")
                        .build(),
                p -> p.getAudit().getClientIpGuard().name(),
                (p, v) -> p.getAudit().setClientIpGuard(
                        team.prost.ixauth.config.IxAuthProperties.Audit.ClientIpGuardMode
                                .valueOf(v.trim().toUpperCase(java.util.Locale.ROOT))));
    }

    /**
     * 메일 발송 이력·재시도·다국어 (G21 · G17).
     *
     * <p>{@link #defineMail()} 과 같은 그룹이다. 메서드를 나눈 것은 길이 제한(80줄) 때문이다.</p>
     */
    private void defineMailDelivery() {

        add(SettingDefinition.of("mail.retry-enabled", Type.BOOLEAN)
                        .group("메일")
                        .label("발송 실패 시 다시 시도")
                        .help("지수 백오프로 최대 3회까지 다시 보낸다. 끄면 한 번 실패한 메일은 "
                                + "그대로 실패로 남는다 — 발송 이력에는 어느 쪽이든 기록된다.")
                        .warning("재시도는 발송 시점의 메시지를 메모리에 들고 있는 동안만 된다. "
                                + "본문·링크를 DB 에 저장하지 않기 때문이다(저장하면 재설정 링크가 "
                                + "곧 계정 탈취 경로가 된다). 프로세스가 내려가면 대기 중이던 "
                                + "재시도는 사라지고 이력에 실패로 남는다.")
                        .build(),
                p -> String.valueOf(p.getMail().isRetryEnabled()),
                (p, v) -> p.getMail().setRetryEnabled(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("mail.retention-days", Type.INTEGER)
                        .group("메일")
                        .label("발송 이력 보존 기간 (일)")
                        .help("0 이면 무기한 보존한다. 매일 새벽에 지난 것을 정리한다. "
                                + "이력에는 받는 사람 주소가 들어 있으므로 무한정 쌓아 둘 이유가 없다.")
                        .build(),
                p -> String.valueOf(p.getMail().getRetentionDays()),
                (p, v) -> p.getMail().setRetentionDays(Integer.parseInt(v)));

        add(SettingDefinition.of("mail.default-locale", Type.ENUM)
                        .group("메일")
                        .label("메일 기본 언어")
                        .help("사용자 속성 locale 이 있으면 그것을 먼저 쓰고, 없거나 해당 언어의 "
                                + "템플릿이 없으면 이 언어로 보낸다.")
                        .options(new Option("ko", "한국어"), new Option("en", "English"))
                        .build(),
                p -> p.getMail().getDefaultLocale(),
                (p, v) -> p.getMail().setDefaultLocale(v.trim()));
    }

    /**
     * 운영 도구 — 감사 로그 내보내기 상한 · 속도 제한 저장소 · 서명 키 회전.
     *
     * <p>세 가지 다 기존 그룹에 붙는다. 화면에서는 각각 감사 로그 · 보안 · 토큰·세션에 보인다.</p>
     */
    private void defineOperations() {

        add(SettingDefinition.of("audit.export-max", Type.INTEGER)
                        .group("감사 로그")
                        .label("CSV 내보내기 최대 행 수")
                        .help("기간을 넓게 잡은 요청 하나가 메모리를 다 쓰는 것을 막는다. "
                                + "넘치면 거기서 끊고 마지막 줄에 잘렸다는 사실을 적는다 — "
                                + "조용히 끊으면 그것이 전부인 줄 알고 보고서를 쓰게 된다.")
                        .build(),
                p -> String.valueOf(p.getAudit().getExportMax()),
                (p, v) -> p.getAudit().setExportMax(Integer.parseInt(v)));

        add(SettingDefinition.of("rate-limit.storage", Type.ENUM)
                        .group("보안")
                        .label("속도 제한 카운터 저장 위치")
                        .help("인스턴스 메모리는 인스턴스별로 세므로 2대를 띄우면 실질 한도가 "
                                + "2배가 된다. 공용 DB 로 두면 한 곳에서 센다.")
                        .options(new Option("MEMORY", "인스턴스 메모리 — 빠르다 (기본)"),
                                new Option("DATABASE", "공용 DB — 인스턴스가 여럿일 때"))
                        .warning("DB 로 두면 로그인 요청마다 DB 왕복이 하나 더 붙는다. "
                                + "정확한 쿼터가 목적이 아니라 무차별 대입 속도를 막는 것이므로, "
                                + "인스턴스가 하나라면 바꿀 이유가 없다.")
                        .build(),
                p -> p.getRateLimit().getStorage().name(),
                (p, v) -> p.getRateLimit().setStorage(IxAuthProperties.RateLimit.Storage
                        .valueOf(v.trim().toUpperCase(java.util.Locale.ROOT))));

        add(SettingDefinition.of("jwt.key-rotation-days", Type.INTEGER)
                        .group("토큰·세션")
                        .label("서명 키 회전 주기 (일)")
                        .help("현재 키가 이 일수를 넘으면 매일 새벽 배치가 새 키를 발급한다. "
                                + "0 이면 회전하지 않는다. 구 키는 즉시 버리지 않고 JWKS 에 "
                                + "남겨 두었다가, 그 키로 서명된 토큰이 모두 만료된 뒤 내린다.")
                        .warning("ixauth.jwt.private-key 로 키를 직접 주입한 설치에서는 회전하지 "
                                + "않는다 — 주입한 쪽의 의도가 '이 키를 쓴다' 이기 때문이다.")
                        .build(),
                p -> String.valueOf(p.getJwt().getKeyRotationDays()),
                (p, v) -> p.getJwt().setKeyRotationDays(Integer.parseInt(v)));
    }

    private void add(SettingDefinition def,
                     Function<IxAuthProperties, String> reader,
                     BiConsumer<IxAuthProperties, String> applier) {
        bindings.put(def.key(), new SettingBinding(def, reader, applier));
    }

    public List<SettingBinding> all() {
        return List.copyOf(bindings.values());
    }

    public SettingBinding find(String key) {
        return bindings.get(key);
    }

    public boolean contains(String key) {
        return bindings.containsKey(key);
    }

    /** 화면이 그리는 순서대로 그룹을 돌려준다 */
    public List<String> groups() {
        var out = new ArrayList<String>();
        bindings.values().forEach(b -> {
            if (!out.contains(b.definition().group())) {
                out.add(b.definition().group());
            }
        });
        return out;
    }

    private static List<String> splitList(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        return java.util.Arrays.stream(raw.split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    /** `30m` · `2h` · `7d` 를 받는다. 화면에 PT30M 을 적게 하지 않기 위해서다 */
    static Duration parseDuration(String raw) {
        String v = raw == null ? "" : raw.trim().toLowerCase(java.util.Locale.ROOT);
        if (v.isEmpty()) {
            throw new IllegalArgumentException("기간이 비었습니다");
        }
        if (v.startsWith("p")) {
            return Duration.parse(v.toUpperCase(java.util.Locale.ROOT));
        }
        char unit = v.charAt(v.length() - 1);
        long n = Long.parseLong(v.substring(0, v.length() - 1).trim());
        return switch (unit) {
            case 's' -> Duration.ofSeconds(n);
            case 'm' -> Duration.ofMinutes(n);
            case 'h' -> Duration.ofHours(n);
            case 'd' -> Duration.ofDays(n);
            default -> throw new IllegalArgumentException(
                    "기간 형식이 올바르지 않습니다 (예: 30m, 2h, 7d): " + raw);
        };
    }

    // ══════════════════ 로그인 수단 4종 (2026-08-08 추가) ══════════════════

    /**
     * 매직 링크 로그인.
     *
     * <p>Google 로그인은 여기에 없다. 다른 provider 3종과 마찬가지로 키가 시크릿이라
     * 켜고 끄는 것을 환경변수로만 받는다 ({@code IXAUTH_SOCIAL_GOOGLE_*}).</p>
     */
    private void defineMagicLink() {

        add(SettingDefinition.of("account.magic-link-enabled", Type.BOOLEAN)
                        .group("로그인 수단")
                        .label("메일 링크로 로그인 (매직 링크)")
                        .help("비밀번호 없이 메일로 받은 링크를 눌러 로그인한다. "
                                + "계정이 없는 주소로 요청해도 같은 응답을 주므로 "
                                + "가입자 명부가 새지 않는다.")
                        .warning("켜는 순간 메일함이 곧 로그인 수단이 된다 — 비밀번호를 아무리 "
                                + "길게 걸어 두어도 그 계정의 보안은 메일함의 보안을 넘지 못한다. "
                                + "2단계 인증을 켠 계정은 이 경로로도 코드를 한 번 더 받는다.")
                        .build(),
                p -> String.valueOf(p.getAccount().isMagicLinkEnabled()),
                (p, v) -> p.getAccount().setMagicLinkEnabled(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("account.magic-link-token-ttl", Type.DURATION)
                        .group("로그인 수단")
                        .label("로그인 링크 수명")
                        .help("링크 자체가 로그인이라 재설정 링크(30분)보다 짧게 잡는다. "
                                + "메일을 열어 누르는 데 걸리는 시간이면 충분하다.")
                        .warning("길게 잡을수록 메일함이 유출됐을 때 남이 그대로 로그인할 수 있는 "
                                + "시간이 길어진다. 재설정 링크와 달리 흔적도 남지 않는다.")
                        .shownWhen("account.magic-link-enabled", "true")
                        .build(),
                p -> p.getAccount().getMagicLinkTokenTtl().toString(),
                (p, v) -> p.getAccount().setMagicLinkTokenTtl(parseDuration(v)));

        add(SettingDefinition.of("mail.magic-link-path", Type.STRING)
                        .group("로그인 수단")
                        .label("앱의 로그인 링크 화면 경로")
                        .help("앱이 이 경로에 화면을 두고 token 을 받아 "
                                + "POST /auth/magic-link/verify 로 중계한다.")
                        .shownWhen("account.magic-link-enabled", "true")
                        .build(),
                p -> p.getMail().getMagicLinkPath(),
                (p, v) -> p.getMail().setMagicLinkPath(v.trim()));
    }

    /**
     * CAPTCHA.
     *
     * <p>{@code captcha.secret-key} 는 <b>의도적으로 없다.</b> 시크릿을 화면에서 편집
     * 가능하게 만들면 DB·감사로그·백업으로 유출면이 넓어진다 (규칙 3).
     * 환경변수 {@code IXAUTH_CAPTCHA_SECRET_KEY} 로 넣는다.</p>
     */
    private void defineCaptcha() {

        add(SettingDefinition.of("captcha.enabled", Type.BOOLEAN)
                        .group("CAPTCHA")
                        .label("자동 가입 방지 확인 사용")
                        .help("속도 제한은 한 IP 의 속도를 누르지만, 수천 IP 가 하나씩 던지는 "
                                + "방식은 어느 IP 도 한도를 넘지 않은 채 통과한다. "
                                + "그 빈틈을 메우는 것이 이쪽이다 — 대체가 아니라 보완이다.")
                        .warning("켜기 전에 앱이 요청 본문에 captchaToken 을 실어 보내도록 먼저 "
                                + "고쳐야 한다. 순서를 바꾸면 아래에서 고른 경로가 전부 400 이 된다. "
                                + "시크릿 키는 환경변수 IXAUTH_CAPTCHA_SECRET_KEY 로만 받는다.")
                        .build(),
                p -> String.valueOf(p.getCaptcha().isEnabled()),
                (p, v) -> p.getCaptcha().setEnabled(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("captcha.provider", Type.ENUM)
                        .group("CAPTCHA")
                        .label("CAPTCHA 제공자")
                        .help("reCAPTCHA v3 는 사용자에게 아무것도 묻지 않고 점수만 준다.")
                        .options(new Option("RECAPTCHA", "Google reCAPTCHA v3"),
                                new Option("NONE", "검증 안 함 — 연동을 잠시 떼어 둘 때"))
                        .warning("'검증 안 함' 은 켜 두어도 아무것도 막지 않는다. "
                                + "끄고 싶으면 위 스위치를 끄는 편이 오해가 없다.")
                        .shownWhen("captcha.enabled", "true")
                        .build(),
                p -> p.getCaptcha().getProvider().name(),
                (p, v) -> p.getCaptcha().setProvider(IxAuthProperties.Captcha.Provider
                        .valueOf(v.trim().toUpperCase(java.util.Locale.ROOT))));

        add(SettingDefinition.of("captcha.min-score", Type.STRING)
                        .group("CAPTCHA")
                        .label("통과로 볼 최소 점수 (0.0 ~ 1.0)")
                        .help("reCAPTCHA v3 는 통과·실패가 아니라 '얼마나 사람 같은가' 를 점수로 "
                                + "준다. 0.5 가 출발점이고 실제 값은 서비스마다 다르다 — "
                                + "높이면 사람이 걸리고, 낮추면 봇이 지나간다.")
                        .shownWhen("captcha.provider", "RECAPTCHA")
                        .build(),
                p -> String.valueOf(p.getCaptcha().getMinScore()),
                (p, v) -> p.getCaptcha().setMinScore(parseScore(v)));

        add(SettingDefinition.of("captcha.protect", Type.LIST)
                        .group("CAPTCHA")
                        .label("확인을 걸 경로")
                        .help("쉼표로 구분한다. SIGNUP(가입) · LOGIN(로그인) · "
                                + "PASSWORD_FORGOT(비밀번호 찾기·메일 로그인 링크 요청). "
                                + "비우면 켜도 아무 데도 걸리지 않는다.")
                        .warning("LOGIN 을 넣으면 확인에 실패했을 때 이미 쓰고 있는 사용자가 "
                                + "못 들어온다. 가입·비밀번호 찾기가 막히는 것과는 무게가 다르다 — "
                                + "그래서 기본에서 빠져 있다.")
                        .shownWhen("captcha.enabled", "true")
                        .build(),
                p -> joinEnums(p.getCaptcha().getProtect()),
                (p, v) -> p.getCaptcha().setProtect(
                        parseEnumList(IxAuthProperties.CaptchaAction.class, v)));
    }

    /** step-up 재인증 — 민감 작업에 2단계 코드를 한 번 더 요구한다 */
    private void defineStepUp() {

        add(SettingDefinition.of("mfa.step-up-actions", Type.LIST)
                        .group("2단계 인증")
                        .label("코드를 한 번 더 받을 민감 작업")
                        .help("쉼표로 구분한다. PASSWORD_CHANGE · EMAIL_CHANGE · "
                                + "ACCOUNT_DELETE · MFA_DISABLE. 비우면 요구하지 않는다. "
                                + "비밀번호는 한 번 새면 계속 새어 있는 값이라 '지금 이 사람이 "
                                + "본인인가' 를 증명하지 못한다 — 30초마다 바뀌는 코드는 증명한다.")
                        .warning("앱이 그 화면에서 mfaCode 를 받아 보내도록 먼저 고쳐야 한다. "
                                + "고치기 전에 켜면 그 화면들이 전부 실패한다. "
                                + "2단계를 켜지 않은 계정에는 적용되지 않는다 — 요구할 코드가 없다.")
                        .build(),
                p -> joinEnums(p.getMfa().getStepUpActions()),
                (p, v) -> p.getMfa().setStepUpActions(
                        parseEnumList(IxAuthProperties.StepUpAction.class, v)));
    }

    /** 사용자 대리 — 관리자가 특정 사용자로 전환한다 */
    private void defineImpersonation() {

        add(SettingDefinition.of("impersonation.enabled", Type.BOOLEAN)
                        .group("사용자 대리")
                        .label("관리자가 사용자로 전환할 수 있다")
                        .help("'저는 그 화면이 안 나와요' 를 그 사람 화면 그대로 재현하는 수단이다. "
                                + "끄면 남는 방법은 그 사람의 비밀번호를 초기화하고 로그인해 보는 "
                                + "것뿐인데, 그건 사용자를 실제로 쫓아내고 감사 로그에 본인 "
                                + "로그인으로 남는다 — 대리가 오히려 흔적이 정확하다.")
                        .warning("전용 권한 ixauth:impersonation:create 를 가진 역할만 쓸 수 있고, "
                                + "시작은 반드시 감사 로그(IMPERSONATION_STARTED)에 남는다 — "
                                + "이 기록은 끌 수 없다. 대리 세션으로는 관리 API·비밀번호 변경 "
                                + "같은 민감 작업을 할 수 없다.")
                        .build(),
                p -> String.valueOf(p.getImpersonation().isEnabled()),
                (p, v) -> p.getImpersonation().setEnabled(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("impersonation.ttl", Type.DURATION)
                        .group("사용자 대리")
                        .label("대리 세션 수명")
                        .help("대리로 받은 세션이 살아 있는 시간. 일반 로그인(기본 7일)보다 짧게 "
                                + "둔다 — 대리는 지금 이 문의를 보는 동안의 일이다. "
                                + "access token 수명(기본 15분)은 이것과 무관하다.")
                        .warning("길게 잡으면 관리자 브라우저에 남의 계정 열쇠가 그만큼 오래 "
                                + "남는다. 그 사이의 조작은 전부 그 사람 이름으로 기록된다.")
                        .build(),
                p -> p.getImpersonation().getTtl().toString(),
                (p, v) -> p.getImpersonation().setTtl(parseDuration(v)));
    }

    /**
     * 연합 신원 교환 — 앱이 이미 검증한 외부 신원을 받아 세션을 발급한다.
     *
     * <p>네 개를 전부 화면에 올리는 이유 — 이 기능의 위험은 "켰는가" 가 아니라
     * <b>"무엇을 받고 무엇을 만드는가"</b> 에 있다. 켜는 스위치만 화면에 두고
     * 나머지를 yml 로 밀어 두면, 운영자는 자기가 켠 것이 어디까지 허용하는지 모른 채
     * 켜게 된다.</p>
     */
    private void defineFederation() {

        add(SettingDefinition.of("federation.enabled", Type.BOOLEAN)
                        .group("연합 신원")
                        .label("외부에서 확인한 신원으로 로그인")
                        .help("앱이 외부 IdP(예: 넥서스허브)에서 확인한 사용자를 서비스 키로 "
                                + "제출하면, IX-Auth 가 그 사람을 계정에 잇고 토큰을 발급한다. "
                                + "IX-Auth 가 외부와 직접 통신하지는 않는다 — 확인은 앱이 한다.")
                        .warning("이 경로의 신뢰 근거는 서비스 키 하나뿐이다. 키를 쥔 쪽은 "
                                + "아무 사람이나 주장할 수 있고, 2단계 인증도 건너뛴다 "
                                + "— 외부 IdP 가 이미 본인확인을 마쳤다는 전제이기 때문이다. "
                                + "켜기 전에 아래 허용 목록을 먼저 채운다.")
                        .build(),
                p -> String.valueOf(p.getFederation().isEnabled()),
                (p, v) -> p.getFederation().setEnabled(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("federation.allowed-providers", Type.LIST)
                        .group("연합 신원")
                        .label("받아들일 provider")
                        .help("쉼표로 구분한다 (예: nexus-hub). 대소문자는 가리지 않는다. "
                                + "비우면 켜져 있어도 전부 거부한다 — '켜면 다 받는다' 로 두면 "
                                + "앱 하나를 붙이려고 켠 스위치가 이름만 바꿔 오는 모든 요청을 "
                                + "통과시키게 된다.")
                        .shownWhen("federation.enabled", "true")
                        .build(),
                p -> String.join(", ", p.getFederation().getAllowedProviders()),
                (p, v) -> p.getFederation().setAllowedProviders(splitList(v)));

        add(SettingDefinition.of("federation.link-by-email", Type.BOOLEAN)
                        .group("연합 신원")
                        .label("같은 이메일이면 기존 계정에 연결")
                        .help("처음 보는 외부 신원인데 같은 주소의 계정이 이미 있을 때 그 계정에 "
                                + "붙인다. 끄면 409 로 돌려주고 관리자가 손으로 연결해야 한다.")
                        .warning("소셜 로그인과 달리 provider 의 이메일 검증 신호를 보지 않는다 "
                                + "— 여기서는 앱이 이미 신원을 확인했다는 것이 전제다. "
                                + "그 전제가 약한 provider 를 받는다면 끄는 쪽이 맞다.")
                        .shownWhen("federation.enabled", "true")
                        .build(),
                p -> String.valueOf(p.getFederation().isLinkByEmail()),
                (p, v) -> p.getFederation().setLinkByEmail(Boolean.parseBoolean(v)));

        add(SettingDefinition.of("federation.auto-provision", Type.BOOLEAN)
                        .group("연합 신원")
                        .label("처음 보는 사람의 계정을 자동 생성")
                        .help("연결된 계정도, 같은 주소의 계정도 없을 때 계정을 새로 만든다"
                                + "(비밀번호 없음 · 이메일 인증됨 · 기본 역할). "
                                + "끄면 미리 등록된 사람만 들어온다(404).")
                        .warning("켜면 그 provider 에 계정을 가진 누구나 여기에도 계정이 생긴다. "
                                + "사내 시스템을 초대제로 운영한다면 끈다.")
                        .shownWhen("federation.enabled", "true")
                        .build(),
                p -> String.valueOf(p.getFederation().isAutoProvision()),
                (p, v) -> p.getFederation().setAutoProvision(Boolean.parseBoolean(v)));
    }

    /**
     * 0.0~1.0 의 실수 하나.
     *
     * <p>{@code Type.DOUBLE} 을 만들지 않은 이유 — 타입을 늘리면 관리 화면과 저장 계층이
     * 함께 따라와야 하고, 실수 설정은 지금 이것 하나다. 대신 범위를 여기서 막아
     * "저장은 됐는데 아무것도 통과하지 않는" 상태를 만들지 않는다.</p>
     */
    private static double parseScore(String raw) {
        double value;
        try {
            value = Double.parseDouble(raw == null ? "" : raw.trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("점수 형식이 올바르지 않습니다 (예: 0.5): " + raw);
        }
        if (value < 0 || value > 1) {
            throw new IllegalArgumentException("점수는 0.0 과 1.0 사이여야 합니다: " + raw);
        }
        return value;
    }

    /**
     * 쉼표 목록을 enum 목록으로.
     *
     * <p>모르는 값이 오면 예외다 — 조용히 버리면 오타 하나가 "설정했는데 안 걸린다" 가
     * 되고, 그건 보안 설정에서 가장 나쁜 실패다. {@code SettingsService} 가 적용해 본 뒤
     * 저장하므로 잘못된 값은 DB 에 남지 않는다.</p>
     */
    private static <E extends Enum<E>> List<E> parseEnumList(Class<E> type, String raw) {
        return splitList(raw).stream()
                .map(v -> Enum.valueOf(type, v.toUpperCase(java.util.Locale.ROOT)))
                .toList();
    }

    private static String joinEnums(List<? extends Enum<?>> values) {
        if (values == null || values.isEmpty()) {
            return "";
        }
        return String.join(", ", values.stream().map(Enum::name).toList());
    }
}
