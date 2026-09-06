package team.prost.ixauth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * 메일 한 통의 발송 결과.
 *
 * <p><b>본문과 링크를 담지 않는다.</b> 재설정·초대 링크는 그 자체가 계정 접근 수단이라,
 * DB 에 남기는 순간 DB(와 그 백업)를 읽을 수 있는 사람이 누구의 계정이든 가져갈 수 있다.
 * 여기 남는 것은 <b>누구에게 · 무슨 용도로 · 어떻게 됐는지</b> 뿐이다.</p>
 *
 * <p>그 대가로 재시도는 발송 시점의 메시지를 메모리에 들고 있는 동안만 가능하다
 * ({@code MailDeliveryService}). 프로세스가 내려가면 대기 중이던 재시도는 사라지고
 * 이 행만 실패로 남는다 — 운영자는 그것을 보고 해당 기능을 다시 실행한다.</p>
 */
@Entity
@Table(name = "mail_deliveries")
@Getter
@Setter
@NoArgsConstructor
public class MailDelivery {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "to_email", nullable = false, length = 320)
    private String toEmail;

    /** {@code MailMessage.Kind} 의 이름. 앱이 이 문자열로 분기하므로 이름을 바꾸지 않는다 */
    @Column(nullable = false, length = 40)
    private String kind;

    /** 제목에는 링크가 들어가지 않는다 — 목록에서 무슨 메일인지 알아보는 용도다 */
    @Column(nullable = false, length = 300)
    private String subject;

    @Column(nullable = false, length = 10)
    private String locale = "ko";

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Status status = Status.PENDING;

    @Column(nullable = false)
    private int attempts;

    /** 예외 메시지만. 스택트레이스는 넣지 않는다 — 내부 경로가 관리 화면으로 흘러간다 */
    @Column(name = "last_error", length = 500)
    private String lastError;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "sent_at")
    private Instant sentAt;

    public MailDelivery(String toEmail, String kind, String subject, String locale) {
        this.toEmail = toEmail;
        this.kind = kind;
        this.subject = subject;
        this.locale = locale;
    }

    /**
     * 발송 상태.
     *
     * <p>{@link #FAILED} 와 {@link #GAVE_UP} 을 가르는 이유 — 운영자가 손대야 하는 것은
     * 뒤쪽뿐이다. 둘을 합치면 목록이 "아직 시도 중" 으로 가득 차서 진짜 문제가 묻힌다.</p>
     */
    public enum Status {
        /** 아직 첫 시도 전 */
        PENDING,
        SENT,
        /** 실패했고 재시도가 남아 있다 */
        FAILED,
        /** 재시도를 다 썼다 */
        GAVE_UP,
        /**
         * {@code transport=LOG} 라 실제로 나가지 않았다.
         *
         * <p>{@code SENT} 로 적으면 거짓말이 된다 — 운영자는 사용자가 받았다고 읽는다.</p>
         */
        SKIPPED
    }
}
