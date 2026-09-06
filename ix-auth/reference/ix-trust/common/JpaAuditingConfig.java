package team.prost.ixtrust.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

/**
 * JPA Auditing 활성화 설정.
 * BaseEntity의 createdAt, updatedAt 자동 관리.
 */
@Configuration
@EnableJpaAuditing
public class JpaAuditingConfig {
}
