package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;

/**
 * 유예가 끝난 탈퇴 요청을 집행한다.
 *
 * <p>요청 시점에 미래를 예약하지 않고 <b>매일 훑는 방식</b>을 쓴다. 예약을 메모리에
 * 두면 인스턴스가 재시작되거나 여러 대일 때 어느 쪽이 실행할지가 불분명해지고,
 * 그걸 정리하려면 전용 스케줄 저장소가 필요해진다 — 설계 불변식 3(전용 인프라를
 * 두지 않는다)에 어긋난다. 하루 한 번 훑는 비용은 부분 인덱스가 있어 무시할 만하다.</p>
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AccountDeletionJob {

    private final AccountDeletionService accountDeletionService;

    /** 감사 정리(04:20)·만료 레코드 정리(04:40) 와 겹치지 않게 04:50 */
    @Scheduled(cron = "0 50 4 * * *")
    public void apply() {
        int applied = accountDeletionService.applyDueDeletions(Instant.now());
        if (applied > 0) {
            log.info("탈퇴 유예가 끝난 계정 {}건을 비활성화했다", applied);
        }
    }
}
