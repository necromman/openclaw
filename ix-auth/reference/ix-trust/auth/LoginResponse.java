package team.prost.ixtrust.client.auth.dto;

import java.util.Map;

/**
 * 로그인/토큰갱신 응답 — 토큰은 httpOnly 쿠키로 전달, 본문에는 사용자 정보만.
 *
 * <p>1.9.0 — {@code extra} 필드 추가. SP 가 {@link team.prost.ixtrust.client.spi.UserExtraProvider} Bean
 * 등록 시 도메인 특화 데이터가 채워짐. 미등록 시 null (Jackson 직렬화 시 생략).
 */
public record LoginResponse(
        String name,
        String email,
        String role,
        Map<String, Object> extra
) {
    /** 하위 호환 — extra 없는 기존 호출지 (AuthService 등) 지원. */
    public LoginResponse(String name, String email, String role) {
        this(name, email, role, null);
    }
}
