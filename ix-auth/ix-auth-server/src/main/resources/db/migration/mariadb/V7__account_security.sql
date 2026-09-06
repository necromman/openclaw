-- MariaDB 방언 (postgresql/ 원본과 1:1 대응)
-- 계정 보안 — 본인 탈퇴(G5).
--
-- V1~V6 은 고정이다. 이미 배포된 DB 가 그 체크섬을 들고 있으므로 고치면 부팅에 실패한다.
--
-- 이 묶음의 나머지(로그인 알림 G3 · 동시 세션 제한 G4 · 기기 표시 G20)는 스키마가 필요 없다.
--   · G3 "이 (IP, User-Agent) 로 전에 들어온 적이 있는가" 는 sessions 에 이미 다 있다.
--     같은 사실을 두 곳에 적으면 반드시 어긋나고, 그 어긋남이 곧 오탐·미탐이 된다.
--     조회는 idx_sessions_user (user_id, revoked_at) 의 선행 컬럼을 그대로 탄다.
--   · G4 는 sessions.revoked_at 을 쓰는 판단일 뿐이다.
--   · G20 은 저장된 user_agent 를 읽는 시점에 만드는 표시용 문자열이다. 저장하지 않는 이유는
--     파싱 규칙을 고치면 과거 행이 옛 규칙으로 남아 같은 기기가 두 이름으로 보이기 때문이다.

-- ── 본인 탈퇴 ──
--
-- 물리 삭제하지 않는다. 지우면 ① 감사 로그의 user_id 가 가리킬 곳이 사라져 "누가 무엇을 했는지"
-- 를 되짚을 수 없고 ② 같은 주소로 다시 가입해 이력을 지울 수 있다.
-- 그래서 관리자 소프트 삭제와 같은 자리(status = 'DISABLED')를 쓰되, '본인이 요청했다' 는
-- 사실과 그 시각만 여기에 따로 남긴다. 관리자가 닫은 계정과 본인이 닫은 계정은 다른 사건이다.
--
--   NULL                          요청 없음
--   값 있음 + status <> DISABLED  유예 중 — 그 사이 로그인하면 취소되어 다시 NULL 이 된다
--   값 있음 + status  = DISABLED  탈퇴 완료. 요청 시각은 개인정보 처리 기록으로 남는다
ALTER TABLE users ADD COLUMN deletion_requested_at DATETIME(6);

-- 유예가 끝난 요청을 찾는 야간 배치 전용.
-- 대부분의 행이 NULL 이므로 부분 인덱스로 둔다 — 전체 인덱스는 쓰지도 않을 행까지 안고 간다.
-- MariaDB 는 부분 인덱스(WHERE 절)를 지원하지 않는다 (MDEV-15140, 미구현) — 전체 인덱스로 대체한다.
-- 대부분 NULL 인 행을 인덱스에서 빼는 원본의 최적화 의도는 못 살리지만, 조회 결과는 동일하다.
CREATE INDEX idx_users_deletion_requested ON users (deletion_requested_at);
