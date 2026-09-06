package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.config.IxAuthProperties.SelfDeleteMode;
import team.prost.ixauth.domain.User;
import team.prost.ixauth.domain.UserStatus;
import team.prost.ixauth.mail.MailService;
import team.prost.ixauth.repository.UserRepository;

import java.time.Instant;
import java.util.Map;

/**
 * 본인 탈퇴 — 요청 · 취소 · 유예 만료 집행.
 *
 * <p><b>물리 삭제하지 않는다.</b> 행을 지우면 두 가지가 무너진다. ① 감사 로그의
 * {@code user_id} 가 가리킬 곳이 사라져 "누가 무엇을 했는지" 를 되짚을 수 없다.
 * ② 같은 주소로 다시 가입해 자기 이력을 지울 수 있다 — 정지·거절당한 사람이
 * 탈퇴 후 재가입으로 기록을 세탁하는 경로가 된다. 그래서 관리자 소프트 삭제와
 * 같은 자리({@code status = DISABLED})를 쓰고, 요청 시각만 따로 남긴다.</p>
 *
 * <p><b>유예를 두는 이유는 하나다 — 홧김에 누른 것을 되돌리기 위해서다.</b>
 * 그래서 취소 조건이 "로그인 한 번" 이다. 별도의 취소 화면·취소 링크를 만들지 않는
 * 것도 같은 이유로, 그 링크가 담긴 메일함을 쥔 쪽이 탈퇴를 되돌릴 수 있으면 안 된다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AccountDeletionService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final MailService mailService;
    private final AuditService auditService;
    private final SessionRevocationService sessionRevocationService;
    private final IxAuthProperties properties;

    /**
     * @param mode        적용된 방식. {@code IMMEDIATE} 면 이 응답 시점에 이미 비활성이다
     * @param effectiveAt 실제로 비활성이 되는 시각. 그때까지는 로그인으로 취소할 수 있다
     */
    public record Result(String mode, Instant effectiveAt) {
    }

    /**
     * 탈퇴 요청. <b>현재 비밀번호를 반드시 확인한다.</b>
     *
     * <p>확인하지 않으면 잠깐 자리를 비운 사이 남이 계정을 닫아 버릴 수 있다.
     * 비밀번호 변경·이메일 변경과 같은 급의 행위다.</p>
     */
    @Transactional
    public Result requestSelfDelete(Long userId, String currentPassword,
                                    String ip, String userAgent) {
        SelfDeleteMode mode = properties.getAccount().getSelfDeleteMode();
        if (mode == SelfDeleteMode.DISABLED) {
            throw new ApiException(ErrorCode.AUTH_SELF_DELETE_DISABLED);
        }
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "사용자를 찾을 수 없습니다."));
        requirePassword(user, currentPassword, ip, userAgent);

        Instant now = Instant.now();
        // 이미 요청해 둔 상태면 시각을 갱신하지 않는다. 누를 때마다 유예가 뒤로 밀리면
        // 유예가 영영 끝나지 않고, 사용자는 자기가 언제 탈퇴되는지 알 수 없게 된다
        if (user.getDeletionRequestedAt() == null) {
            user.setDeletionRequestedAt(now);
        }
        boolean immediate = mode == SelfDeleteMode.IMMEDIATE;
        Instant effectiveAt = immediate
                ? now
                : user.getDeletionRequestedAt().plus(properties.getAccount().getSelfDeleteGrace());
        if (immediate) {
            user.setStatus(UserStatus.DISABLED);
        }
        userRepository.save(user);

        // 어느 쪽이든 세션은 전부 끊는다. 남겨 두면 "탈퇴했는데 아직 로그인돼 있다" 가 되고,
        // 유예 모드에서는 그 세션이 살아 있는 한 취소 조건(로그인)이 성립하지도 않는다
        sessionRevocationService.revokeAllForUser(userId, now);

        if (immediate) {
            mailService.sendAccountDeleted(user.getEmail(), user.getName());
        } else {
            mailService.sendAccountDeleteRequested(user.getEmail(), user.getName(), effectiveAt);
        }
        auditService.record(immediate ? AuditService.SELF_DELETED
                        : AuditService.SELF_DELETE_REQUESTED,
                userId, userId, ip, userAgent, Map.of("mode", mode.name()));
        return new Result(mode.name(), effectiveAt);
    }

    /**
     * 유예 중에 로그인하면 취소한다 — 로그인 경로가 부른다.
     *
     * <p>사용자에게 아무것도 요구하지 않는 것이 핵심이다. "취소하시겠습니까" 를
     * 물으면 홧김에 눌렀던 사람이 또 한 번 결정을 강요받는다.</p>
     */
    @Transactional
    public void cancelIfPending(User user, String ip, String userAgent) {
        if (user.getDeletionRequestedAt() == null || user.getStatus() == UserStatus.DISABLED) {
            return;
        }
        user.setDeletionRequestedAt(null);
        userRepository.save(user);
        auditService.record(AuditService.SELF_DELETE_CANCELED, user.getId(), user.getId(),
                ip, userAgent, Map.of());
        log.info("탈퇴 유예 중 로그인 — user={} 탈퇴를 취소했다", user.getId());
    }

    /**
     * 유예가 끝난 요청을 비활성으로 바꾼다. 야간 배치가 부른다.
     *
     * <p>모드가 {@code GRACE} 가 아니면 아무것도 하지 않는다. 관리자가 탈퇴 기능을
     * 껐는데 남아 있던 요청이 뒤늦게 집행되면, 아무도 그 계정이 왜 닫혔는지 알 수 없다.</p>
     */
    @Transactional
    public int applyDueDeletions(Instant now) {
        var account = properties.getAccount();
        if (account.getSelfDeleteMode() != SelfDeleteMode.GRACE) {
            return 0;
        }
        var due = userRepository.findDeletionDue(
                now.minus(account.getSelfDeleteGrace()), UserStatus.DISABLED);
        for (User user : due) {
            user.setStatus(UserStatus.DISABLED);
            userRepository.save(user);
            sessionRevocationService.revokeAllForUser(user.getId(), now);
            mailService.sendAccountDeleted(user.getEmail(), user.getName());
            // actor 는 사용자 자신이다 — 관리자가 아니라 본인이 요청한 결과다
            auditService.record(AuditService.SELF_DELETED, user.getId(), user.getId(),
                    null, null, Map.of("mode", SelfDeleteMode.GRACE.name()));
        }
        return due.size();
    }

    /**
     * 비밀번호 확인. 실패는 감사 로그에 남긴다 — 남의 계정을 닫으려던 시도가
     * 흔적 없이 지나가면 안 된다.
     */
    private void requirePassword(User user, String raw, String ip, String userAgent) {
        // 소셜로만 쓰는 계정은 비밀번호가 없다. 그 경우 여기서 막고 관리자에게 보낸다 —
        // 확인 수단이 없는 채로 계정을 닫아 주면 토큰 하나로 남의 계정을 닫을 수 있다
        if (user.getPasswordHash() == null
                || !passwordEncoder.matches(raw, user.getPasswordHash())) {
            auditService.record(AuditService.SELF_DELETE_REQUESTED, user.getId(), user.getId(),
                    ip, userAgent, Map.of("result", "PASSWORD_MISMATCH"));
            throw new ApiException(ErrorCode.AUTH_INVALID_CREDENTIALS,
                    "현재 비밀번호가 올바르지 않습니다.");
        }
    }
}
