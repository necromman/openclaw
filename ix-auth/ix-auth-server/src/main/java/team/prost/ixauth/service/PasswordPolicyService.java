package team.prost.ixauth.service;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.password.BreachedPasswordChecker;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 비밀번호 정책 검증. 위반 항목을 details 로 돌려줘 사용자가 무엇을 고쳐야 할지 알 수 있게 한다.
 *
 * <p>여기서 보는 것은 <b>비밀번호 자체의 성질</b>뿐이다 — 길이·구성·유출 여부.
 * "이 사람이 전에 쓴 적이 있는가" 는 사용자를 알아야 하는 판단이라
 * {@link PasswordHistoryService} 가 따로 본다.</p>
 */
@Service
@RequiredArgsConstructor
public class PasswordPolicyService {

    private static final String SPECIALS = "!@#$%^&*()_+-=[]{}|;:',.<>/?~`\"\\";

    private final IxAuthProperties properties;
    private final BreachedPasswordChecker breachedChecker;

    public void validate(String raw) {
        var policy = properties.getPassword();
        List<Map<String, String>> violations = new ArrayList<>();

        if (raw == null || raw.length() < policy.getMinLength()) {
            violations.add(Map.of("field", "password",
                    "reason", "최소 " + policy.getMinLength() + "자 이상이어야 합니다."));
        }
        if (raw != null) {
            if (policy.isRequireUppercase() && raw.chars().noneMatch(Character::isUpperCase)) {
                violations.add(Map.of("field", "password", "reason", "대문자를 포함해야 합니다."));
            }
            if (policy.isRequireDigit() && raw.chars().noneMatch(Character::isDigit)) {
                violations.add(Map.of("field", "password", "reason", "숫자를 포함해야 합니다."));
            }
            if (policy.isRequireSpecial() && raw.chars().noneMatch(c -> SPECIALS.indexOf(c) >= 0)) {
                violations.add(Map.of("field", "password", "reason", "특수문자를 포함해야 합니다."));
            }
        }

        if (!violations.isEmpty()) {
            throw new ApiException(ErrorCode.AUTH_PASSWORD_POLICY,
                    ErrorCode.AUTH_PASSWORD_POLICY.getDefaultMessage(), violations);
        }

        assertNotBreached(raw);
    }

    /**
     * 외부 유출 목록 대조 — 형식 검사를 <b>모두 통과한 뒤에만</b> 부른다.
     *
     * <p>순서에 뜻이 있다. 어차피 거절될 짧은 비밀번호로 외부 API 를 두드릴 이유가
     * 없고, 그 호출은 사용자를 3초까지 기다리게 한다.</p>
     *
     * <p>조회에 실패하면 {@code false} 가 돌아와 그대로 통과한다 — 그 판단의 근거는
     * {@link BreachedPasswordChecker} 에 적어 두었다.</p>
     */
    private void assertNotBreached(String raw) {
        if (!properties.getPassword().isCheckBreached()) {
            return;
        }
        if (breachedChecker.isBreached(raw)) {
            throw new ApiException(ErrorCode.AUTH_PASSWORD_BREACHED,
                    ErrorCode.AUTH_PASSWORD_BREACHED.getDefaultMessage(),
                    List.of(Map.of("field", "password",
                            "reason", "외부 유출 목록에 있는 비밀번호입니다.")));
        }
    }
}
