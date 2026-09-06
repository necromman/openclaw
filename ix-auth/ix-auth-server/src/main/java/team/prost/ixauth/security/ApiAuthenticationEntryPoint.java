package team.prost.ixauth.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import team.prost.ixauth.common.ApiResponse;
import team.prost.ixauth.common.ErrorCode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.UUID;

/**
 * 인증 실패 응답 — 계약 봉투를 지킨다 (http-api.md §1).
 *
 * <p>기본 {@code HttpStatusEntryPoint} 는 본문 없는 401 을 낸다. 그러면 앱은
 * "서비스 키가 틀린 건지, 토큰이 만료된 건지" 를 구분할 수 없고, 운영에서
 * 원인을 찾지 못한다. 실패 사유를 <b>계약 에러코드</b>로 돌려준다.</p>
 *
 * <p>단, 사유를 밝히는 것과 정보를 흘리는 것은 다르다. 여기서 구분하는 것은
 * 호출자가 스스로 아는 사실(자기가 보낸 키·토큰)뿐이며, 계정 존재 여부 같은
 * 것은 담지 않는다.</p>
 */
@RequiredArgsConstructor
public class ApiAuthenticationEntryPoint implements AuthenticationEntryPoint {

    private final ObjectMapper mapper;

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
                         AuthenticationException authException) throws IOException {
        ErrorCode code = resolve(request);

        response.setStatus(code.getStatus().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        mapper.writeValue(response.getOutputStream(), ApiResponse.fail(
                new ApiResponse.ErrorBody(code.name(), code.getDefaultMessage(),
                        UUID.randomUUID().toString(), null)));
    }

    private ErrorCode resolve(HttpServletRequest request) {
        Object result = request.getAttribute(ServiceKeyFilter.ATTR_RESULT);

        if (result == ServiceKeyFilter.Result.INVALID) {
            return ErrorCode.SERVICE_KEY_INVALID;
        }
        // 서비스 키는 맞는데 여기까지 왔다면 사용자 토큰이 필요한 경로다
        if (result == ServiceKeyFilter.Result.OK) {
            return ErrorCode.AUTH_TOKEN_INVALID;
        }
        // 키가 없다 — 토큰을 들고 온 흔적이 있으면 토큰 문제로 본다
        String authorization = request.getHeader("Authorization");
        return (authorization != null && authorization.startsWith("Bearer "))
                ? ErrorCode.AUTH_TOKEN_INVALID
                : ErrorCode.SERVICE_KEY_MISSING;
    }
}
