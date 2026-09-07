-- OPENCLAW-FORK-DELTA: 임원(EXECUTIVE) 역할을 시드한다 (ix-auth/MODULE.md 6절).
--
-- V14 가 시드한 4단계(SUPERADMIN/ADMIN/MODERATOR/MEMBER) 위에 한 단계를 더 얹는다.
-- 포크의 역할 매핑이 EXECUTIVE 를 게이트웨이 역할 executive 로 옮기고, 우선순위는
-- superadmin > admin > executive > moderator > member 다.
--
-- 임원의 전 부서 열람은 이 역할이 주는 것이 아니라 dept- 그룹 전체 소속이 주는 것이다.
-- 역할이 주는 것은 세션 상한(타인 세션 보기 전용)과 member 와 같은 스코프뿐이다.
-- 그래서 role_permissions 에는 아무것도 넣지 않는다 - 사용자 관리는 SUPERADMIN·ADMIN 의 일이다.
--
-- V14 와 같은 이유로 존재 검사를 걸어 멱등하게 만든다. 이미 콘솔에서 같은 코드의 역할을
-- 만들어 둔 설치본이 있어도 이 마이그레이션은 아무것도 바꾸지 않는다.

INSERT INTO roles (code, name, description, is_system)
SELECT 'EXECUTIVE', '임원', '전 부서 세션 열람(읽기 전용) + 본인 세션 작업', TRUE
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'EXECUTIVE');
