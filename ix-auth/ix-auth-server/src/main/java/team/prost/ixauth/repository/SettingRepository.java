package team.prost.ixauth.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import team.prost.ixauth.domain.Setting;

public interface SettingRepository extends JpaRepository<Setting, String> {
}
