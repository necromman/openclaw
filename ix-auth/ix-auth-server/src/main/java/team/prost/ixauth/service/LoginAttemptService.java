package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.UserStatus;
import team.prost.ixauth.repository.UserRepository;

import java.time.Instant;
import java.util.Map;

/**
 * 로그인 실패 누적 · 계정 잠금.
 *
 * <p><b>반드시 별도 트랜잭션에서 커밋한다.</b> 로그인 실패는 예외를 던져 끝나는데,
 * 그 예외가 주 트랜잭션을 롤백시키면 실패 카운터도 함께 사라진다. 그러면 몇 번을
 * 틀려도 카운터가 0으로 되돌아가 <b>계정 잠금이 영원히 작동하지 않는다</b>
 * (2026-08-08 실측으로 확인한 버그).</p>
 */
@Service
@RequiredArgsConstructor
public class LoginAttemptService {

    private final UserRepository userRepository;
    private final IxAuthProperties properties;
    private final AuditService auditService;

    /**
     * 실패를 누적하고 임계에 닿으면 잠근다.
     *
     * @return 이번 실패로 잠겼으면 true
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean registerFailure(Long userId, String ip, String userAgent) {
        var lockout = properties.getLockout();
        var user = userRepository.findById(userId).orElse(null);
        if (user == null) {
            return false;
        }
        Instant now = Instant.now();

        if (!lockout.isEnabled()) {
            auditService.record(AuditService.LOGIN_FAILURE, userId, null, ip, userAgent,
                    Map.of("reason", "BAD_PASSWORD"));
            return false;
        }

        // 마지막 실패로부터 reset-window 가 지났으면 카운터를 새로 센다
        int count = 1;
        if (user.getLastFailedAt() != null
                && user.getLastFailedAt().plus(lockout.getResetWindow()).isAfter(now)) {
            count = user.getFailedCount() + 1;
        }
        user.setFailedCount(count);
        user.setLastFailedAt(now);

        boolean locked = count >= lockout.getMaxAttempts();
        if (locked) {
            user.setLockedUntil(now.plus(lockout.getDuration()));
            user.setStatus(UserStatus.LOCKED);
        }
        userRepository.saveAndFlush(user);

        auditService.record(locked ? AuditService.ACCOUNT_LOCKED : AuditService.LOGIN_FAILURE,
                userId, null, ip, userAgent, Map.of("attempts", count));
        return locked;
    }

    /**
     * 로그인 성공 — 카운터를 비운다. 주 트랜잭션에서 처리해도 되지만 대칭을 위해 여기 둔다.
     *
     * <p>푸는 것은 <b>이 서비스가 건 자동 잠금뿐</b>이다. 관리자가 건 잠금
     * ({@code status=LOCKED} · {@code locked_until} 없음)까지 풀면, 차단해 둔 계정이
     * 로그인 한 번으로 되살아난다 (User#clearAutomaticLock).</p>
     */
    @Transactional
    public void registerSuccess(Long userId, Instant now) {
        userRepository.findById(userId).ifPresent(user -> {
            user.clearAutomaticLock();
            user.setLastLoginAt(now);
        });
    }
}
