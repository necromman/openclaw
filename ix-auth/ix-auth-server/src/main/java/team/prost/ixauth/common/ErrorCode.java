package team.prost.ixauth.common;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/**
 * 에러 코드. 정본은 docs/contract/errors.md.
 *
 * <p>앱은 이 {@code code} 문자열로 분기한다. 절대 메시지로 분기하지 않는다.
 * 기존 코드의 의미를 바꾸지 않는다 (계약 하위 호환).</p>
 */
@Getter
public enum ErrorCode {

    // ── 인증 ──
    /** 이메일 없음 <b>또는</b> 비밀번호 불일치. 둘을 구분하지 않는다 — 계정 존재 유출 방지 */
    AUTH_INVALID_CREDENTIALS(HttpStatus.UNAUTHORIZED, "이메일 또는 비밀번호가 올바르지 않습니다."),
    AUTH_ACCOUNT_LOCKED(HttpStatus.LOCKED, "계정이 잠겼습니다."),
    AUTH_ACCOUNT_DISABLED(HttpStatus.FORBIDDEN, "비활성화된 계정입니다."),
    AUTH_EMAIL_UNVERIFIED(HttpStatus.FORBIDDEN, "이메일 인증이 필요합니다."),
    AUTH_SOCIAL_DISABLED(HttpStatus.NOT_FOUND, "사용할 수 없는 로그인 방식입니다."),
    AUTH_SOCIAL_STATE_INVALID(HttpStatus.BAD_REQUEST, "로그인 요청이 만료되었거나 유효하지 않습니다."),
    AUTH_SOCIAL_EXCHANGE_FAILED(HttpStatus.UNAUTHORIZED, "소셜 로그인에 실패했습니다."),
    AUTH_SOCIAL_PROFILE_FAILED(HttpStatus.UNAUTHORIZED, "소셜 계정 정보를 가져오지 못했습니다."),
    AUTH_SOCIAL_UNREACHABLE(HttpStatus.SERVICE_UNAVAILABLE, "소셜 로그인 제공자에 연결할 수 없습니다."),
    AUTH_SOCIAL_NO_ACCOUNT(HttpStatus.FORBIDDEN, "연결된 계정이 없습니다. 관리자에게 문의하세요."),
    AUTH_SOCIAL_ALREADY_LINKED(HttpStatus.CONFLICT, "이미 다른 계정에 연결된 소셜 계정입니다."),
    AUTH_ACCOUNT_PENDING(HttpStatus.FORBIDDEN, "초대 수락이 필요한 계정입니다."),
    AUTH_ACCOUNT_PENDING_APPROVAL(HttpStatus.FORBIDDEN, "관리자 승인 대기 중인 계정입니다."),
    AUTH_TOKEN_EXPIRED(HttpStatus.UNAUTHORIZED, "토큰이 만료되었습니다."),
    AUTH_TOKEN_INVALID(HttpStatus.UNAUTHORIZED, "유효하지 않은 토큰입니다."),
    AUTH_SESSION_REVOKED(HttpStatus.UNAUTHORIZED, "종료된 세션입니다. 다시 로그인하세요."),
    AUTH_REFRESH_EXPIRED(HttpStatus.UNAUTHORIZED, "세션이 만료되었습니다. 다시 로그인하세요."),
    AUTH_PASSWORD_POLICY(HttpStatus.BAD_REQUEST, "비밀번호가 정책에 맞지 않습니다."),
    /**
     * 최근에 쓴 적이 있는 비밀번호.
     *
     * <p>기본(이력 검사 꺼짐)에서는 <b>직전</b> 것만 걸리고,
     * {@code password.history-count} 를 켜면 최근 N개가 걸린다. 몇 개까지인지는
     * 메시지로 알려 준다 — 코드는 그대로라 앱의 분기가 깨지지 않는다.</p>
     */
    AUTH_PASSWORD_REUSED(HttpStatus.BAD_REQUEST, "직전 비밀번호는 사용할 수 없습니다."),
    /**
     * 외부 유출 목록에 있는 비밀번호 ({@code password.check-breached}).
     *
     * <p>{@code AUTH_PASSWORD_POLICY} 와 나눈 이유 — 앱이 다르게 안내해야 한다.
     * 정책 미달은 "무엇을 고치면 되는지" 를 알려 줄 수 있지만, 유출된 비밀번호는
     * 길이·복잡도를 아무리 만족해도 <b>그 값 자체를</b> 버려야 한다.</p>
     */
    AUTH_PASSWORD_BREACHED(HttpStatus.BAD_REQUEST,
            "유출된 적이 있는 비밀번호입니다. 다른 비밀번호를 사용하세요."),
    /**
     * 필수 약관에 동의하지 않았다 ({@code terms.require-on-signup}).
     *
     * <p>{@code details} 에 어떤 코드가 빠졌는지 실린다. 앱은 그것을 보고 해당
     * 체크박스를 짚어 준다 — "약관에 동의하세요" 만으로는 어느 것인지 알 수 없다.</p>
     */
    AUTH_TERMS_REQUIRED(HttpStatus.BAD_REQUEST, "필수 약관에 동의해야 합니다."),
    AUTH_MFA_REQUIRED(HttpStatus.UNAUTHORIZED, "2단계 인증이 필요합니다."),
    AUTH_MFA_INVALID(HttpStatus.UNAUTHORIZED, "인증 코드가 올바르지 않습니다."),
    /**
     * 본인 탈퇴가 꺼져 있다 ({@code account.self-delete-mode = DISABLED}).
     *
     * <p>{@code AUTHZ_FORBIDDEN} 과 나눈 이유 — 앱은 이 둘에 다르게 반응해야 한다.
     * 권한 문제면 "관리자에게 문의", 기능이 꺼진 것이면 탈퇴 화면 자체를 감춘다.</p>
     */
    AUTH_SELF_DELETE_DISABLED(HttpStatus.FORBIDDEN, "탈퇴를 사용할 수 없습니다."),
    /**
     * CAPTCHA 토큰이 필요한 경로인데 오지 않았다 ({@code captcha.protect}).
     *
     * <p>400 인 이유 — 이것은 <b>앱의 실수</b>다. 사용자는 아무것도 잘못하지 않았고,
     * 앱이 토큰을 실어 보내도록 고치면 된다. 403 으로 주면 앱은 "이 사용자가 차단됐다"
     * 로 읽고 사용자에게 엉뚱한 안내를 한다.</p>
     */
    AUTH_CAPTCHA_REQUIRED(HttpStatus.BAD_REQUEST, "자동 가입 방지 확인이 필요합니다."),
    /**
     * CAPTCHA 검증에 실패했다 — 토큰이 위조·만료됐거나 점수가 하한 미만이다.
     *
     * <p>403 인 이유 — 여기서는 요청 형식이 아니라 <b>판정</b>이 거절이다. 이유를
     * 나눠 주지 않는다(위조인지 점수 미달인지). 구분해 주면 점수를 넘길 때까지
     * 조정하는 데 쓰인다.</p>
     *
     * <p><b>provider 에 닿지 못한 경우는 이 코드가 아니다.</b> 그때는 통과시킨다 —
     * 외부 장애로 가입이 막히면 안 된다 ({@code captcha/CaptchaGuard}).</p>
     */
    AUTH_CAPTCHA_FAILED(HttpStatus.FORBIDDEN, "자동 가입 방지 확인에 실패했습니다."),

    /**
     * 자기 자신을 대리하려 했다.
     *
     * <p>400 인 이유 — 이건 권한 문제가 아니라 <b>말이 안 되는 요청</b>이다. 403 으로
     * 주면 관리자는 "권한을 더 받으면 되나" 를 찾게 된다.</p>
     */
    IMPERSONATION_SELF(HttpStatus.BAD_REQUEST, "자기 자신은 대리할 수 없습니다."),
    /**
     * 대리 대상이 {@code ACTIVE} 가 아니다.
     *
     * <p>409 인 이유 — 요청은 옳은데 <b>대상의 지금 상태</b>가 맞지 않는다. 잠긴·비활성·
     * 승인대기 계정을 대리하면 그 사람 본인은 들어올 수 없는데 관리자는 들어가는,
     * 설명할 수 없는 상태가 된다.</p>
     */
    IMPERSONATION_TARGET_NOT_ACTIVE(HttpStatus.CONFLICT, "활성 상태인 사용자만 대리할 수 있습니다."),
    /**
     * 대리 세션으로 민감 작업을 시도했다 — 관리 API · 비밀번호/이메일 변경 · 탈퇴 ·
     * 2단계 · 소셜 연결 · 약관 동의.
     *
     * <p>{@code AUTHZ_FORBIDDEN} 과 나눈 이유 — 앱이 다르게 안내해야 한다. 권한 부족이면
     * "관리자에게 문의" 지만, 이건 <b>대리를 끝내고 본인으로 로그인하면</b> 되는 일이다.</p>
     */
    IMPERSONATION_ACTION_FORBIDDEN(HttpStatus.FORBIDDEN,
            "대리 중에는 할 수 없는 작업입니다. 대리를 종료하고 본인 계정으로 다시 로그인하세요."),
    /** {@code ixauth.impersonation.enabled} 가 꺼져 있다 */
    IMPERSONATION_DISABLED(HttpStatus.FORBIDDEN, "사용자 대리 기능이 꺼져 있습니다."),

    /**
     * 연합 신원 교환이 꺼져 있다 ({@code ixauth.federation.enabled=false}).
     *
     * <p>계정과 무관한 <b>전역 스위치</b>라 알려 줘도 새는 것이 없다. 앱은 이 코드를
     * 보고 "넥서스허브로 로그인" 버튼 자체를 감춘다.</p>
     */
    AUTH_FEDERATION_DISABLED(HttpStatus.FORBIDDEN, "연합 로그인이 꺼져 있습니다."),
    /**
     * 허용 목록에 없는 provider 다 ({@code ixauth.federation.allowed-providers}).
     *
     * <p>{@code AUTH_FEDERATION_DISABLED} 와 나눈 이유 — <b>앱의 실수와 운영자의
     * 설정 누락</b>을 구분해야 한다. 기능은 켜져 있는데 이 provider 만 안 들어오는
     * 것이므로, 답은 "버튼을 감춘다" 가 아니라 "허용 목록에 이름을 추가한다" 다.</p>
     */
    AUTH_FEDERATION_PROVIDER_NOT_ALLOWED(HttpStatus.FORBIDDEN,
            "허용되지 않은 연합 provider 입니다."),
    /**
     * 같은 이메일의 계정이 있는데 이메일 연결이 꺼져 있다
     * ({@code ixauth.federation.link-by-email=false}).
     *
     * <p>409 인 이유 — 요청은 옳은데 <b>지금 이 계정의 상태</b>가 자동 연결을 허용하지
     * 않는다. 여기서 새 계정을 만들면 같은 주소의 계정이 둘이 되므로 만들지 않는다.
     * 관리자가 손으로 연결하면 그다음부터는 통과한다.</p>
     */
    AUTH_FEDERATION_LINK_DENIED(HttpStatus.CONFLICT,
            "같은 이메일의 계정이 이미 있습니다. 관리자에게 연결을 요청하세요."),
    /**
     * 연결된 계정이 없고 자동 생성도 하지 않는다
     * ({@code ixauth.federation.auto-provision=false} 이거나 이메일이 오지 않았다).
     *
     * <p>404 인 이유 — 권한이 없는 것이 아니라 <b>가리키는 사용자가 없다</b>. 403 으로
     * 주면 앱은 "차단된 사람" 으로 읽고 사용자에게 엉뚱한 안내를 한다.</p>
     */
    AUTH_FEDERATION_NO_ACCOUNT(HttpStatus.NOT_FOUND,
            "연결된 계정이 없습니다. 관리자에게 문의하세요."),

    // ── 인가 ──
    AUTHZ_FORBIDDEN(HttpStatus.FORBIDDEN, "권한이 없습니다."),
    AUTHZ_UNKNOWN_PERMISSION(HttpStatus.BAD_REQUEST, "등록되지 않은 권한 코드입니다."),
    AUTHZ_INVALID_PERMISSION_CODE(HttpStatus.BAD_REQUEST, "권한 코드 형식이 올바르지 않습니다."),
    AUTHZ_GRANT_CONFLICT(HttpStatus.CONFLICT, "이미 부여된 권한입니다."),
    AUTHZ_BATCH_TOO_LARGE(HttpStatus.BAD_REQUEST, "한 번에 요청할 수 있는 건수를 초과했습니다."),

    // ── 서비스 인증 ──
    SERVICE_KEY_MISSING(HttpStatus.UNAUTHORIZED, "서비스 키가 없습니다."),
    SERVICE_KEY_INVALID(HttpStatus.UNAUTHORIZED, "서비스 키가 올바르지 않습니다."),

    // ── 공통 ──
    VALIDATION_FAILED(HttpStatus.BAD_REQUEST, "요청 값이 올바르지 않습니다."),
    NOT_FOUND(HttpStatus.NOT_FOUND, "대상을 찾을 수 없습니다."),
    METHOD_NOT_ALLOWED(HttpStatus.METHOD_NOT_ALLOWED, "이 경로에서 지원하지 않는 메서드입니다."),
    CONFLICT(HttpStatus.CONFLICT, "이미 존재하거나 변경할 수 없는 대상입니다."),
    RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS, "요청이 너무 많습니다. 잠시 후 다시 시도하세요."),
    SERVICE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "서비스를 사용할 수 없습니다."),
    INTERNAL(HttpStatus.INTERNAL_SERVER_ERROR, "처리 중 오류가 발생했습니다.");

    private final HttpStatus status;
    private final String defaultMessage;

    ErrorCode(HttpStatus status, String defaultMessage) {
        this.status = status;
        this.defaultMessage = defaultMessage;
    }
}
