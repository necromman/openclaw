-- MariaDB 방언 (postgresql/ 원본과 1:1 대응)
-- 운영·관리 기능의 스키마 — 메일 발송 이력(G21) · 메일 템플릿/다국어(G16·G17) ·
-- 속도 제한 카운터(G26).
--
-- V1~V9 는 고정이다. 이미 배포된 DB 가 그 체크섬을 들고 있으므로 고치면 부팅에 실패한다.
--
-- 이 묶음의 나머지는 스키마가 필요 없다.
--   · G14/G23 감사 로그 CSV·기간 필터 — audit_logs 를 읽기만 한다.
--   · G22 사용자 상세 — 이미 있는 표들을 한 번에 모아 보여 줄 뿐이다.
--   · G25 설정 변경 이력 — 감사 로그(SETTING_CHANGED)에 이미 남아 있다. 표를 또 만들면
--     같은 사실이 두 곳에 생기고, 둘이 어긋나는 날이 온다.
--   · G19 서명 키 회전 — signing_keys 가 이미 active/retired_at 을 들고 있다.
--
-- 새 표는 모두 비어 있는 채로 시작하고, 비어 있으면 지금까지와 똑같이 동작한다.


-- =====================================================================
-- 1. 메일 발송 이력 (G21)
-- =====================================================================

-- **본문과 링크를 저장하지 않는다.** 이 표에서 가장 중요한 결정이다.
--
-- 재설정·초대 메일의 링크는 그 자체가 계정 접근 수단이다. DB 에 남기면 DB 를 읽을 수
-- 있는 사람(백업 파일을 포함해서)이 누구의 계정이든 가져갈 수 있고, 그건 이 표가 주는
-- 편의보다 훨씬 비싸다. 그래서 남기는 것은 **누구에게 · 무슨 용도로 · 어떻게 됐는지** 뿐이다.
--
-- 그 대가로 재시도는 발송 시점의 메시지를 **메모리에 들고 있는 동안만** 가능하다
-- (MailDeliveryService). 프로세스가 내려가면 대기 중이던 재시도는 사라지고 행은
-- 실패로 남는다 — 운영자는 그 사실을 보고 해당 기능을 다시 실행하면 된다.
CREATE TABLE mail_deliveries (
    id         BIGINT       AUTO_INCREMENT PRIMARY KEY,
    -- RFC 5321 의 최대 주소 길이
    to_email   VARCHAR(320) NOT NULL,
    -- MailMessage.Kind — PASSWORD_RESET · INVITE …
    kind       VARCHAR(40)  NOT NULL,
    -- 제목에는 링크가 들어가지 않는다. 목록에서 무슨 메일인지 알아보는 용도
    subject    VARCHAR(300) NOT NULL,
    -- 어떤 언어로 나갔는가 (G17). 사용자가 "영어로 왔다" 고 할 때 근거가 된다
    locale     VARCHAR(10)  NOT NULL DEFAULT 'ko',
    -- PENDING | SENT | FAILED | GAVE_UP | SKIPPED
    --   FAILED  = 실패했고 재시도가 남아 있다
    --   GAVE_UP = 재시도를 다 썼다. 운영자가 손대야 하는 것은 이것이다
    --   SKIPPED = transport=LOG 라 실제로 나가지 않았다. SENT 로 적으면 거짓말이 된다
    status     VARCHAR(20)  NOT NULL,
    attempts   INTEGER      NOT NULL DEFAULT 0,
    -- 예외 메시지만. 스택트레이스는 넣지 않는다 — 내부 경로가 화면으로 흘러간다
    last_error VARCHAR(500),
    created_at DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    sent_at    DATETIME(6)
);
-- 관리 화면의 기본 질문은 "최근에 뭐가 나갔나" 다
CREATE INDEX idx_mail_deliveries_created ON mail_deliveries (created_at DESC);
-- 두 번째 질문은 "안 나간 게 있나" — 상태로 좁힌 뒤 최근순
CREATE INDEX idx_mail_deliveries_status ON mail_deliveries (status, created_at DESC);


-- =====================================================================
-- 2. 메일 템플릿 (G16) + 다국어 (G17)
-- =====================================================================

-- **행이 없으면 코드의 기본 템플릿을 쓴다.** 이 표는 처음에 비어 있고, 비어 있는 동안
-- 메일 본문은 지금까지와 한 글자도 다르지 않다. 편집은 덮어쓰기이고, 삭제는 초기화다.
--
-- 언어를 코드가 아니라 행으로 가르는 이유 — 고객사가 필요로 하는 언어는 우리가 모른다.
-- 다만 기본 템플릿은 ko·en 두 벌만 코드에 둔다. 그 밖의 언어는 관리자가 넣어야 한다.
CREATE TABLE mail_templates (
    id         BIGINT       AUTO_INCREMENT PRIMARY KEY,
    kind       VARCHAR(40)  NOT NULL,
    -- 'ko' · 'en'. 사용자 attributes.locale 또는 mail.default-locale 로 고른다
    locale     VARCHAR(10)  NOT NULL DEFAULT 'ko',
    subject    VARCHAR(300) NOT NULL,
    body       TEXT         NOT NULL,
    updated_at DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- 누가 바꿨는지. 메일 본문은 사용자가 보는 얼굴이라 근거 없이 바뀌면 안 된다
    updated_by BIGINT
);
-- (용도, 언어) 하나에 한 벌
CREATE UNIQUE INDEX uq_mail_templates ON mail_templates (kind, locale);


-- =====================================================================
-- 3. 속도 제한 카운터 (G26)
-- =====================================================================

-- 인스턴스를 여러 개 띄우면 메모리 카운터는 인스턴스별이라 실질 한도가 배수가 된다.
-- 이 표는 그것을 한 곳에서 세기 위한 것이고, **기본값(MEMORY)에서는 한 줄도 쌓이지 않는다.**
--
-- 기본이 MEMORY 인 이유는 DB 왕복이 로그인 경로에 붙기 때문이다. 로그인은 이 제품에서
-- 가장 뜨거운 경로이고, 거기에 왕복을 하나 더 얹는 것은 인스턴스가 여럿일 때만 값을 한다.
--
-- 정확한 쿼터가 목적이 아니다. 막으려는 것은 **무차별 대입의 속도**이므로, 창 경계에서
-- 몇 건이 새는 것은 문제가 되지 않는다. 그래서 잠금도 직렬화도 쓰지 않는다.
CREATE TABLE rate_limit_counters (
    -- "<IP>|<버킷>" — 예: 203.0.113.7|login
    bucket       VARCHAR(200) PRIMARY KEY,
    -- epoch 초 / 60. 고정 창이다 (슬라이딩이 아니다 — 단순함이 낫다)
    window_start BIGINT       NOT NULL,
    hits         INTEGER      NOT NULL,
    updated_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
-- 지난 창의 행을 치우는 데 쓴다. 없으면 IP 수만큼 행이 영원히 남는다
CREATE INDEX idx_rate_limit_window ON rate_limit_counters (window_start);
