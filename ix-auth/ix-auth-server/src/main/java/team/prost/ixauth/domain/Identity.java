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
import team.prost.ixauth.social.SocialProvider;

import java.time.Instant;

/**
 * 외부 계정 연결.
 *
 * <p>매칭 기준은 {@code (provider, subject)} 다. <b>이메일이 아니다</b> — 이메일은 바뀌고,
 * 바뀐 주소가 남에게 재할당될 수도 있다. subject 로 묶어야 그런 변화에도 같은 사람이다.</p>
 */
@Entity
@Table(name = "identities")
@Getter
@Setter
@NoArgsConstructor
public class Identity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private SocialProvider.Kind provider;

    /** provider 의 불변 식별자 */
    @Column(nullable = false, length = 255)
    private String subject;

    /** 연결 시점의 주소. 표시·추적용이며 매칭 기준이 아니다 */
    @Column(length = 320)
    private String email;

    @Column(name = "display_name", length = 200)
    private String displayName;

    @Column(name = "linked_at", nullable = false)
    private Instant linkedAt = Instant.now();

    @Column(name = "last_login_at")
    private Instant lastLoginAt;

    public Identity(Long userId, SocialProvider.Kind provider, String subject,
                    String email, String displayName) {
        this.userId = userId;
        this.provider = provider;
        this.subject = subject;
        this.email = email;
        this.displayName = displayName;
    }
}
