package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.Session;
import team.prost.ixauth.repository.SessionRepository;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 계정당 동시 활성 세션 상한 — 넘치면 <b>가장 오래된 것부터</b> 폐기한다.
 *
 * <p><b>왜 오래된 쪽인가.</b> 넘친 것은 방금 로그인한 사람 때문인데 그를 끊으면
 * 로그인이 그 자리에서 실패한 것처럼 보인다. 사용자는 무엇이 잘못됐는지 알 수 없고
 * 계속 다시 시도한다. 오래된 쪽을 끊으면 "다른 기기에서 로그아웃됐다" 라는, 적어도
 * 원인을 짐작할 수 있는 현상이 된다.</p>
 *
 * <p><b>기본값이 0(제한 없음)인 이유</b>는 {@code IxAuthProperties.Account} 에 적어 두었다 —
 * 제한을 기본으로 걸면 여러 기기를 쓰는 사람이 영문도 모르고 로그아웃된다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SessionLimitService {

    private final SessionRepository sessionRepository;
    private final AuditService auditService;
    private final IxAuthProperties properties;

    /**
     * 상한을 적용한다. 로그인 경로에서만 부른다 — 토큰 갱신은 세션 수를 늘리지 않는다
     * (옛 세션을 폐기하고 새것을 만드는 회전이다).
     *
     * @param keepSessionId 방금 발급한 세션. 상한이 1 이어도 <b>이것만은 살아남아야 한다</b> —
     *                      끊어 버리면 로그인에 성공하고도 곧바로 못 쓰는 토큰을 받는다
     * @return 실제로 폐기한 세션 수
     */
    @Transactional
    public int enforce(Long userId, UUID keepSessionId, String ip, String userAgent, Instant now) {
        int max = properties.getAccount().getMaxConcurrentSessions();
        if (max <= 0) {
            return 0;      // 0 = 제한 없음 (기본값)
        }

        List<Session> active = sessionRepository.findActiveOldestFirst(userId, now);
        int over = active.size() - max;
        if (over <= 0) {
            return 0;
        }

        var doomed = new ArrayList<UUID>(over);
        for (Session s : active) {
            if (doomed.size() >= over) {
                break;
            }
            // 목록은 오래된 순이라 방금 만든 세션은 맨 뒤에 있어 여기 걸리지 않는다.
            // 그래도 명시적으로 막아 둔다 — 이 불변식이 깨지면 증상이 "로그인은 됐는데
            // 바로 튕긴다" 라 원인을 찾기가 매우 어렵다
            if (s.getId().equals(keepSessionId)) {
                continue;
            }
            doomed.add(s.getId());
        }
        if (doomed.isEmpty()) {
            return 0;
        }

        int revoked = sessionRepository.revokeByIds(doomed, now);
        // 사용자에게는 "갑자기 로그아웃됐다" 로 보인다. 남기지 않으면 그 문의에 답할 근거가 없다
        auditService.record(AuditService.SESSION_EVICTED, userId, userId, ip, userAgent,
                Map.of("revoked", revoked, "limit", max));
        log.info("동시 세션 상한({}) 초과 — user={} 세션 {}개 폐기", max, userId, revoked);
        return revoked;
    }
}
