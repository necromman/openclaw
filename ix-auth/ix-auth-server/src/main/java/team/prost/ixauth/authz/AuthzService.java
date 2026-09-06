package team.prost.ixauth.authz;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.repository.GroupRepository;
import team.prost.ixauth.repository.PermissionRepository;
import team.prost.ixauth.repository.RoleRepository;
import team.prost.ixauth.repository.UserRepository;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * L1 인가 — 역할·그룹·권한.
 *
 * <p><b>앱은 이 서비스를 매 요청 호출하지 않는다.</b> {@code permission-map} 을 한 번 받아
 * 캐싱하고 토큰의 역할 클레임과 대조해 스스로 판정한다 (설계 불변식 2).
 * 여기 있는 판정 메서드는 jar 자신의 관리 API 를 보호하는 용도다.</p>
 */
@Service
@RequiredArgsConstructor
public class AuthzService {

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final GroupRepository groupRepository;
    private final PermissionRepository permissionRepository;

    /**
     * 유효 역할 = 직접 부여 ∪ 그룹 경유.
     *
     * <p>이 합집합을 토큰 발급 시점에 계산해 {@code ixauth_roles} 에 담는다.
     * 앱은 그룹→역할 매핑을 알 필요가 없다.</p>
     */
    @Transactional(readOnly = true)
    public List<String> effectiveRoleCodes(Long userId) {
        var codes = new TreeSet<String>();
        codes.addAll(userRepository.findDirectRoleCodes(userId));
        codes.addAll(userRepository.findGroupRoleCodes(userId));
        return List.copyOf(codes);
    }

    @Transactional(readOnly = true)
    public List<String> groupCodes(Long userId) {
        return userRepository.findGroupCodes(userId);
    }

    /**
     * permission-map — 역할 → 권한 코드 목록.
     *
     * <p>앱이 부팅 시 1회 받아 캐싱한다. 역할이 수백 개가 아닌 한 수 KB 다.</p>
     */
    @Transactional(readOnly = true)
    public Map<String, List<String>> permissionMap() {
        var map = new TreeMap<String, List<String>>();
        for (Object[] pair : roleRepository.findAllRolePermissionPairs()) {
            String roleCode = (String) pair[0];
            String permCode = (String) pair[1];
            map.computeIfAbsent(roleCode, k -> new ArrayList<>()).add(permCode);
        }
        // 권한이 하나도 없는 역할도 맵에 실어야 앱이 "역할은 있는데 권한 0" 을 구분할 수 있다
        roleRepository.findAll().forEach(r -> map.putIfAbsent(r.getCode(), List.of()));
        return map;
    }

    /**
     * permissions_version — 권한 정의가 마지막으로 바뀐 시각(epoch 초).
     *
     * <p>전용 테이블을 두지 않고 관련 테이블의 {@code max(updated_at)} 을 쓴다.
     * 토큰 클레임 {@code ixauth_pv} 에 실려, 앱이 캐시된 맵이 낡았는지 판단한다.</p>
     */
    @Transactional(readOnly = true)
    public long permissionsVersion() {
        Instant max = Instant.EPOCH;
        max = later(max, permissionRepository.findMaxUpdatedAt().orElse(Instant.EPOCH));
        max = later(max, groupRepository.findMaxUpdatedAt().orElse(Instant.EPOCH));
        for (var role : roleRepository.findAll()) {
            max = later(max, role.getUpdatedAt());
        }
        return max.getEpochSecond();
    }

    /** 사용자의 유효 권한 코드 — 메뉴 노출용 */
    @Transactional(readOnly = true)
    public List<String> effectivePermissions(Long userId) {
        var roles = effectiveRoleCodes(userId);
        if (roles.isEmpty()) {
            return List.of();
        }
        var map = permissionMap();
        var perms = new TreeSet<String>();
        roles.forEach(r -> perms.addAll(map.getOrDefault(r, List.of())));
        return List.copyOf(perms);
    }

    /** jar 자신의 API 보호용 판정 */
    @Transactional(readOnly = true)
    public boolean hasPermission(Long userId, String requiredCode) {
        return PermissionCodes.anyMatches(effectivePermissions(userId), requiredCode);
    }

    /** 토큰에 담긴 역할로 판정 — DB 조회 없이 (관리 API 필터용) */
    public boolean hasPermission(List<String> roleCodes, Map<String, List<String>> map, String requiredCode) {
        if (roleCodes == null || roleCodes.isEmpty()) {
            return false;
        }
        var perms = new ArrayList<String>();
        roleCodes.forEach(r -> perms.addAll(map.getOrDefault(r, List.of())));
        return PermissionCodes.anyMatches(perms, requiredCode);
    }

    private Instant later(Instant a, Instant b) {
        return a.isAfter(b) ? a : b;
    }
}
