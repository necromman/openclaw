package team.prost.ixauth.authz;

import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.common.PermissionMatcher;

import java.util.Collection;

/**
 * 공용 {@link PermissionMatcher} 를 서버의 에러 계약으로 감싼다.
 *
 * <p>매칭 규칙 자체는 {@code ix-auth-common} 에 있다 — 앱 측 SDK 와 같아야 하기 때문이다.
 * 여기서는 규칙 위반을 계약 에러코드({@code AUTHZ_INVALID_PERMISSION_CODE}) 로 바꿔
 * 400 으로 나가게만 한다. 감싸지 않으면 잘못된 코드가 500 이 된다.</p>
 */
public final class PermissionCodes {

    private PermissionCodes() {
    }

    public static void validate(String code) {
        try {
            PermissionMatcher.validateCode(code);
        } catch (IllegalArgumentException e) {
            throw new ApiException(ErrorCode.AUTHZ_INVALID_PERMISSION_CODE, e.getMessage());
        }
    }

    public static boolean anyMatches(Collection<String> granted, String required) {
        try {
            return PermissionMatcher.anyMatches(granted, required);
        } catch (IllegalArgumentException e) {
            throw new ApiException(ErrorCode.AUTHZ_INVALID_PERMISSION_CODE, e.getMessage());
        }
    }
}
