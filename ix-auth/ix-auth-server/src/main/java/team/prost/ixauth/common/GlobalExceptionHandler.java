package team.prost.ixauth.common;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 공통 예외 핸들러 — 응답에 스택트레이스·SQL·내부 경로를 절대 싣지 않는다.
 * 원인은 {@code traceId} 로 서버 로그에서 찾는다 (docs/contract/errors.md).
 */
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    public static final String TRACE_HEADER = "X-Request-Id";

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiResponse<Void>> handleApi(ApiException e, HttpServletRequest req) {
        String traceId = traceId(req);
        // 4xx 는 정상 흐름의 일부라 warn 이하로 남긴다. 5xx 만 error
        if (e.getCode().getStatus().is5xxServerError()) {
            log.error("[{}] {} — {}", traceId, e.getCode(), e.getMessage(), e);
        } else {
            log.debug("[{}] {} — {}", traceId, e.getCode(), e.getMessage());
        }
        return build(e.getCode(), e.getMessage(), traceId, e.getDetails(), e.getMeta());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException e,
                                                              HttpServletRequest req) {
        List<Map<String, String>> details = e.getBindingResult().getFieldErrors().stream()
                .map(f -> Map.of("field", f.getField(),
                        "reason", f.getDefaultMessage() == null ? "올바르지 않습니다." : f.getDefaultMessage()))
                .toList();
        return build(ErrorCode.VALIDATION_FAILED, ErrorCode.VALIDATION_FAILED.getDefaultMessage(),
                traceId(req), details);
    }

    /**
     * 본문을 읽지 못한 경우 — 깨진 JSON, 잘못된 인코딩, 타입 불일치.
     *
     * <p>클라이언트가 잘못 보낸 것이므로 400 이다. 이걸 500 으로 내면 서버 장애로 오진하게 된다
     * (실제로 CP949 로 전송된 한글 때문에 500 이 나 원인 추적에 시간을 썼다).</p>
     */
    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    public ResponseEntity<ApiResponse<Void>> handleUnreadable(
            org.springframework.http.converter.HttpMessageNotReadableException e,
            HttpServletRequest req) {
        String traceId = traceId(req);
        log.debug("[{}] 요청 본문 파싱 실패 — {}", traceId, e.getMessage());
        return build(ErrorCode.VALIDATION_FAILED,
                "요청 본문을 읽을 수 없습니다. JSON 형식과 UTF-8 인코딩을 확인하세요.", traceId, null);
    }

    /**
     * 없는 경로 — 404 다.
     *
     * <p>이걸 잡지 않으면 아래 {@code Exception} 핸들러로 떨어져 <b>500 + 스택트레이스</b>가 된다.
     * 두 가지가 함께 잘못된다: 클라이언트는 "서버가 고장났다" 로 읽어 재시도하고,
     * 오타·봇 스캔 하나하나가 ERROR 로그를 남겨 진짜 장애를 덮는다.</p>
     *
     * <p>{@code NoResourceFoundException} 인 이유는 관리 콘솔 정적 파일을 서빙하기 때문이다 —
     * 매핑되지 않은 요청은 정적 리소스 탐색까지 간 뒤 여기서 끝난다.</p>
     */
    @ExceptionHandler({
            org.springframework.web.servlet.resource.NoResourceFoundException.class,
            org.springframework.web.servlet.NoHandlerFoundException.class})
    public ResponseEntity<ApiResponse<Void>> handleNoHandler(Exception e, HttpServletRequest req) {
        String traceId = traceId(req);
        log.debug("[{}] 없는 경로 — {} {}", traceId, req.getMethod(), req.getRequestURI());
        return build(ErrorCode.NOT_FOUND,
                "요청한 경로가 없습니다.", traceId, null);
    }

    /**
     * 경로는 맞지만 메서드가 다르다 — 405.
     *
     * <p>404 로 뭉개면 "경로가 틀렸나" 를 한참 찾게 된다. 허용 메서드를
     * {@code Allow} 헤더로 알려주는 것이 규약이다.</p>
     */
    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiResponse<Void>> handleMethod(
            org.springframework.web.HttpRequestMethodNotSupportedException e,
            HttpServletRequest req) {
        String traceId = traceId(req);
        log.debug("[{}] 허용되지 않는 메서드 — {} {}", traceId, req.getMethod(), req.getRequestURI());
        var body = ApiResponse.<Void>fail(new ApiResponse.ErrorBody(
                ErrorCode.METHOD_NOT_ALLOWED.name(),
                "이 경로에서 %s 는 지원하지 않습니다.".formatted(req.getMethod()),
                traceId, null, null));
        var res = ResponseEntity.status(ErrorCode.METHOD_NOT_ALLOWED.getStatus());
        var allowed = e.getSupportedHttpMethods();
        if (allowed != null && !allowed.isEmpty()) {
            res = res.header("Allow", allowed.stream().map(Object::toString)
                    .collect(java.util.stream.Collectors.joining(", ")));
        }
        return res.body(body);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnexpected(Exception e, HttpServletRequest req) {
        String traceId = traceId(req);
        log.error("[{}] 처리되지 않은 예외 — {} {}", traceId, req.getMethod(), req.getRequestURI(), e);
        // 원인을 응답에 담지 않는다
        return build(ErrorCode.INTERNAL, ErrorCode.INTERNAL.getDefaultMessage(), traceId, null);
    }

    private ResponseEntity<ApiResponse<Void>> build(ErrorCode code, String message, String traceId,
                                                    List<Map<String, String>> details) {
        return build(code, message, traceId, details, null);
    }

    private ResponseEntity<ApiResponse<Void>> build(ErrorCode code, String message, String traceId,
                                                    List<Map<String, String>> details,
                                                    Map<String, Object> meta) {
        var body = ApiResponse.fail(
                new ApiResponse.ErrorBody(code.name(), message, traceId, details, meta));
        return ResponseEntity.status(code.getStatus()).body(body);
    }

    private String traceId(HttpServletRequest req) {
        String given = req.getHeader(TRACE_HEADER);
        return (given != null && !given.isBlank()) ? given : UUID.randomUUID().toString();
    }
}
