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
 * 약관 한 <b>버전</b>. 개정하면 이 행을 고치지 않고 새 행을 만든다.
 *
 * <p>같은 행을 고쳐 쓰면 동의 이력이 가리키는 대상이 나중에 바뀌어, "그 사람이 무엇에
 * 동의했는가" 를 영영 알 수 없게 된다. 증빙은 '동의했다' 가 아니라 <b>'이 내용에
 * 동의했다'</b> 여야 한다.</p>
 */
@Entity
@Table(name = "terms")
@Getter
@Setter
@NoArgsConstructor
public class Term {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** {@code service} · {@code privacy} · {@code marketing} 등. 앱과 계약하는 이름이다 */
    @Column(nullable = false, length = 40)
    private String code;

    /** 같은 코드 안에서만 의미가 있다. 1 부터 */
    @Column(nullable = false)
    private int version;

    @Column(nullable = false, length = 200)
    private String title;

    /** 본문을 직접 담거나 {@link #bodyUrl} 로 외부를 가리키거나 — 둘 중 하나는 있어야 한다 */
    @Column(columnDefinition = "text")
    private String body;

    @Column(name = "body_url", length = 1000)
    private String bodyUrl;

    /**
     * 필수 약관인가.
     *
     * <p>필수는 동의하지 않으면 가입할 수 없고 개정되면 재동의를 요구한다. 선택은
     * <b>거절도 하나의 답</b>이라, 거절했다는 사실까지 이력에 남긴다.</p>
     */
    @Column(nullable = false)
    private boolean required = true;

    @Column(name = "display_order", nullable = false)
    private int displayOrder;

    /**
     * 게시 시각. {@code null} 이면 초안이라 사용자에게 보이지 않는다.
     *
     * <p>관리자가 문안을 다듬는 동안 가입 화면에 반쯤 쓴 약관이 뜨면 안 된다.</p>
     */
    @Column(name = "published_at")
    private Instant publishedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    @PreUpdate
    void touch() {
        this.updatedAt = Instant.now();
    }

    public Term(String code, int version, String title) {
        this.code = code;
        this.version = version;
        this.title = title;
    }

    public boolean isPublished() {
        return publishedAt != null;
    }
}
