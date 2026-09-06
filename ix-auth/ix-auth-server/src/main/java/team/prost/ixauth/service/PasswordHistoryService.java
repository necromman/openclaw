package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.PasswordHistory;
import team.prost.ixauth.repository.PasswordHistoryRepository;

/**
 * 최근 N개 비밀번호 재사용 금지 ({@code password.history-count}).
 *
 * <p><b>기본은 0 — 아무것도 하지 않는다.</b> 이력을 남기려면 지난 비밀번호의 해시를
 * 계속 보관해야 하고, 그건 보관하는 개인정보를 늘리는 일이다. 공공·금융처럼 요구받는
 * 곳에서만 켠다. 0 이어도 <b>직전</b> 비밀번호는 {@code AccountService} 가 현재 해시와
 * 비교해 늘 막는다 — 그건 이력이 아니라 현재 값과의 비교라 추가 보관이 없다.</p>
 *
 * <p>비교는 해시끼리 하지 않고 {@link PasswordEncoder#matches}로 한다. bcrypt 는 salt 가
 * 매번 달라서 같은 비밀번호도 다른 해시가 되고, 해시를 맞대 보면 <b>아무것도 걸리지
 * 않는다</b> — 검사가 있는데 통과만 시키는, 가장 나쁜 상태가 된다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PasswordHistoryService {

    private final PasswordHistoryRepository repository;
    private final PasswordEncoder passwordEncoder;
    private final IxAuthProperties properties;

    /** 켜져 있는가. 음수는 0 으로 본다 — 화면에서 잘못 넣어도 검사가 뒤집히지 않게 */
    private int limit() {
        return Math.max(0, properties.getPassword().getHistoryCount());
    }

    /**
     * 최근 N개에 있으면 거부한다.
     *
     * <p>호출 지점이 중요하다 — <b>토큰을 소모하기 전에</b> 불러야 한다. 재설정 링크를
     * 눌러 들어온 사람이 "최근에 쓴 비밀번호" 를 적었다는 이유로 링크까지 잃으면
     * 메일을 처음부터 다시 받아야 한다 (http-api.md §2-1 의 정책 검사 순서와 같은 이유).</p>
     */
    @Transactional(readOnly = true)
    public void assertNotReused(Long userId, String rawPassword) {
        int keep = limit();
        if (keep == 0 || userId == null || rawPassword == null) {
            return;
        }
        var recent = repository.findByUserIdOrderByCreatedAtDesc(userId, PageRequest.of(0, keep));
        boolean reused = recent.stream()
                .anyMatch(h -> passwordEncoder.matches(rawPassword, h.getPasswordHash()));
        if (reused) {
            throw new ApiException(ErrorCode.AUTH_PASSWORD_REUSED,
                    "최근 " + keep + "개 안에 쓴 비밀번호는 다시 사용할 수 없습니다.");
        }
    }

    /**
     * 바뀐 비밀번호의 해시를 이력에 남기고 상한을 넘은 것을 지운다.
     *
     * <p>꺼져 있으면 남기지 않을 뿐 아니라 <b>이미 쌓인 것을 지운다.</b> 검사에 쓰지
     * 않을 해시를 계속 들고 있을 이유가 없다 — 이력은 기록용이 아니라 검사용이고,
     * "누가 언제 비밀번호를 바꿨는가" 는 감사 로그가 이미 갖고 있다.</p>
     */
    @Transactional
    public void record(Long userId, String passwordHash) {
        if (userId == null || passwordHash == null) {
            return;
        }
        int keep = limit();
        if (keep == 0) {
            repository.deleteAllForUser(userId);
            return;
        }
        repository.save(new PasswordHistory(userId, passwordHash));
        // 방금 넣은 것까지 세어 keep 개만 남긴다
        int removed = repository.trimTo(userId, keep);
        if (removed > 0) {
            log.debug("비밀번호 이력 정리 — user={} 삭제 {}건 (상한 {})", userId, removed, keep);
        }
    }
}
