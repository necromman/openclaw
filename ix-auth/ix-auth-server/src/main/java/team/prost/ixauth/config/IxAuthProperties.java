package team.prost.ixauth.config;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;
import java.util.List;
import java.util.Locale;

/**
 * IX-Auth 전체 설정. 정본은 docs/contract/config.md.
 *
 * <p>모든 설정을 여기 한 곳에 모은다 — {@code @Value} 산발 금지
 * (.claude/rules/coding-style.md).</p>
 */
@ConfigurationProperties(prefix = "ixauth")
@Validated
@Getter
@Setter
public class IxAuthProperties {

    /** standalone | federated | hybrid */
    private Mode mode = Mode.STANDALONE;

    /** 앱→jar 공유 시크릿. 32자 이상 강제 — 짧으면 부팅을 거부한다 */
    @NotBlank
    @Size(min = 32, message = "ixauth.service-key 는 32자 이상이어야 합니다")
    private String serviceKey;

    private Db db = new Db();
    private Jwt jwt = new Jwt();
    private Admin admin = new Admin();
    private Password password = new Password();
    private Lockout lockout = new Lockout();
    private Authz authz = new Authz();
    private AdminUi adminUi = new AdminUi();
    private RateLimit rateLimit = new RateLimit();
    private Audit audit = new Audit();
    private Mail mail = new Mail();
    private Account account = new Account();
    private Social social = new Social();
    private Mfa mfa = new Mfa();
    private Terms terms = new Terms();
    private Captcha captcha = new Captcha();
    private Impersonation impersonation = new Impersonation();
    private Federation federation = new Federation();

    public enum Mode { STANDALONE, FEDERATED, HYBRID }

    @Getter
    @Setter
    public static class Db {
        private String schema = "ixauth";
        /** 개발용 H2. 운영에서 true 면 부팅을 거부한다 */
        private boolean embedded = false;
    }

    @Getter
    @Setter
    public static class Jwt {
        /** RS256 기본 — 검증 주체가 우리가 통제하지 않는 앱이라 호환성을 우선한다 */
        private String algorithm = "RS256";
        @NotBlank
        private String issuer;
        /** 미설정 시 issuer 를 쓴다 */
        private String audience = "";
        /**
         * 짧게 유지한다. 앱이 로컬 검증하므로 발급된 토큰은 만료 전까지 무효화할 수
         * 없고, 그 대가를 수명으로 상쇄한다 (docs/contract/token.md §1).
         */
        private Duration accessTtl = Duration.ofMinutes(15);
        private Duration refreshTtl = Duration.ofDays(7);
        /** PEM/Base64 PKCS#8 직접 주입. 미설정 시 최초 부팅에 생성 후 DB 보관 */
        private String privateKey = "";
        private int keyRotationDays = 90;
        private Duration clockSkew = Duration.ofSeconds(60);

        public String effectiveAudience() {
            return (audience == null || audience.isBlank()) ? issuer : audience;
        }
    }

    @Getter
    @Setter
    public static class Admin {
        @NotBlank
        private String email;
        @NotBlank
        private String password;
        private String name = "관리자";
    }

    @Getter
    @Setter
    public static class Password {
        private String encoder = "bcrypt";
        private int bcryptStrength = 10;
        private int minLength = 10;
        private boolean requireUppercase = true;
        private boolean requireDigit = true;
        private boolean requireSpecial = true;
        /**
         * 레거시 해시를 로그인 성공 시 현행 알고리즘으로 조용히 재해싱한다.
         * 개발 중 프로젝트가 IX-Auth 로 이사할 때(도입 케이스 B)의 핵심 장치.
         */
        private boolean rehashOnLogin = true;

        /**
         * 최근 몇 개의 비밀번호를 재사용 금지로 볼 것인가. {@code 0} = 검사하지 않는다.
         *
         * <p><b>0 이 기본이다.</b> 이력을 남기려면 지난 비밀번호의 해시를 계속 보관해야 하고,
         * 그건 보관하는 개인정보를 늘리는 일이다. 요구받지 않는 곳에서 켤 이유가 없다.
         * 0 이어도 <b>직전</b> 비밀번호는 언제나 막는다 — 그건 이력이 아니라 현재 값과의
         * 비교라 추가 보관이 필요 없다.</p>
         */
        private int historyCount;

        /**
         * 유출된 적이 있는 비밀번호를 거부한다 (Have I Been Pwned, k-익명성).
         *
         * <p><b>기본이 꺼짐인 이유는 외부 API 이기 때문이다.</b> 이 제품은 폐쇄망 설치를
         * 상정하고 있고, 거기서는 조회 자체가 되지 않는다. 켜더라도 조회 실패는
         * 가입·변경을 막지 않는다(fail-open) — 외부 서비스 장애로 로그인 시스템이
         * 멈추는 것이 약한 비밀번호 하나보다 훨씬 나쁘다.</p>
         */
        private boolean checkBreached;
    }

    @Getter
    @Setter
    public static class Lockout {
        private boolean enabled = true;
        private int maxAttempts = 5;
        private Duration duration = Duration.ofMinutes(15);
        /** 이 시간 동안 실패가 없으면 카운터를 초기화한다 */
        private Duration resetWindow = Duration.ofMinutes(30);
    }

    @Getter
    @Setter
    public static class Authz {
        private Duration permissionMapCache = Duration.ofHours(1);
        private Duration checkCacheTtl = Duration.ofSeconds(60);
        /**
         * jar 조회 실패 시 동작 — deny(fail-secure) | l1(L1 권한으로 폴백).
         * 기본이 deny 인 이유: 인증 서버가 답을 못 하는 상태에서 허용보다 차단이 안전하다.
         */
        private String fallbackOnUnavailable = "deny";
        private int batchCheckMax = 100;
        private int listResourcesMax = 1000;
    }

    @Getter
    @Setter
    public static class AdminUi {
        /** false 면 404 — 존재 자체를 숨긴다 */
        private boolean enabled = true;
        private String path = "/admin-ui";
        private Duration sessionTtl = Duration.ofHours(2);
    }

    @Getter
    @Setter
    public static class RateLimit {
        private boolean enabled = true;
        private int loginPerMinute = 10;
        private int refreshPerMinute = 60;
        private int defaultPerMinute = 600;

        /**
         * 카운터를 어디에 두는가.
         *
         * <p><b>기본이 메모리인 이유는 DB 왕복이 로그인 경로에 붙기 때문이다.</b>
         * 인스턴스가 하나면 메모리로 충분하고, 여럿이면 한도가 인스턴스 수만큼
         * 배수가 되므로 공용 DB 로 옮긴다.</p>
         *
         * <p>어느 쪽이든 <b>정확한 쿼터가 목적이 아니다.</b> 막으려는 것은 무차별 대입의
         * 속도이므로 창 경계에서 몇 건이 새는 것은 문제가 되지 않는다.</p>
         */
        private Storage storage = Storage.MEMORY;

        public enum Storage {
            /** 인스턴스 메모리 — 빠르지만 인스턴스별로 센다 */
            MEMORY,
            /** 공용 DB — 인스턴스가 여럿일 때 한 곳에서 센다 */
            DATABASE
        }
    }

    @Getter
    @Setter
    public static class Audit {
        private boolean enabled = true;
        private int retentionDays = 365;
        private boolean logFailedLogin = true;

        /**
         * CSV 내보내기 한 번의 최대 행 수.
         *
         * <p>상한이 없으면 기간을 넓게 잡은 요청 하나가 서버 메모리를 태운다.
         * 넘치면 거기서 끊고 <b>잘렸다는 사실을 마지막 줄에 적는다</b> — 조용히 끊으면
         * 받는 사람은 그것이 전부인 줄 알고 보고서를 쓴다.</p>
         */
        private int exportMax = 50_000;

        /**
         * 잘못된 연동 감지 - 감사 IP 가 방문자일 수 없는 주소면 시스템 로그에 경고한다.
         *
         * <p>앱이 경유지 주소를 넘기면 감사 로그가 그 경유지로 굳는데, 이 실수는 화면에
         * 아무 증상도 내지 않는다. 그래서 서버가 스스로 알아채 알린다
         * (판정은 {@code ClientIpGuard}, 고치는 법은 docs/guides/client-ip.md).</p>
         *
         * <p>기본값이 루프백을 넘기는 이유는 로컬 개발에서 방문자가 실제로 127.0.0.1
         * 이기 때문이다. 늘 켜져 있는 경고는 곧 아무도 읽지 않는다.</p>
         */
        private ClientIpGuardMode clientIpGuard = ClientIpGuardMode.WARN;

        public enum ClientIpGuardMode {
            /** 보지 않는다 */
            OFF,
            /** 사설망·링크로컬·CDN 엣지 대역이면 경고 (기본) */
            WARN,
            /** 루프백까지 경고 - 앱과 jar 가 다른 호스트인 운영에서 쓴다 */
            STRICT
        }
    }

    /**
     * 메일 발송 — 비밀번호 찾기·이메일 인증·초대에 쓴다.
     *
     * <p><b>왜 jar 가 직접 보내는가.</b> 이 제품의 출발점은 "프로젝트마다 로그인을
     * 다시 만들어야 한다" 는 것이었다. 발송을 앱에 떠넘기면 프로젝트마다 메일
     * 템플릿과 발송 코드를 또 만들게 되고, 페인포인트가 그대로 재발한다.
     * 그래서 SMTP 설정만 넣으면 바로 동작하는 것을 기본으로 둔다.</p>
     *
     * <p>다만 사내 메일 시스템을 쓰거나 폐쇄망이어서 SMTP 를 열 수 없는 곳도 있다.
     * 그때는 {@code WEBHOOK} 으로 앱에 넘긴다 — jar 는 링크를 만들어 건네주고,
     * 발송은 앱이 자기 방식대로 한다.</p>
     */
    @Getter
    @Setter
    public static class Mail {
        private Transport transport = Transport.LOG;

        /** 보내는 사람. 표시 이름을 함께 쓰려면 {@code IX-Auth <no-reply@example.com>} */
        private String from = "no-reply@localhost";

        /**
         * 메일 링크가 가리킬 <b>앱</b> 주소. jar 주소가 아니다 —
         * jar 는 외부에 노출되지 않는다 (설계 불변식 4).
         * 예: {@code https://myapp.example.com} → 링크는 {@code .../reset-password?token=…}
         */
        private String appBaseUrl = "";

        /** 앱의 각 화면 경로. 앱이 이 경로에 화면을 두고 토큰을 서버로 넘긴다 */
        private String resetPath = "/reset-password";
        private String verifyPath = "/verify-email";
        private String invitePath = "/accept-invite";
        /**
         * 매직 링크가 가리킬 앱 화면. 앱은 여기서 {@code token} 을 받아
         * {@code POST /auth/magic-link/verify} 로 중계한다.
         */
        private String magicLinkPath = "/magic-link";

        /** 제품명 — 메일 제목·본문에 쓴다 */
        private String productName = "IX-Auth";

        /**
         * 발송에 실패하면 다시 시도한다 (지수 백오프, 최대 3회).
         *
         * <p>재시도는 <b>발송 시점의 메시지를 메모리에 들고 있는 동안만</b> 된다.
         * 본문과 링크를 DB 에 저장하지 않기 때문이다 — 재설정 링크가 DB 에 남으면
         * 그것이 곧 계정 탈취 경로다. 프로세스가 내려가면 대기 중이던 재시도는
         * 사라지고 이력에는 실패로 남는다.</p>
         */
        private boolean retryEnabled = true;

        /** 발송 이력 보존 기간. {@code 0} 이면 무기한. 이력에는 받는 사람 주소가 들어 있다 */
        private int retentionDays = 30;

        /**
         * 사용자 {@code attributes.locale} 이 없을 때 쓸 언어.
         *
         * <p>기본 템플릿은 {@code ko}·{@code en} 두 벌이 코드에 있다. 그 밖의 언어는
         * 관리자가 템플릿을 넣어야 하고, 없으면 이 언어로 폴백한다.</p>
         */
        private String defaultLocale = "ko";

        private Smtp smtp = new Smtp();
        private Webhook webhook = new Webhook();

        public enum Transport {
            /** jar 가 SMTP 로 직접 보낸다 (기본 권장) */
            SMTP,
            /** 앱 엔드포인트로 넘긴다 — 사내 메일 시스템·폐쇄망 */
            WEBHOOK,
            /** 보내지 않고 링크를 로그에 남긴다. 개발용 — 운영에서 쓰면 경고한다 */
            LOG
        }

        @Getter
        @Setter
        public static class Smtp {
            private String host = "";
            private int port = 587;
            private String username = "";
            private String password = "";
            private boolean starttls = true;
            private boolean ssl = false;
            private Duration timeout = Duration.ofSeconds(10);
        }

        @Getter
        @Setter
        public static class Webhook {
            /** 앱의 수신 엔드포인트. jar 가 여기로 POST 한다 */
            private String url = "";
            /** 앱이 요청의 출처를 확인할 수 있게 서비스 키를 헤더로 보낸다 */
            private boolean sendServiceKey = true;
            private Duration timeout = Duration.ofSeconds(10);
        }
    }

    /** 가입 방식 — 고객사마다 다르므로 설정으로 고른다 */
    public enum SignupMode {
        /** 초대받은 사람만. 설치형 기본값 — 열어 두면 주소를 아는 누구나 계정을 만든다 */
        CLOSED,
        /** 누구나 가입하면 바로 쓴다 */
        OPEN,
        /** 가입은 받되 관리자가 승인해야 활성화된다 */
        APPROVAL
    }

    /** 가입 시 본인확인 수단 */
    public enum SignupVerification {
        /** 확인하지 않는다. 사내 폐쇄망처럼 이미 신원이 보장된 곳에서만 */
        NONE,
        /** 이메일 링크 확인 */
        EMAIL,
        /** 통신사 PASS 등 실명 확인 — 별도 연동이 필요하다 */
        PASS
    }

    /**
     * 소셜 로그인 — Microsoft · 카카오 · 네이버.
     *
     * <p><b>콜백은 앱이 받는다.</b> IX-Auth 는 외부에 노출되지 않으므로(불변식 4)
     * provider 가 브라우저를 IX-Auth 로 돌려보낼 수 없다. 앱이 {@code code} 를 받아
     * IX-Auth 로 중계하고, IX-Auth 가 토큰 교환·프로필 조회·계정 매칭을 한다.</p>
     */
    @Getter
    @Setter
    public static class Social {

        private boolean enabled = false;

        /**
         * 처음 보는 외부 계정을 <b>자동으로 만들지</b>.
         *
         * <p>기본은 끈다. 켜면 그 provider 계정을 가진 누구나 들어올 수 있다 —
         * 사내용 인스턴스에서는 초대받은 사람만 들어와야 한다.</p>
         */
        private boolean autoSignup = false;

        /**
         * 같은 이메일의 기존 계정에 <b>자동으로 연결할지</b>.
         *
         * <p>이것이 이 기능에서 가장 위험한 스위치다. provider 가 이메일을 실제로
         * 검증했는지 알 수 없는데 자동 연결하면, 남의 이메일을 자기 소셜 계정에
         * 적어 넣는 것만으로 그 계정을 가져갈 수 있다.</p>
         *
         * <p>그래서 <b>provider 가 "검증했다" 고 명시한 경우에만</b> 연결한다.
         * 네이버처럼 검증 여부를 주지 않는 곳은 이 값이 true 여도 연결하지 않는다
         * ({@link Provider#isTrustEmailVerified()} 로 provider 별로 다시 제한한다).</p>
         */
        private boolean autoLinkVerifiedEmail = true;

        /** state 수명 — 사용자가 provider 화면에서 머무는 시간을 감안한다 */
        private Duration stateTtl = Duration.ofMinutes(10);

        private Provider microsoft = new Provider();
        private Provider kakao = new Provider();
        private Provider naver = new Provider();

        /**
         * Google (OIDC).
         *
         * <p>{@code email_verified} 를 <b>규격으로</b> 주므로 검증 신호를 믿을 수 있고,
         * 같은 이메일의 기존 계정에 자동 연결된다. 다만 Google 계정은 누구나 만들 수
         * 있어 Microsoft 의 테넌트 같은 범위 제한이 없다 — 사내용이라면
         * {@code auto-signup} 을 끄거나 {@code account.signup-allowed-domains} 를 건다.</p>
         */
        private Provider google = new Provider();

        @Getter
        @Setter
        public static class Provider {
            private boolean enabled = false;
            private String clientId = "";
            /** 로그·응답에 절대 싣지 않는다 */
            private String clientSecret = "";
            /** Microsoft 전용 — {@code common} · {@code organizations} · 테넌트 ID */
            private String tenant = "common";
            /** 기본값 외의 스코프가 필요할 때만 */
            private String scope = "";

            /**
             * 이 provider 의 "이메일 검증됨" 신호를 믿을지.
             *
             * <p>Microsoft(조직 계정)·카카오는 검증 여부를 준다. 네이버는 주지 않으므로
             * 기본이 false 이고, 켜더라도 그 판단의 책임은 운영자에게 있다.</p>
             */
            private boolean trustEmailVerified = true;
        }
    }

    /**
     * 계정 라이프사이클 — 가입·초대·인증·재설정.
     *
     * <p>설치형 제품의 기본값은 "관리자가 계정을 만든다" 다. 자체 가입을 기본으로
     * 열어 두면 사내용으로 띄운 인스턴스에 외부인이 계정을 만들 수 있다.</p>
     */
    @Getter
    @Setter
    public static class Account {
        /**
         * 가입 방식.
         *
         * <p>고객사마다 다르다 — 사내 시스템은 초대만, 대외 서비스는 즉시 가입,
         * 심사가 필요한 곳은 승인제다. 그래서 코드가 아니라 설정으로 고른다
         * (.claude/rules/settings-driven.md).</p>
         *
         * <p><b>기본값이 OPEN 인 점에 주의한다.</b> 사내용으로 띄운다면 관리 화면에서
         * {@code CLOSED} 로 바꾸거나 가입 허용 도메인을 함께 건다 — 그러지 않으면
         * 주소를 아는 누구나 계정을 만들 수 있다.</p>
         */
        private SignupMode signupMode = SignupMode.OPEN;

        /** 가입 시 본인확인을 어디까지 요구하는가 */
        private SignupVerification signupVerification = SignupVerification.EMAIL;

        /**
         * @deprecated {@link #signupMode} 로 대체됐다. 기존 설정 파일과의 호환을 위해 남긴다 —
         *             {@code true} 면 부팅 시 {@code OPEN} 으로 승격한다
         */
        @Deprecated
        private Boolean signupEnabled;

        /** 가입 시 이메일 도메인 제한 (비우면 제한 없음). 예: prost.kr */
        private List<String> signupAllowedDomains = List.of();

        /**
         * 이메일 인증을 마쳐야 로그인할 수 있는가.
         *
         * <p>{@code true} 로 바꿀 때 주의 — 기존 계정은 V2 마이그레이션에서 인증된
         * 것으로 표시된다. 그렇지 않으면 켜는 순간 전원이 로그인하지 못한다.</p>
         */
        private boolean requireEmailVerification = false;

        /** 재설정 링크 수명. 길수록 메일함이 유출됐을 때의 창이 넓어진다 */
        private Duration resetTokenTtl = Duration.ofMinutes(30);
        private Duration verifyTokenTtl = Duration.ofDays(1);
        private Duration inviteTokenTtl = Duration.ofDays(7);

        /**
         * 비밀번호를 바꾸면 다른 세션을 전부 끊는다.
         *
         * <p>비밀번호 변경의 목적은 대개 "누가 내 계정을 쓰는 것 같다" 이다.
         * 세션을 남겨 두면 그 목적이 달성되지 않는다.</p>
         */
        private boolean revokeSessionsOnPasswordChange = true;

        /** 같은 계정에 재설정 메일을 다시 보내기까지의 최소 간격 */
        private Duration resendCooldown = Duration.ofMinutes(1);

        /**
         * 새 기기·새 IP 에서 로그인되면 본인에게 메일로 알린다.
         *
         * <p>기본이 켬인 것은 이 설정만 성격이 다르기 때문이다. 다른 기본값은 "닫아
         * 둔다" 가 안전한 쪽이지만, 알림은 <b>보내는 쪽</b>이 안전하다 — 계정을
         * 빼앗겼다는 사실을 사용자가 스스로 알아챌 수 있는 거의 유일한 통로다.</p>
         */
        private boolean notifyNewDevice = true;

        /**
         * 계정당 동시 활성 세션 상한. 초과하면 <b>가장 오래된 것부터</b> 폐기한다.
         *
         * <p><b>0(제한 없음)이 기본이다.</b> 여기서만 "가장 닫힌 값" 규칙을 따르지
         * 않는다 — 제한을 기본으로 걸면 PC·휴대폰·태블릿을 함께 쓰는 사람이 영문도
         * 모르고 로그아웃된다. 보안이 아니라 장애로 체감된다.</p>
         */
        private int maxConcurrentSessions;

        /**
         * 본인 탈퇴를 허용하는가.
         *
         * <p>기본은 사용 안 함이다. 대외 서비스는 개인정보 처리 요구사항 때문에 켜야
         * 하지만, 사내 시스템에서 직원이 자기 계정을 닫아 버리면 곤란하다.</p>
         */
        private SelfDeleteMode selfDeleteMode = SelfDeleteMode.DISABLED;

        /**
         * {@link SelfDeleteMode#GRACE} 의 유예 기간.
         *
         * <p>이 사이에 로그인하면 탈퇴가 취소된다. 홧김에 누른 경우를 되돌릴 수
         * 있어야 하고, 그것이 유예를 두는 유일한 이유다.</p>
         */
        private Duration selfDeleteGrace = Duration.ofDays(7);

        /**
         * {@code users.attributes} 에 <b>정의에 없는 키</b>가 오면 거부한다.
         *
         * <p>기본이 꺼짐이다. 켜는 쪽이 더 닫힌 값이지만, 이 설정은 <b>이미 저장된
         * 데이터를 소급해서 불법으로 만든다.</b> 정의 기능이 없던 시절에 앱이 자유롭게
         * 넣어 둔 키가 그대로 남아 있고, 켜는 순간 그 사용자를 수정하는 요청이 전부
         * 400 이 된다. 먼저 쓰이는 키를 정의에 등록한 뒤 켜는 순서여야 한다.</p>
         */
        private boolean strictAttributes;

        /**
         * {@code POST /admin/users/bulk} 가 한 번에 받는 최대 행 수.
         *
         * <p>상한이 없으면 요청 하나로 서버를 세울 수 있다. 초과분을 잘라 처리하지 않고
         * 요청 전체를 거절한다 — 일부만 들어간 것을 관리자가 알아채기 어렵다.</p>
         */
        private int bulkImportMax = 500;

        /**
         * 비밀번호 없이 메일 링크로 로그인한다 (매직 링크).
         *
         * <p><b>기본은 꺼짐이다.</b> 켜는 순간 <b>메일함이 곧 로그인 수단</b>이 된다 —
         * 비밀번호를 아무리 길게 걸어 두어도 메일함을 쥔 쪽이 들어올 수 있다.
         * 사내 메일이 이미 SSO 뒤에 있는 곳에서는 합리적인 선택이지만, 그 판단은
         * 운영자가 해야 한다.</p>
         *
         * <p>2단계 인증이 켜진 계정은 이 경로로도 <b>코드를 한 번 더 받는다</b> —
         * 그러지 않으면 메일 한 통으로 2단계가 통째로 우회된다.</p>
         */
        private boolean magicLinkEnabled;

        /**
         * 매직 링크 수명. <b>재설정 링크보다 짧게</b> 잡는다(기본 10분).
         *
         * <p>재설정 링크는 손에 넣어도 새 비밀번호를 정해야 하고 그 순간 본인에게
         * 변경 알림이 나가지만, 매직 링크는 <b>그 자체가 로그인</b>이라 유출되면
         * 아무 흔적 없이 들어온다. 수명이 곧 노출 창이다.</p>
         */
        private Duration magicLinkTokenTtl = Duration.ofMinutes(10);
    }

    /**
     * 약관 동의 — 이용약관·개인정보처리방침·마케팅 수신.
     *
     * <p>대외 서비스에는 사실상 필수이고, 사내 인스턴스에는 받을 약관 자체가 없다.
     * 그 둘을 같은 jar 하나로 덮으려면 기능 전체가 스위치여야 한다
     * (.claude/rules/settings-driven.md).</p>
     */
    @Getter
    @Setter
    public static class Terms {

        /**
         * 약관 기능을 쓰는가. 끄면 조회·동의 API 가 빈 결과를 주고 재동의 신호도 나가지 않는다.
         *
         * <p>꺼도 <b>등록해 둔 약관과 동의 이력은 지우지 않는다.</b> 기능을 잠시 껐다고
         * 법적 증빙이 사라지면 안 된다.</p>
         */
        private boolean enabled;

        /** 가입 요청에 필수 약관 동의가 없으면 거부한다 */
        private boolean requireOnSignup = true;

        /**
         * 필수 약관이 새 버전으로 게시되면 다시 받는다.
         *
         * <p><b>로그인을 막지 않는다.</b> 막으면 새 버전을 게시하는 순간 전원이 못
         * 들어온다. 대신 로그인 응답에 {@code termsAgreementRequired} 로 코드 목록을
         * 실어 보내고, 앱이 그 신호를 받아 동의 화면으로 보낸다 — 2단계 인증의
         * {@code mfaSetupRequired} 와 같은 방식이다.</p>
         */
        private boolean reagreementRequired = true;
    }

    /** 본인 탈퇴 처리 방식 — 고객사마다 다르므로 설정으로 고른다 */
    public enum SelfDeleteMode {
        /** 본인 탈퇴 없음. 관리자만 계정을 닫는다 */
        DISABLED,
        /** 요청 즉시 비활성. 되돌릴 수 없다 */
        IMMEDIATE,
        /** 유예 후 비활성. 그 사이 로그인하면 취소된다 */
        GRACE
    }

    /** 2단계 인증을 누구에게 요구하는가 — 고객사마다 다르므로 설정으로 고른다 */
    public enum MfaMode {
        /** 사용자가 스스로 켠다. 기본값 */
        OPTIONAL,
        /** 관리 권한(ixauth:*)을 가진 사람은 필수 */
        REQUIRED_ADMIN,
        /** 전원 필수 */
        REQUIRED_ALL
    }

    /**
     * 2단계 인증(TOTP) — 인증 앱의 6자리 코드.
     *
     * <p>알고리즘 파라미터(SHA1·30초·6자리)는 여기에 없다. 고객사마다 다를 수 있는
     * 정책이 아니라 인증 앱과 맞아야 하는 규격이고, 바꾸면 대부분의 앱이 코드를
     * 만들지 못한다 (.claude/rules/settings-driven.md — 알고리즘은 정책이 아니다).</p>
     */
    @Getter
    @Setter
    public static class Mfa {

        private MfaMode mode = MfaMode.OPTIONAL;

        /**
         * 등록 시 함께 발급할 백업 코드 수.
         *
         * <p>TOTP 만 켜면 휴대폰 분실이 곧 계정 상실이다. 관리자 한 명뿐인 설치라면
         * 아무도 들어갈 수 없는 상태가 된다.</p>
         */
        private int backupCodeCount = 10;

        /** 인증 앱 목록에 표시될 이름. 비우면 {@code mail.product-name} 을 쓴다 */
        private String issuer = "";

        /**
         * 비밀번호 통과 후 코드를 넣기까지 허용할 시간.
         *
         * <p>이 사이의 challenge 는 "비밀번호는 이미 맞았다" 는 증표라서, 길게 두면
         * 그만큼 반쪽짜리 자격증명이 살아 있는 셈이 된다.</p>
         */
        private Duration challengeTtl = Duration.ofMinutes(5);

        /**
         * TOTP 시크릿 암호화 키 — <b>시크릿이므로 환경변수로만 받는다</b>
         * ({@code IXAUTH_MFA_ENCRYPTION_KEY}). 관리 화면에 노출하지 않는다.
         *
         * <p>비우면 {@code ixauth.service-key} 에서 파생한다. 그 경우
         * <b>service-key 를 바꾸면 등록된 TOTP 가 전부 무효</b>가 되므로, 운영에서는
         * 별도로 준다.</p>
         */
        private String encryptionKey = "";

        /**
         * 관리자가 남의 2단계를 초기화할 수 있는가.
         *
         * <p>기본이 켬이다. 끄는 쪽이 더 닫힌 값이지만, 끄면 휴대폰과 백업 코드를
         * 모두 잃은 사람의 복구 경로가 <b>DB 직접 수정</b>밖에 남지 않는다 — 그쪽은
         * 감사 로그도 알림도 없어 오히려 위험하다. 실제 통제는 이 스위치가 아니라
         * 초기화에 항상 따라붙는 감사 기록과 본인 통지다(끌 수 없다).</p>
         */
        private boolean adminReset = true;

        /**
         * 민감 작업에 <b>TOTP 코드를 한 번 더</b> 요구할 목록 (step-up 인증).
         *
         * <p>지금도 비밀번호 변경·이메일 변경·탈퇴는 현재 비밀번호를 요구한다. 그런데
         * 비밀번호는 <b>한 번 새면 계속 새어 있는</b> 값이라, 그것만으로는 "지금 이
         * 사람이 본인인가" 를 증명하지 못한다. TOTP 코드는 30초마다 바뀌므로 그 질문에
         * 답할 수 있다.</p>
         *
         * <p><b>기본은 비어 있다(요구하지 않음).</b> 2단계를 켜 둔 사용자에게 코드를 더
         * 받는 것이라 잠기는 사람은 없지만, 앱이 {@code mfaCode} 를 보내도록 고치기
         * 전에는 그 화면들이 전부 실패한다. 앱을 먼저 고치고 켜는 순서여야 한다.</p>
         *
         * <p>2단계를 켜지 않은 계정에는 적용되지 않는다 — 요구할 코드 자체가 없다.
         * 그 계정을 막아 봐야 비밀번호를 바꿀 수 없게 될 뿐이다.</p>
         */
        private List<StepUpAction> stepUpActions = List.of();
    }

    /** step-up 인증을 요구할 작업 — 고객사마다 민감도 판단이 다르므로 설정으로 고른다 */
    public enum StepUpAction {
        PASSWORD_CHANGE,
        EMAIL_CHANGE,
        ACCOUNT_DELETE,
        /** 2단계 해제 — <b>여기가 가장 중요하다.</b> 이걸 막지 못하면 나머지도 무의미하다 */
        MFA_DISABLE
    }

    /**
     * 사용자 대리(impersonation) — 관리자가 특정 사용자로 전환한다.
     *
     * <p>"화면이 안 나온다" 는 문의를 재현하는 데 이보다 확실한 수단이 없다. 대안은
     * 관리자가 그 사람의 비밀번호를 초기화하고 로그인해 보는 것인데, 그건 사용자를
     * 실제로 쫓아내고 감사 로그에 <b>본인 로그인</b>으로 남는다 — 대리가 오히려
     * 흔적이 정확한 길이다.</p>
     */
    @Getter
    @Setter
    public static class Impersonation {

        /**
         * 기본은 켬.
         *
         * <p>끄는 쪽이 더 닫힌 값이지만, 끄면 남는 재현 수단이 위의 비밀번호 초기화뿐이라
         * 오히려 흔적이 흐려진다. 실제 통제는 이 스위치가 아니라 <b>전용 권한 코드
         * {@code ixauth:impersonation:create} 와 끌 수 없는 감사 기록</b>이다.</p>
         */
        private boolean enabled = true;

        /**
         * 대리 세션의 수명 — 일반 로그인({@code jwt.refresh-ttl}, 기본 7일)보다 짧게 둔다.
         *
         * <p>대리는 <b>지금 이 문의를 보는 동안</b>의 일이다. 7일을 주면 관리자 브라우저에
         * 남의 계정으로 들어가는 열쇠가 일주일 동안 남아 있게 되고, 그 사이의 조작은
         * 전부 그 사람 이름으로 기록된다.</p>
         *
         * <p>access token 수명은 건드리지 않는다({@code jwt.access-ttl}, 기본 15분) —
         * 그건 서명 갱신 주기이지 세션 수명이 아니다.</p>
         */
        private Duration ttl = Duration.ofHours(1);
    }

    /**
     * 연합 신원 교환 — 앱이 <b>이미 검증한</b> 외부 신원을 서비스 키로 제출하면
     * 사용자를 연결하거나 만들고 세션을 발급한다.
     *
     * <p><b>IX-Auth 가 OIDC IdP 가 되는 것이 아니다.</b> jar 는 외부 provider 와 직접
     * 토큰을 교환하지 않고 브라우저를 받지도 않는다(설계 불변식 1·4). 신원을 확인하는
     * 주체는 앱이고, 여기서 하는 일은 그 결과를 계정에 잇는 것뿐이다 — README 의
     * {@code ixauth.mode=federated} 로 가는 첫 단계다.</p>
     *
     * <p><b>이 기능의 신뢰 근거는 서비스 키 하나뿐이다.</b> 앱이 "이 사람은 홍길동이다"
     * 라고 말하면 jar 는 그대로 믿는다. 그래서 기본은 꺼짐이고, 켜더라도
     * {@link #allowedProviders} 가 비어 있으면 아무것도 통과하지 못한다 —
     * 켜는 것과 무엇을 받을지는 따로 정하게 한다.</p>
     */
    @Getter
    @Setter
    public static class Federation {

        /** 기본은 꺼짐. 서비스 키를 쥔 쪽이 아무 신원이나 주장할 수 있는 경로다 */
        private boolean enabled;

        /**
         * 받아들일 provider 이름 목록 (예: {@code nexus-hub}). 대소문자를 가리지 않는다.
         *
         * <p><b>비어 있으면 전부 거부한다.</b> "켜면 다 받는다" 로 두면 앱 하나를 붙이려고
         * 켠 스위치가 이름만 바꿔 오는 모든 요청을 통과시키게 된다.</p>
         */
        private List<String> allowedProviders = List.of();

        /**
         * 처음 보는 외부 신원인데 같은 이메일의 계정이 이미 있으면 그 계정에 연결한다.
         *
         * <p>소셜 로그인({@code social.auto-link-verified-email})과 달리 provider 의
         * 이메일 검증 신호를 보지 않는다 — 여기서는 <b>앱이 이미 신원을 확인했다</b> 는
         * 것이 전제이기 때문이다. 그 전제가 약한 provider 를 받는다면 이 값을 끄고,
         * 연결은 관리자가 손으로 한다(그러면 409 로 돌려준다).</p>
         */
        private boolean linkByEmail = true;

        /**
         * 처음 보는 외부 신원이고 같은 이메일의 계정도 없으면 계정을 새로 만든다(JIT).
         *
         * <p>끄면 미리 등록된 사람만 들어온다(404). 사내 시스템을 초대제로 운영한다면
         * 끄는 쪽이 맞다.</p>
         */
        private boolean autoProvision = true;

        /** 허용 목록에 있는 provider 인가 — 앞뒤 공백과 대소문자를 무시한다 */
        public boolean allows(String provider) {
            if (provider == null || provider.isBlank()) {
                return false;
            }
            String want = normalizeProvider(provider);
            return allowedProviders.stream()
                    .filter(p -> p != null && !p.isBlank())
                    .map(Federation::normalizeProvider)
                    .anyMatch(want::equals);
        }

        /** 저장·비교에 쓰는 표준형. 목록에 {@code Nexus-Hub} 로 적어도 같은 것으로 본다 */
        public static String normalizeProvider(String provider) {
            return provider == null ? "" : provider.trim().toLowerCase(Locale.ROOT);
        }
    }

    /**
     * CAPTCHA — 사람인지 확인한다.
     *
     * <p><b>속도 제한과 다른 것을 막는다.</b> 속도 제한은 한 IP 의 속도를 누르지만,
     * 봇넷처럼 수천 IP 가 하나씩 던지는 방식은 어느 IP 도 한도를 넘지 않은 채 통과한다.
     * 그 차이를 메우는 것이 이쪽이다 — 대체가 아니라 보완이다.</p>
     *
     * <p><b>검증 실패는 거부, provider 미도달은 통과.</b> 이 비대칭이 이 기능의 핵심
     * 결정이고, 근거는 {@code captcha/CaptchaGuard} 에 적어 두었다.</p>
     */
    @Getter
    @Setter
    public static class Captcha {

        /**
         * 기본은 꺼짐. 켜려면 앱이 요청 본문에 {@code captchaToken} 을 실어 보내도록
         * 먼저 고쳐야 한다 — 순서를 바꾸면 그 경로가 전부 400 이 된다.
         */
        private boolean enabled;

        /** 어느 서비스를 쓰는가. 구현이 없는 값을 고르면 아무것도 검증되지 않는다 */
        private Provider provider = Provider.RECAPTCHA;

        /**
         * 검증용 시크릿 — <b>환경변수로만</b> 받는다 ({@code IXAUTH_CAPTCHA_SECRET_KEY}).
         * 관리 화면에 노출하지 않는다 (.claude/rules/settings-driven.md 규칙 3).
         *
         * <p>비어 있으면 켜져 있어도 검증하지 못한다. 그 경우 <b>통과시키고 WARN</b> 을
         * 남긴다 — 설정 실수로 가입이 통째로 막히는 쪽이 더 나쁘다.</p>
         */
        private String secretKey = "";

        /**
         * reCAPTCHA v3 의 점수 하한 (0.0~1.0). 이보다 낮으면 봇으로 본다.
         *
         * <p>v3 는 통과/실패가 아니라 <b>점수</b>를 준다. 0.5 는 Google 이 권하는
         * 출발점이고, 실제 값은 서비스마다 다르므로 운영하면서 조정한다 —
         * 높이면 사람이 걸리고, 낮추면 봇이 지나간다.</p>
         */
        private double minScore = 0.5;

        /**
         * 어느 경로에 걸 것인가.
         *
         * <p>기본에 {@code LOGIN} 이 <b>빠져 있다.</b> 가입·비밀번호 찾기는 막혀도
         * 새 사용자만 불편하지만, 로그인이 막히면 <b>이미 쓰고 있는 전원</b>이 못
         * 들어온다. 외부 스크립트 하나에 의존하는 지점을 로그인 경로에 두는 것은
         * 그만큼 무거운 결정이라 운영자가 명시적으로 골라야 한다.</p>
         */
        private List<CaptchaAction> protect = List.of(CaptchaAction.SIGNUP,
                CaptchaAction.PASSWORD_FORGOT);

        public enum Provider {
            /** Google reCAPTCHA v3 — 점수 기반, 사용자에게 아무것도 묻지 않는다 */
            RECAPTCHA,
            /** 검증하지 않는다. 연동을 잠시 떼어 둘 때 쓴다 */
            NONE
        }
    }

    /** CAPTCHA 를 걸 수 있는 경로 */
    public enum CaptchaAction {
        SIGNUP,
        LOGIN,
        PASSWORD_FORGOT
    }
}
