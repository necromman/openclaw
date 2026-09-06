package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.repository.OAuthStateRepository;
import team.prost.ixauth.repository.SessionRepository;
import team.prost.ixauth.repository.VerificationTokenRepository;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * 만료된 세션·메일 토큰 정리.
 *
 * <p>둘 다 <b>만료 시각이 지나면 아무 효력이 없다.</b> 그런데 지우는 곳이 없으면
 * 테이블만 계속 자란다 — 로그인이 잦은 서비스에서 {@code sessions} 는 사용자 수가
 * 아니라 <b>로그인 횟수</b>만큼 쌓인다.</p>
 *
 * <p>바로 지우지 않고 유예를 둔다. 만료 직후의 행이 남아 있어야 "왜 로그아웃됐지" 를
 * 운영에서 추적할 수 있다. 감사 로그와 달리 이쪽은 보존 의무가 없으므로 짧게 잡는다.</p>
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ExpiredRecordCleanupJob {

    /** 만료 후 이만큼 지나면 지운다 — 그 사이는 원인 추적용으로 남겨 둔다 */
    private static final int GRACE_DAYS = 7;

    private final SessionRepository sessionRepository;
    private final VerificationTokenRepository tokenRepository;
    private final OAuthStateRepository oauthStateRepository;

    /** 감사 로그 정리(04:20) 와 겹치지 않게 04:40 */
    @Scheduled(cron = "0 40 4 * * *")
    @Transactional
    public void purge() {
        Instant before = Instant.now().minus(GRACE_DAYS, ChronoUnit.DAYS);

        int sessions = sessionRepository.deleteExpiredBefore(before);
        int tokens = tokenRepository.deleteExpiredBefore(before);
        // OAuth state 는 유예가 필요 없다 — 재사용되지 않고 추적 가치도 없다
        int states = oauthStateRepository.deleteExpiredBefore(Instant.now());

        if (sessions > 0 || tokens > 0 || states > 0) {
            log.info("만료 레코드 정리 — 세션 {}건, 메일 토큰 {}건, OAuth state {}건",
                    sessions, tokens, states);
        }
    }
}
