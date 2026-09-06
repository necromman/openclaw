package team.prost.ixauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import team.prost.ixauth.domain.Permission;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface PermissionRepository extends JpaRepository<Permission, Long> {

    Optional<Permission> findByCode(String code);

    boolean existsByCode(String code);

    List<Permission> findByDomain(String domain);

    List<Permission> findByCodeIn(List<String> codes);

    /**
     * permissions_version 원재료 — 권한 정의가 마지막으로 바뀐 시각.
     *
     * <p>전용 테이블을 두지 않고 {@code max(updated_at)} 을 쓴다. 그룹·역할 쪽 변경분과
     * 합쳐 최댓값을 취한 뒤 epoch 초로 환산해 토큰 클레임 {@code ixauth_pv} 에 싣는다
     * (docs/contract/authz.md §5).</p>
     */
    @Query("select max(p.updatedAt) from Permission p")
    Optional<Instant> findMaxUpdatedAt();
}
