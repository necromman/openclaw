package team.prost.ixauth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/**
 * 리소스가 어디에 있는가 — 파일이 로컬인지 S3 인지에 따라 키 표기가 다르다.
 *
 * <p>표기가 어긋나면 권한이 <b>조용히</b> 없는 것이 된다. {@code /contracts/a.pdf} 로
 * 부여하고 {@code contracts/a.pdf} 로 물으면 걸리지 않는데, 그 결과는 "권한 없음" 과
 * 구분되지 않아 원인을 찾기 어렵다. 그래서 종류마다 정규화 규칙을 정해 둔다.</p>
 */
@Entity
@Table(name = "resource_types")
@Getter
@Setter
@NoArgsConstructor
public class ResourceType {

    @Id
    @Column(length = 40)
    private String code;

    @Column(nullable = false, length = 100)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "key_format", nullable = false, length = 20)
    private KeyFormat keyFormat = KeyFormat.PATH;

    /** 리눅스 파일시스템은 대소문자를 구분하고, S3 버킷은 구분하지 않는다 */
    @Column(name = "case_sensitive", nullable = false)
    private boolean caseSensitive = true;

    /**
     * 저장소가 스스로 권한을 관리하는가.
     *
     * <p>true 면 IX-Auth 는 판정하지 않고 그렇다고 알려 준다. 파일서버가 자체 권한을
     * 가진 경우 두 곳에서 각각 판정하면 어느 쪽이 진짜인지 알 수 없게 된다.</p>
     */
    @Column(nullable = false)
    private boolean delegated;

    @Column(length = 500)
    private String description;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public enum KeyFormat {
        /** {@code /a/b/c} — 로컬·NAS·SeaweedFS filer. {@code /} 로 끝나면 폴더 */
        PATH,
        /** {@code s3://버킷/키} · {@code 버킷/키} 를 같은 것으로 본다 */
        S3,
        /** 경로가 아닌 식별자. 상속 없이 정확히 일치할 때만 */
        OPAQUE
    }

    public ResourceType(String code, String name, KeyFormat keyFormat) {
        this.code = code;
        this.name = name;
        this.keyFormat = keyFormat;
    }
}
