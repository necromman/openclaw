package team.prost.ixauth.mail;

import java.util.Map;

/**
 * 보낼 메일 한 통.
 *
 * <p>{@code link} 를 따로 들고 있는 이유 — WEBHOOK 모드에서 앱은 본문을 버리고
 * 링크만 가져다 자기 템플릿으로 다시 만든다. 본문에서 URL 을 파싱하게 두면
 * 템플릿을 바꾸는 순간 앱이 깨진다.</p>
 *
 * @param to      받는 사람
 * @param subject 제목
 * @param body    템플릿으로 만든 본문 (평문). 관리자가 고쳐 둔 템플릿이 있으면 그것으로 만든다
 * @param kind    용도 — 앱이 템플릿을 고르는 기준
 * @param link    사용자가 눌러야 할 앱 링크
 * @param vars    템플릿 치환값 (이름·제품명·만료 등)
 * @param locale  어떤 언어로 만들었는가 (`ko`·`en`). 앱이 자기 템플릿을 고를 때도 쓴다
 */
public record MailMessage(String to, String subject, String body,
                          Kind kind, String link, Map<String, String> vars, String locale) {

    /**
     * 앱이 자기 템플릿을 고르는 기준 (WEBHOOK 모드).
     *
     * <p>값을 <b>지우거나 이름을 바꾸지 않는다</b> — 웹훅을 받는 앱이 이 문자열로
     * 분기한다. 새 종류는 뒤에 더한다.</p>
     */
    public enum Kind {
        PASSWORD_RESET, EMAIL_VERIFY, INVITE, EMAIL_CHANGE, PASSWORD_CHANGED, ACCOUNT_EXISTS,
        SIGNUP_APPROVED,
        /** 새 기기·새 IP 로그인 알림. 링크가 없다 */
        NEW_DEVICE_LOGIN,
        /** 탈퇴 접수 — 유예 모드라 아직 되돌릴 수 있다 */
        ACCOUNT_DELETE_REQUESTED,
        /** 탈퇴 완료 — 계정이 비활성이 됐다 */
        ACCOUNT_DELETED,
        /** 관리자가 2단계 인증을 초기화했다 */
        MFA_RESET,
        /**
         * 매직 링크 — 이 링크가 곧 로그인이다.
         *
         * <p>WEBHOOK 으로 받는 앱은 이 종류를 <b>다른 것보다 조심해서</b> 다뤄야 한다.
         * 링크를 로그·모니터링에 남기면 그 로그를 볼 수 있는 사람이 남의 계정으로
         * 들어올 수 있다.</p>
         */
        MAGIC_LINK
    }
}
