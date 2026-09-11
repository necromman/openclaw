package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.authz.PermissionCodes;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.domain.Group;
import team.prost.ixauth.domain.Permission;
import team.prost.ixauth.domain.Role;
import team.prost.ixauth.repository.GroupRepository;
import team.prost.ixauth.repository.PermissionRepository;
import team.prost.ixauth.repository.RoleRepository;
import team.prost.ixauth.repository.UserRepository;

import java.util.List;
import java.util.Map;

/** 역할 · 권한 · 그룹 관리. */
@Service
@RequiredArgsConstructor
public class AccessAdminService {

    private final RoleRepository roleRepository;
    private final PermissionRepository permissionRepository;
    private final GroupRepository groupRepository;
    private final UserRepository userRepository;
    private final AuditService auditService;

    // ── 권한 ──

    @Transactional(readOnly = true)
    public List<Permission> listPermissions() {
        return permissionRepository.findAll();
    }

    @Transactional
    public Permission createPermission(String code, String description, Long actorId) {
        PermissionCodes.validate(code);   // 문법 검증 — '**' 중간 배치 등을 여기서 거른다
        if (permissionRepository.existsByCode(code)) {
            throw ApiException.conflict("이미 등록된 권한 코드입니다.");
        }
        String[] parts = code.split(":", -1);
        var permission = new Permission(parts[0], parts[1], parts[2], description);
        permissionRepository.save(permission);
        auditService.record(AuditService.PERMISSION_CHANGED, null, actorId, null, null,
                Map.of("action", "CREATE", "code", code));
        return permission;
    }

    @Transactional
    public void deletePermission(Long id, Long actorId) {
        var permission = permissionRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound("권한"));
        permissionRepository.delete(permission);
        auditService.record(AuditService.PERMISSION_CHANGED, null, actorId, null, null,
                Map.of("action", "DELETE", "code", permission.getCode()));
    }

    // ── 역할 ──

    @Transactional(readOnly = true)
    public List<Role> listRoles() {
        return roleRepository.findAllWithPermissions();
    }

    @Transactional(readOnly = true)
    public Role getRole(Long id) {
        return roleRepository.findById(id).orElseThrow(() -> ApiException.notFound("역할"));
    }

    @Transactional
    public Role createRole(String code, String name, String description, Long actorId) {
        if (roleRepository.existsByCode(code)) {
            throw ApiException.conflict("이미 존재하는 역할 코드입니다.");
        }
        var role = roleRepository.save(new Role(code, name, description));
        auditService.record(AuditService.PERMISSION_CHANGED, null, actorId, null, null,
                Map.of("action", "ROLE_CREATE", "code", code));
        return role;
    }

    @Transactional
    public void deleteRole(Long id, Long actorId) {
        var role = getRole(id);
        if (role.isSystem()) {
            throw ApiException.conflict("시스템 역할은 삭제할 수 없습니다.");
        }
        roleRepository.delete(role);
        auditService.record(AuditService.PERMISSION_CHANGED, null, actorId, null, null,
                Map.of("action", "ROLE_DELETE", "code", role.getCode()));
    }

    /** 역할의 권한을 통째로 교체한다 */
    @Transactional
    public Role replaceRolePermissions(Long roleId, List<String> permissionCodes, Long actorId) {
        var role = getRole(roleId);
        role.getPermissions().clear();

        if (permissionCodes != null && !permissionCodes.isEmpty()) {
            var found = permissionRepository.findByCodeIn(permissionCodes);
            if (found.size() != permissionCodes.size()) {
                // 사전 등록제 (결정 A4) — 등록되지 않은 코드는 부여할 수 없다
                throw new ApiException(ErrorCode.AUTHZ_UNKNOWN_PERMISSION);
            }
            role.getPermissions().addAll(found);
        }
        // updatedAt 이 permissions_version 에 반영되도록 명시적으로 건드린다
        role.setUpdatedAt(java.time.Instant.now());

        auditService.record(AuditService.PERMISSION_CHANGED, null, actorId, null, null,
                Map.of("action", "ROLE_PERMISSIONS", "role", role.getCode(),
                        "permissions", permissionCodes == null ? List.of() : permissionCodes));
        return role;
    }

    // ── 그룹 ──

    @Transactional(readOnly = true)
    public List<Group> listGroups() {
        return groupRepository.findAllWithRoles();
    }

    @Transactional(readOnly = true)
    public Group getGroup(Long id) {
        return groupRepository.findById(id).orElseThrow(() -> ApiException.notFound("그룹"));
    }

    @Transactional
    public Group createGroup(String code, String name, String description, Long actorId) {
        if (groupRepository.existsByCode(code)) {
            throw ApiException.conflict("이미 존재하는 그룹 코드입니다.");
        }
        var group = groupRepository.save(new Group(code, name, description));
        auditService.record(AuditService.GROUP_CHANGED, null, actorId, null, null,
                Map.of("action", "CREATE", "code", code));
        return group;
    }

    @Transactional
    public void deleteGroup(Long id, Long actorId) {
        var group = getGroup(id);
        groupRepository.delete(group);
        auditService.record(AuditService.GROUP_CHANGED, null, actorId, null, null,
                Map.of("action", "DELETE", "code", group.getCode()));
    }

    @Transactional
    public Group replaceGroupRoles(Long groupId, List<String> roleCodes, Long actorId) {
        var group = getGroup(groupId);
        group.getRoles().clear();
        if (roleCodes != null && !roleCodes.isEmpty()) {
            var found = roleRepository.findByCodeIn(roleCodes);
            if (found.size() != roleCodes.size()) {
                throw new ApiException(ErrorCode.NOT_FOUND, "존재하지 않는 역할이 포함돼 있습니다.");
            }
            group.getRoles().addAll(found);
        }
        group.setUpdatedAt(java.time.Instant.now());
        auditService.record(AuditService.GROUP_CHANGED, null, actorId, null, null,
                Map.of("action", "ROLES", "group", group.getCode(),
                        "roles", roleCodes == null ? List.of() : roleCodes));
        return group;
    }

    /**
     * 그룹 구성원 조회. 계약에 있는 GET 을 구현한다.
     *
     * <p>OPENCLAW-FORK-DELTA: 원본에는 추가·삭제만 있고 조회가 없어, 부서를 지우려는 관리자가
     * "비었는가" 를 확인할 길이 로그인 이력뿐이었다. 아직 로그인하지 않은 사람도 구성원이다.</p>
     */
    @Transactional(readOnly = true)
    public List<team.prost.ixauth.domain.User> listMembers(Long groupId) {
        getGroup(groupId);
        return userRepository.findAllByGroupId(groupId);
    }

    @Transactional
    public void addMember(Long groupId, Long userId, Long actorId) {
        var group = getGroup(groupId);
        var user = userRepository.findById(userId).orElseThrow(() -> ApiException.notFound("사용자"));
        user.getGroups().add(group);
        auditService.record(AuditService.GROUP_CHANGED, userId, actorId, null, null,
                Map.of("action", "MEMBER_ADD", "group", group.getCode()));
    }

    @Transactional
    public void removeMember(Long groupId, Long userId, Long actorId) {
        var group = getGroup(groupId);
        var user = userRepository.findById(userId).orElseThrow(() -> ApiException.notFound("사용자"));
        user.getGroups().remove(group);
        auditService.record(AuditService.GROUP_CHANGED, userId, actorId, null, null,
                Map.of("action", "MEMBER_REMOVE", "group", group.getCode()));
    }
}
