package team.prost.ixauth.authz;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.domain.ResourceGrant;
import team.prost.ixauth.repository.ResourceGrantRepository;
import team.prost.ixauth.repository.UserRepository;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.TreeSet;

/**
 * L2 인가 — 리소스 인스턴스 권한.
 *
 * <p>판정 규칙은 계약 docs/contract/authz.md §4 그대로다:</p>
 * <ol>
 *   <li>만료된 grant 제외</li>
 *   <li>요청 action 을 덮는 grant 만</li>
 *   <li><b>DENY 가 하나라도 있으면 거부</b> (상속 거리와 무관하게 최종)</li>
 *   <li>ALLOW 가 하나라도 있으면 허용</li>
 *   <li>없으면 L1 폴백 — {@code <resourceType>:<resourceKey>:<action>} 권한 코드로 판정</li>
 *   <li>그래도 없으면 거부 (기본 거부)</li>
 * </ol>
 */
@Service
@RequiredArgsConstructor
public class ResourceAuthzService {

    private final ResourceGrantRepository grantRepository;
    private final ResourceKeyNormalizer normalizer;
    private final UserRepository userRepository;
    private final AuthzService authzService;

    /** 판정 결과 — 근거를 항상 함께 돌려준다. 권한 문제는 근거 없이는 원인을 못 찾는다 */
    public record Decision(boolean allowed, String reason, String matchedKey, Long grantId) {

        static Decision deny(String reason) {
            return new Decision(false, reason, null, null);
        }
    }

    public record CheckRequest(String resourceType, String resourceKey, String action) {
    }

    // ────────────────────────── 판정 ──────────────────────────

    @Transactional(readOnly = true)
    public Decision check(Long userId, String resourceType, String resourceKey, String action) {
        // 저장소가 자체 권한을 가진 종류는 여기서 판정하지 않는다.
        // 두 곳에서 각각 판정하면 어느 쪽이 진짜인지 알 수 없게 된다
        if (normalizer.isDelegated(resourceType)) {
            return new Decision(false, "DELEGATED", null, null);
        }
        // 부여할 때와 같은 규칙으로 맞춘다 — 한쪽만 정규화하면
        // /contracts/a.pdf 로 준 권한을 contracts/a.pdf 로 물었을 때 걸리지 않는다
        String key = normalizer.normalize(resourceType, resourceKey);

        var subjects = subjectsOf(userId);
        var chain = ancestorChain(key);
        if (chain.isEmpty()) {
            return Decision.deny("NO_MATCH");
        }
        var grants = grantRepository.findForDecision(resourceType, chain, subjects);
        return decide(grants, action, userId, resourceType, key);
    }

    /** 목록 화면용 — 주체·조상 조회를 한 번만 하고 여러 건을 판정한다 (N+1 방지) */
    @Transactional(readOnly = true)
    public List<Decision> batchCheck(Long userId, List<CheckRequest> requests) {
        var subjects = subjectsOf(userId);
        var results = new ArrayList<Decision>(requests.size());

        for (var req : requests) {
            if (normalizer.isDelegated(req.resourceType())) {
                results.add(new Decision(false, "DELEGATED", null, null));
                continue;
            }
            String normKey = normalizer.normalize(req.resourceType(), req.resourceKey());
            var chain = ancestorChain(normKey);
            if (chain.isEmpty()) {
                results.add(Decision.deny("NO_MATCH"));
                continue;
            }
            var grants = grantRepository.findForDecision(req.resourceType(), chain, subjects);
            results.add(decide(grants, req.action(), userId, req.resourceType(), normKey));
        }
        return results;
    }

    /**
     * 접근 가능한 리소스 키 목록.
     *
     * <p>앱이 자기 쿼리를 필터링하는 데 쓴다. DENY 로 막힌 키는 제외한다.</p>
     */
    @Transactional(readOnly = true)
    public List<String> listResources(Long userId, String resourceType, String action, int max) {
        var subjects = subjectsOf(userId);
        Instant now = Instant.now();

        var allowed = new TreeSet<String>();
        var denied = new TreeSet<String>();
        for (var g : grantRepository.findBySubjects(resourceType, subjects)) {
            if (!g.isLive(now) || !g.coversAction(action)) {
                continue;
            }
            (g.isDeny() ? denied : allowed).add(g.getResourceKey());
        }
        allowed.removeAll(denied);
        return allowed.stream().limit(max).toList();
    }

    // ────────────────────────── 내부 ──────────────────────────

    private Decision decide(Collection<ResourceGrant> grants, String action, Long userId,
                            String resourceType, String resourceKey) {
        Instant now = Instant.now();
        ResourceGrant allow = null;

        for (var g : grants) {
            if (!g.isLive(now) || !g.coversAction(action)) {
                continue;
            }
            if (g.isDeny()) {
                // DENY 는 즉시 최종이다. 하위 경로의 ALLOW 가 상위의 DENY 를 이기지 않는다 —
                // "전체 허용 + 특정 폴더 제외" 가 실무에 흔하고, 그 반대는 드물고 위험하다
                return new Decision(false, "GRANT_DENY", g.getResourceKey(), g.getId());
            }
            if (allow == null) {
                allow = g;
            }
        }
        if (allow != null) {
            return new Decision(true, "GRANT_ALLOW", allow.getResourceKey(), allow.getId());
        }

        // L1 폴백 — 역할이 준 광역 권한(예: file:contracts/**:download)으로 열릴 수 있다
        String code = resourceType + ":" + stripLeadingSlash(resourceKey) + ":" + action;
        if (authzService.hasPermission(userId, code)) {
            return new Decision(true, "L1_FALLBACK", null, null);
        }
        return Decision.deny("NO_MATCH");
    }

    /** 주체 집합 — 사용자 · 소속 그룹 · 유효 역할 */
    private List<String> subjectsOf(Long userId) {
        var subjects = new ArrayList<String>();
        subjects.add("USER:" + userId);
        userRepository.findGroupIds(userId).forEach(id -> subjects.add("GROUP:" + id));

        var roleIds = new TreeSet<Long>(userRepository.findDirectRoleIds(userId));
        roleIds.addAll(userRepository.findGroupRoleIds(userId));
        roleIds.forEach(id -> subjects.add("ROLE:" + id));
        return subjects;
    }

    /**
     * 조상 경로 체인 — 자기 자신부터 루트까지.
     *
     * <pre>
     * /contracts/2026/a.pdf → [/contracts/2026/a.pdf, /contracts/2026/, /contracts/, /]
     * /contracts/2026/      → [/contracts/2026/, /contracts/, /]
     * doc-4821              → [doc-4821]                       (경로가 아니면 정확 매칭만)
     * </pre>
     *
     * <p>prefix LIKE 를 쓰지 않는 이유: {@code /contracts/2026/a.pdf} 판정에 필요한 것은
     * <b>조상</b>이지 형제({@code .../b.pdf})가 아니다. prefix 는 형제까지 잡는다.</p>
     */
    static List<String> ancestorChain(String key) {
        if (key == null || key.isBlank()) {
            return List.of();
        }
        var chain = new ArrayList<String>();
        chain.add(key);
        if (!key.startsWith("/")) {
            return chain;   // 식별자 — 상속 없음
        }
        String cur = key.endsWith("/") ? key.substring(0, key.length() - 1) : key;
        while (true) {
            int idx = cur.lastIndexOf('/');
            if (idx < 0) {
                break;
            }
            String parent = cur.substring(0, idx + 1);   // 끝의 '/' 포함
            if (!chain.contains(parent)) {
                chain.add(parent);
            }
            if ("/".equals(parent)) {
                break;
            }
            cur = cur.substring(0, idx);
        }
        return chain;
    }

    /** L1 권한 코드에는 앞의 '/' 를 넣지 않는다 — file:contracts/2026/a.pdf:download */
    private String stripLeadingSlash(String key) {
        return key.startsWith("/") ? key.substring(1) : key;
    }
}
