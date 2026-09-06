package team.prost.ixtrust.common;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.stream.Collectors;

/**
 * 전역 예외 처리기.
 * 모든 컨트롤러 예외를 ApiResponse 래퍼로 통일.
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<Void>> handleIllegalArgument(IllegalArgumentException e) {
        log.warn("잘못된 요청: {}", e.getMessage());
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(e.getMessage()));
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<ApiResponse<Void>> handleIllegalState(IllegalStateException e) {
        log.warn("접근 거부: {}", e.getMessage());
        return ResponseEntity
                .status(HttpStatus.FORBIDDEN)
                .body(ApiResponse.error(e.getMessage()));
    }

    // 보안 예외(AccessDeniedException, AuthenticationException) — ix-trust-core 는 spring-security
    // 의존이 없어 import 자체가 불가하므로 여기서 못 잡는다. 두 경로로 나뉘어 처리된다:
    //  1) 필터 단계 authority 부족 → Spring Security 의 JsonAuthHandlers(AccessDeniedHandler /
    //     AuthenticationEntryPoint)가 응답 완결.
    //  2) service 레이어에서 수동 throw(OrganizationScopeGuard.requireMatch 등) → api 모듈의
    //     SecurityExceptionHandler(@Order HIGHEST_PRECEDENCE)가 403 으로 처리. 이게 없으면 아래
    //     RuntimeException 폴백이 500 으로 떨어뜨린다(2026-07-29 ORG_ADMIN cross-org 실측 결함).

    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiResponse<Void>> handleMethodNotAllowed(org.springframework.web.HttpRequestMethodNotSupportedException e) {
        log.warn("HTTP 메서드 미지원: {}", e.getMessage());
        return ResponseEntity
                .status(HttpStatus.METHOD_NOT_ALLOWED)
                .contentType(MediaType.APPLICATION_JSON)
                .body(ApiResponse.error("허용되지 않은 요청 방식입니다."));
    }

    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    public ResponseEntity<ApiResponse<Void>> handleNotReadable(org.springframework.http.converter.HttpMessageNotReadableException e) {
        log.warn("요청 본문 파싱 실패: {}", e.getMessage());
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .contentType(MediaType.APPLICATION_JSON)
                .body(ApiResponse.error("요청 형식이 올바르지 않습니다."));
    }

    /**
     * Accept header 가 controller produces 와 mismatch 면 406 NOT_ACCEPTABLE.
     * 이전엔 catch-all 500 으로 떨어져 사용자 흐름에 ERROR 로그 노이즈 (2026-05-05 시연
     * picker.js 회귀 사례 + 2026-05-07 reproducer: Accept: application/javascript).
     */
    @ExceptionHandler(org.springframework.web.HttpMediaTypeNotAcceptableException.class)
    public ResponseEntity<ApiResponse<Void>> handleMediaTypeNotAcceptable(
            org.springframework.web.HttpMediaTypeNotAcceptableException e) {
        log.debug("Accept header 미지원: {}", e.getMessage());
        return ResponseEntity
                .status(HttpStatus.NOT_ACCEPTABLE)
                .contentType(MediaType.APPLICATION_JSON)
                .body(ApiResponse.error("요청한 응답 형식을 제공할 수 없습니다."));
    }

    /**
     * 매핑 없는 path 호출 시 404 (catch-all 500 흡수 차단). dead path 와 진짜 server error 구분.
     * Spring 6 의 NoHandlerFoundException + Spring 6.1+ 의 NoResourceFoundException 동시 처리.
     */
    @ExceptionHandler({
            org.springframework.web.servlet.NoHandlerFoundException.class,
            org.springframework.web.servlet.resource.NoResourceFoundException.class
    })
    public ResponseEntity<ApiResponse<Void>> handleNotFound(Exception e) {
        log.debug("매핑되지 않은 경로: {}", e.getMessage());
        return ResponseEntity
                .status(HttpStatus.NOT_FOUND)
                .contentType(MediaType.APPLICATION_JSON)
                .body(ApiResponse.error("요청하신 경로를 찾을 수 없습니다."));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldErrors().stream()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
                .collect(Collectors.joining(", "));
        log.warn("유효성 검증 실패: {}", message);
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(message));
    }

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<ApiResponse<Void>> handleRuntime(RuntimeException e, HttpServletRequest request) {
        String message = e.getMessage();
        // 데이터소스 커넥터 에러는 사용자 친화적 메시지 반환
        if (message != null && (message.contains("LDAP") || message.contains("DB ") || message.contains("JDBC"))) {
            log.warn("데이터소스 오류: {}", message);
            return errorResponse(HttpStatus.BAD_REQUEST, message, request);
        }
        log.error("서버 오류 발생: {}", message, e);
        return errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "서버 내부 오류가 발생했습니다.", request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleException(Exception e, HttpServletRequest request) {
        log.error("서버 오류 발생", e);
        return errorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "서버 내부 오류가 발생했습니다.", request);
    }

    /**
     * Content-Type을 명시적으로 application/json 으로 강제.
     * SockJS 폴백(/ws/.../xhr_streaming 등)은 Content-Type=application/javascript 로 응답을 강제하는데
     * 그 상태에서 ApiResponse(LinkedHashMap) 직렬화를 시도하면 HttpMessageNotWritableException 발생.
     */
    private ResponseEntity<ApiResponse<Void>> errorResponse(HttpStatus status, String message, HttpServletRequest request) {
        return ResponseEntity
                .status(status)
                .contentType(MediaType.APPLICATION_JSON)
                .body(ApiResponse.error(message));
    }
}
