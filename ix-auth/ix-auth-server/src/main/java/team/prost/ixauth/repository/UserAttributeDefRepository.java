package team.prost.ixauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import team.prost.ixauth.domain.UserAttributeDef;

import java.util.List;

public interface UserAttributeDefRepository extends JpaRepository<UserAttributeDef, String> {

    /** 화면이 그리는 순서 그대로 — 정의한 순서가 곧 입력 폼의 순서다 */
    List<UserAttributeDef> findAllByOrderByDisplayOrderAscKeyAsc();
}
