package team.prost.ixtrust.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 역할 엔티티.
 * 사용자에게 부여되는 역할과 권한(permission)을 정의.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "roles", uniqueConstraints = @UniqueConstraint(columnNames = {"organization_id", "code"}))
public class Role extends BaseEntity {

    @Column(name = "organization_id", nullable = false)
    private Long organizationId;

    /** 역할 코드 (예: ADMIN, MANAGER, VIEWER). Organization 내 유니크 */
    @Column(nullable = false, length = 50)
    private String code;

    /** 역할 표시명 (예: "시스템 관리자") */
    @Column(nullable = false)
    private String name;

    @Column(length = 500)
    private String description;

    /** 콤마 구분 권한 목록 (예: "user:read,user:write,client:manage") */
    @Column(length = 2000)
    private String permissions;

    /** 시스템 기본 역할 여부 (삭제 불가) */
    @Column(name = "built_in", nullable = false)
    private boolean builtIn = false;
}
