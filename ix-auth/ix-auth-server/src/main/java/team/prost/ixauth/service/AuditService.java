package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.AuditLog;
import team.prost.ixauth.repository.AuditLogRepository;

import java.util.Map;

/**
 * 감사 로그 기록 — append-only.
 *
 * <p>{@link #record} 는 별도 트랜잭션에서 커밋한다. 로그인 실패처럼 주 트랜잭션이
 * 롤백되는 경우에도 기록은 남아야 하기 때문이다.</p>
 *
 * <p>detail 에 비밀번호·토큰·시크릿을 절대 넣지 않는다.</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AuditService {

    // 이벤트 타입
    public static final String LOGIN_SUCCESS = "LOGIN_SUCCESS";
    public static final String LOGIN_FAILURE = "LOGIN_FAILURE";
    public static final String LOGOUT = "LOGOUT";
    public static final String ACCOUNT_LOCKED = "ACCOUNT_LOCKED";
    public static final String TOKEN_REFRESHED = "TOKEN_REFRESHED";
    public static final String REFRESH_REUSE_DETECTED = "REFRESH_REUSE_DETECTED";
    public static final String PASSWORD_CHANGED = "PASSWORD_CHANGED";
    public static final String PASSWORD_REHASHED = "PASSWORD_REHASHED";
    public static final String USER_CREATED = "USER_CREATED";
    public static final String USER_UPDATED = "USER_UPDATED";
    public static final String USER_DISABLED = "USER_DISABLED";
    public static final String USER_UNLOCKED = "USER_UNLOCKED";
    public static final String ROLE_GRANTED = "ROLE_GRANTED";
    public static final String PERMISSION_CHANGED = "PERMISSION_CHANGED";
    public static final String GROUP_CHANGED = "GROUP_CHANGED";
    public static final String SESSION_REVOKED = "SESSION_REVOKED";
    public static final String MFA_CHALLENGED = "MFA_CHALLENGED";
    public static final String MFA_ENABLED = "MFA_ENABLED";
    public static final String MFA_DISABLED = "MFA_DISABLED";
    public static final String MFA_VERIFIED = "MFA_VERIFIED";
    public static final String MFA_FAILED = "MFA_FAILED";
    /** 백업 코드는 한 번 쓰면 사라진다 — 몇 개 남았는지가 사고 조사에서 신호가 된다 */
    public static final String MFA_BACKUP_CODE_USED = "MFA_BACKUP_CODE_USED";
    /**
     * 관리자가 남의 2단계를 초기화했다.
     *
     * <p>이 기록은 선택 사항이 아니다. 관리자가 조용히 남의 2단계를 끌 수 있으면
     * 2단계는 관리자 앞에서 아무것도 막지 못한다.</p>
     */
    public static final String MFA_RESET_BY_ADMIN = "MFA_RESET_BY_ADMIN";
    /** 이전에 본 적 없는 (IP, User-Agent) 로 로그인 — 알림 메일이 나간 시점 */
    public static final String NEW_DEVICE_LOGIN = "NEW_DEVICE_LOGIN";
    /**
     * 동시 세션 상한을 넘어 오래된 세션을 끊었다.
     *
     * <p>사용자에게는 "갑자기 로그아웃됐다" 로 보인다. 남기지 않으면 그 문의에
     * 답할 근거가 없다.</p>
     */
    public static final String SESSION_EVICTED = "SESSION_EVICTED";
    /** 본인 탈퇴 요청 (유예 모드) — 아직 비활성이 아니다 */
    public static final String SELF_DELETE_REQUESTED = "SELF_DELETE_REQUESTED";
    /** 유예 중 로그인해 탈퇴가 취소됐다 */
    public static final String SELF_DELETE_CANCELED = "SELF_DELETE_CANCELED";
    /** 본인 탈퇴가 실제로 적용됐다 (즉시 모드거나 유예가 끝났거나) */
    public static final String SELF_DELETED = "SELF_DELETED";
    /**
     * 약관에 동의(또는 거절)했다.
     *
     * <p>이력 원장은 {@code term_agreements} 이고 이쪽은 사건 기록이다. 둘을 함께 두는
     * 이유 — 원장은 "지금 어떤 상태인가" 를 답하고, 감사 로그는 "그때 무슨 일이 있었나"
     * 를 다른 사건들과 같은 시간축에서 답한다.</p>
     */
    public static final String TERMS_AGREED = "TERMS_AGREED";
    public static final String TERM_CREATED = "TERM_CREATED";
    public static final String TERM_UPDATED = "TERM_UPDATED";
    /** 게시 = 그 시점부터 사용자에게 보이고, 필수라면 재동의 대상이 된다 */
    public static final String TERM_PUBLISHED = "TERM_PUBLISHED";
    public static final String TERM_DELETED = "TERM_DELETED";
    /** 사용자 속성 정의가 바뀌었다 — 이후의 생성·수정 검증이 달라진다 */
    public static final String ATTRIBUTE_DEF_CHANGED = "ATTRIBUTE_DEF_CHANGED";
    /**
     * 일괄 등록을 실행했다.
     *
     * <p>행마다 {@link #USER_CREATED} 가 따로 남는다. 이 기록은 "언제 누가 몇 건을
     * 올렸고 몇 건이 실패했는가" 를 한 줄로 묶어 둔 것이다 — 그게 없으면 수백 개의
     * 계정 생성 기록만 남아 한 번의 업로드인지 알 수 없다.</p>
     */
    public static final String USERS_BULK_IMPORTED = "USERS_BULK_IMPORTED";
    /**
     * 감사 로그를 CSV 로 내보냈다.
     *
     * <p><b>내보내기 자체를 남긴다.</b> 내려받은 파일에는 이메일·IP·User-Agent 가 줄줄이
     * 들어 있다 — 그건 열람이 아니라 <b>반출</b>이고, 반출한 사실이 남지 않으면 유출이
     * 났을 때 어디로 나갔는지 되짚을 수 없다.</p>
     */
    public static final String AUDIT_EXPORTED = "AUDIT_EXPORTED";
    /** 메일 템플릿을 고쳤다. 본문은 남기지 않는다 — 감사 로그가 본문 저장소가 되면 안 된다 */
    public static final String MAIL_TEMPLATE_CHANGED = "MAIL_TEMPLATE_CHANGED";
    public static final String MAIL_TEMPLATE_RESET = "MAIL_TEMPLATE_RESET";
    /** 관리자가 실패한 메일을 다시 보냈다 */
    public static final String MAIL_DELIVERY_RETRIED = "MAIL_DELIVERY_RETRIED";
    /**
     * 서명 키를 회전했다.
     *
     * <p>토큰의 신뢰가 걸린 사건이라 자동이라도 흔적이 남아야 한다 — "언제부터 이 kid 로
     * 서명됐는가" 를 나중에 물을 일이 반드시 생긴다.</p>
     */
    public static final String SIGNING_KEY_ROTATED = "SIGNING_KEY_ROTATED";
    /** 구 서명 키를 JWKS 에서 내렸다. 이 시점 이후 그 kid 의 토큰은 검증되지 않는다 */
    public static final String SIGNING_KEY_RETIRED = "SIGNING_KEY_RETIRED";
    /**
     * 연합 신원으로 로그인했다 (앱이 외부 IdP 에서 확인한 사람).
     *
     * <p>{@link #LOGIN_SUCCESS} 와 따로 두는 이유 — 이 경로는 비밀번호도 2단계도 거치지
     * 않는다. 같은 이름으로 묶어 두면 "이 계정으로 누가 어떻게 들어왔나" 를 되짚을 때
     * 자체 인증과 구분되지 않는다. {@code detail.provider} 에 어느 IdP 인지 남는다.</p>
     */
    public static final String FEDERATED_LOGIN = "FEDERATED_LOGIN";
    /** 외부 신원을 이메일이 같은 기존 계정에 연결했다 — 계정 인수가 일어나는 지점이다 */
    public static final String FEDERATED_LINK = "FEDERATED_LINK";
    /** 외부 신원으로 계정을 새로 만들었다 (JIT). 비밀번호 없는 계정이 하나 늘어난 사건이다 */
    public static final String FEDERATED_PROVISION = "FEDERATED_PROVISION";
    /**
     * 관리자가 특정 사용자로 전환했다 (impersonation).
     *
     * <p><b>이 기록은 선택 사항이 아니다.</b> 이 시점 이후 그 세션이 남기는 로그는 전부
     * 대상 사용자 이름으로 찍힌다 — 이 한 줄이 없으면 "그날 그 사람이 한 일" 과
     * "관리자가 그 사람인 척 한 일" 을 구분할 방법이 사라진다.</p>
     *
     * <p>{@code userId} 는 대상, {@code actorId} 는 관리자다. detail 에 대상 이메일과
     * 발급된 세션 id 가 실린다.</p>
     */
    public static final String IMPERSONATION_STARTED = "IMPERSONATION_STARTED";

    /**
     * 방문자가 브라우저 뒤에 있는 사건들 - 이때의 IP 는 <b>앱이 넘긴 값</b>이라야 한다.
     *
     * <p>{@link ClientIpGuard} 를 여기에만 태우는 이유: 관리 API 나 배치(보존 정리·키 회전)의
     * IP 는 앱 서버나 내부망 주소인 것이 정상이라 그것까지 경고하면 소음이 된다.
     * 잘못된 연동은 어차피 로그인 경로에서 100% 드러난다.</p>
     */
    private static final java.util.Set<String> VISITOR_EVENTS = java.util.Set.of(
            LOGIN_SUCCESS, LOGIN_FAILURE, LOGOUT, TOKEN_REFRESHED, NEW_DEVICE_LOGIN,
            MFA_CHALLENGED, MFA_VERIFIED, MFA_FAILED, REFRESH_REUSE_DETECTED);

    private final AuditLogRepository repository;
    private final IxAuthProperties properties;
    private final ApplicationContext applicationContext;
    private final team.prost.ixauth.common.ClientInfo clientInfo;
    private final team.prost.ixauth.common.ClientIpGuard clientIpGuard;
    private final tools.jackson.databind.ObjectMapper mapper;

    /**
     * 감사 기록.
     *
     * <p>별도 트랜잭션({@code REQUIRES_NEW})에서 커밋한다 — 로그인 실패처럼 주 트랜잭션이
     * 롤백되는 경우에도 기록은 남아야 하기 때문이다.</p>
     *
     * <p>그 대가로 <b>기록 실패가 본업을 깨뜨리면 안 된다.</b> 별도 트랜잭션의 예외는
     * 호출자에게 전파돼 주 트랜잭션까지 롤백시키므로, 여기서 삼킨다.
     * 감사 로그를 못 남기는 것보다 로그인·사용자 생성이 막히는 쪽이 더 나쁘다.</p>
     */
    public void record(String eventType, Long userId, Long actorId,
                       String ip, String userAgent, Map<String, Object> detail) {
        if (!properties.getAudit().isEnabled()) {
            return;
        }
        if (LOGIN_FAILURE.equals(eventType) && !properties.getAudit().isLogFailedLogin()) {
            return;
        }
        try {
            // 호출자가 안 넘겼으면 현재 요청에서 뽑는다 — 관리 API 처럼 매번 전달하기
            // 번거로운 경로에서 IP·UA 가 비는 것을 막는다
            String resolvedIp = clientInfo.ip(ip);
            // 판정한 IP 가 방문자일 수 없는 주소면 여기서 경고가 나간다. 기록은 그대로 남긴다 -
            // 넘어온 값을 고쳐 적으면 잘못된 연동이 더 조용해진다
            if (VISITOR_EVENTS.contains(eventType)) {
                clientIpGuard.inspect(eventType, resolvedIp);
            }
            self().persist(eventType, userId, actorId,
                    resolvedIp, clientInfo.userAgent(userAgent), detail);
        } catch (Exception e) {
            log.warn("감사 로그 기록 실패 — event={} user={} ({})", eventType, userId, e.getMessage());
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void persist(String eventType, Long userId, Long actorId,
                        String ip, String userAgent, Map<String, Object> detail) {
        var entry = new AuditLog();
        entry.setEventType(eventType);
        entry.setUserId(userId);
        entry.setActorId(actorId);
        entry.setIp(ip);
        entry.setUserAgent(userAgent);
        if (detail != null) {
            entry.setDetail(detail);
        }
        repository.save(entry);
    }

    /** 자기 호출로는 프록시를 거치지 않아 REQUIRES_NEW 가 무시된다 — 주입된 프록시를 쓴다 */
    private AuditService self() {
        return applicationContext.getBean(AuditService.class);
    }

    public void record(String eventType, Long userId, String ip, String userAgent) {
        record(eventType, userId, userId, ip, userAgent, Map.of());
    }

    // ────────────────────── 내보내기 (G14) ──────────────────────

    /** CSV 머리글. 순서를 바꾸지 않는다 — 받는 쪽이 열 위치로 읽는 경우가 있다 */
    private static final String CSV_HEADER =
            "id,createdAt,eventType,userId,actorId,ip,userAgent,detail\n";

    /**
     * 감사 로그를 CSV 로 흘려보낸다.
     *
     * <p><b>한 번에 다 읽지 않는다.</b> 목록을 통째로 메모리에 올리면 기간을 넓게 잡은
     * 요청 하나가 서버를 세운다. 페이지 단위로 읽어 쓰면서 흘린다.</p>
     *
     * <p>{@code to} 를 호출 시각으로 닫아 두면 그 사이 새로 쌓이는 행이 페이지 경계를
     * 밀지 않는다 — 열어 두면 최근순 정렬에서 앞이 밀려 같은 행을 두 번 쓰게 된다.</p>
     *
     * <p>상한에 걸리면 <b>잘렸다는 사실을 마지막 줄에 적는다.</b> 조용히 끊으면 받는
     * 사람은 그것이 전부인 줄 알고 보고서를 쓴다.</p>
     *
     * @return 실제로 쓴 행 수
     */
    @Transactional(readOnly = true)
    public int exportCsv(java.io.Writer out, String eventType, Long userId,
                         java.time.Instant from, java.time.Instant to)
            throws java.io.IOException {

        int cap = Math.max(1, properties.getAudit().getExportMax());
        int pageSize = Math.min(cap, 1000);

        // 엑셀이 UTF-8 을 알아보게 하는 BOM. 없으면 한글이 깨져 보이고, 그 상태로
        // "인코딩이 이상하다" 는 문의가 온다. 눈에 보이지 않는 글자라 이스케이프로 적는다
        out.write('\uFEFF');
        out.write(CSV_HEADER);

        int written = 0;
        for (int page = 0; written < cap; page++) {
            var result = repository.search(eventType, userId, from, to,
                    org.springframework.data.domain.PageRequest.of(page, pageSize));
            if (result.getContent().isEmpty()) {
                break;
            }
            for (var entry : result.getContent()) {
                if (written >= cap) {
                    break;
                }
                out.write(toCsvRow(entry));
                written++;
            }
            if (!result.hasNext()) {
                break;
            }
        }
        if (written >= cap) {
            out.write("# 상한 " + cap + "행에 걸려 여기서 잘렸습니다. "
                    + "기간을 좁혀 다시 내려받으세요.\n");
        }
        return written;
    }

    private String toCsvRow(AuditLog entry) {
        return String.join(",",
                String.valueOf(entry.getId()),
                team.prost.ixauth.common.Csv.escape(String.valueOf(entry.getCreatedAt())),
                team.prost.ixauth.common.Csv.escape(entry.getEventType()),
                entry.getUserId() == null ? "" : String.valueOf(entry.getUserId()),
                entry.getActorId() == null ? "" : String.valueOf(entry.getActorId()),
                team.prost.ixauth.common.Csv.escape(entry.getIp()),
                team.prost.ixauth.common.Csv.escape(entry.getUserAgent()),
                team.prost.ixauth.common.Csv.escape(detailJson(entry))) + "\n";
    }

    /** detail 은 JSON 한 칸으로 넣는다 — 열로 펼치면 이벤트마다 열 구성이 달라진다 */
    private String detailJson(AuditLog entry) {
        try {
            return entry.getDetail() == null ? "" : mapper.writeValueAsString(entry.getDetail());
        } catch (Exception e) {
            return "";
        }
    }
}
