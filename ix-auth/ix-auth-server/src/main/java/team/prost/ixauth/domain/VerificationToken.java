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
 * 메일로 나가는 1회용 토큰 — 비밀번호 재설정 · 이메일 인증 · 초대 · 이메일 변경.
 *
 * <p>용도마다 테이블을 따로 두지 않는다. 만료·1회용·정리 규칙이 넷으로 갈라지면
 * 그중 하나만 고치는 실수가 나고, 그 하나가 보안 구멍이 된다.</p>
 *
 * <p>평문은 저장하지 않는다. 메일로 나간 원본은 사용자만 갖고, DB 에는 SHA-256
 * 해시만 둔다 — DB 가 유출돼도 그것만으로는 남의 비밀번호를 바꿀 수 없어야 한다.</p>
 */
@Entity
@Table(name = "verification_tokens")
@Getter
@Setter
@NoArgsConstructor
public class VerificationToken {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Purpose purpose;

    /** SHA-256 hex(64자). 평문 저장 금지 */
    @Column(name = "token_hash", nullable = false, length = 64)
    private String tokenHash;

    /** 용도별 부가 정보 — EMAIL_CHANGE 의 '바꿀 주소' 등 */
    @Column(length = 320)
    private String payload;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    /** 1회용. 쓰면 시각을 남기고 다시는 통하지 않는다 */
    @Column(name = "used_at")
    private Instant usedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public enum Purpose {
        /** 비밀번호 찾기 */
        PASSWORD_RESET,
        /** 가입·주소 확인 */
        EMAIL_VERIFY,
        /** 관리자 초대 — 수락하면 비밀번호를 정하고 ACTIVE 가 된다 */
        INVITE,
        /** 이메일 변경 — payload 에 새 주소가 들어 있다 */
        EMAIL_CHANGE,
        /**
         * 2단계 인증 중간 증표 — 비밀번호는 맞았고 코드만 남은 상태.
         *
         * <p>메일로 나가지 않는 유일한 용도다. 그래도 여기 두는 이유는 이 표의 규칙
         * (해시 저장 · 1회용 · 만료 · 자동 정리)이 정확히 필요한 것이기 때문이다.
         * 표를 새로 만들면 그 규칙이 두 벌로 갈라진다.</p>
         */
        MFA_CHALLENGE,
        /**
         * 매직 링크 — 비밀번호 없이 이 링크만으로 로그인한다.
         *
         * <p><b>다른 용도와 위험도가 다르다.</b> 재설정 링크는 손에 넣어도 새 비밀번호를
         * 정해야 하고 그 순간 본인에게 알림이 나가지만, 이것은 <b>그 자체가 로그인</b>이라
         * 유출되면 흔적 없이 들어온다. 그래서 수명이 훨씬 짧다
         * ({@code account.magic-link-token-ttl}, 기본 10분).</p>
         */
        MAGIC_LINK
    }

    public VerificationToken(Long userId, Purpose purpose, String tokenHash,
                             Instant expiresAt, String payload) {
        this.userId = userId;
        this.purpose = purpose;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
        this.payload = payload;
    }

    public boolean isUsable(Instant now) {
        return usedAt == null && expiresAt.isAfter(now);
    }
}
