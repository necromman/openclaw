package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.repository.SessionRepository;

import java.time.Instant;

/**
 * 세션 강제 폐기.
 *
 * <p><b>반드시 별도 트랜잭션에서 커밋한다.</b> refresh 재사용이 감지되면 전 세션을 끊고
 * 곧바로 예외를 던지는데, 그 예외가 주 트랜잭션을 롤백시키면 <b>폐기가 함께 취소되어
 * 탈취된 토큰이 계속 살아 있게 된다</b> (2026-08-08 실측으로 확인한 보안 버그 —
 * 재사용 감지 후에도 다른 세션이 정상 동작했다).</p>
 *
 * <p>계정 잠금({@link LoginAttemptService})이 겪은 것과 같은 함정이다.</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SessionRevocationService {

    private final SessionRepository sessionRepository;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public int revokeAllForUser(Long userId, Instant now) {
        int revoked = sessionRepository.revokeAllByUserId(userId, now);
        log.warn("사용자 {} 의 세션 {}개를 폐기했다", userId, revoked);
        return revoked;
    }
}
