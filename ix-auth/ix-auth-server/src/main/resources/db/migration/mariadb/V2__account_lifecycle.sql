-- MariaDB 방언 (postgresql/ 원본과 1:1 대응)
-- 계정 라이프사이클 — 비밀번호 찾기 · 이메일 인증 · 초대 · 이메일 변경
--
-- V1 은 2026-08-08 부로 고정이다. 이미 배포된 DB 가 V1 체크섬을 들고 있으므로
-- V1 을 고치면 그 DB 는 부팅에 실패한다 (실제로 개발 중 겪었다).
--
-- password_reset_tokens 를 verification_tokens 로 일반화한다. 용도마다 테이블을
-- 따로 두면 만료·1회용·정리 로직이 네 벌로 갈라지고, 그중 하나만 고치는 실수가 난다.
-- 이 테이블에는 아직 구현이 없어 데이터가 없으므로 지금이 바꿀 수 있는 마지막 시점이다.

DROP TABLE IF EXISTS password_reset_tokens;

CREATE TABLE verification_tokens (
    id         BIGINT       AUTO_INCREMENT PRIMARY KEY,
    user_id    BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- PASSWORD_RESET | EMAIL_VERIFY | INVITE | EMAIL_CHANGE
    purpose    VARCHAR(20)  NOT NULL,
    -- SHA-256 hex(64자). 평문 저장 금지 — DB 가 유출돼도 토큰을 쓸 수 없어야 한다
    token_hash VARCHAR(64)  NOT NULL,
    -- 용도별 부가 정보. EMAIL_CHANGE 의 '바꿀 주소' 가 여기 들어간다
    payload    VARCHAR(320),
    expires_at DATETIME(6)  NOT NULL,
    -- 1회용. 쓰면 시각을 남기고 다시는 통하지 않는다
    used_at    DATETIME(6),
    created_at DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);

CREATE UNIQUE INDEX uq_verification_token ON verification_tokens (token_hash);
-- '이 사용자의 이 용도 중 살아 있는 것' 을 찾는 질의가 대부분이다
CREATE INDEX idx_verification_user_purpose ON verification_tokens (user_id, purpose);
-- 만료분 정리용
CREATE INDEX idx_verification_expires ON verification_tokens (expires_at);

-- 이메일 인증 시각. NULL = 미인증.
-- 기존 계정은 이미 쓰고 있던 주소이므로 인증된 것으로 본다 — 여기서 NULL 로 두면
-- 업그레이드하는 순간 전원이 로그인하지 못한다.
ALTER TABLE users ADD COLUMN email_verified_at DATETIME(6);
UPDATE users SET email_verified_at = created_at;
