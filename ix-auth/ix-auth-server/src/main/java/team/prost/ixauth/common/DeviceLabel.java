package team.prost.ixauth.common;

import java.util.Locale;

/**
 * User-Agent 원문을 사람이 알아보는 한 줄로 줄인다 — {@code "Chrome · Windows"}.
 *
 * <p><b>왜 필요한가.</b> 세션 목록의 목적은 "이 중에 내가 모르는 기기가 있는가" 를
 * 사용자가 판단하는 것이다. {@code Mozilla/5.0 (Windows NT 10.0; Win64; x64)
 * AppleWebKit/537.36 …} 를 늘어놓으면 그 판단이 불가능하다. 원문은 진단용으로 함께
 * 돌려주고, 판단은 이 문자열로 하게 한다.</p>
 *
 * <p><b>왜 라이브러리를 쓰지 않는가.</b> 정확한 UA 파싱은 수천 줄의 규칙 데이터와
 * 주기적 갱신을 요구한다. 여기서 필요한 정확도는 "내 노트북인지 아닌지" 수준이고,
 * 그 정도는 규칙 열 몇 줄로 충분하다. 인증 서버에 갱신이 필요한 의존성을 들이는
 * 비용이 얻는 것보다 크다.</p>
 *
 * <p><b>모바일 여부는 따로 붙이지 않는다.</b> {@code iPhone} · {@code iPad} ·
 * {@code Android} 자체가 이미 모바일이라는 뜻이고, 사용자가 자기 기기를 알아보는
 * 데에는 그 이름이 "모바일" 이라는 딱지보다 낫다. OS 를 못 알아본 채 모바일 신호만
 * 있는 경우에만 그 사실을 쓴다.</p>
 *
 * <p><b>절대 예외를 던지지 않는다.</b> UA 는 클라이언트가 마음대로 보내는 값이라
 * 무엇이든 올 수 있다. 세션 <b>목록 조회</b>가 그 값 하나 때문에 실패하면, 정작
 * 수상한 세션을 찾으려던 사용자가 화면 자체를 못 본다.</p>
 */
public final class DeviceLabel {

    /** 알아보지 못했을 때. 빈 문자열을 돌려주지 않는다 — 화면이 빈칸을 그리게 된다 */
    public static final String UNKNOWN = "알 수 없는 기기";

    private static final String SEPARATOR = " · ";
    /** 브라우저가 아닌 클라이언트({@code curl/8.7.1})의 제품 이름을 잘라 낼 상한 */
    private static final int PRODUCT_MAX = 30;

    private DeviceLabel() {
    }

    /**
     * @param userAgent 저장된 원문. null·공백이어도 된다
     * @return {@code "Chrome · Windows"} · {@code "Safari · iPhone"} · {@code "curl"} ·
     *         {@link #UNKNOWN}
     */
    public static String of(String userAgent) {
        if (userAgent == null || userAgent.isBlank()) {
            return UNKNOWN;
        }
        String ua = userAgent.toLowerCase(Locale.ROOT);
        String browser = browserOf(ua);
        String device = deviceOf(ua);

        if (browser != null && device != null) {
            return browser + SEPARATOR + device;
        }
        if (browser != null) {
            return browser;
        }
        if (device != null) {
            return device;
        }
        // 브라우저가 아닌 클라이언트 — 서버 간 호출·스크립트·앱이 여기 들어온다.
        // "알 수 없는 기기" 로 뭉개는 것보다 curl · PostmanRuntime 이라고 적어 주는 편이
        // 사용자에게도 운영에도 낫다
        String product = productOf(userAgent);
        return product == null ? UNKNOWN : product;
    }

    /**
     * 브라우저 이름.
     *
     * <p><b>순서가 규칙이다.</b> Edge·삼성인터넷·Opera·Whale 은 자기 UA 에 {@code Chrome}
     * 을 함께 싣고, iOS 의 모든 브라우저는 {@code Safari} 를 싣는다. 흔한 것을 먼저 보면
     * 전부 Chrome 과 Safari 로 뭉개진다.</p>
     */
    private static String browserOf(String ua) {
        if (ua.contains("edg/") || ua.contains("edge/") || ua.contains("edgios")
                || ua.contains("edga/")) {
            return "Edge";
        }
        if (ua.contains("samsungbrowser")) {
            return "Samsung Internet";
        }
        if (ua.contains("opr/") || ua.contains("opera")) {
            return "Opera";
        }
        if (ua.contains("whale")) {
            return "Whale";
        }
        if (ua.contains("firefox") || ua.contains("fxios")) {
            return "Firefox";
        }
        if (ua.contains("chrome") || ua.contains("chromium") || ua.contains("crios")) {
            return "Chrome";
        }
        if (ua.contains("safari")) {
            return "Safari";
        }
        return null;
    }

    /**
     * 기기·OS 이름.
     *
     * <p>여기서도 순서가 규칙이다 — iPad 의 UA 에는 {@code Mac OS X} 가, Android 의 UA
     * 에는 {@code Linux} 가 들어 있다. 넓은 쪽을 먼저 보면 아이패드가 macOS 로, 휴대폰이
     * 리눅스로 나온다.</p>
     */
    private static String deviceOf(String ua) {
        if (ua.contains("iphone")) {
            return "iPhone";
        }
        if (ua.contains("ipad")) {
            return "iPad";
        }
        if (ua.contains("ipod")) {
            return "iPod";
        }
        if (ua.contains("android")) {
            return "Android";
        }
        if (ua.contains("windows")) {
            return "Windows";
        }
        if (ua.contains("mac os x") || ua.contains("macintosh")) {
            return "macOS";
        }
        if (ua.contains("cros")) {
            return "ChromeOS";
        }
        if (ua.contains("linux") || ua.contains("x11")) {
            return "Linux";
        }
        // OS 는 못 알아봤지만 모바일이라는 신호는 있다 — 그것만이라도 알려 준다
        if (ua.contains("mobile")) {
            return "모바일";
        }
        return null;
    }

    /**
     * {@code curl/8.7.1} · {@code PostmanRuntime/7.39.0} 처럼 {@code 제품/버전} 으로
     * 시작하는 UA 에서 제품 이름만 뽑는다. 버전은 버리는데, 같은 도구의 버전이 올라갈
     * 때마다 사용자에게 "새 기기" 로 보이면 안 되기 때문이다.
     *
     * <p><b>이름처럼 생긴 것만 통과시킨다</b> — 글자로 시작하고 이름에 쓰일 만한 문자로만
     * 이어지는 토큰. 조건을 걸지 않으면 {@code !@#$%^&*()} 같은 값이 그대로 세션 목록에
     * 찍힌다. 그건 정보가 아니라 클라이언트가 보낸 문자열을 화면에 흘리는 것이다.</p>
     */
    private static String productOf(String userAgent) {
        String head = userAgent.trim();
        int cut = head.indexOf('/');
        if (cut <= 0) {
            cut = head.indexOf(' ');
        }
        if (cut > 0) {
            head = head.substring(0, cut);
        }
        if (head.isEmpty() || head.length() > PRODUCT_MAX
                || !Character.isLetter(head.charAt(0))) {
            return null;
        }
        for (int i = 0; i < head.length(); i++) {
            if (!isNameChar(head.charAt(i))) {
                return null;
            }
        }
        return head;
    }

    private static boolean isNameChar(char c) {
        return Character.isLetterOrDigit(c) || c == '.' || c == '-' || c == '_' || c == '+';
    }
}
