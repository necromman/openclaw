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
 * 연합 신원 연결 — 앱이 <b>이미 검증한</b> 외부 신원과 IX-Auth 사용자의 대응.
 *
 * <p>매칭 기준은 {@code (provider, subject)} 다. <b>이메일이 아니다</b> — 이메일은 바뀌고,
 * 바뀐 주소가 남에게 재할당될 수도 있다.</p>
 *
 * <p><b>{@link Identity}(소셜)와 표를 나눈 이유</b> — 저쪽 {@code provider} 는 코드에
 * 열거된 값이고 그 행은 jar 가 provider 와 직접 주고받은 결과다. 이쪽 {@code provider} 는
 * 운영자가 설정으로 정하는 자유 문자열이고 그 행은 <b>앱이 대신 확인해 온</b> 결과다.
 * 신뢰의 출처가 다른 둘을 한 표에 섞으면 "이 연결을 누가 보증했는가" 를 나중에
 * 구분할 수 없다.</p>
 */
@Entity
@Table(name = "federated_identities")
@Getter
@Setter
@NoArgsConstructor
public class FederatedIdentity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** 운영자가 허용 목록에 적은 이름 그대로 (예: {@code nexus-hub}). 소문자로 정규화한다 */
    @Column(nullable = false, length = 64)
    private String provider;

    /** 외부 IdP 가 주는 불변 식별자 */
    @Column(nullable = false, length = 255)
    private String subject;

    /**
     * <b>연결 시점의</b> 주소. 표시·추적용이며 매칭 기준이 아니다.
     *
     * <p>이름을 {@code email} 이 아니라 {@code emailAtLink} 로 둔 것은 그 사실을
     * 이름이 스스로 말하게 하기 위해서다 — {@code email} 이면 "지금 주소" 로 읽고
     * 조인하게 된다.</p>
     */
    @Column(name = "email_at_link", length = 320)
    private String emailAtLink;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "last_login_at")
    private Instant lastLoginAt;

    public FederatedIdentity(Long userId, String provider, String subject, String emailAtLink) {
        this.userId = userId;
        this.provider = provider;
        this.subject = subject;
        this.emailAtLink = emailAtLink;
    }
}
