package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.repository.AuditLogRepository;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * 감사 로그 보존 기간 정리.
 *
 * <p>감사 로그는 append-only 이고 일반 경로에서 삭제하지 않는다. 무한정 쌓이면 앱 DB 를
 * 잠식하므로 <b>이 배치만</b> 예외적으로 삭제한다 (.claude/rules/coding-style.md 보안 규칙 5).</p>
 *
 * <p>{@code ixauth.audit.retention-days = 0} 이면 무기한 보존하고 아무것도 지우지 않는다.</p>
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AuditRetentionJob {

    private final AuditLogRepository repository;
    private final IxAuthProperties properties;

    /** 매일 새벽 4시 20분 — 운영 트래픽이 가장 적은 시간대 */
    @Scheduled(cron = "0 20 4 * * *")
    @Transactional
    public void purge() {
        int days = properties.getAudit().getRetentionDays();
        if (days <= 0) {
            return;   // 무기한 보존
        }
        Instant before = Instant.now().minus(days, ChronoUnit.DAYS);
        int deleted = repository.deleteOlderThan(before);
        if (deleted > 0) {
            log.info("감사 로그 정리 — {}일 경과분 {}건 삭제", days, deleted);
        }
    }
}
