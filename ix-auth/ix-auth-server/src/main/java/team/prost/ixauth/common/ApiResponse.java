package team.prost.ixauth.common;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;
import java.util.Map;

/**
 * 응답 봉투. 정본은 docs/contract/http-api.md §1.
 *
 * <p>성공은 {@code {"data": …}}, 실패는 {@code {"error": {code, message, traceId}}}.</p>
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse<T>(T data, ErrorBody error) {

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(data, null);
    }

    public static ApiResponse<Void> fail(ErrorBody error) {
        return new ApiResponse<>(null, error);
    }

    /**
     * @param details 검증 실패의 필드별 사유
     * @param meta    <b>코드별 부가 정보.</b> 앱이 그 에러를 처리하려면 값이 하나 더
     *                필요한 경우에만 붙는다 — 지금은 {@code AUTH_MFA_REQUIRED} 의
     *                challenge 뿐이다. 여기에 내부 상태·원인을 담지 않는다
     *                (docs/contract/errors.md)
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ErrorBody(String code, String message, String traceId,
                            List<Map<String, String>> details,
                            Map<String, Object> meta) {

        public ErrorBody(String code, String message, String traceId,
                         List<Map<String, String>> details) {
            this(code, message, traceId, details, null);
        }
    }

    /** 목록 응답 페이로드 */
    public record PageData<T>(List<T> items, int page, int size, long total) {
    }
}
