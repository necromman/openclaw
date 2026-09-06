package team.prost.ixauth.client;

import com.nimbusds.jwt.JWTClaimsSet;

import java.util.List;

/**
 * 인증된 사용자 — {@code SecurityContext} 의 principal.
 *
 * <p>{@code @AuthenticationPrincipal IxAuthPrincipal user} 로 컨트롤러에서 받는다.</p>
 */
public record IxAuthPrincipal(
        String userId,
        String email,
        String name,
        List<String> roles,
        List<String> groups,
        String sessionId,
        JWTClaimsSet claims) {

    static IxAuthPrincipal from(JWTClaimsSet claims) {
        return new IxAuthPrincipal(
                claims.getSubject(),
                claimString(claims, "email"),
                claimString(claims, "name"),
                claimList(claims, "ixauth_roles"),
                claimList(claims, "ixauth_groups"),
                claimString(claims, "ixauth_sid"),
                claims);
    }

    private static String claimString(JWTClaimsSet claims, String name) {
        try {
            return claims.getStringClaim(name);
        } catch (Exception e) {
            return null;
        }
    }

    private static List<String> claimList(JWTClaimsSet claims, String name) {
        try {
            List<String> v = claims.getStringListClaim(name);
            return v == null ? List.of() : v;
        } catch (Exception e) {
            return List.of();
        }
    }
}
