package team.prost.ixauth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * 동의(또는 거절) 한 건. <b>지우지 않고 고치지도 않는다.</b>
 *
 * <p>철회하면 이 행을 뒤집는 대신 {@code agreed = false} 인 새 행을 남긴다. 덮어쓰면
 * "언제부터 언제까지 동의 상태였는가" 가 사라지는데, 증빙에서 필요한 것이 바로 그 구간이다.</p>
 *
 * <p>{@link #code} · {@link #version} 을 {@link #termId} 와 함께 들고 있는 것은 중복이
 * 아니라 <b>스냅샷</b>이다. 약관 행이 어떤 이유로든 사라져도 무엇에 동의했는지는 남아야 한다.</p>
 */
@Entity
@Table(name = "term_agreements")
@Getter
@Setter
@NoArgsConstructor
public class TermAgreement {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "term_id", nullable = false)
    private Long termId;

    @Column(nullable = false, length = 40)
    private String code;

    @Column(nullable = false)
    private int version;

    /** 선택 약관의 거절도 기록한다 — 마케팅 수신 거부는 지켜야 할 의사 표시다 */
    @Column(nullable = false)
    private boolean agreed;

    @Column(name = "agreed_at", nullable = false, updatable = false)
    private Instant agreedAt = Instant.now();

    /** 증빙에서 시각만큼 자주 요구받는 것이 출처다 */
    @Column(length = 45)
    private String ip;

    @Column(name = "user_agent", length = 500)
    private String userAgent;

    public TermAgreement(Long userId, Term term, boolean agreed, String ip, String userAgent) {
        this.userId = userId;
        this.termId = term.getId();
        this.code = term.getCode();
        this.version = term.getVersion();
        this.agreed = agreed;
        this.ip = ip;
        this.userAgent = userAgent;
    }
}
