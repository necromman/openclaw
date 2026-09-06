package team.prost.ixauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import team.prost.ixauth.domain.Role;

import java.util.List;
import java.util.Optional;

public interface RoleRepository extends JpaRepository<Role, Long> {

    Optional<Role> findByCode(String code);

    boolean existsByCode(String code);

    List<Role> findByCodeIn(List<String> codes);

    /**
     * permission-map 원재료 — 역할코드 · 권한코드 쌍 전체.
     *
     * <p>앱이 부팅 시 1회 받아 캐싱한다. 역할이 수백 개가 아닌 한 수 KB 수준이다
     * (docs/contract/authz.md §5).</p>
     */
    @Query("select r.code, p.code from Role r join r.permissions p order by r.code, p.code")
    List<Object[]> findAllRolePermissionPairs();

    @Query("select r from Role r left join fetch r.permissions")
    List<Role> findAllWithPermissions();
}
