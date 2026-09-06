package team.prost.ixauth.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import team.prost.ixauth.common.ApiException;
import team.prost.ixauth.common.ErrorCode;
import team.prost.ixauth.config.IxAuthProperties;
import team.prost.ixauth.domain.SigningKey;

import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * access token 발급·검증.
 *
 * <p>클레임 이름은 OIDC 관례를 따르고 커스텀은 {@code ixauth_} 접두어를 쓴다.
 * {@code federated} 모드로 IX-Trust 에 위임할 때 앱 코드가 그대로 동작해야 하기 때문이다
 * (docs/contract/token.md §3).</p>
 *
 * <p><b>권한 목록은 담지 않는다.</b> 역할만 담고, 권한 판정은 앱이 permission-map 으로 한다.</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class JwtService {

    public static final String CLAIM_ROLES = "ixauth_roles";
    public static final String CLAIM_GROUPS = "ixauth_groups";
    public static final String CLAIM_SID = "ixauth_sid";
    public static final String CLAIM_PV = "ixauth_pv";

    /**
     * 이 세션을 연 외부 신원 공급자 — 연합 신원 교환으로 들어왔을 때만 실린다.
     *
     * <p>없으면 IX-Auth 자체 인증(비밀번호·매직 링크·소셜)이다. 평범한 로그인에
     * 빈 값을 늘 붙이지 않는 이유는 {@link #CLAIM_ACT} 와 같다 — 앱이 유무가 아니라
     * 내용으로 판단하게 된다.</p>
     *
     * <p>출처는 토큰이 아니라 <b>세션 행</b>({@code sessions.idp})이다. 회전 때 앱이
     * 보낸 값을 그대로 다시 서명하면 어느 IdP 로 들어왔는지를 클라이언트가 정하게 된다.</p>
     */
    public static final String CLAIM_IDP = "ixauth_idp";

    /**
     * 대리(impersonation) 중일 때만 실리는 <b>표준</b> 클레임 (RFC 8693 §4.1).
     *
     * <p>{@code ixauth_} 접두어를 붙이지 않은 유일한 커스텀 클레임이다 — 이름과 모양이
     * 이미 표준으로 정해져 있고, {@code federated} 모드로 IX-Trust 에 위임할 때도
     * 같은 이름이어야 앱 코드가 그대로 동작한다 (docs/contract/token.md §3).</p>
     */
    public static final String CLAIM_ACT = "act";

    private final IxAuthProperties properties;
    private final SigningKeyService signingKeyService;

    public record IssuedToken(String token, Instant expiresAt, long expiresInSeconds) {
    }

    /**
     * 실제로 조작하고 있는 사람 — 대리 세션의 {@code act} 클레임이 된다.
     *
     * <p>{@code sub} 는 대리 <b>대상</b>이다. 앱은 대상의 권한으로 동작하되 화면에는
     * 이 사람을 함께 보여 준다 — 누가 대리 중인지 보이지 않으면 그 세션에서 벌어진
     * 일을 나중에 아무도 설명할 수 없다.</p>
     */
    public record Actor(Long userId, String email) {
    }

    public IssuedToken issueAccessToken(Long userId, String email, String name,
                                        List<String> roles, List<String> groups,
                                        UUID sessionId, long permissionsVersion) {
        return issueAccessToken(userId, email, name, roles, groups, sessionId,
                permissionsVersion, null, null);
    }

    /**
     * @param actor 대리 중이면 그 관리자. 평범한 로그인이면 {@code null}
     * @param idp   연합 신원으로 열린 세션이면 그 provider 이름. 자체 인증이면 {@code null}
     */
    public IssuedToken issueAccessToken(Long userId, String email, String name,
                                        List<String> roles, List<String> groups,
                                        UUID sessionId, long permissionsVersion,
                                        Actor actor, String idp) {
        var jwt = properties.getJwt();
        Instant now = Instant.now();
        Instant exp = now.plus(jwt.getAccessTtl());
        SigningKey key = signingKeyService.activeKey();

        var claims = new JWTClaimsSet.Builder()
                .issuer(jwt.getIssuer())
                .subject(String.valueOf(userId))
                .audience(jwt.effectiveAudience())
                .issueTime(Date.from(now))
                .expirationTime(Date.from(exp))
                .jwtID(UUID.randomUUID().toString())
                .claim("email", email)
                .claim("name", name)
                .claim(CLAIM_ROLES, roles)
                .claim(CLAIM_GROUPS, groups)
                .claim(CLAIM_SID, sessionId.toString())
                .claim(CLAIM_PV, permissionsVersion);

        if (actor != null) {
            // 평범한 로그인에는 이 클레임을 넣지 않는다 — 빈 act 가 늘 붙어 있으면
            // 앱이 "대리 중인가" 를 값의 유무가 아니라 내용으로 판단하게 된다
            claims.claim(CLAIM_ACT, Map.of(
                    "sub", String.valueOf(actor.userId()),
                    "email", actor.email() == null ? "" : actor.email()));
        }

        if (idp != null && !idp.isBlank()) {
            claims.claim(CLAIM_IDP, idp);
        }

        var claimSet = claims.build();

        try {
            var header = new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKid()).build();
            var signed = new SignedJWT(header, claimSet);
            signed.sign(new RSASSASigner(signingKeyService.privateKeyOf(key)));
            return new IssuedToken(signed.serialize(), exp, jwt.getAccessTtl().toSeconds());
        } catch (Exception e) {
            throw new ApiException(ErrorCode.INTERNAL, "토큰 발급에 실패했습니다.");
        }
    }

    /**
     * 토큰 검증 — 서명 · 만료 · issuer · audience.
     *
     * <p>이 메서드는 관리 API 보호용이다. <b>앱은 이 엔드포인트를 호출하지 않고
     * JWKS 공개키로 스스로 검증한다</b> (설계 불변식 2).</p>
     */
    public JWTClaimsSet verify(String token) {
        try {
            SignedJWT jwt = SignedJWT.parse(token);
            String kid = jwt.getHeader().getKeyID();

            SigningKey key = signingKeyService.jwksKeyById(kid)
                    .orElseThrow(() -> new ApiException(ErrorCode.AUTH_TOKEN_INVALID));

            if (!jwt.verify(new RSASSAVerifier(signingKeyService.publicKeyOf(key)))) {
                throw new ApiException(ErrorCode.AUTH_TOKEN_INVALID);
            }

            JWTClaimsSet claims = jwt.getJWTClaimsSet();
            Instant now = Instant.now();
            long skew = properties.getJwt().getClockSkew().toSeconds();

            if (claims.getExpirationTime() == null
                    || claims.getExpirationTime().toInstant().plusSeconds(skew).isBefore(now)) {
                throw new ApiException(ErrorCode.AUTH_TOKEN_EXPIRED);
            }
            if (!properties.getJwt().getIssuer().equals(claims.getIssuer())) {
                throw new ApiException(ErrorCode.AUTH_TOKEN_INVALID);
            }
            if (claims.getAudience() == null
                    || !claims.getAudience().contains(properties.getJwt().effectiveAudience())) {
                throw new ApiException(ErrorCode.AUTH_TOKEN_INVALID);
            }
            return claims;
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(ErrorCode.AUTH_TOKEN_INVALID);
        }
    }
}
