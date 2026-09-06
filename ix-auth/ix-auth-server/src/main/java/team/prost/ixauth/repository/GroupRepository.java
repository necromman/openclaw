package team.prost.ixauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import team.prost.ixauth.domain.Group;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface GroupRepository extends JpaRepository<Group, Long> {

    Optional<Group> findByCode(String code);

    boolean existsByCode(String code);

    List<Group> findByCodeIn(List<String> codes);

    @Query("select g from Group g left join fetch g.roles")
    List<Group> findAllWithRoles();

    /** permissions_version 산출용 — 그룹 정의 변경 시각 */
    @Query("select max(g.updatedAt) from Group g")
    Optional<Instant> findMaxUpdatedAt();
}
