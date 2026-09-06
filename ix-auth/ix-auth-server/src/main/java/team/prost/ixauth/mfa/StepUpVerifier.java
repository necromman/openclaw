package team.prost.ixauth.mfa;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.config.IxAuthProperties.StepUpAction;
import team.prost.ixauth.service.MfaService;

import java.util.Map;

/**
 * 민감 작업 앞의 재인증 — "지금 이 순간에도 본인인가".
 *
 * <h2>현재 비밀번호만으로는 부족한 이유</h2>
 *
 * <p>비밀번호 변경·이메일 변경·탈퇴는 이미 현재 비밀번호를 요구한다. 그런데 비밀번호는
 * <b>한 번 새면 계속 새어 있는</b> 값이다 — 피싱·유출·어깨너머로 넘어간 비밀번호는
 * 바꾸기 전까지 계속 유효하고, 공격자는 그것을 그대로 다시 입력하면 된다. 즉 "이 사람이
 * 비밀번호를 안다" 는 것은 증명하지만 "지금 이 사람이 계정 주인이다" 는 증명하지 못한다.</p>
 *
 * <p>TOTP 코드는 30초마다 바뀌므로 그 질문에 답할 수 있다. 훔친 비밀번호로 로그인한
 * 쪽은 <b>이메일을 바꿔 계정을 통째로 가져가는 마지막 한 걸음</b>에서 막힌다.</p>
 *
 * <h2>어디에도 강제로 걸지 않는다</h2>
 *
 * <p>기본은 비어 있다({@code mfa.step-up-actions}). 켜면 앱이 그 화면에서
 * {@code mfaCode} 를 받아 보내도록 고쳐야 하고, 고치기 전에 켜면 그 화면들이 전부
 * 실패한다. <b>앱을 먼저 고치고 켜는 순서</b>여야 한다.</p>
 *
 * <p>2단계를 켜지 않은 계정에는 적용되지 않는다 — 요구할 코드 자체가 없다. 거기서
 * 막아 봐야 그 사람은 비밀번호조차 바꿀 수 없게 될 뿐이고, 그건 보안이 아니라 장애다.
 * 전원에게 강제하고 싶다면 {@code mfa.mode = REQUIRED_ALL} 이 그 수단이다.</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class StepUpVerifier {

    private final MfaService mfaService;
    private final IxAuthProperties properties;

    /**
     * 이 작업에 재인증이 걸려 있으면 코드를 확인하고, 걸리지 않았으면 아무것도 하지 않는다.
     *
     * @param code 요청 본문의 {@code mfaCode}. 인증 앱의 6자리 <b>또는 백업 코드</b> —
     *             로그인 2단계와 같은 자리다. 휴대폰이 없을 때 백업 코드로도 넘어갈 수
     *             있어야 민감 작업이 영영 막히지 않는다
     * @throws ApiException 필요한데 코드가 없으면 {@code AUTH_MFA_REQUIRED},
     *                      틀리면 {@code AUTH_MFA_INVALID}
     */
    public void require(StepUpAction action, Long userId, String code,
                        String ip, String userAgent) {
        if (!isRequired(action)) {
            return;
        }
        if (!mfaService.isActive(userId)) {
            // 2단계를 안 켠 계정. 요구할 코드가 없으므로 통과시킨다 —
            // 현재 비밀번호 확인은 호출부가 이미 했다
            return;
        }
        if (code == null || code.isBlank()) {
            log.debug("step-up 코드 없음 — action={} user={}", action, userId);
            // 로그인의 MFA_REQUIRED 와 같은 코드지만 meta 에 challenge 가 없다.
            // 앱은 그 차이로 둘을 구분한다 — 여기서는 코드를 받아 같은 요청을 다시 보내면 된다
            throw new ApiException(ErrorCode.AUTH_MFA_REQUIRED,
                    "이 작업에는 2단계 인증 코드가 필요합니다.", null,
                    Map.of("stepUp", action.name()));
        }
        mfaService.verifyStepUpCode(userId, code, ip, userAgent);
    }

    /** 앱이 화면에 코드 입력 칸을 그릴지 미리 판단할 수 있게 열어 둔다 */
    public boolean isRequired(StepUpAction action) {
        var actions = properties.getMfa().getStepUpActions();
        return actions != null && actions.contains(action);
    }
}
