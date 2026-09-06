package team.prost.ixtrust.client.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtBuilder;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import team.prost.ixtrust.client.IxTrustClientProperties;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

public class JwtProvider {

    private final SecretKey key;
    private final long accessTokenValidity;
    private final long refreshTokenValidity;

    public JwtProvider(IxTrustClientProperties.Jwt jwtProps) {
        String secret = jwtProps.getSecret();
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException(
                    "ixtrust.client.jwt.secret 설정이 필요합니다. 32자 이상의 시크릿 키를 설정하세요.");
        }
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessTokenValidity = jwtProps.getAccessTokenValidity();
        this.refreshTokenValidity = jwtProps.getRefreshTokenValidity();
    }

    public long getAccessTokenValidity() {
        return accessTokenValidity;
    }

    /**
     * 1.7.0 — userId type-agnostic. Long / UUID / String 등 모두 받아 String 직렬화.
     * 1.5.x/1.6.x 기존 Long 호출지는 자동 widening (Object 으로 박싱).
     */
    public String createAccessToken(Object userId, String email, String role) {
        return createToken(userId, email, role, null, accessTokenValidity);
    }

    public String createAccessToken(Object userId, String email, String role, String sid) {
        return createToken(userId, email, role, sid, accessTokenValidity);
    }

    public String createRefreshToken(Object userId, String email, String role) {
        return createToken(userId, email, role, null, refreshTokenValidity);
    }

    public String createRefreshToken(Object userId, String email, String role, String sid) {
        return createToken(userId, email, role, sid, refreshTokenValidity);
    }

    private String createToken(Object userId, String email, String role, String sid, long validity) {
        Date now = new Date();
        // 1.7.0 — userId 항상 String 으로 직렬화 (UUID/Long/String 모두 통합).
        // parse() 시점은 Number/String 둘 다 받아 1.5.x 토큰 호환.
        String userIdString = userId != null ? String.valueOf(userId) : null;
        JwtBuilder builder = Jwts.builder()
                .subject(email)
                .claim("userId", userIdString)
                .claim("role", role)
                .issuedAt(now)
                .expiration(new Date(now.getTime() + validity))
                .signWith(key);
        if (sid != null && !sid.isBlank()) {
            builder.claim("sid", sid);
        }
        return builder.compact();
    }

    public Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    public boolean validateToken(String token) {
        try {
            parseToken(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }

    public String getEmail(String token) {
        return parseToken(token).getSubject();
    }

    /**
     * 1.7.0 — userId claim 을 String 으로 반환.
     * 1.5.x/1.6.x 토큰의 Number(Long) claim 도 호환 (Object → String.valueOf).
     */
    public String getUserIdAsString(String token) {
        Object raw = parseToken(token).get("userId");
        return raw != null ? String.valueOf(raw) : null;
    }

    /**
     * @deprecated 1.7.0 — {@link #getUserIdAsString(String)} 사용. UUID/String PK 호환.
     *             기존 Long 가정 SP 만 호환용으로 유지.
     */
    @Deprecated
    public Long getUserId(String token) {
        Object raw = parseToken(token).get("userId");
        if (raw == null) {
            return null;
        }
        if (raw instanceof Number n) {
            return n.longValue();
        }
        try {
            return Long.parseLong(raw.toString());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public String getRole(String token) {
        return parseToken(token).get("role", String.class);
    }

    /** iat(issued-at)을 epoch seconds로 반환 — 블랙리스트 체크에 사용 */
    public long getIssuedAtSec(String token) {
        Date iat = parseToken(token).getIssuedAt();
        return iat != null ? iat.getTime() / 1000L : 0L;
    }

    /** OIDC sid claim — Back-Channel Logout 타겟팅에 사용 (없으면 null) */
    public String getSid(String token) {
        return parseToken(token).get("sid", String.class);
    }
}
