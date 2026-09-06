package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.User;
import team.prost.ixauth.repository.UserRepository;
import team.prost.ixauth.security.JwtService;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 사용자 대리(impersonation) — 관리자가 특정 사용자로 전환한다.
 *
 * <p>답하려는 질문은 하나다: <b>"저는 그 화면이 안 나와요" 를 어떻게 재현하는가.</b>
 * 대안은 그 사람의 비밀번호를 초기화하고 로그인해 보는 것인데, 그건 사용자를 실제로
 * 쫓아내고 감사 로그에 <b>본인 로그인</b>으로 남는다. 대리가 오히려 흔적이 정확하다.</p>
 *
 * <p>발급되는 것은 <b>대상 사용자의</b> access/refresh token 이고, access token 에는
 * 표준 {@code act} 클레임으로 관리자가 실린다 (docs/contract/token.md §3).</p>
 *
 * <p>이 서비스가 지키는 네 가지:</p>
 * <ol>
 *   <li>전용 권한 {@code ixauth:impersonation:create} — 호출자 검사는 컨트롤러가 한다</li>
 *   <li>대상은 {@code ACTIVE} 만. 자기 자신은 대리하지 않는다</li>
 *   <li>시작은 반드시 감사 로그에 남는다 — 끌 수 없다</li>
 *   <li>대리 세션은 민감 작업을 하지 못한다 ({@code ImpersonationGuard})</li>
 * </ol>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ImpersonationService {

    private final UserRepository userRepository;
    private final AuthService authService;
    private final AuditService auditService;
    private final IxAuthProperties properties;

    /**
     * 대리를 시작한다.
     *
     * @param targetId 대리 대상 사용자
     * @param actor    호출한 관리자 (id · email)
     * @return 대상 사용자의 로그인 결과와 동일한 모양
     */
    @Transactional
    public AuthService.LoginResult start(Long targetId, JwtService.Actor actor,
                                         String userAgent, String ip) {
        if (!properties.getImpersonation().isEnabled()) {
            throw new ApiException(ErrorCode.IMPERSONATION_DISABLED);
        }
        if (actor.userId().equals(targetId)) {
            // 권한이 아니라 요청 자체가 성립하지 않는다 — 400 인 이유는 ErrorCode 주석
            throw new ApiException(ErrorCode.IMPERSONATION_SELF);
        }

        User target = userRepository.findById(targetId)
                .orElseThrow(() -> ApiException.notFound("사용자"));

        // 잠긴·비활성·승인대기 계정을 대리하면 <b>본인은 못 들어오는데 관리자는 들어가는</b>
        // 상태가 된다. 재현하려던 화면이 애초에 그 사람에게 보이지 않는 화면이라
        // 조사 결과 자체가 틀어진다
        if (!target.isActive()) {
            throw new ApiException(ErrorCode.IMPERSONATION_TARGET_NOT_ACTIVE,
                    "활성 상태인 사용자만 대리할 수 있습니다. 현재 상태: " + target.getStatus());
        }

        var result = authService.issueImpersonated(target, actor, userAgent, ip);

        // userId=대상 · actorId=관리자. 이 한 줄이 없으면 이후 그 세션이 남기는 모든
        // 기록을 본인이 한 일과 구분할 수 없다
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("targetId", target.getId());
        detail.put("targetEmail", target.getEmail());
        detail.put("impersonatorEmail", actor.email());
        detail.put("ttl", properties.getImpersonation().getTtl().toString());
        auditService.record(AuditService.IMPERSONATION_STARTED, target.getId(), actor.userId(),
                ip, userAgent, detail);

        log.info("사용자 대리 시작 — 관리자={} 대상={}", actor.userId(), target.getId());
        return result;
    }
}
