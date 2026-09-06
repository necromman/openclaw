package team.prost.ixtrust.common;

import lombok.Builder;

/**
 * 공통 API 응답 래퍼.
 * 모든 REST 응답은 이 record로 감싸서 반환.
 */
@Builder
public record ApiResponse<T>(boolean success, T data, String error) {

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, data, null);
    }

    public static <T> ApiResponse<T> error(String error) {
        return new ApiResponse<>(false, null, error);
    }
}
