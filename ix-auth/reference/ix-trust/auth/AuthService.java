package team.prost.ixtrust.client.auth;

import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import team.prost.ixtrust.client.auth.dto.AuthRequest;
import team.prost.ixtrust.client.auth.dto.AuthResponse;
import team.prost.ixtrust.client.security.JwtProvider;
import team.prost.ixtrust.client.security.TokenBlacklistService;
import team.prost.ixtrust.client.spi.SsoUserInfo;
import team.prost.ixtrust.client.spi.SsoUserProvider;

@RequiredArgsConstructor
@SuppressWarnings({"rawtypes", "unchecked"})
public class AuthService {

    private final SsoUserProvider userProvider;
    private final PasswordEncoder passwordEncoder;
    private final JwtProvider jwtProvider;
    private final TokenBlacklistService tokenBlacklistService;

    @Transactional(readOnly = true)
    public AuthResponse login(AuthRequest request) {
        var opt = userProvider.findByEmail(request.email());
        if (opt.isEmpty()) {
            throw new IllegalArgumentException("이메일 또는 비밀번호가 올바르지 않습니다.");
        }
        SsoUserInfo user = (SsoUserInfo) opt.get();

        if (!user.isActive()) {
            throw new IllegalStateException("비활성화된 계정입니다.");
        }

        if (!passwordEncoder.matches(request.password(), user.getPassword())) {
            throw new IllegalArgumentException("이메일 또는 비밀번호가 올바르지 않습니다.");
        }

        String role = user.getPrimaryRole();
        String accessToken = jwtProvider.createAccessToken(user.getId(), user.getEmail(), role);
        String refreshToken = jwtProvider.createRefreshToken(user.getId(), user.getEmail(), role);

        return new AuthResponse(accessToken, refreshToken, user.getName(), user.getEmail(), role);
    }

    @Transactional(readOnly = true)
    public AuthResponse refresh(String refreshToken) {
        if (!jwtProvider.validateToken(refreshToken)) {
            throw new IllegalArgumentException("유효하지 않은 리프레시 토큰입니다.");
        }

        String email = jwtProvider.getEmail(refreshToken);
        long iatSec = jwtProvider.getIssuedAtSec(refreshToken);
        // sid 포함 체크 — Back-Channel Logout으로 무효화된 세션은 refresh도 거부해야
        // ERP 프론트가 401 받고 자동 refresh로 새 access token 발급받아 BCL을 우회하는 버그 차단
        String sid = jwtProvider.getSid(refreshToken);
        if (tokenBlacklistService.isBlacklisted(email, sid, iatSec)) {
            throw new IllegalArgumentException("로그아웃된 세션입니다. 다시 로그인하세요.");
        }

        // 1.7.0 — userId String 으로 받아 SsoUserProvider 가 자기 ID type 으로 변환
        String userIdAsString = jwtProvider.getUserIdAsString(refreshToken);
        var opt = userProvider.findById(userIdAsString);
        if (opt.isEmpty()) {
            throw new IllegalArgumentException("사용자를 찾을 수 없습니다.");
        }
        SsoUserInfo user = (SsoUserInfo) opt.get();

        String role = user.getPrimaryRole();
        // 새 access token에도 동일 sid 유지 — 같은 SSO 세션이라 후속 BCL이 또 와도 차단 가능
        String newAccessToken = jwtProvider.createAccessToken(user.getId(), user.getEmail(), role, sid);

        return new AuthResponse(newAccessToken, refreshToken, user.getName(), user.getEmail(), role);
    }

    @Transactional(readOnly = true)
    @SuppressWarnings({"rawtypes", "unchecked"})
    public java.util.Optional<SsoUserInfo> findUserByEmail(String email) {
        return userProvider.findByEmail(email);
    }

    @Transactional
    public void initAdminIfNotExists(String name, String email, String rawPassword) {
        if (userProvider.existsByEmail(email)) {
            return;
        }
        userProvider.createAdmin(name, email, passwordEncoder.encode(rawPassword));
    }
}
