-- MariaDB 방언 (postgresql/ 원본과 1:1 대응)
-- IX-Auth baseline
-- 파생 원본: docs/contract/schema.sql (계약이 정본이다. 여기를 먼저 고치지 않는다)
-- 이 파일은 적용 후 수정 금지 — 정정은 새 버전으로 (.claude/rules/architecture.md)

-- ── 사용자 ──
CREATE TABLE users (
    id            BIGINT        AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(320)  NOT NULL,
    -- MariaDB 는 PostgreSQL 의 함수형 인덱스(lower(email))를 지원하지 않는다.
    -- 가상 생성 컬럼 + 그 컬럼에 대한 UNIQUE 인덱스로 대체한다 (원본: uq_users_email ON users (lower(email)))
    email_lower   VARCHAR(320)  GENERATED ALWAYS AS (LOWER(email)) VIRTUAL,
    -- 알고리즘 접두어 포함: '{bcrypt}$2a$10$...'
    password_hash VARCHAR(255),
    name          VARCHAR(100)  NOT NULL,
    status        VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',
    failed_count  INTEGER       NOT NULL DEFAULT 0,
    locked_until  DATETIME(6),
    last_failed_at DATETIME(6),
    last_login_at DATETIME(6),
    attributes    JSON          NOT NULL DEFAULT '{}',
    created_at    DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at    DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE UNIQUE INDEX uq_users_email ON users (email_lower);
CREATE INDEX idx_users_status ON users (status);

-- ── 역할 · 그룹 ──
CREATE TABLE roles (
    id          BIGINT       AUTO_INCREMENT PRIMARY KEY,
    code        VARCHAR(50)  NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    is_system   BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);

CREATE TABLE user_roles (
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id    BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    granted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, role_id)
);
CREATE INDEX idx_user_roles_role ON user_roles (role_id);

CREATE TABLE groups (
    id          BIGINT       AUTO_INCREMENT PRIMARY KEY,
    code        VARCHAR(50)  NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);

CREATE TABLE user_groups (
    user_id   BIGINT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    group_id  BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    joined_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id, group_id)
);
CREATE INDEX idx_user_groups_group ON user_groups (group_id);

CREATE TABLE group_roles (
    group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    role_id  BIGINT NOT NULL REFERENCES roles(id)  ON DELETE CASCADE,
    PRIMARY KEY (group_id, role_id)
);
CREATE INDEX idx_group_roles_role ON group_roles (role_id);

-- ── 권한 (L1) ──
CREATE TABLE permissions (
    id          BIGINT        AUTO_INCREMENT PRIMARY KEY,
    code        VARCHAR(200)  NOT NULL UNIQUE,
    domain      VARCHAR(50)   NOT NULL,
    resource    VARCHAR(120)  NOT NULL,
    action      VARCHAR(30)   NOT NULL,
    description VARCHAR(500),
    created_at  DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at  DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE INDEX idx_permissions_domain ON permissions (domain);

CREATE TABLE role_permissions (
    role_id       BIGINT NOT NULL REFERENCES roles(id)       ON DELETE CASCADE,
    permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    granted_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX idx_role_permissions_perm ON role_permissions (permission_id);

-- ── 리소스 인스턴스 권한 (L2) — 스키마만 선반영, 구현은 P2 ──
CREATE TABLE resource_grants (
    id            BIGINT        AUTO_INCREMENT PRIMARY KEY,
    subject_type  VARCHAR(10)   NOT NULL,
    subject_id    BIGINT        NOT NULL,
    resource_type VARCHAR(50)   NOT NULL,
    -- 원본은 VARCHAR(1000). MariaDB InnoDB 는 utf8mb4 기준 인덱스 합계 3072바이트 한도가 있고
    -- idx_grants_resource·uq_grants_tuple 두 복합 인덱스가 이 컬럼을 포함하므로 VARCHAR(255)로 축소.
    -- 아직 구현 전(P2, 데이터 없음)이라 지금이 축소할 수 있는 시점 — V2 가 password_reset_tokens 를
    -- 갈아엎은 것과 같은 이유
    resource_key  VARCHAR(255)  NOT NULL,
    action        VARCHAR(30)   NOT NULL,
    effect        VARCHAR(10)   NOT NULL DEFAULT 'ALLOW',
    granted_by    BIGINT        REFERENCES users(id) ON DELETE SET NULL,
    expires_at    DATETIME(6),
    created_at    DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
-- L2 성능의 전부. 판정은 조상 경로 IN 조회이며, pattern_ops 는 향후 prefix 검색용으로 유지
-- MariaDB 에는 PostgreSQL 의 연산자 클래스(varchar_pattern_ops) 개념이 없다 — 기본 VARCHAR 인덱스가
-- LIKE 'prefix%' 조회를 이미 지원하므로 그대로 제거
CREATE INDEX idx_grants_resource
    ON resource_grants (resource_type, resource_key);
CREATE INDEX idx_grants_subject ON resource_grants (subject_type, subject_id);
CREATE UNIQUE INDEX uq_grants_tuple
    ON resource_grants (subject_type, subject_id, resource_type, resource_key, action);

-- ── 세션 (refresh token 은 opaque 난수. 해시로만 저장) ──
CREATE TABLE sessions (
    -- MariaDB 10.7+ 네이티브 UUID — 엔티티(java.util.UUID)와 JDBC 타입(Types#UUID)이 맞아야
    -- Hibernate validate 를 통과한다 (CHAR(36) 은 실측에서 wrong column type 으로 부팅 거부)
    id                 UUID          PRIMARY KEY,
    user_id            BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(64)   NOT NULL,
    issued_at          DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at         DATETIME(6)   NOT NULL,
    revoked_at         DATETIME(6),
    last_used_at       DATETIME(6),
    user_agent         VARCHAR(500),
    ip                 VARCHAR(45),
    CONSTRAINT ck_sessions_expiry CHECK (expires_at > issued_at)
);
CREATE UNIQUE INDEX uq_sessions_token ON sessions (refresh_token_hash);
CREATE INDEX idx_sessions_user ON sessions (user_id, revoked_at);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- ── 감사 로그 (append-only) ──
CREATE TABLE audit_logs (
    id         BIGINT       AUTO_INCREMENT PRIMARY KEY,
    event_type VARCHAR(50)  NOT NULL,
    -- FK 없음: append-only 독립 로그 + 별도 트랜잭션 기록 (아래 주석 참조)
    user_id    BIGINT,
    actor_id   BIGINT,
    ip         VARCHAR(45),
    user_agent VARCHAR(500),
    detail     JSON         NOT NULL DEFAULT '{}',
    created_at DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE INDEX idx_audit_created ON audit_logs (created_at DESC);
CREATE INDEX idx_audit_user ON audit_logs (user_id, created_at DESC);
CREATE INDEX idx_audit_event ON audit_logs (event_type, created_at DESC);

-- ── 비밀번호 재설정 · MFA [P2] ──
CREATE TABLE password_reset_tokens (
    id         BIGINT      AUTO_INCREMENT PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    used_at    DATETIME(6),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE UNIQUE INDEX uq_reset_token ON password_reset_tokens (token_hash);
CREATE INDEX idx_reset_user ON password_reset_tokens (user_id);

CREATE TABLE mfa_credentials (
    id               BIGINT      AUTO_INCREMENT PRIMARY KEY,
    user_id          BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type             VARCHAR(20) NOT NULL,
    secret_enc       TEXT        NOT NULL,
    backup_codes_enc TEXT,
    confirmed_at     DATETIME(6),
    created_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE UNIQUE INDEX uq_mfa_user_type ON mfa_credentials (user_id, type);

-- ── 서명 키 (JWKS 게시용. 최초 부팅 시 자동 생성 후 보관) ──
CREATE TABLE signing_keys (
    kid         VARCHAR(50)  PRIMARY KEY,
    algorithm   VARCHAR(10)  NOT NULL,
    public_jwk  TEXT         NOT NULL,
    private_pkcs8 TEXT       NOT NULL,
    active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    retired_at  DATETIME(6)
);
CREATE INDEX idx_signing_keys_active ON signing_keys (active, created_at DESC);

-- ── 초기 시드 ──
INSERT INTO roles (code, name, description, is_system) VALUES
    ('ADMIN', '관리자', 'IX-Auth 관리 API·화면 전권', TRUE),
    ('USER',  '일반 사용자', '기본 역할', TRUE);

INSERT INTO permissions (code, domain, resource, action, description) VALUES
    ('ixauth:*:*',         'ixauth', '*',     '*',     'IX-Auth 관리 전권'),
    ('ixauth:users:read',  'ixauth', 'users', 'read',  '사용자 조회'),
    ('ixauth:users:write', 'ixauth', 'users', 'write', '사용자 생성·수정·삭제'),
    ('ixauth:roles:read',  'ixauth', 'roles', 'read',  '역할·권한 조회'),
    ('ixauth:roles:write', 'ixauth', 'roles', 'write', '역할·권한 변경'),
    ('ixauth:audit:read',  'ixauth', 'audit', 'read',  '감사 로그 조회');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'ADMIN' AND p.code = 'ixauth:*:*';
