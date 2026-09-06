package team.prost.ixauth.mail;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationContext;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.MailDelivery;
import team.prost.ixauth.repository.MailDeliveryRepository;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 발송 실행 + 이력 기록 + 실패 재시도 (G21).
 *
 * <p><b>지금까지는 발송 실패를 통로마다 삼키고 로그만 남겼다.</b> 운영자가 "안 갔다" 를
 * 알 방법이 없었고, 사용자는 링크를 받지 못한 채 기다렸다. 삼키는 자리를 여기 하나로
 * 모아, 삼키되 <b>기록은 남기고 다시 시도한다.</b></p>
 *
 * <p>발송 실패가 요청을 실패시키지 않는다는 약속은 그대로다 — 재설정 응답은 계정 존재
 * 여부를 감춰야 하고, 그 답이 SMTP 상태에 따라 갈리면 감추는 의미가 없다.</p>
 *
 * <h2>재시도가 메모리에 있는 이유</h2>
 *
 * <p>이력에 본문과 링크를 저장하지 않기 때문이다. 재설정 링크가 DB 에 남으면 DB(와 그
 * 백업)를 읽을 수 있는 사람이 누구의 계정이든 가져갈 수 있다 — 이력이 주는 편의보다
 * 훨씬 비싸다. 그래서 재시도용 메시지는 <b>프로세스 메모리에만</b> 둔다.</p>
 *
 * <p>대가로 프로세스가 내려가면 대기 중이던 재시도는 사라진다. 그때 이력에는 실패로
 * 남으므로 운영자는 그 사실을 보고 해당 기능(초대·재설정)을 다시 실행하면 된다.
 * 관리 화면의 재시도 버튼도 메시지를 아직 들고 있는 행에서만 눌린다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MailDeliveryService {

    /** 최초 1회 + 재시도 2회. 그 이상은 대개 설정이 잘못된 것이지 일시 장애가 아니다 */
    private static final int MAX_ATTEMPTS = 3;
    /** 지수 백오프의 기준 — 1분, 2분. SMTP 일시 장애는 대개 이 안에서 풀린다 */
    private static final long BACKOFF_BASE_SECONDS = 60;
    /**
     * 메모리에 들고 있을 메시지 수의 상한.
     *
     * <p>없으면 메일 서버가 오래 죽어 있을 때 실패분이 그대로 쌓여 힙을 먹는다.
     * 넘치면 오래된 것부터 버린다 — 그 행은 이력에 남고 재시도 버튼만 눌리지 않는다.</p>
     */
    private static final int MAX_PENDING = 500;

    private final MailDeliveryRepository repository;
    private final IxAuthProperties properties;
    private final ObjectMapper mapper;
    private final ApplicationContext applicationContext;

    /** id → 아직 들고 있는 메시지. 재시도의 유일한 근거다 */
    private final Map<Long, Pending> pending = new ConcurrentHashMap<>();

    /**
     * @param nextAttemptAt {@code null} 이면 자동 재시도는 끝났고 수동 재시도만 남았다는 뜻
     */
    private record Pending(long id, MailMessage message, int attempts,
                           Instant nextAttemptAt, Instant queuedAt) {
    }

    // ────────────────────── 발송 ──────────────────────

    /** {@link MailService} 가 부르는 유일한 입구 */
    public void send(MailMessage message) {
        Long id = open(message);
        if (id == null) {
            // 이력을 못 남겼다고 메일을 안 보내지는 않는다 — 사용자에게 닿는 쪽이 먼저다.
            // 이 경로는 이력이 없으므로 재시도할 근거도 없다
            try {
                deliver(message);
            } catch (MailSendException e) {
                log.warn("메일 발송 실패: to={} kind={} — {}",
                        message.to(), message.kind(), e.getMessage());
            }
            return;
        }
        attempt(id, message, 1);
    }

    private Long open(MailMessage message) {
        try {
            return self().record(message);
        } catch (Exception e) {
            log.warn("메일 발송 이력을 남기지 못했습니다 — to={} kind={} ({})",
                    message.to(), message.kind(), e.getMessage());
            return null;
        }
    }

    /**
     * 이력 행을 만든다.
     *
     * <p>별도 트랜잭션이다({@code REQUIRES_NEW}) — 호출한 쪽의 트랜잭션이 뒤에 롤백돼도
     * <b>메일은 이미 나갔다.</b> 함께 사라지면 이력이 사실과 어긋난다
     * ({@code AuditService} 와 같은 이유).</p>
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Long record(MailMessage message) {
        var row = new MailDelivery(message.to(), message.kind().name(),
                trim(message.subject(), 300), message.locale());
        return repository.save(row).getId();
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void finish(long id, MailDelivery.Status status, int attempts, String error) {
        repository.findById(id).ifPresent(row -> {
            row.setStatus(status);
            row.setAttempts(attempts);
            row.setLastError(trim(error, 500));
            if (status == MailDelivery.Status.SENT) {
                row.setSentAt(Instant.now());
            }
            repository.save(row);
        });
    }

    private void attempt(long id, MailMessage message, int attemptNo) {
        try {
            deliver(message);
            update(id, MailDelivery.Status.SENT, attemptNo, null);
            pending.remove(id);
        } catch (SkippedException e) {
            // 실패가 아니다 — 설정이 "보내지 않는다" 였을 뿐이라 재시도할 것이 없다
            update(id, MailDelivery.Status.SKIPPED, attemptNo, e.getMessage());
            pending.remove(id);
        } catch (MailSendException e) {
            boolean retry = properties.getMail().isRetryEnabled() && attemptNo < MAX_ATTEMPTS;
            update(id, retry ? MailDelivery.Status.FAILED : MailDelivery.Status.GAVE_UP,
                    attemptNo, e.getMessage());
            // 받는 주소와 용도는 남기되 링크는 남기지 않는다 — 로그를 본 사람이 계정을 가져갈 수 있다
            log.warn("메일 발송 실패({}회차): to={} kind={} — {}{}",
                    attemptNo, message.to(), message.kind(), e.getMessage(),
                    retry ? " (재시도 예정)" : " (재시도 없음)");
            retain(id, message, attemptNo, retry);
        }
    }

    /**
     * 실제 발송. {@code LOG} 는 나가지 않은 것으로 표시한다.
     *
     * <p>{@code SENT} 로 적으면 운영자는 사용자가 받았다고 읽는다. 그건 거짓말이고,
     * 그 거짓말은 "왜 안 왔지" 를 조사하는 시간을 통째로 낭비시킨다.</p>
     */
    private void deliver(MailMessage message) {
        if (properties.getMail().getTransport() == IxAuthProperties.Mail.Transport.LOG) {
            new LogMailSender().send(message);
            throw new SkippedException();
        }
        sender().send(message);
    }

    /** {@code transport=LOG} 를 실패와 구분하기 위한 내부 신호 */
    private static final class SkippedException extends MailSendException {
        private static final long serialVersionUID = 1L;

        private SkippedException() {
            super("transport=LOG — 실제로 발송되지 않았습니다");
        }
    }

    private void update(long id, MailDelivery.Status status, int attempts, String error) {
        try {
            self().finish(id, status, attempts, error);
        } catch (Exception e) {
            log.warn("메일 발송 이력을 갱신하지 못했습니다 — id={} ({})", id, e.getMessage());
        }
    }

    // ────────────────────── 재시도 ──────────────────────

    private void retain(long id, MailMessage message, int attempts, boolean schedule) {
        Instant now = Instant.now();
        Instant next = schedule
                ? now.plusSeconds(BACKOFF_BASE_SECONDS * (1L << (attempts - 1)))
                : null;
        pending.put(id, new Pending(id, message, attempts, next, now));
        evictOldestIfFull();
    }

    private void evictOldestIfFull() {
        while (pending.size() > MAX_PENDING) {
            pending.values().stream().min(Comparator.comparing(Pending::queuedAt))
                    .ifPresent(oldest -> pending.remove(oldest.id()));
        }
    }

    /** 밀린 재시도를 처리한다. 창을 짧게 잡아도 되는 이유 — 대기열은 대개 비어 있다 */
    @Scheduled(fixedDelay = 20_000, initialDelay = 20_000)
    public void drainRetries() {
        if (!properties.getMail().isRetryEnabled()) {
            return;
        }
        Instant now = Instant.now();
        for (Pending p : List.copyOf(pending.values())) {
            if (p.nextAttemptAt() == null || p.nextAttemptAt().isAfter(now)) {
                continue;
            }
            // 다음 순회에 다시 잡히지 않도록 먼저 예약을 지운다
            pending.put(p.id(), new Pending(p.id(), p.message(), p.attempts(), null,
                    p.queuedAt()));
            attempt(p.id(), p.message(), p.attempts() + 1);
        }
    }

    /**
     * 관리자가 누른 재시도.
     *
     * @return {@code false} 면 메시지를 더 이상 들고 있지 않다는 뜻이다. 본문·링크를
     *         저장하지 않으므로 되살릴 방법이 없고, 그 경우 해당 기능을 다시 실행해야 한다
     */
    public boolean retryNow(long id) {
        var p = pending.get(id);
        if (p == null) {
            return false;
        }
        attempt(id, p.message(), p.attempts() + 1);
        return true;
    }

    /** 지금 재시도를 누를 수 있는 행 — 관리 화면이 버튼을 그릴지 판단한다 */
    public Set<Long> retryableIds() {
        return Set.copyOf(pending.keySet());
    }

    // ────────────────────── 정리 ──────────────────────

    /**
     * 보존 기간이 지난 이력을 지운다.
     *
     * <p>이력에는 받는 사람 주소가 들어 있다 — 목적을 다한 개인정보를 계속 들고 있을
     * 이유가 없다. {@code 0} 이면 무기한 보존한다(감사 로그와 같은 규칙).</p>
     */
    @Scheduled(cron = "0 35 4 * * *")
    @Transactional
    public void purge() {
        int days = properties.getMail().getRetentionDays();
        if (days <= 0) {
            return;
        }
        int deleted = repository.deleteOlderThan(Instant.now().minus(days, ChronoUnit.DAYS));
        if (deleted > 0) {
            log.info("메일 발송 이력 정리 — {}일 경과분 {}건 삭제", days, deleted);
        }
    }

    // ────────────────────── 통로 ──────────────────────

    /**
     * 보낼 때마다 전송 방식을 다시 읽는다.
     *
     * <p>생성자에서 한 번 만들어 두면 관리자가 화면에서 SMTP 로 바꿔도 재시작 전까지
     * 옛 방식으로 나간다. 계약(config.md §5-0)은 이 설정들이 "재시작 없이 반영된다" 고
     * 약속하므로 약속을 지키는 쪽으로 맞춘다.</p>
     */
    private MailSender sender() {
        var mail = properties.getMail();
        return switch (mail.getTransport()) {
            case SMTP -> new SmtpMailSender(mail);
            case WEBHOOK -> new WebhookMailSender(mail, properties.getServiceKey(), mapper);
            case LOG -> new LogMailSender();
        };
    }

    /** 부팅 시 경고에 쓴다 — 지금 설정으로 메일이 실제로 나가는가 */
    public boolean isOperational() {
        return sender().isOperational();
    }

    /** 자기 호출로는 프록시를 거치지 않아 REQUIRES_NEW 가 무시된다 — 주입된 프록시를 쓴다 */
    private MailDeliveryService self() {
        return applicationContext.getBean(MailDeliveryService.class);
    }

    private static String trim(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() > max ? value.substring(0, max) : value;
    }
}
