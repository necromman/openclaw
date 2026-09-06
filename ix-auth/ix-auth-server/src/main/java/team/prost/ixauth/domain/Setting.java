package team.prost.ixauth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * 관리자가 바꾼 설정 하나.
 *
 * <p>yml 은 기본값이고 이 표는 <b>덮어쓰기</b>다. 행이 없으면 yml 값을 쓴다 —
 * 그래야 새 설정을 추가해도 기존 DB 에 아무 작업이 필요 없다.</p>
 */
@Entity
@Table(name = "settings")
@Getter
@Setter
@NoArgsConstructor
public class Setting {

    @Id
    // 백틱 = Hibernate 에 "방언에 맞게 인용하라"는 표시 — key 는 MariaDB 예약어라
    // 인용 없인 INSERT 컬럼 목록에서 문법 오류가 난다. PostgreSQL 은 "key" 로 인용된다(무해).
    @Column(name = "`key`", length = 120)
    private String key;

    /** 타입에 관계없이 문자열. 해석은 SettingDefinitions 가 한다 */
    @Column(nullable = false, columnDefinition = "text")
    private String value;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    /** 누가 바꿨는지 — 없으면 사고가 났을 때 원인을 찾을 수 없다 */
    @Column(name = "updated_by")
    private Long updatedBy;

    public Setting(String key, String value, Long updatedBy) {
        this.key = key;
        this.value = value;
        this.updatedBy = updatedBy;
    }
}
