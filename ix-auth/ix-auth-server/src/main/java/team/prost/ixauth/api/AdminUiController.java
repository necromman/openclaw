package team.prost.ixauth.api;

import lombok.RequiredArgsConstructor;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.config.IxAuthProperties;

/**
 * 내장 관리 화면.
 *
 * <p>이걸 jar 에 넣는 이유 — 없으면 프로젝트마다 사용자 목록·비밀번호 초기화·권한 부여
 * 화면을 새로 만들게 되어 <b>페인포인트가 이동만 한다</b>. 대신 끌 수 있게 한다
 * (docs/design/embedded-auth-server-design.md §5.3).</p>
 *
 * <p>{@code ixauth.admin-ui.enabled=false} 면 404 — 존재 자체를 숨긴다.</p>
 */
@RestController
@RequiredArgsConstructor
public class AdminUiController {

    private final IxAuthProperties properties;
    /** 프록시 헤더·IPv6 loopback 정규화 — 다른 로그인 경로와 같은 규칙을 쓴다 */
    private final team.prost.ixauth.common.ClientInfo clientInfo;
    private final team.prost.ixauth.service.AuthService authService;

    @GetMapping(value = {"${ixauth.admin-ui.path:/admin-ui}", "${ixauth.admin-ui.path:/admin-ui}/"},
            produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<Resource> index() {
        if (!properties.getAdminUi().isEnabled()) {
            throw new ApiException(team.prost.ixauth.common.ErrorCode.NOT_FOUND, "찾을 수 없습니다.");
        }
        var resource = new ClassPathResource("admin-ui/index.html");
        if (!resource.exists()) {
            throw new ApiException(team.prost.ixauth.common.ErrorCode.NOT_FOUND, "찾을 수 없습니다.");
        }
        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_HTML)
                .header("Cache-Control", "no-store")
                .body(resource);
    }

    /**
     * 관리 화면 전용 로그인 — 서비스 키를 요구하지 않는다.
     *
     * <p>브라우저에서 도는 화면이라 서비스 키를 심을 수 없다. 대신 이 경로만 열고,
     * 발급받은 access token 으로 이후 {@code /admin/**} 을 호출한다.</p>
     */
    @org.springframework.web.bind.annotation.PostMapping("${ixauth.admin-ui.path:/admin-ui}/api/login")
    public team.prost.ixauth.common.ApiResponse<team.prost.ixauth.api.dto.AuthDtos.LoginResponse> login(
            @jakarta.validation.Valid @org.springframework.web.bind.annotation.RequestBody
            team.prost.ixauth.api.dto.AuthDtos.LoginRequest req) {

        if (!properties.getAdminUi().isEnabled()) {
            throw new ApiException(team.prost.ixauth.common.ErrorCode.NOT_FOUND, "찾을 수 없습니다.");
        }
        // 원시 remoteAddr 을 그대로 쓰면 프록시 뒤에서는 게이트웨이 주소가 되고,
        // 로컬에서는 ::1 로 남아 세션 목록에서 다른 로그인과 다르게 보인다
        var result = authService.login(req.email(), req.password(),
                clientInfo.userAgent(null), clientInfo.ip(null));

        return team.prost.ixauth.common.ApiResponse.ok(toResponse(result));
    }

    /**
     * 관리 화면의 2단계 인증 단계.
     *
     * <p>이 경로가 없으면 <b>관리자가 2단계를 켜는 순간 관리 화면에 들어올 수 없다.</b>
     * 화면은 서비스 키를 심을 수 없어 {@code /auth/mfa/verify} 를 부를 수 없기 때문이다.</p>
     */
    @org.springframework.web.bind.annotation.PostMapping(
            "${ixauth.admin-ui.path:/admin-ui}/api/mfa/verify")
    public team.prost.ixauth.common.ApiResponse<team.prost.ixauth.api.dto.AuthDtos.LoginResponse>
            verifyMfa(
            @jakarta.validation.Valid @org.springframework.web.bind.annotation.RequestBody
            team.prost.ixauth.api.dto.MfaDtos.VerifyRequest req) {

        if (!properties.getAdminUi().isEnabled()) {
            throw new ApiException(team.prost.ixauth.common.ErrorCode.NOT_FOUND, "찾을 수 없습니다.");
        }
        var result = authService.verifyMfa(req.challenge(), req.code(),
                clientInfo.userAgent(null), clientInfo.ip(null));
        return team.prost.ixauth.common.ApiResponse.ok(toResponse(result));
    }

    private team.prost.ixauth.api.dto.AuthDtos.LoginResponse toResponse(
            team.prost.ixauth.service.AuthService.LoginResult result) {
        return new team.prost.ixauth.api.dto.AuthDtos.LoginResponse(
                result.accessToken(), result.refreshToken(), result.expiresIn(),
                new team.prost.ixauth.api.dto.AuthDtos.UserSummary(
                        String.valueOf(result.userId()), result.email(), result.name(),
                        result.roles(), result.groups()),
                result.mfaSetupRequired(), result.termsAgreementRequired());
    }
}
