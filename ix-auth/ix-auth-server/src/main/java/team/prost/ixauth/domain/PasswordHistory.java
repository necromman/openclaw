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
 * 지난 비밀번호의 해시 한 건.
 *
 * <p>이 표가 있는 이유는 하나다 — 현재 해시 하나만 들고 있으면 막을 수 있는 것이
 * '직전 것' 뿐이다. 최근 N개를 막으려면 지난 것을 남겨야 한다.</p>
 *
 * <p>그 대가로 <b>보관하는 개인정보가 늘어난다.</b> 그래서 기본값
 * ({@code password.history-count = 0})에서는 여기에 한 줄도 쌓이지 않는다.</p>
 */
@Entity
@Table(name = "password_history")
@Getter
@Setter
@NoArgsConstructor
public class PasswordHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** 알고리즘 접두어 포함 — {@code users.password_hash} 와 같은 형식 */
    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    public PasswordHistory(Long userId, String passwordHash) {
        this.userId = userId;
        this.passwordHash = passwordHash;
    }
}
