package team.prost.ixauth.api.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

/** 2단계 인증 API 요청·응답. 정본은 docs/contract/http-api.md §2-3. */
public final class MfaDtos {

    private MfaDtos() {
    }

    /**
     * @param otpauthUri  인증 앱에 넣을 문자열. <b>QR 은 앱이 그린다</b> (설계 불변식 1)
     * @param backupCodes <b>평문. 이 응답에서만 볼 수 있다</b> — DB 에는 해시만 남으므로
     *                    다시 조회할 방법이 없다
     */
    public record SetupResponse(String otpauthUri, List<String> backupCodes) {
    }

    public record ConfirmRequest(@NotBlank String code) {
    }

    /**
     * @param mfaCode {@code mfa.step-up-actions} 에 {@code MFA_DISABLE} 이 있을 때 필요하다.
     *                <b>2단계를 끄는 데 2단계 코드를 요구하는 것</b>이라 이상해 보이지만,
     *                이것이 없으면 비밀번호를 훔친 쪽이 2단계부터 꺼 버리고 나머지 보호를
     *                전부 무력화할 수 있다. 휴대폰을 잃은 사람은 백업 코드로 넘어가고,
     *                둘 다 잃었다면 관리자 초기화가 경로다
     */
    public record DisableRequest(@NotBlank String currentPassword, String mfaCode) {
    }

    /**
     * @param challenge {@code /auth/login} 이 {@code AUTH_MFA_REQUIRED} 와 함께 준 값
     * @param code      인증 앱의 6자리 코드 <b>또는</b> 백업 코드
     * @param userAgent 앱이 전달하는 최종 사용자 정보 — 로그인 요청과 같은 이유다
     */
    public record VerifyRequest(@NotBlank String challenge, @NotBlank String code,
                                String userAgent, String ip) {
    }

    /**
     * @param pendingConfirm  등록만 하고 아직 확인하지 않았다
     * @param setupRequired   설정상 필수인데 등록하지 않았다 — 앱이 등록 화면으로 보낸다
     */
    public record StatusResponse(boolean enabled, String type, int backupCodesRemaining,
                                 boolean pendingConfirm, String mode, boolean setupRequired) {
    }
}
