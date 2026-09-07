-- OPENCLAW-FORK-DELTA: 포크가 쓰는 4단계 역할을 시드한다 (ix-auth/MODULE.md 6절).
--
-- V1 이 만드는 기본 역할은 ADMIN 과 USER 뿐이다. 포크의 역할 매핑
-- (SUPERADMIN/ADMIN/MODERATOR/MEMBER)이 기대하는 나머지 3개가 없으면 매핑되지 않은
-- 사용자가 전부 gateway.roles.default 로 떨어져 권한 구분이 사라진다.
--
-- 이미 같은 코드의 역할을 콘솔에서 만들어 둔 설치본을 깨뜨리지 않도록 존재 검사를 건다.

INSERT INTO roles (code, name, description, is_system)
SELECT 'SUPERADMIN', '최고 관리자', '전 기능 + 타인 세션 쓰기 + 운영 관리 권한', TRUE
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'SUPERADMIN');

INSERT INTO roles (code, name, description, is_system)
SELECT 'MODERATOR', '중간 관리자', '타인 세션 제안 + 승인·질의 처리', TRUE
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'MODERATOR');

INSERT INTO roles (code, name, description, is_system)
SELECT 'MEMBER', '구성원', '기본 역할. 본인 세션만 다룬다', TRUE
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'MEMBER');

-- SUPERADMIN 은 관리 콘솔 전권을 갖는다. MODERATOR·MEMBER 에는 IX-Auth 관리 권한을
-- 주지 않는다 - 사용자 관리는 SUPERADMIN·ADMIN 의 일이다.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'SUPERADMIN' AND p.code = 'ixauth:*:*'
  AND NOT EXISTS (
      SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id);
