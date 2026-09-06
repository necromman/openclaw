package team.prost.ixtrust.client.security;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * 인증 토큰 쿠키 관리 유틸리티.
 * httpOnly session cookie로 설정하여 브라우저 종료 시 자동 삭제.
 */
public final class CookieHelper {

    public static final String ACCESS_TOKEN_COOKIE = "access_token";
    public static final String REFRESH_TOKEN_COOKIE = "refresh_token";
    /**
     * OIDC id_token httpOnly cookie (1.8.1+) — RP-initiated logout 의 {@code id_token_hint} 발급 source.
     * <p>
     * BFF 흐름 (sso-policy §5.6) 에서 backend callback 이 id_token 을 받자마자 cookie 로 영속화하면,
     * 이후 logout 시 IX-Trust LogoutController 가 sid claim 을 파싱해 정확한 RP cascade 수행 가능.
     * BFF 회귀 사례 (LXP 2026-05-09) 정공 fix.
     */
    public static final String ID_TOKEN_COOKIE = "id_token";

    private CookieHelper() { }

    /** accessToken + refreshToken을 httpOnly session cookie로 설정 (id_token 미포함). */
    public static void setAuthCookies(HttpServletResponse response, String accessToken,
                                      String refreshToken, boolean secure) {
        addSessionCookie(response, ACCESS_TOKEN_COOKIE, accessToken, secure);
        addSessionCookie(response, REFRESH_TOKEN_COOKIE, refreshToken, secure);
    }

    /**
     * accessToken + refreshToken + idToken을 httpOnly session cookie로 설정 (1.8.1+).
     * <p>
     * idToken 이 null/blank 이면 기존 id_token cookie 가 있으면 cleared 됨 — 다른 RP 식별자 잔존 차단.
     * BFF / hybrid 흐름 모두 본 메서드를 사용해 logout RP-initiated id_token_hint 회복.
     */
    public static void setAuthCookies(HttpServletResponse response, String accessToken,
                                      String refreshToken, String idToken, boolean secure) {
        addSessionCookie(response, ACCESS_TOKEN_COOKIE, accessToken, secure);
        addSessionCookie(response, REFRESH_TOKEN_COOKIE, refreshToken, secure);
        if (idToken != null && !idToken.isBlank()) {
            addSessionCookie(response, ID_TOKEN_COOKIE, idToken, secure);
        } else {
            clearCookie(response, ID_TOKEN_COOKIE, secure);
        }
    }

    /** 인증 쿠키 삭제 (Secure/SameSite 속성 포함). 1.8.1+ id_token cookie 도 함께 clear. */
    public static void clearAuthCookies(HttpServletResponse response) {
        clearCookie(response, ACCESS_TOKEN_COOKIE, false);
        clearCookie(response, REFRESH_TOKEN_COOKIE, false);
        clearCookie(response, ID_TOKEN_COOKIE, false);
    }

    /** 인증 쿠키 삭제 (요청 기반 Secure 판단). 1.8.1+ id_token cookie 도 함께 clear. */
    public static void clearAuthCookies(HttpServletResponse response, HttpServletRequest request) {
        boolean secure = isSecureRequest(request);
        clearCookie(response, ACCESS_TOKEN_COOKIE, secure);
        clearCookie(response, REFRESH_TOKEN_COOKIE, secure);
        clearCookie(response, ID_TOKEN_COOKIE, secure);
    }

    /** 쿠키에서 값 읽기 */
    public static String getCookieValue(HttpServletRequest request, String name) {
        if (request.getCookies() == null) {
            return null;
        }
        for (Cookie cookie : request.getCookies()) {
            if (name.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }

    /**
     * 요청이 HTTPS 환경인지 확인.
     * NAS 리버스 프록시가 X-Forwarded-Proto를 안 넘기거나
     * 중간 Nginx가 $scheme(http)으로 덮어쓰는 경우를 대비하여
     * 원본 요청 URL, Referer, Origin도 함께 체크.
     */
    public static boolean isSecureRequest(HttpServletRequest request) {
        if (request.isSecure()) {
            return true;
        }
        if ("https".equalsIgnoreCase(request.getHeader("X-Forwarded-Proto"))) {
            return true;
        }
        // Referer/Origin이 https면 원래 HTTPS 환경
        String referer = request.getHeader("Referer");
        if (referer != null && referer.startsWith("https://")) {
            return true;
        }
        String origin = request.getHeader("Origin");
        if (origin != null && origin.startsWith("https://")) {
            return true;
        }
        return false;
    }

    private static void addSessionCookie(HttpServletResponse response, String name,
                                         String value, boolean secure) {
        Cookie cookie = new Cookie(name, value);
        cookie.setPath("/");
        cookie.setHttpOnly(true);
        cookie.setMaxAge(-1); // session cookie — 브라우저 종료 시 삭제
        cookie.setSecure(secure);
        cookie.setAttribute("SameSite", "Lax");
        response.addCookie(cookie);
    }

    private static void clearCookie(HttpServletResponse response, String name, boolean secure) {
        Cookie cookie = new Cookie(name, "");
        cookie.setPath("/");
        cookie.setHttpOnly(true);
        cookie.setMaxAge(0);
        cookie.setSecure(secure);
        cookie.setAttribute("SameSite", "Lax");
        response.addCookie(cookie);
    }
}
