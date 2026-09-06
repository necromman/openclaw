-- MariaDB 방언 (postgresql/ 원본과 1:1 대응)
-- TOTP 2단계 인증 — 자리는 V1 에 있었고 구현이 없었다.
--
-- V1~V5 는 고정이다. 이미 배포된 DB 가 그 체크섬을 들고 있으므로 고치면 부팅에 실패한다.
-- mfa_credentials 에는 아직 한 줄도 없다(기능이 없었으므로). 그래서 지금이 컬럼 이름을
-- 바로잡을 수 있는 마지막 시점이다 — V2 가 password_reset_tokens 를 갈아엎었던 것과 같다.

-- ① backup_codes_enc → backup_codes_hash
--
-- 백업 코드는 되돌려 읽을 이유가 없다. 사용자가 입력한 값과 대조만 하면 되므로
-- 해시로 충분하고, 그러면 DB 가 통째로 새어도 코드 자체는 나오지 않는다.
-- 암호화해 두면 키를 쥔 쪽이 전부 평문으로 읽을 수 있어 더 나쁘다.
--
-- secret_enc 는 반대다 — TOTP 는 매 검증마다 원본 시크릿으로 코드를 다시 계산해야 하므로
-- 복호화가 가능해야 한다. 그래서 그쪽만 AES-GCM 으로 암호화해 둔다.
ALTER TABLE mfa_credentials RENAME COLUMN backup_codes_enc TO backup_codes_hash;

-- ② 마지막으로 성공한 TOTP 스텝 (30초 = 1스텝)
--
-- 이게 없으면 같은 30초 창의 코드가 두 번 통한다. 어깨너머로 본 코드, 로그·프록시에
-- 남은 코드가 그 창 안에서 한 번 더 쓰일 수 있다는 뜻이다.
-- 검증에 성공한 스텝을 기록해 두고, 그보다 크지 않은 스텝은 거부한다.
ALTER TABLE mfa_credentials ADD COLUMN last_step BIGINT;

-- ③ 마지막 변경 시각 — 언제 등록했고 언제 백업 코드가 줄었는지
ALTER TABLE mfa_credentials ADD COLUMN updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);

-- 임시 challenge 토큰(MFA_CHALLENGE)은 verification_tokens 를 그대로 쓴다.
-- 표를 새로 만들지 않는 이유는 그 표의 주석과 같다 — 만료·1회용·정리 규칙이 갈라지면
-- 그중 하나만 고치는 실수가 나고, 그 하나가 보안 구멍이 된다.
-- purpose 는 VARCHAR(20) 이라 'MFA_CHALLENGE'(13자) 가 그대로 들어간다.
