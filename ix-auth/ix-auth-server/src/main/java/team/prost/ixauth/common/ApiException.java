package team.prost.ixauth.common;

import lombok.Getter;

import java.util.List;
import java.util.Map;

/** 계약된 에러 코드를 던지는 예외. 메시지는 기본값을 쓰거나 덮어쓴다. */
@Getter
public class ApiException extends RuntimeException {

    private final ErrorCode code;
    private final transient List<Map<String, String>> details;

    /**
     * 이 에러를 처리하는 데 필요한 값 — {@code AUTH_MFA_REQUIRED} 의 challenge 처럼
     * "실패했지만 다음 단계가 있다" 는 응답에만 붙는다. 내부 상태를 담지 않는다.
     */
    private final transient Map<String, Object> meta;

    public ApiException(ErrorCode code) {
        this(code, code.getDefaultMessage(), null);
    }

    public ApiException(ErrorCode code, String message) {
        this(code, message, null);
    }

    public ApiException(ErrorCode code, String message, List<Map<String, String>> details) {
        this(code, message, details, null);
    }

    public ApiException(ErrorCode code, String message, List<Map<String, String>> details,
                        Map<String, Object> meta) {
        super(message);
        this.code = code;
        this.details = details;
        this.meta = meta;
    }

    public static ApiException notFound(String what) {
        return new ApiException(ErrorCode.NOT_FOUND, what + "을(를) 찾을 수 없습니다.");
    }

    public static ApiException conflict(String message) {
        return new ApiException(ErrorCode.CONFLICT, message);
    }
}
