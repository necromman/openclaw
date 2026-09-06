-- MariaDB 방언 (postgresql/ 원본과 1:1 대응)
-- 런타임 설정 — 관리자가 화면에서 바꾸고 재시작 없이 반영된다.
--
-- V1~V3 은 고정이다. 이미 배포된 DB 가 그 체크섬을 들고 있으므로 고치면 부팅에 실패한다.
--
-- yml 은 **기본값**이고 이 표는 **덮어쓰기**다. 행이 없으면 yml 값을 쓴다 —
-- 그래야 새 설정을 추가해도 기존 DB 에 아무 작업이 필요 없다.
--
-- 시크릿은 여기 들어오지 않는다 (client-secret · SMTP 비밀번호 · service-key).
-- 화면에서 편집 가능하게 만들면 DB·감사로그·백업으로 유출면이 넓어지고,
-- 관리자 계정 하나가 뚫리면 전부 새어 나간다. 편의보다 이쪽이 중요하다.

CREATE TABLE settings (
    -- 'account.signup-mode' 처럼 yml 경로와 같은 표기를 쓴다
    -- MariaDB 에서 KEY 는 예약어라 백틱으로 escape (PostgreSQL 원본은 escape 불필요)
    `key`      VARCHAR(120) PRIMARY KEY,
    -- 타입에 관계없이 문자열로 둔다. 해석은 정의(SettingDefinitions)가 한다 —
    -- 타입별 컬럼을 두면 새 타입이 생길 때마다 스키마를 바꿔야 한다
    value      TEXT         NOT NULL,
    updated_at DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    -- 누가 바꿨는지. 사고가 났을 때 이것 없이는 원인을 찾을 수 없다
    updated_by BIGINT
);

CREATE INDEX idx_settings_updated ON settings (updated_at);
