package team.prost.ixauth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.Arrays;
import java.util.List;

/**
 * {@code users.attributes}(JSONB) 에 무엇이 들어와야 하는지의 정의.
 *
 * <p>JSONB 는 V1 부터 있었지만 정의도 검증도 없었다. 그래서 앱마다 {@code dept} ·
 * {@code department} · {@code deptCode} 가 섞여 들어가고, 나중에 그걸 읽는 쪽에서는
 * 어느 것이 맞는지 알아낼 방법이 없다.</p>
 *
 * <p><b>정의가 하나도 없으면 아무 검사도 하지 않는다.</b> 지금까지 쓰던 앱이 그대로
 * 동작해야 하기 때문이다 (.claude/rules/settings-driven.md — 기본값 때문에 기존
 * 사용자가 막히지 않는다).</p>
 */
@Entity
@Table(name = "user_attribute_defs")
@Getter
@Setter
@NoArgsConstructor
public class UserAttributeDef {

    /** attributes JSONB 의 키. 앱이 읽는 이름 그대로 */
    @Id
    // key 는 MariaDB 예약어 — 백틱으로 방언별 인용을 요청한다 (Setting.key 와 동일 사유)
    @Column(name = "`key`", length = 60)
    private String key;

    @Column(nullable = false, length = 200)
    private String label;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private AttrType type = AttrType.STRING;

    /**
     * 없으면 사용자 생성·수정을 거부한다.
     *
     * <p>이미 저장된 사용자를 소급해 고치지는 않는다 — 그러면 그 사람이 로그인하지
     * 못하게 되는 것이 아니라, 관리자가 그 사람을 <b>고칠 수</b> 없게 된다.</p>
     */
    @Column(nullable = false)
    private boolean required;

    /** {@link AttrType#ENUM} 의 선택지. 쉼표로 구분한다 (설정의 LIST 표기와 같다) */
    @Column(columnDefinition = "text")
    private String options;

    @Column(name = "display_order", nullable = false)
    private int displayOrder;

    @Column(length = 500)
    private String description;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    /**
     * 받을 수 있는 타입.
     *
     * <p>여기서 멈추는 이유 — 더 늘리면 이 표가 앱의 도메인 스키마가 된다. 사용자에게
     * 딸린 <b>몇 개의 부가 정보</b>를 흔들리지 않게 받는 것이 목적이고, 구조가 있는
     * 데이터는 앱이 자기 테이블에 둔다 (.claude/rules/product-boundary.md).</p>
     */
    public enum AttrType {
        STRING, NUMBER, BOOLEAN, ENUM, DATE
    }

    @PreUpdate
    void touch() {
        this.updatedAt = Instant.now();
    }

    public UserAttributeDef(String key, String label, AttrType type) {
        this.key = key;
        this.label = label;
        this.type = type;
    }

    /** ENUM 선택지 목록. 정의되지 않았으면 빈 목록 */
    public List<String> optionList() {
        if (options == null || options.isBlank()) {
            return List.of();
        }
        return Arrays.stream(options.split(",")).map(String::trim)
                .filter(s -> !s.isEmpty()).toList();
    }
}
