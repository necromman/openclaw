package team.prost.ixtrust.client.security;

import lombok.extern.slf4j.Slf4j;

import java.util.concurrent.ConcurrentHashMap;

/**
 * JWT 블랙리스트.
 * <p>
 * - email → 로그아웃 epoch-seconds: 사용자 전체 세션 종료 (관리자 강제 로그아웃, OIDC sub 기반 logout_token).
 * - sid → 로그아웃 epoch-seconds: 특정 세션만 종료 (OIDC sid 기반 logout_token). 같은 사용자의 다른 기기 세션은 유지.
 * <p>
 * iat(issued-at) < cutoff 인 토큰만 차단하므로, 재로그인으로 발급된 새 토큰은 자동 통과.
 */
@Slf4j
public class TokenBlacklistService {

    private final ConcurrentHashMap<String, Long> revokedByEmail = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Long> revokedBySid = new ConcurrentHashMap<>();
    private final long accessTokenValidityMs;

    public TokenBlacklistService(long accessTokenValidityMs) {
        this.accessTokenValidityMs = accessTokenValidityMs;
    }

    /** 해당 이메일의 "이 시점 이전 발급" 토큰 전체 무효화 (전 기기). */
    public void blacklist(String email) {
        long now = System.currentTimeMillis() / 1000L;
        revokedByEmail.put(email.toLowerCase(), now);
        log.info("JWT 블랙리스트 등록 (email): {} @ {}", email, now);
        evictExpired();
    }

    /** 특정 sid의 토큰만 무효화 (같은 사용자의 다른 세션/기기는 유지). */
    public void blacklistBySid(String sid) {
        if (sid == null || sid.isBlank()) {
            return;
        }
        long now = System.currentTimeMillis() / 1000L;
        revokedBySid.put(sid, now);
        log.info("JWT 블랙리스트 등록 (sid): {} @ {}", sid, now);
        evictExpired();
    }

    /**
     * 토큰의 iat가 email 또는 sid 기준 cutoff보다 이전이면 차단.
     *
     * @param email 토큰의 subject
     * @param sid   토큰의 sid claim (없으면 null)
     * @param tokenIatSec 토큰의 iat (epoch seconds)
     */
    public boolean isBlacklisted(String email, String sid, long tokenIatSec) {
        if (isRevoked(revokedByEmail, email == null ? null : email.toLowerCase(), tokenIatSec)) {
            return true;
        }
        return isRevoked(revokedBySid, sid, tokenIatSec);
    }

    /** 하위 호환 — sid 없이 email만으로 체크 (기존 호출지). */
    public boolean isBlacklisted(String email, long tokenIatSec) {
        return isBlacklisted(email, null, tokenIatSec);
    }

    private boolean isRevoked(ConcurrentHashMap<String, Long> store, String key, long tokenIatSec) {
        if (key == null) {
            return false;
        }
        Long cutoff = store.get(key);
        if (cutoff == null) {
            return false;
        }
        long validitySec = accessTokenValidityMs / 1000L;
        if (System.currentTimeMillis() / 1000L - cutoff > validitySec) {
            store.remove(key);
            return false;
        }
        return tokenIatSec < cutoff;
    }

    /** 테스트/진단용 — 특정 이메일의 revocation 엔트리 강제 제거 */
    public void clear(String email) {
        if (revokedByEmail.remove(email.toLowerCase()) != null) {
            log.info("JWT 블랙리스트 수동 제거 (email): {}", email);
        }
    }

    /** 테스트/진단용 — 특정 sid의 revocation 엔트리 강제 제거 */
    public void clearSid(String sid) {
        if (sid != null && revokedBySid.remove(sid) != null) {
            log.info("JWT 블랙리스트 수동 제거 (sid): {}", sid);
        }
    }

    private void evictExpired() {
        long nowSec = System.currentTimeMillis() / 1000L;
        long validitySec = accessTokenValidityMs / 1000L;
        revokedByEmail.entrySet().removeIf(e -> nowSec - e.getValue() > validitySec);
        revokedBySid.entrySet().removeIf(e -> nowSec - e.getValue() > validitySec);
    }
}
