package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.domain.ResourceGrant;
import team.prost.ixauth.repository.ResourceGrantRepository;

import java.time.Instant;
import java.util.Map;
import java.util.Set;

/** 리소스 인스턴스 권한(L2) 부여·회수. */
@Service
@RequiredArgsConstructor
public class ResourceGrantAdminService {

    private static final Set<String> SUBJECT_TYPES = Set.of("USER", "GROUP", "ROLE");
    private static final Set<String> EFFECTS = Set.of("ALLOW", "DENY");

    private final ResourceGrantRepository repository;
    private final AuditService auditService;
    private final team.prost.ixauth.authz.ResourceKeyNormalizer normalizer;

    @Transactional(readOnly = true)
    public Page<ResourceGrant> search(String resourceType, String subjectType, Pageable pageable) {
        // null 을 바인딩하지 않는다 (PostgreSQL 타입 추론)
        return repository.search(
                resourceType == null ? "" : resourceType,
                subjectType == null ? "" : subjectType,
                pageable);
    }

    @Transactional
    public ResourceGrant grant(String subjectType, Long subjectId, String resourceType,
                               String resourceKey, String action, String effect,
                               Instant expiresAt, Long actorId) {
        String st = normalize(subjectType, SUBJECT_TYPES, "subjectType");
        String ef = normalize(effect == null ? "ALLOW" : effect, EFFECTS, "effect");

        if (subjectId == null || resourceType == null || resourceType.isBlank()
                || resourceKey == null || resourceKey.isBlank()
                || action == null || action.isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "필수 값이 비었습니다.");
        }
        // 판정할 때와 같은 규칙으로 저장한다. 어긋나면 준 권한이 걸리지 않는다
        String key;
        try {
            key = normalizer.normalize(resourceType, resourceKey);
        } catch (IllegalArgumentException e) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, e.getMessage());
        }

        if (repository.existsBySubjectTypeAndSubjectIdAndResourceTypeAndResourceKeyAndAction(
                st, subjectId, resourceType, key, action)) {
            throw new ApiException(ErrorCode.AUTHZ_GRANT_CONFLICT);
        }

        var grant = repository.save(new ResourceGrant(
                st, subjectId, resourceType, key, action, ef, actorId, expiresAt));

        auditService.record(AuditService.PERMISSION_CHANGED, null, actorId, null, null,
                Map.of("action", "GRANT_CREATE", "subject", st + ":" + subjectId,
                        "resource", resourceType + ":" + key,
                        "grant", action + "/" + ef));
        return grant;
    }

    @Transactional
    public void revoke(Long id, Long actorId) {
        var grant = repository.findById(id).orElseThrow(() -> ApiException.notFound("권한 부여"));
        repository.delete(grant);
        auditService.record(AuditService.PERMISSION_CHANGED, null, actorId, null, null,
                Map.of("action", "GRANT_DELETE",
                        "subject", grant.getSubjectType() + ":" + grant.getSubjectId(),
                        "resource", grant.getResourceType() + ":" + grant.getResourceKey()));
    }

    private String normalize(String value, Set<String> allowed, String field) {
        String v = value == null ? "" : value.trim().toUpperCase();
        if (!allowed.contains(v)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    field + " 은(는) " + allowed + " 중 하나여야 합니다.");
        }
        return v;
    }
}
