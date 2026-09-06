package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.api.dto.AccountDtos;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.DeviceLabel;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.domain.Session;
import team.prost.ixauth.repository.SessionRepository;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 사용자가 자기 세션을 보고 끊는다.
 *
 * <p>"지금 어디에서 로그인돼 있는가" 를 스스로 확인할 수 있어야 한다. 이것이 없으면
 * 계정이 털렸을 때 사용자가 할 수 있는 일이 비밀번호 변경뿐이고, 그마저도 상대 세션이
 * 남아 있으면 소용이 없다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SessionQueryService {

    private final SessionRepository sessionRepository;
    private final SessionRevocationService revocationService;
    private final AuditService auditService;

    @Transactional(readOnly = true)
    public List<AccountDtos.SessionInfo> listActive(Long userId, UUID currentSessionId) {
        Instant now = Instant.now();
        return sessionRepository.findByUserIdOrderByIssuedAtDesc(userId).stream()
                .filter(s -> s.getRevokedAt() == null && s.getExpiresAt().isAfter(now))
                .map(s -> toInfo(s, currentSessionId))
                .toList();
    }

    /**
     * 내 세션 하나를 끊는다.
     *
     * <p>남의 세션 식별자를 넣어도 끊기지 않는다 — 소유자를 반드시 대조한다.
     * 이 확인을 빠뜨리면 세션 ID 하나로 아무나 로그아웃시킬 수 있다.</p>
     */
    @Transactional
    public void revokeOwn(Long userId, UUID sessionId, String ip, String userAgent) {
        Session session = sessionRepository.findById(sessionId)
                .filter(s -> s.getUserId().equals(userId))
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "세션을 찾을 수 없습니다."));

        if (session.getRevokedAt() == null) {
            session.setRevokedAt(Instant.now());
            sessionRepository.save(session);
        }
        auditService.record("SESSION_REVOKED", userId, userId, ip, userAgent,
                Map.of("sessionId", sessionId.toString()));
    }

    /** 전부 끊는다 — 현재 세션도 포함한다. 앱은 재로그인을 요구하면 된다 */
    @Transactional
    public void revokeAllOwn(Long userId, String ip, String userAgent) {
        int count = revocationService.revokeAllForUser(userId, Instant.now());
        auditService.record("ALL_SESSIONS_REVOKED", userId, userId, ip, userAgent,
                Map.of("count", count));
    }

    /**
     * 기기 이름은 <b>읽는 시점에</b> 만든다. 세션 행에 저장하지 않는 이유 — 파싱 규칙을
     * 고치면 이미 저장된 행은 옛 규칙으로 남아, 같은 기기가 목록에 두 이름으로 나온다.
     * 그러면 사용자는 "모르는 기기" 를 하나 더 보게 된다.
     */
    private AccountDtos.SessionInfo toInfo(Session s, UUID currentSessionId) {
        return new AccountDtos.SessionInfo(
                s.getId().toString(), s.getIssuedAt(), s.getLastUsedAt(), s.getExpiresAt(),
                s.getIp(), s.getUserAgent(), DeviceLabel.of(s.getUserAgent()),
                s.getId().equals(currentSessionId));
    }
}
