-- MySQL 8 방언 (mariadb/ 사본 — 다른 곳은 파일 안 주석으로 표시했다)
-- 소셜 로그인 — Microsoft · 카카오 · 네이버
--
-- V1·V2 는 고정이다. 이미 배포된 DB 가 그 체크섬을 들고 있으므로 고치면 부팅에 실패한다.

-- 외부 계정 연결.
-- 사용자 하나가 여러 provider 를 붙일 수 있고, provider 의 subject 는 전역 유일하다.
CREATE TABLE identities (
    id            BIGINT       AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- MICROSOFT | KAKAO | NAVER
    provider      VARCHAR(20)  NOT NULL,
    -- provider 가 주는 불변 식별자. 이메일이 아니다 —
    -- 이메일은 바뀌고, 바뀐 주소가 남에게 재할당될 수도 있다
    subject       VARCHAR(255) NOT NULL,
    -- 연결 시점의 주소. 표시·추적용이며 매칭 기준이 아니다
    email         VARCHAR(320),
    display_name  VARCHAR(200),
    linked_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    last_login_at DATETIME(6)
);

-- 같은 외부 계정이 두 사용자에게 붙으면 누구로 로그인할지 정할 수 없다
CREATE UNIQUE INDEX uq_identity_provider_subject ON identities (provider, subject);
CREATE INDEX idx_identity_user ON identities (user_id);

-- OAuth state — CSRF 방어와 PKCE 검증값 보관.
--
-- 인메모리로 두면 인스턴스가 여러 대일 때 콜백이 다른 인스턴스로 들어와 실패한다.
-- 전용 Redis 를 두지 않는 것이 설계 불변식 3 이므로 앱 DB 에 둔다.
CREATE TABLE oauth_states (
    -- 평문이 아니라 해시. 유출돼도 그것만으로는 콜백을 위조할 수 없다
    state_hash    VARCHAR(64)  PRIMARY KEY,
    provider      VARCHAR(20)  NOT NULL,
    -- 앱이 콜백을 받을 주소. 토큰 교환 때 provider 에 그대로 다시 보내야 한다
    redirect_uri  VARCHAR(500) NOT NULL,
    -- PKCE. provider 가 지원하면 쓴다
    code_verifier VARCHAR(128),
    created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at    DATETIME(6)  NOT NULL
);

CREATE INDEX idx_oauth_state_expires ON oauth_states (expires_at);
