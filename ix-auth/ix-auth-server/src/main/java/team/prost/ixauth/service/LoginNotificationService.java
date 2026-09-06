package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.common.DeviceLabel;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.User;
import team.prost.ixauth.mail.MailService;
import team.prost.ixauth.repository.SessionRepository;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * 새 기기·새 IP 로그인 알림.
 *
 * <p><b>왜 이 기능이 있는가.</b> 계정을 빼앗겼을 때 사용자가 스스로 알아챌 수 있는
 * 통로가 사실상 이것뿐이다. 세션 목록에도 같은 정보가 있지만 그건 <b>들여다봐야</b>
 * 보이고, 남의 계정을 조용히 쓰는 쪽은 사용자가 들여다볼 이유를 만들지 않는다.</p>
 *
 * <p><b>판정 근거를 따로 저장하지 않는다.</b> "이 조합으로 전에 들어온 적이 있는가" 는
 * {@code sessions} 에 이미 다 있다. 같은 사실을 두 곳에 적으면 반드시 어긋나고, 그
 * 어긋남이 곧 오탐(멀쩡한 기기에 알림)과 미탐(진짜 침입에 침묵)이 된다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LoginNotificationService {

    private final SessionRepository sessionRepository;
    private final MailService mailService;
    private final AuditService auditService;
    private final IxAuthProperties properties;

    /**
     * 처음 보는 (IP, User-Agent) 조합이면 본인에게 알린다.
     *
     * <p><b>로그인 경로에서만 부른다 — 토큰 갱신에서는 부르지 않는다.</b> 갱신도 세션을
     * 새로 만들지만 그건 로그인이 아니고, 갱신마다 판정하면 이동 중인 휴대폰이 IP 를
     * 바꿀 때마다 메일이 나간다. 그런 알림은 몇 번 만에 읽히지 않게 되고, 그러면
     * 정작 진짜 침입 때도 읽히지 않는다.</p>
     *
     * <p>판정을 세션 발급 <b>뒤</b>에 하는 대신 방금 만든 세션을 제외한다. 앞에서 하면
     * 아직 저장 전이라 "이번 로그인" 자체를 세는 실수가 없지만, 발급이 실패하는
     * 경우에도 알림이 나가 버린다.</p>
     */
    @Transactional
    public void notifyIfNewDevice(User user, UUID sessionId, String ip, String userAgent,
                                  Instant now) {
        if (!properties.getAccount().isNotifyNewDevice()) {
            return;
        }
        // 첫 로그인에는 보내지 않는다. 가입 직후 전원에게 "새 기기에서 로그인되었습니다" 가
        // 가면 그건 알림이 아니라 소음이고, 사용자는 이 메일 전체를 무시하기 시작한다
        if (sessionRepository.countByUserIdAndIdNot(user.getId(), sessionId) == 0) {
            return;
        }
        if (sessionRepository.countSameDevice(user.getId(), sessionId,
                nullToEmpty(ip), nullToEmpty(userAgent)) > 0) {
            return;
        }

        String device = DeviceLabel.of(userAgent);
        // 발송은 실패해도 로그인을 깨뜨리지 않는다 — 전송 계층이 예외를 삼킨다
        // (SmtpMailSender 주석). 여기서 다시 감싸면 그 규칙이 두 곳으로 갈라진다
        mailService.sendNewDeviceLogin(user.getEmail(), user.getName(), now, ip, device);
        auditService.record(AuditService.NEW_DEVICE_LOGIN, user.getId(), user.getId(),
                ip, userAgent, Map.of("device", device));
        log.info("새 기기 로그인 알림 — user={} device={}", user.getId(), device);
    }

    /**
     * null 을 파라미터로 넘기지 않는다. PostgreSQL 은 null 파라미터의 타입을 추론하지
     * 못해 터진다 ({@code UserRepository.search} 주석의 실측 사례). 질의 쪽에서
     * {@code coalesce} 로 맞춘다.
     */
    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }
}
