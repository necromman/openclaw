-- =====================================================================
-- IX-Auth 스키마 계약 (Phase 0)
--
-- 정본: 이 파일. 구현체의 Flyway V*.sql 은 여기서 파생된다.
-- 기준 DB: PostgreSQL 15+ (MySQL 변형은 파일 끝 주석 참조)
-- 네임스페이스: `ixauth` 스키마 — 앱 테이블과 같은 DB, 다른 스키마 (설계 불변식 3)
--
-- 총 14종
--   인증  users, roles, user_roles, sessions, audit_logs, signing_keys,
--         password_reset_tokens[P2], mfa_credentials[P2]
--   인가  permissions, role_permissions, ixauth_groups, user_groups, group_roles,
--         resource_grants[P2]
--
-- 변경 절차: .claude/rules/contract-policy.md
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS ixauth;

-- =====================================================================
-- 1. 사용자
-- =====================================================================

CREATE TABLE ixauth.users (
    id            BIGSERIAL     PRIMARY KEY,
    email         VARCHAR(320)  NOT NULL,
    -- 알고리즘 접두어 필수: '{bcrypt}$2a$10$...'
    --   ① 개발 중 프로젝트가 IX-Auth 로 이사할 때 레거시 해시를 그대로 수용하고
    --      로그인 성공 시 조용히 현행 알고리즘으로 재해싱하기 위함
    --   ② 나중에 도입하면 기존 행 전부를 손봐야 한다
    --      (IX-Trust V11__add_bcrypt_prefix_to_passwords.sql 이 그 사례)
    --   소셜 전용 계정[P2]은 NULL
    password_hash VARCHAR(255),
    name          VARCHAR(100)  NOT NULL,
    -- ACTIVE | LOCKED | DISABLED | PENDING
    status        VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',
    failed_count  INTEGER       NOT NULL DEFAULT 0,
    locked_until  TIMESTAMPTZ,
    -- 마지막 실패 시각. lockout.reset-window 가 지났는지 판단해 카운터를 새로 세는 데 쓴다
    last_failed_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    -- 이메일 인증 시각. NULL = 미인증 (V2)
    email_verified_at TIMESTAMPTZ,
    -- 본인이 탈퇴를 요청한 시각. NULL = 요청 없음 (V7)
    --   값 있음 + status <> DISABLED  유예 중 — 그 사이 로그인하면 취소되어 다시 NULL
    --   값 있음 + status  = DISABLED  탈퇴 완료
    -- 물리 삭제하지 않는 이유: ① 감사 로그의 user_id 가 가리킬 곳이 사라진다
    -- ② 같은 주소로 재가입해 이력을 지울 수 있다. 관리자가 닫은 계정과 구분하려고 따로 둔다
    deletion_requested_at TIMESTAMPTZ,
    -- 앱 고유 필드용. 검색이 필요하면 앱 프로필 테이블 + FK 를 쓴다
    -- (IX-Auth 스키마에 앱 컬럼을 추가하지 않는다 — rules/product-boundary.md)
    attributes    JSONB         NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- 대소문자 무시 유일성. 'A@x.com' 과 'a@x.com' 은 같은 계정이다
CREATE UNIQUE INDEX uq_users_email ON ixauth.users (lower(email));
CREATE INDEX idx_users_status ON ixauth.users (status);

-- =====================================================================
-- 2. 역할 · 그룹  (L1 인가)
-- =====================================================================

CREATE TABLE ixauth.roles (
    id          BIGSERIAL    PRIMARY KEY,
    code        VARCHAR(50)  NOT NULL UNIQUE,   -- 'ADMIN', 'PM', 'VIEWER'
    name        VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    -- 시스템 역할은 삭제·코드변경 불가 (ADMIN 등)
    is_system   BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- 역할 계층(parent_id)은 두지 않는다 — 결정 A2.
-- "왜 이 권한이 있지" 추적이 어려워진다. 권한 중복 부여로 처리하고,
-- 필요해지면 그때 컬럼을 추가한다 (추가는 쉽고, 제거는 어렵다).

CREATE TABLE ixauth.user_roles (
    user_id BIGINT NOT NULL REFERENCES ixauth.users(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES ixauth.roles(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    granted_by BIGINT REFERENCES ixauth.users(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, role_id)
);
CREATE INDEX idx_user_roles_role ON ixauth.user_roles (role_id);

-- 권한 부여 단위. 조직도가 아니다 —
-- "이 그룹에 권한을 주는가" 면 여기, "이 사람이 조직 어디에 속하는가" 면 앱/IX-Trust
--
-- 표 이름이 `groups` 가 아닌 이유 (2026-08-21 개명) — GROUPS 는 MySQL 8.0.2+ 예약어다
-- (윈도우 함수 절). 인용하지 않은 `CREATE TABLE groups` 는 ERROR 1064 로 실패하고,
-- DDL 만 백틱으로 감싸도 Hibernate 가 런타임 SELECT 에서 같은 이름을 인용 없이 내보내
-- 그룹을 읽는 경로가 전부 깨진다. MariaDB·PostgreSQL 에서는 예약어가 아니지만,
-- 엔티티 하나가 세 방언을 함께 타므로 이름은 한 벌이어야 한다.
-- 기존 설치본은 V12 가 rename 한다 (V1 은 고정 — 체크섬을 바꾸지 않는다).
CREATE TABLE ixauth.ixauth_groups (
    id          BIGSERIAL    PRIMARY KEY,
    code        VARCHAR(50)  NOT NULL UNIQUE,   -- 'dev-team', 'partner-acme'
    name        VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- 그룹 계층도 두지 않는다 (A2 와 같은 이유, 평면 구조)

CREATE TABLE ixauth.user_groups (
    user_id  BIGINT NOT NULL REFERENCES ixauth.users(id)  ON DELETE CASCADE,
    group_id BIGINT NOT NULL REFERENCES ixauth.ixauth_groups(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, group_id)
);
CREATE INDEX idx_user_groups_group ON ixauth.user_groups (group_id);

CREATE TABLE ixauth.group_roles (
    group_id BIGINT NOT NULL REFERENCES ixauth.ixauth_groups(id) ON DELETE CASCADE,
    role_id  BIGINT NOT NULL REFERENCES ixauth.roles(id)  ON DELETE CASCADE,
    PRIMARY KEY (group_id, role_id)
);
CREATE INDEX idx_group_roles_role ON ixauth.group_roles (role_id);

-- =====================================================================
-- 3. 권한  (L1 인가)
-- =====================================================================

-- 사전 등록제 — 결정 A4.
-- 등록된 코드만 부여할 수 있다. 관리 화면에 목록을 보여주고 오타를 막는다.
CREATE TABLE ixauth.permissions (
    id          BIGSERIAL     PRIMARY KEY,
    -- '<domain>:<resource>:<action>'  예: 'page:admin.users:view'
    -- 문법·매칭 규칙은 authz.md
    code        VARCHAR(200)  NOT NULL UNIQUE,
    domain      VARCHAR(50)   NOT NULL,   -- 'page' | 'file' | 'board' | 앱이 정의
    resource    VARCHAR(120)  NOT NULL,   -- 'admin.users', 'contracts/**', '*'
    action      VARCHAR(30)   NOT NULL,   -- 'view' | 'read' | 'write' | 'download' | '*'
    description VARCHAR(500),
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_permissions_domain ON ixauth.permissions (domain);

CREATE TABLE ixauth.role_permissions (
    role_id       BIGINT NOT NULL REFERENCES ixauth.roles(id)       ON DELETE CASCADE,
    permission_id BIGINT NOT NULL REFERENCES ixauth.permissions(id) ON DELETE CASCADE,
    granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX idx_role_permissions_perm ON ixauth.role_permissions (permission_id);

-- permissions_version 은 별도 테이블을 두지 않는다.
-- 아래 4개 테이블의 max(updated_at|granted_at) 을 epoch 초로 환산해 쓴다.
--   permissions, role_permissions, ixauth_groups, group_roles
-- 앱은 이 값이 바뀌면 permission-map 을 다시 받는다 (authz.md §캐싱).

-- =====================================================================
-- 4. 리소스 인스턴스 권한  (L2 인가) — [P2 구현, 계약은 P0 확정]
-- =====================================================================

CREATE TABLE ixauth.resource_grants (
    id            BIGSERIAL     PRIMARY KEY,
    -- USER | GROUP | ROLE
    subject_type  VARCHAR(10)   NOT NULL,
    subject_id    BIGINT        NOT NULL,
    resource_type VARCHAR(50)   NOT NULL,    -- 'file' | 'folder' | 'document' | 앱이 정의
    -- 경로 또는 식별자. 경로면 계층 상속이 적용된다 (authz.md §L2 판정)
    --   '/contracts/2026/a.pdf' 조회 시 '/contracts/2026/', '/contracts/', '/' 도 함께 본다
    resource_key  VARCHAR(1000) NOT NULL,
    action        VARCHAR(30)   NOT NULL,    -- 'read'|'write'|'delete'|'download'|'share'|'*'
    -- ALLOW | DENY  — DENY 가 우선한다 (결정 A3)
    effect        VARCHAR(10)   NOT NULL DEFAULT 'ALLOW',
    granted_by    BIGINT        REFERENCES ixauth.users(id) ON DELETE SET NULL,
    expires_at    TIMESTAMPTZ,               -- 임시 권한 (결정 A5). NULL = 무기한
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- L2 성능의 전부가 이 인덱스다.
-- 판정은 조상 경로 집합의 IN 조회이므로 (resource_type, resource_key) 복합 인덱스면 충분하다.
-- varchar_pattern_ops 는 향후 prefix 검색(관리 화면의 경로 탐색 등)을 열어두기 위해 유지한다.
CREATE INDEX idx_grants_resource
    ON ixauth.resource_grants (resource_type, resource_key varchar_pattern_ops);
CREATE INDEX idx_grants_subject
    ON ixauth.resource_grants (subject_type, subject_id);
-- 같은 (주체, 리소스, 액션) 에 ALLOW/DENY 중복 등록 방지
CREATE UNIQUE INDEX uq_grants_tuple
    ON ixauth.resource_grants (subject_type, subject_id, resource_type, resource_key, action);

-- =====================================================================
-- 4.5 서명 키  (JWKS 게시용)
-- =====================================================================

-- DB 에 두는 이유:
--   ① jar 가 재시작해도 이미 발급된 토큰이 계속 검증돼야 한다
--   ② 여러 인스턴스가 같은 키로 서명해야 한다
--   ③ 회전 시 구 키를 JWKS 에 남겨둬야 아직 유효한 토큰이 깨지지 않는다 (token.md §4)
--
-- private key 는 PKCS#8 Base64. DB 접근이 곧 키 유출이므로 DB 자체의 접근 통제가 전제다.
-- 외부 주입(`ixauth.jwt.private-key`)도 지원한다.
CREATE TABLE ixauth.signing_keys (
    kid           VARCHAR(50)  PRIMARY KEY,   -- JWKS 의 kid. 예: '2026-08-08-7654'
    algorithm     VARCHAR(10)  NOT NULL,      -- 'RS256'
    public_jwk    TEXT         NOT NULL,      -- 공개키 JWK JSON — JWKS 응답에 그대로 실린다
    private_pkcs8 TEXT         NOT NULL,
    -- 활성 키로 서명한다. 회전 후 구 키는 false 지만 retired_at 이 null 인 동안 JWKS 에는 남는다
    active        BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    retired_at    TIMESTAMPTZ                 -- 설정되면 JWKS 에서 빠진다
);
CREATE INDEX idx_signing_keys_active ON ixauth.signing_keys (active, created_at DESC);

-- =====================================================================
-- 5. 세션
-- =====================================================================

-- refresh token 은 JWT 가 아니라 opaque 난수다.
-- JWT 로 하면 앱이 로컬 검증할 수 있어 즉시 폐기가 불가능해진다.
-- 여기 저장하고 대조해야 로그아웃·강제 종료가 실제로 먹는다.
CREATE TABLE ixauth.sessions (
    id                 UUID          PRIMARY KEY,
    user_id            BIGINT        NOT NULL REFERENCES ixauth.users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(64)   NOT NULL,   -- SHA-256 hex(64자). 평문 저장 금지
    issued_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    expires_at         TIMESTAMPTZ   NOT NULL,
    revoked_at         TIMESTAMPTZ,
    last_used_at       TIMESTAMPTZ,
    user_agent         VARCHAR(500),
    ip                 VARCHAR(45),              -- IPv6 최대 길이
    -- 사용자 대리(impersonation). NULL 이면 평범한 로그인 세션이다.
    -- 토큰의 act 클레임이 여기서 나온다 — 토큰에만 두면 refresh 회전 때 앱이 보낸
    -- 값을 그대로 다시 서명하는 꼴이라 대리 사실을 클라이언트가 정하게 된다
    impersonator_id    BIGINT,
    -- 그 시점의 기록이다. 조인으로 지금 값을 끌어오면 관리자가 주소를 바꾼 순간
    -- 과거의 사실이 바뀐다
    impersonator_email VARCHAR(320),
    -- 이 세션을 연 외부 신원 공급자 (V13). NULL 이면 IX-Auth 자체 인증이다.
    -- 토큰의 ixauth_idp 클레임이 여기서 나온다 — impersonator_id 와 같은 이유로
    -- 세션 행이 정본이어야 회전이 몇 번 돌아도 출처가 서버로 남는다
    idp                VARCHAR(64),
    CONSTRAINT ck_sessions_expiry CHECK (expires_at > issued_at)
);
CREATE UNIQUE INDEX uq_sessions_token ON ixauth.sessions (refresh_token_hash);
CREATE INDEX idx_sessions_user ON ixauth.sessions (user_id, revoked_at);
CREATE INDEX idx_sessions_expires ON ixauth.sessions (expires_at);
-- "이 관리자가 최근에 누구를 대리했나". 대리 세션은 드물어 부분 인덱스로 충분하다
CREATE INDEX idx_sessions_impersonator ON ixauth.sessions (impersonator_id)
    WHERE impersonator_id IS NOT NULL;

-- =====================================================================
-- 6. 감사 로그
-- =====================================================================

-- append-only. UPDATE/DELETE 경로를 코드에 만들지 않는다 (rules/coding-style.md).
-- 보존 기간이 지난 것은 파티션 드롭 또는 운영자 배치로 정리한다.
CREATE TABLE ixauth.audit_logs (
    id         BIGSERIAL    PRIMARY KEY,
    -- LOGIN_SUCCESS | LOGIN_FAILURE | LOGOUT | ACCOUNT_LOCKED | PASSWORD_CHANGED
    -- | ROLE_GRANTED | PERMISSION_CHANGED | GRANT_CREATED | ... (errors.md 와 별개 체계)
    event_type VARCHAR(50)  NOT NULL,
    -- FK 를 걸지 않는다: append-only 독립 로그이고 별도 트랜잭션에서 기록되므로
    -- 아직 커밋되지 않은 사용자를 참조하다 깨진다 (2026-08-08 실측)
    user_id    BIGINT,
    actor_id   BIGINT,   -- 관리자 조작 시
    ip         VARCHAR(45),
    user_agent VARCHAR(500),
    -- 상세. 비밀번호·토큰·시크릿을 절대 넣지 않는다
    detail     JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON ixauth.audit_logs (created_at DESC);
CREATE INDEX idx_audit_user ON ixauth.audit_logs (user_id, created_at DESC);
CREATE INDEX idx_audit_event ON ixauth.audit_logs (event_type, created_at DESC);

-- =====================================================================
-- 7. 비밀번호 재설정 · MFA  — [P2]
-- =====================================================================

-- 비밀번호 재설정 · 이메일 인증 · 초대 · 이메일 변경이 한 테이블을 쓴다.
-- 용도마다 테이블을 따로 두면 만료·1회용·정리 로직이 네 벌로 갈라지고,
-- 그중 하나만 고치는 실수가 난다. (V2)
CREATE TABLE ixauth.verification_tokens (
    id         BIGSERIAL    PRIMARY KEY,
    user_id    BIGINT       NOT NULL REFERENCES ixauth.users(id) ON DELETE CASCADE,
    -- PASSWORD_RESET | EMAIL_VERIFY | INVITE | EMAIL_CHANGE | MFA_CHALLENGE | MAGIC_LINK
    -- MFA_CHALLENGE 만 메일로 나가지 않는다 — 로그인 1단계와 2단계 사이의 증표다 (V6)
    -- MAGIC_LINK 는 그 자체가 로그인이라 수명이 가장 짧다 (기본 10분, V9)
    -- CHECK 제약을 걸지 않는 이유 — 용도가 늘 때마다 마이그레이션이 필요해진다.
    -- 값의 유효성은 JPA enum 이 보장하고, DB 는 저장만 한다
    purpose    VARCHAR(20)  NOT NULL,
    token_hash VARCHAR(64)  NOT NULL,   -- SHA-256 hex(64자). 평문 저장 금지
    payload    VARCHAR(320),            -- EMAIL_CHANGE 의 '바꿀 주소' 등 용도별 부가 정보
    expires_at TIMESTAMPTZ  NOT NULL,
    used_at    TIMESTAMPTZ,             -- 1회용. 쓰면 시각을 남기고 다시는 통하지 않는다
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_verification_token ON ixauth.verification_tokens (token_hash);
CREATE INDEX idx_verification_user_purpose ON ixauth.verification_tokens (user_id, purpose);
CREATE INDEX idx_verification_expires ON ixauth.verification_tokens (expires_at);

-- 2026-08-08 구현(V6__mfa.sql)에 맞춰 정정.
--   ① backup_codes_enc → backup_codes_hash
--      백업 코드는 대조만 하면 되므로 되돌려 읽을 이유가 없다. 해시면 DB 가 통째로
--      새어도 코드 자체는 나오지 않는데, 암호화는 키를 쥔 쪽이 전부 평문으로 읽는다.
--      secret_enc 만 암호화인 것은 TOTP 가 매 검증마다 원본으로 코드를 다시 계산하기 때문이다.
--   ② last_step 추가 — 없으면 같은 30초 창의 코드가 두 번 통한다(재사용).
CREATE TABLE ixauth.mfa_credentials (
    id                BIGSERIAL   PRIMARY KEY,
    user_id           BIGINT      NOT NULL REFERENCES ixauth.users(id) ON DELETE CASCADE,
    type              VARCHAR(20) NOT NULL,   -- 'TOTP'
    -- AES-256-GCM 암호문(Base64), 'v1:' 접두어. 평문 금지
    secret_enc        TEXT        NOT NULL,
    -- 남은 1회용 코드의 SHA-256 hex 목록(줄바꿈 구분). 쓰면 그 줄이 사라진다
    backup_codes_hash TEXT,
    confirmed_at      TIMESTAMPTZ,            -- 최초 검증 완료 시각. NULL = 등록 미완료
    -- 마지막으로 통과한 TOTP 스텝(30초 단위). 이보다 크지 않으면 거부 = 재사용 차단
    last_step         BIGINT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_mfa_user_type ON ixauth.mfa_credentials (user_id, type);

-- 로그인 중간 증표(challenge)는 표를 따로 두지 않고 verification_tokens 의
-- purpose = 'MFA_CHALLENGE' 로 둔다 — 만료·1회용·정리 규칙을 한 벌로 유지하기 위해서다.
--
-- step-up 재인증(mfa.step-up-actions, V9)도 이 표를 그대로 쓴다. 코드 검증이 로그인
-- 2단계와 **같은 경로**를 지나므로 재사용 차단(last_step)과 백업 코드 소모가 저절로
-- 같이 적용된다. "언제 재인증했는가" 는 저장하지 않는다 — 유효 시간을 두면 그 사이
-- 이메일 변경이 코드 없이 통과한다. 기록은 감사 로그(detail.phase = STEP_UP)에 남는다.

-- =====================================================================
-- 8. 초기 시드
-- =====================================================================

-- 시스템 역할. 관리자 계정은 부팅 시 ixauth.admin.* 설정으로 생성한다 (config.md)
INSERT INTO ixauth.roles (code, name, description, is_system) VALUES
    ('ADMIN', '관리자', 'IX-Auth 관리 API·화면 전권', TRUE),
    ('USER',  '일반 사용자', '기본 역할', TRUE);

INSERT INTO ixauth.permissions (code, domain, resource, action, description) VALUES
    ('ixauth:*:*',           'ixauth', '*',      '*',      'IX-Auth 관리 전권'),
    ('ixauth:users:read',    'ixauth', 'users',  'read',   '사용자 조회'),
    ('ixauth:users:write',   'ixauth', 'users',  'write',  '사용자 생성·수정·삭제'),
    ('ixauth:roles:read',    'ixauth', 'roles',  'read',   '역할·권한 조회'),
    ('ixauth:roles:write',   'ixauth', 'roles',  'write',  '역할·권한 변경'),
    ('ixauth:audit:read',    'ixauth', 'audit',  'read',   '감사 로그 조회'),
    -- 사용자 대리. users:write 와 나눈다 — 사용자를 고치는 것과 사용자가 되는 것은
    -- 다른 일이고, resource 를 users 로 두면 ixauth:users:* 에 딸려 간다
    ('ixauth:impersonation:create', 'ixauth', 'impersonation', 'create', '사용자 대리 시작');

INSERT INTO ixauth.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM ixauth.roles r, ixauth.permissions p
WHERE r.code = 'ADMIN' AND p.code = 'ixauth:*:*';

-- =====================================================================
-- MariaDB · MySQL 변형 (2026-08-21 — Q6 종결, 셋 다 실지원)
-- =====================================================================
-- 실제 DDL 은 `ix-auth-server/src/main/resources/db/migration/{vendor}` 에 있다.
-- vendor 는 JDBC URL 이 정한다 — postgresql | mariadb | mysql.
--
-- · 스키마 → 별도 데이터베이스: URL 이 ixauth 데이터베이스를 직접 가리킨다 (config.md §3)
-- · BIGSERIAL      → BIGINT AUTO_INCREMENT
-- · TIMESTAMPTZ    → DATETIME(6)  (앱이 UTC 로 저장·비교)
-- · JSONB          → JSON
-- · UUID           → MariaDB 10.7+ 는 네이티브 UUID, MySQL 8 은 BINARY(16)
--                    (Hibernate 방언이 각각 그렇게 매핑한다. CHAR(36) 은 validate 에서 거부된다)
-- · lower(email) 유일 인덱스 → GENERATED ALWAYS AS (LOWER(email)) VIRTUAL + UNIQUE
-- · varchar_pattern_ops → 불필요 (기본 인덱스가 prefix LIKE 를 탄다)
-- · 부분 인덱스(WHERE 절) → 전체 인덱스 (MariaDB MDEV-15140 · MySQL 미지원)
-- · CHECK 제약은 MySQL 8.0.16+ 부터 동작
--
-- MySQL 8 만의 제약 두 가지 — 이것 때문에 mariadb/ 사본을 그대로 쓸 수 없다:
--   ① JSON/TEXT/BLOB 컬럼은 리터럴 DEFAULT 를 금지한다 (ERROR 1101).
--      `JSON NOT NULL DEFAULT '{}'` → `JSON NOT NULL DEFAULT ('{}')` (8.0.13+ 표현식 기본값)
--   ② GROUPS 가 8.0.2+ 예약어다 → 표 이름은 세 방언 모두 ixauth_groups (위 §2 주석)

-- =====================================================================
-- 소셜 로그인 (V3)
-- =====================================================================

-- 외부 계정 연결. 매칭 기준은 (provider, subject) 이고 이메일이 아니다 —
-- 이메일은 바뀌고, 바뀐 주소가 남에게 재할당될 수도 있다.
CREATE TABLE ixauth.identities (
    id            BIGSERIAL    PRIMARY KEY,
    user_id       BIGINT       NOT NULL REFERENCES ixauth.users(id) ON DELETE CASCADE,
    provider      VARCHAR(20)  NOT NULL,   -- MICROSOFT | KAKAO | NAVER | GOOGLE (V9)
    subject       VARCHAR(255) NOT NULL,   -- provider 의 불변 식별자
    email         VARCHAR(320),            -- 표시·추적용. 매칭 기준이 아니다
    display_name  VARCHAR(200),
    linked_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_identity_provider_subject ON ixauth.identities (provider, subject);
CREATE INDEX idx_identity_user ON ixauth.identities (user_id);

-- =====================================================================
-- 연합 신원 교환 (V13)
-- =====================================================================

-- 앱이 **이미 검증한** 외부 신원과 IX-Auth 사용자의 대응 (http-api.md §2-7).
--
-- identities(소셜)와 표를 나눈 이유 — 저쪽 provider 는 코드에 열거된 값이고 그 행은
-- jar 가 provider 와 직접 주고받은 결과다. 이쪽 provider 는 운영자가 설정
-- (ixauth.federation.allowed-providers)으로 정하는 자유 문자열이고 그 행은 앱이 대신
-- 확인해 온 결과다. 신뢰의 출처가 다른 둘을 한 표에 섞으면 "이 연결을 누가
-- 보증했는가" 를 나중에 구분할 수 없다.
CREATE TABLE ixauth.federated_identities (
    id            BIGSERIAL    PRIMARY KEY,
    user_id       BIGINT       NOT NULL REFERENCES ixauth.users(id) ON DELETE CASCADE,
    provider      VARCHAR(64)  NOT NULL,   -- 허용 목록의 이름. 소문자로 정규화해 저장
    subject       VARCHAR(255) NOT NULL,   -- 외부 IdP 의 불변 식별자. 이메일이 아니다
    -- **연결 시점의** 주소. 표시·추적용이며 매칭 기준이 아니다. 이름이 email 이면
    -- "지금 주소" 로 읽고 조인하게 되므로 그 사실을 컬럼 이름이 스스로 말하게 했다
    email_at_link VARCHAR(320),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);
-- 같은 외부 계정이 두 사용자에게 붙으면 누구로 로그인할지 정할 수 없다
CREATE UNIQUE INDEX uq_federated_provider_subject
    ON ixauth.federated_identities (provider, subject);
CREATE INDEX idx_federated_user ON ixauth.federated_identities (user_id);

-- OAuth 진행 중인 요청 — CSRF(state) + PKCE.
-- 인메모리로 두면 인스턴스가 여럿일 때 콜백이 다른 인스턴스로 들어와 실패한다.
CREATE TABLE ixauth.oauth_states (
    state_hash    VARCHAR(64)  PRIMARY KEY,   -- 평문 아님. SHA-256
    provider      VARCHAR(20)  NOT NULL,
    redirect_uri  VARCHAR(500) NOT NULL,      -- 토큰 교환 때 같은 값을 다시 보내야 한다
    code_verifier VARCHAR(128),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ  NOT NULL
);
CREATE INDEX idx_oauth_state_expires ON ixauth.oauth_states (expires_at);

-- =====================================================================
-- 약관 동의 · 비밀번호 이력 · 속성 정의 (V8)
-- =====================================================================

-- 약관 한 **버전**. 개정하면 이 행을 고치지 않고 새 행을 만든다.
-- 고치면 동의 이력이 가리키는 내용이 나중에 달라져, "그 사람이 무엇에 동의했는가" 를
-- 영영 알 수 없게 된다. 증빙은 '동의했다' 가 아니라 '이 내용에 동의했다' 여야 한다.
CREATE TABLE ixauth.terms (
    id            BIGSERIAL    PRIMARY KEY,
    -- 'service' · 'privacy' · 'marketing'. 고객사마다 필요한 약관이 달라 자유 문자열이다
    code          VARCHAR(40)  NOT NULL,
    version       INTEGER      NOT NULL,          -- 같은 코드 안에서만 의미가 있다. 1부터
    title         VARCHAR(200) NOT NULL,
    body          TEXT,                            -- 본문을 담거나
    body_url      VARCHAR(1000),                   -- 외부 문서를 가리키거나 (둘 중 하나)
    required      BOOLEAN      NOT NULL DEFAULT TRUE,
    display_order INTEGER      NOT NULL DEFAULT 0,
    -- NULL = 초안. 게시 전에는 사용자에게 보이지 않는다 —
    -- 문안을 다듬는 동안 반쯤 쓴 약관이 가입 화면에 뜨면 안 된다
    published_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_terms_body CHECK (body IS NOT NULL OR body_url IS NOT NULL)
);
CREATE UNIQUE INDEX uq_terms_code_version ON ixauth.terms (code, version);
CREATE INDEX idx_terms_published ON ixauth.terms (code, published_at DESC);

-- 동의 이력. **지우지 않고 고치지도 않는다.**
-- 철회는 agreed = FALSE 인 새 행이다 — 덮어쓰면 "언제부터 언제까지 동의 상태였는가" 가
-- 사라지는데, 증빙에서 필요한 것이 바로 그 구간이다.
-- code·version 을 함께 두는 것은 중복이 아니라 스냅샷이다.
CREATE TABLE ixauth.term_agreements (
    id         BIGSERIAL   PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES ixauth.users(id) ON DELETE CASCADE,
    term_id    BIGINT      NOT NULL REFERENCES ixauth.terms(id),
    code       VARCHAR(40) NOT NULL,
    version    INTEGER     NOT NULL,
    agreed     BOOLEAN     NOT NULL,      -- 선택 약관의 '거절' 도 지켜야 할 의사 표시다
    agreed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip         VARCHAR(45),               -- 증빙에서 시각만큼 자주 요구받는 것이 출처다
    user_agent VARCHAR(500)
);
CREATE INDEX idx_term_agreements_user ON ixauth.term_agreements (user_id, code, agreed_at DESC);
CREATE INDEX idx_term_agreements_term ON ixauth.term_agreements (term_id);

-- 지난 비밀번호의 해시. 현재 해시 하나만 들고 있으면 막을 수 있는 것이 '직전 것' 뿐이다.
-- 그 대가로 보관하는 개인정보가 늘어나므로, 기본값(password.history-count = 0)에서는
-- 여기에 한 줄도 쌓이지 않는다.
-- 검사는 encoder.matches() 로 한다 — 해시끼리 비교하면 salt 때문에 아무것도 걸리지 않는다.
CREATE TABLE ixauth.password_history (
    id            BIGSERIAL    PRIMARY KEY,
    user_id       BIGINT       NOT NULL REFERENCES ixauth.users(id) ON DELETE CASCADE,
    password_hash VARCHAR(255) NOT NULL,   -- users.password_hash 와 같은 형식(접두어 포함)
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_password_history_user ON ixauth.password_history (user_id, created_at DESC);

-- users.attributes(JSONB) 에 무엇이 들어와야 하는지의 정의.
-- 정의가 없으면 아무 검사도 하지 않는다 — 지금까지 쓰던 앱이 그대로 동작해야 한다.
CREATE TABLE ixauth.user_attribute_defs (
    key           VARCHAR(60)  PRIMARY KEY,   -- attributes 의 키. 앱이 읽는 이름 그대로
    label         VARCHAR(200) NOT NULL,
    type          VARCHAR(20)  NOT NULL DEFAULT 'STRING',  -- STRING|NUMBER|BOOLEAN|ENUM|DATE
    required      BOOLEAN      NOT NULL DEFAULT FALSE,
    options       TEXT,                       -- ENUM 의 선택지. 쉼표 구분
    display_order INTEGER      NOT NULL DEFAULT 0,
    description   VARCHAR(500),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);


-- =====================================================================
-- 운영·관리 (2026-08-08 · V10)
-- =====================================================================

-- 메일 한 통의 발송 결과. **본문과 링크를 담지 않는다** — 재설정 링크가 DB(와 백업)에
-- 남으면 그것을 읽을 수 있는 사람이 누구의 계정이든 가져갈 수 있다. 이 표가 주는 편의보다
-- 훨씬 비싸다. 남는 것은 받는 사람 · 용도 · 상태뿐이고, 그 대가로 재시도는 발송 시점의
-- 메시지를 프로세스가 들고 있는 동안만 가능하다.
CREATE TABLE ixauth.mail_deliveries (
    id         BIGSERIAL    PRIMARY KEY,
    to_email   VARCHAR(320) NOT NULL,
    kind       VARCHAR(40)  NOT NULL,   -- MailMessage.Kind — 웹훅의 kind 와 같은 값
    subject    VARCHAR(300) NOT NULL,   -- 링크는 들어가지 않는다
    locale     VARCHAR(10)  NOT NULL DEFAULT 'ko',
    -- PENDING | SENT | FAILED(재시도 남음) | GAVE_UP(재시도 끝) | SKIPPED(transport=LOG)
    status     VARCHAR(20)  NOT NULL,
    attempts   INTEGER      NOT NULL DEFAULT 0,
    last_error VARCHAR(500),            -- 예외 메시지만. 스택트레이스는 넣지 않는다
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    sent_at    TIMESTAMPTZ
);
CREATE INDEX idx_mail_deliveries_created ON ixauth.mail_deliveries (created_at DESC);
CREATE INDEX idx_mail_deliveries_status ON ixauth.mail_deliveries (status, created_at DESC);

-- 관리자가 고쳐 쓴 메일 템플릿. **행이 없으면 코드의 기본 템플릿을 쓴다** (settings 와 같은 방식).
-- 그래야 이 기능이 생겼다고 이미 운영 중인 설치의 메일 문구가 달라지지 않는다.
CREATE TABLE ixauth.mail_templates (
    id         BIGSERIAL    PRIMARY KEY,
    kind       VARCHAR(40)  NOT NULL,
    locale     VARCHAR(10)  NOT NULL DEFAULT 'ko',   -- 'ko' · 'en'
    subject    VARCHAR(300) NOT NULL,
    body       TEXT         NOT NULL,
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by BIGINT
);
CREATE UNIQUE INDEX uq_mail_templates ON ixauth.mail_templates (kind, locale);

-- 속도 제한 카운터. **기본값(rate-limit.storage = MEMORY)에서는 한 줄도 쌓이지 않는다.**
-- 인스턴스가 여럿일 때만 켠다 — DB 왕복이 로그인 경로에 붙기 때문이다.
-- 정확한 쿼터가 아니라 무차별 대입의 '속도' 를 막는 것이라 창 경계의 누수는 문제가 되지 않는다.
CREATE TABLE ixauth.rate_limit_counters (
    bucket       VARCHAR(200) PRIMARY KEY,   -- "<IP>|<버킷>"
    window_start BIGINT       NOT NULL,      -- epoch 초 / 60 (고정 창)
    hits         INTEGER      NOT NULL,
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_rate_limit_window ON ixauth.rate_limit_counters (window_start);
