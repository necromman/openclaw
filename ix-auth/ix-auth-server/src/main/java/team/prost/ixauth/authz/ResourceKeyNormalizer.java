package team.prost.ixauth.authz;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import team.prost.ixauth.domain.ResourceType;
import team.prost.ixauth.repository.ResourceTypeRepository;

import java.util.Locale;
import java.util.Optional;

/**
 * 리소스 키를 종류별 규칙으로 통일한다.
 *
 * <p><b>부여할 때와 물을 때 같은 규칙을 써야 의미가 있다.</b> 한쪽만 정규화하면
 * {@code /contracts/a.pdf} 로 준 권한을 {@code contracts/a.pdf} 로 물었을 때 걸리지
 * 않는다 — 그리고 그 결과는 "권한 없음" 과 구분되지 않아 원인을 찾기 어렵다.</p>
 *
 * <p>저장소마다 같은 파일을 다르게 부르기 때문에 필요하다:</p>
 * <pre>
 * 로컬/NAS  /data/contracts/a.pdf   ·  data/contracts/a.pdf
 * S3        s3://docs/2026/a.pdf    ·  docs/2026/a.pdf  ·  /docs/2026/a.pdf
 * SeaweedFS /buckets/docs/a.pdf     (filer 경로 — PATH 와 같다)
 * </pre>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ResourceKeyNormalizer {

    private final ResourceTypeRepository typeRepository;

    /**
     * 등록된 종류인지 확인하고 키를 정규화한다.
     *
     * <p>등록되지 않은 종류는 {@code PATH} 로 다룬다 — 거부하지 않는 이유는, 앱이
     * 새 종류를 쓰기 시작했을 때 권한 조회가 통째로 실패하는 것보다 기본 규칙으로
     * 동작하는 편이 낫기 때문이다. 대신 경고를 남긴다.</p>
     */
    public String normalize(String resourceType, String rawKey) {
        Optional<ResourceType> type = typeRepository.findById(safe(resourceType));
        if (type.isEmpty()) {
            log.debug("등록되지 않은 리소스 종류 — {} (PATH 규칙으로 처리)", resourceType);
            return normalizePath(rawKey, true);
        }
        var t = type.get();
        return switch (t.getKeyFormat()) {
            case PATH -> normalizePath(rawKey, t.isCaseSensitive());
            case S3 -> normalizeS3(rawKey, t.isCaseSensitive());
            case OPAQUE -> normalizeOpaque(rawKey, t.isCaseSensitive());
        };
    }

    /** 저장소가 스스로 권한을 관리하는 종류인가 */
    public boolean isDelegated(String resourceType) {
        return typeRepository.findById(safe(resourceType))
                .map(ResourceType::isDelegated).orElse(false);
    }

    // ────────────────────── 규칙 ──────────────────────

    /**
     * 경로 — 앞에 {@code /} 를 강제하고 중복 구분자를 줄인다.
     *
     * <p>끝의 {@code /} 는 <b>지운다.</b> 폴더 여부는 상속 계산이 판단하고,
     * 여기서는 같은 대상을 같은 문자열로 만드는 것만 한다 —
     * 다만 {@code /} 하나(루트)와 폴더 표시는 살려야 하므로 그것만 예외다.</p>
     */
    private String normalizePath(String raw, boolean caseSensitive) {
        String v = safe(raw);
        if (v.isEmpty()) {
            return v;
        }
        v = v.replace('\\', '/');            // 윈도우 경로를 같은 표기로
        v = v.replaceAll("/{2,}", "/");      // // → /
        if (!v.startsWith("/")) {
            v = "/" + v;
        }
        // 상위 탐색은 허용하지 않는다 — /a/../../etc 로 권한 밖을 가리킬 수 있다
        if (v.contains("/../") || v.endsWith("/..")) {
            throw new IllegalArgumentException("상위 경로 참조(..)는 쓸 수 없습니다: " + raw);
        }
        return caseSensitive ? v : v.toLowerCase(Locale.ROOT);
    }

    /**
     * S3 — {@code s3://버킷/키} 와 {@code 버킷/키} 를 같은 것으로 만든다.
     *
     * <p>버킷 이름은 대소문자를 구분하지 않으므로(사실 소문자만 허용된다) 전체를
     * 소문자로 내린다. 오브젝트 키는 대소문자를 구분하지만, 종류 설정이
     * {@code case-sensitive=false} 면 함께 내려간다 — 실무에서 키까지 대소문자를
     * 섞어 쓰는 경우가 드물고, 섞이면 조용한 불일치가 더 위험하다.</p>
     */
    private String normalizeS3(String raw, boolean caseSensitive) {
        String v = safe(raw);
        if (v.isEmpty()) {
            return v;
        }
        String lower = v.toLowerCase(Locale.ROOT);
        if (lower.startsWith("s3://")) {
            v = v.substring(5);
        } else if (lower.startsWith("s3:/")) {
            v = v.substring(4);
        }
        return normalizePath(v, caseSensitive);
    }

    /** 식별자 — 공백만 정리한다. 경로가 아니므로 구분자를 손대지 않는다 */
    private String normalizeOpaque(String raw, boolean caseSensitive) {
        String v = safe(raw);
        return caseSensitive ? v : v.toLowerCase(Locale.ROOT);
    }

    private static String safe(String v) {
        return v == null ? "" : v.trim();
    }
}
