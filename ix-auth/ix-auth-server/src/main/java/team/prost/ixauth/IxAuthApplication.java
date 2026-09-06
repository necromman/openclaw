package team.prost.ixauth;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * IX-Auth — 신규 프로젝트에 동봉되는 경량 인증 서버.
 *
 * <p>두 가지 방식으로 뜬다.</p>
 * <ul>
 *   <li>사이드카 — 이 jar 를 독립 프로세스로 실행 (기술스택 무관한 앱과 동거)</li>
 *   <li>in-process — Spring Boot 앱의 의존성으로 편입 [P4]</li>
 * </ul>
 *
 * <p>어느 쪽이든 외부에 노출하지 않는다. 앱이 중계한다 (설계 불변식 4).</p>
 */
@SpringBootApplication
@ConfigurationPropertiesScan
@org.springframework.scheduling.annotation.EnableScheduling   // 감사 로그 보존 배치
public class IxAuthApplication {

    public static void main(String[] args) {
        SpringApplication.run(IxAuthApplication.class, args);
    }
}
