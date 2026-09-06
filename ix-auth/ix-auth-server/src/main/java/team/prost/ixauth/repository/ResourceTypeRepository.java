package team.prost.ixauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import team.prost.ixauth.domain.ResourceType;

import java.util.List;

public interface ResourceTypeRepository extends JpaRepository<ResourceType, String> {

    List<ResourceType> findAllByOrderByCodeAsc();
}
