package team.prost.ixauth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * 관리자가 고쳐 쓴 메일 템플릿 하나.
 *
 * <p><b>행이 없으면 코드의 기본 템플릿을 쓴다.</b> 설정 표({@link Setting})와 같은 방식이다 —
 * 그래야 이 기능이 생겼다는 이유로 기존 설치의 메일 본문이 달라지지 않는다.
 * 편집은 덮어쓰기이고, 삭제는 초기화다.</p>
 *
 * <p>언어를 코드가 아니라 행으로 가르는 이유 — 고객사가 필요로 하는 언어를 우리가 모른다.
 * 기본 템플릿만 {@code ko}·{@code en} 두 벌을 코드에 두고, 그 밖은 관리자가 넣는다.</p>
 */
@Entity
@Table(name = "mail_templates")
@Getter
@Setter
@NoArgsConstructor
public class MailTemplate {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** {@code MailMessage.Kind} 의 이름 */
    @Column(nullable = false, length = 40)
    private String kind;

    @Column(nullable = false, length = 10)
    private String locale;

    @Column(nullable = false, length = 300)
    private String subject;

    @Column(nullable = false, columnDefinition = "text")
    private String body;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    /** 누가 바꿨는지 — 메일 본문은 사용자가 보는 얼굴이라 근거 없이 바뀌면 안 된다 */
    @Column(name = "updated_by")
    private Long updatedBy;

    public MailTemplate(String kind, String locale, String subject, String body, Long updatedBy) {
        this.kind = kind;
        this.locale = locale;
        this.subject = subject;
        this.body = body;
        this.updatedBy = updatedBy;
    }

    @PreUpdate
    void touch() {
        this.updatedAt = Instant.now();
    }
}
