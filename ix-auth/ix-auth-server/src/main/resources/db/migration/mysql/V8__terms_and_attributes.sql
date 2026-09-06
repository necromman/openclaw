-- MySQL 8 방언 (mariadb/ 사본 — 다른 곳은 파일 안 주석으로 표시했다)
-- 가입·비밀번호 정책 5종의 스키마 — 약관 동의(G6) · 비밀번호 이력(G9) · 속성 정의(G12).
--
-- V1~V7 은 고정이다. 이미 배포된 DB 가 그 체크섬을 들고 있으므로 고치면 부팅에 실패한다.
--
-- 이 묶음의 나머지 둘은 스키마가 필요 없다.
--   · G10 유출 비밀번호 차단 — 외부 목록과 대조할 뿐 아무것도 저장하지 않는다.
--     저장하면 그 순간 우리가 유출 목록의 사본을 갖게 된다.
--   · G13 CSV 일괄 등록 — 기존 users 에 여러 줄을 넣는 것뿐이다. 결과는 응답으로만 준다.
--     "지난번 업로드가 어땠지" 는 감사 로그(USER_CREATED)로 이미 되짚을 수 있다.
--
-- 새 표는 모두 비어 있는 채로 시작하고, 어떤 검사도 행이 없으면 통과한다.
-- 그래서 이 마이그레이션만으로는 기존 사용자의 동작이 하나도 달라지지 않는다.


-- =====================================================================
-- 1. 약관 (G6)
-- =====================================================================

-- 약관은 (코드, 버전) 으로 식별한다. 개정하면 새 행이고, 옛 행은 남는다.
--
-- 같은 행을 고쳐 쓰지 않는 이유가 이 표의 전부다 — 동의 이력이 가리키는 대상이
-- 나중에 바뀌면 "그 사람이 무엇에 동의했는가" 를 영영 알 수 없게 된다.
-- 증빙은 '동의했다' 가 아니라 '이 내용에 동의했다' 여야 한다.
CREATE TABLE terms (
    id           BIGINT       AUTO_INCREMENT PRIMARY KEY,
    -- 'service' · 'privacy' · 'marketing'. 앱과 계약하는 이름이라 자유 문자열로 둔다 —
    -- 고객사마다 필요한 약관이 다르고, enum 으로 묶으면 그때마다 jar 를 다시 빌드해야 한다
    code         VARCHAR(40)  NOT NULL,
    -- 1 부터. 같은 코드 안에서만 의미가 있다
    version      INTEGER      NOT NULL,
    title        VARCHAR(200) NOT NULL,
    -- 본문을 여기 두거나(body), 외부 문서를 가리키거나(body_url) 둘 중 하나.
    -- 긴 약관을 DB 에 넣기 싫은 곳이 있고, 반대로 외부 링크가 죽는 것을 걱정하는 곳이 있다
    body         TEXT,
    body_url     VARCHAR(1000),
    -- 필수 약관은 동의하지 않으면 가입할 수 없고, 개정되면 재동의를 요구한다.
    -- 선택 약관(마케팅 수신 등)은 거절도 하나의 답이라 그 사실까지 기록한다
    required     BOOLEAN      NOT NULL DEFAULT TRUE,
    display_order INTEGER     NOT NULL DEFAULT 0,
    -- NULL = 초안. 게시 전에는 사용자에게 보이지 않는다.
    -- 관리자가 문안을 다듬는 동안 가입 화면에 반쯤 쓴 약관이 뜨면 안 된다
    published_at DATETIME(6),
    created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- 본문이 둘 다 비면 사용자가 읽을 것이 없는 약관이 된다. 그 상태로 동의를 받으면
    -- 증빙이 아니라 그냥 체크박스다
    CONSTRAINT ck_terms_body CHECK (body IS NOT NULL OR body_url IS NOT NULL)
);
CREATE UNIQUE INDEX uq_terms_code_version ON terms (code, version);
-- 현재 게시본 조회 — (코드별로 가장 큰 게시 버전) 이 매 로그인·가입에서 필요하다
CREATE INDEX idx_terms_published ON terms (code, published_at DESC);

-- 동의 이력. **지우지 않는다.**
--
-- UPDATE 도 하지 않는다 — 동의를 철회하면 그 사실을 새 행으로 남긴다(agreed = FALSE).
-- 덮어쓰면 "언제부터 언제까지 동의 상태였는가" 가 사라지고, 그 구간이 곧 증빙이다.
--
-- code·version 을 term_id 와 함께 복사해 두는 것은 중복이 아니라 스냅샷이다.
-- terms 행이 어떤 이유로든 사라져도 무엇에 동의했는지는 여기 남아야 한다.
CREATE TABLE term_agreements (
    id         BIGINT      AUTO_INCREMENT PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    term_id    BIGINT      NOT NULL REFERENCES terms(id),
    code       VARCHAR(40) NOT NULL,
    version    INTEGER     NOT NULL,
    -- 선택 약관의 '거절' 도 기록한다. 마케팅 수신 거부는 지켜야 할 의사 표시다
    agreed     BOOLEAN     NOT NULL,
    agreed_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- 언제·어디서 동의했는지. 증빙에서 시각만큼 자주 요구받는 것이 출처다
    ip         VARCHAR(45),
    user_agent VARCHAR(500)
);
-- "이 사용자가 이 코드에 마지막으로 무엇을 했는가" — 재동의 판정이 매 로그인 이 질문을 한다
CREATE INDEX idx_term_agreements_user ON term_agreements (user_id, code, agreed_at DESC);
-- "이 버전에 몇 명이 동의했는가" — 관리 화면의 이력 조회 + 삭제 가능 여부 판단
CREATE INDEX idx_term_agreements_term ON term_agreements (term_id);


-- =====================================================================
-- 2. 비밀번호 재사용 이력 (G9)
-- =====================================================================

-- 지금까지 막을 수 있던 것은 '직전 것' 뿐이었다. 현재 해시 하나만 들고 있었기 때문이다.
-- 최근 N개를 막으려면 지난 해시를 남겨야 하는데, 그건 보관하는 개인정보를 늘리는 일이라
-- 기본값(password.history-count = 0)에서는 이 표에 한 줄도 쌓이지 않는다.
--
-- 평문이 아니라 해시를 넣는 것은 두말할 것 없고, 검사도 encoder.matches() 로 한다 —
-- 해시끼리 비교하면 salt 때문에 같은 비밀번호가 다른 해시가 되어 아무것도 걸리지 않는다.
CREATE TABLE password_history (
    id            BIGINT       AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 알고리즘 접두어 포함 — users.password_hash 와 같은 형식
    password_hash VARCHAR(255) NOT NULL,
    created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
-- 최근 N개를 새것부터 훑는다. 상한을 넘은 오래된 행을 지우는 것도 같은 인덱스를 탄다
CREATE INDEX idx_password_history_user ON password_history (user_id, created_at DESC);


-- =====================================================================
-- 3. 사용자 속성 정의 (G12)
-- =====================================================================

-- users.attributes(JSONB) 는 V1 부터 있었지만 정의도 검증도 없었다. 그래서 앱마다
-- 'dept' · 'department' · 'deptCode' 가 섞여 들어가고, 나중에 그걸 읽는 쪽에서 알아낼
-- 방법이 없다. 무엇이 들어와야 하는지를 여기에 적어 두고 그대로 검사한다.
--
-- 정의가 하나도 없으면 아무 검사도 하지 않는다 — 지금까지 쓰던 앱이 그대로 동작해야 한다.
CREATE TABLE user_attribute_defs (
    -- attributes JSONB 의 키. 'dept' 처럼 앱이 읽는 이름 그대로
    -- MySQL/MariaDB 에서 KEY 는 예약어라 백틱으로 escape (PostgreSQL 원본은 escape 불필요)
    `key`         VARCHAR(60)  PRIMARY KEY,
    label         VARCHAR(200) NOT NULL,
    -- STRING | NUMBER | BOOLEAN | ENUM | DATE
    type          VARCHAR(20)  NOT NULL DEFAULT 'STRING',
    -- 필수 속성이 빠지면 사용자 생성·수정이 거부된다.
    -- 이미 있는 사용자를 소급해서 고치지는 않는다 — 그러면 로그인이 막힌다
    required      BOOLEAN      NOT NULL DEFAULT FALSE,
    -- ENUM 일 때의 선택지. 쉼표로 구분한다 (설정의 LIST 표기와 같게 맞췄다)
    options       TEXT,
    display_order INTEGER      NOT NULL DEFAULT 0,
    description   VARCHAR(500),
    created_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
