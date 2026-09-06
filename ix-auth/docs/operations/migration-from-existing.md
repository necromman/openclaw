# 개발 중인 프로젝트를 IX-Auth 로 이사하기

> **대상**: 이미 로그인을 만들었지만 **실사용자 데이터가 없거나 버려도 되는** 프로젝트 (도입 케이스 B).
>
> ⚠️ **운영 중이라 실사용자 계정이 살아 있다면 대상이 아니다** (케이스 C).\
> 기존 users 테이블을 그대로 두려면 스키마 매핑 계층이 필요한데, 그게 IX-Auth 가 없애려던 구조다.\
> 상세: [`../../.claude/rules/product-boundary.md`](../../.claude/rules/product-boundary.md)

---

## 방향

**앱이 IX-Auth 에 맞춘다.** 앱의 users 테이블을 버리고 `ixauth.users` 를 쓴다. 반대 방향(IX-Auth 가 앱 스키마에 맞추기)은 지원하지 않는다.

```
[이사 전]                          [이사 후]
app.users (앱 소유)         →      ixauth.users        (IX-Auth 소유)
  ├ email, password                  ├ email, password_hash
  ├ name                             ├ name, status, ...
  ├ department  ┐                  app_user_profiles   (앱 소유)
  ├ employee_no ├ 앱 고유    →        ├ user_id → ixauth.users.id (FK)
  └ phone       ┘                    ├ department, employee_no, phone
```

---

## 순서

### 1. IX-Auth 를 띄운다

앱 DB 를 그대로 가리킨다. 부팅하면 `ixauth` 스키마가 자동 생성된다.

```yaml
IXAUTH_DB_URL: jdbc:postgresql://db:5432/myapp   # 앱이 쓰던 DB
IXAUTH_JWT_ISSUER: https://myapp.example.com
IXAUTH_SERVICE_KEY: <32자 이상>
IXAUTH_ADMIN_EMAIL: admin@example.com
IXAUTH_ADMIN_PASSWORD: <초기 비밀번호>
```

### 2. 계정을 옮긴다

```sql
-- 기존 계정 → ixauth.users
INSERT INTO ixauth.users (email, password_hash, name, status, created_at)
SELECT
    u.email,
    -- ⚠ 해시 접두어가 핵심이다 (아래 §비밀번호 참조)
    CASE
        WHEN u.password LIKE '{%'      THEN u.password          -- 이미 접두어 있음
        WHEN u.password LIKE '$2a$%'
          OR u.password LIKE '$2b$%'
          OR u.password LIKE '$2y$%'   THEN '{bcrypt}' || u.password
        ELSE NULL                                               -- 그 외 = 재설정 대상
    END,
    u.name,
    'ACTIVE',
    COALESCE(u.created_at, now())
FROM app.users u
WHERE u.email IS NOT NULL;
```

**`password_hash` 가 NULL 로 들어간 계정은 로그인할 수 없다.** 관리 화면에서 비밀번호를 초기화하거나, 개발 계정이면 그냥 다시 만든다.

### 3. 앱 고유 필드를 분리한다

IX-Auth 스키마에 앱 컬럼을 추가하지 않는다. 두 가지 방법 중 고른다.

**A. 앱 프로필 테이블 + FK (권장)**

```sql
CREATE TABLE app_user_profiles (
    user_id     BIGINT PRIMARY KEY REFERENCES ixauth.users(id) ON DELETE CASCADE,
    department  VARCHAR(100),
    employee_no VARCHAR(50),
    phone       VARCHAR(30)
);

INSERT INTO app_user_profiles (user_id, department, employee_no, phone)
SELECT n.id, o.department, o.employee_no, o.phone
FROM app.users o
JOIN ixauth.users n ON lower(n.email) = lower(o.email);
```

**B. `attributes` JSONB** — 필드가 적고 검색이 필요 없을 때

```sql
UPDATE ixauth.users n
   SET attributes = jsonb_build_object('employeeNo', o.employee_no)
  FROM app.users o
 WHERE lower(n.email) = lower(o.email);
```

### 4. 역할을 옮긴다

```sql
-- 앱의 역할 코드를 IX-Auth 역할로 등록
INSERT INTO ixauth.roles (code, name) VALUES ('PM', '프로젝트 관리자')
ON CONFLICT (code) DO NOTHING;

INSERT INTO ixauth.user_roles (user_id, role_id)
SELECT n.id, r.id
FROM app.users o
JOIN ixauth.users n ON lower(n.email) = lower(o.email)
JOIN ixauth.roles r ON r.code = o.role_code
ON CONFLICT DO NOTHING;
```

권한(`permissions`)은 사전 등록제다. 앱이 쓰던 화면·기능 권한을 `page:...` / `board:...` 코드로 등록하고 역할에 부여한다 ([`../contract/authz.md`](../contract/authz.md) §2).

### 5. 앱 코드의 FK 를 재배선한다

앱 테이블이 `app.users.id` 를 참조하고 있다면 `ixauth.users.id` 로 옮긴다.

```sql
-- 예: 게시글 작성자
ALTER TABLE posts ADD COLUMN author_id_new BIGINT;
UPDATE posts p SET author_id_new = n.id
  FROM app.users o JOIN ixauth.users n ON lower(n.email) = lower(o.email)
 WHERE p.author_id = o.id;
ALTER TABLE posts DROP COLUMN author_id;
ALTER TABLE posts RENAME COLUMN author_id_new TO author_id;
ALTER TABLE posts ADD CONSTRAINT fk_posts_author
    FOREIGN KEY (author_id) REFERENCES ixauth.users(id);
```

### 6. 앱의 로그인 코드를 교체한다

```
기존: 앱이 직접 비밀번호 검증 + 세션 생성
이후: 앱이 POST /auth/login 을 중계하고, 받은 토큰을 앱 도메인 쿠키로 심는다
      매 요청 검증은 JWKS 공개키로 앱이 스스로 한다 (jar 호출 없음)
```

로그인 **화면은 앱이 계속 소유한다** — IX-Auth 는 화면을 그리지 않는다(헤드리스).

### 7. 옛 테이블을 지운다

전부 확인한 뒤에 `app.users` 를 드롭한다. 되돌릴 일이 있을 수 있으니 한 릴리스 정도는 남겨 두길 권한다.

---

## 비밀번호 — 이사에서 가장 걸리는 지점

| 기존 저장 방식 | 이사 가능? | 방법 |
|---------------|-----------|------|
| BCrypt (`$2a$...`) | ✅ | `'{bcrypt}' \|\| password` 로 접두어만 붙인다 |
| BCrypt + 접두어 (`{bcrypt}$2a$...`) | ✅ | 그대로 |
| SHA-256 / MD5 / 평문 | ❌ | **재설정 강제** — 지원하지 않는다 |

IX-Auth 는 해시에 알고리즘 접두어를 붙여 저장하고, **로그인이 성공하면 조용히 현행 알고리즘으로 재해싱**한다(`ixauth.password.rehash-on-login`, 기본 켜짐). 그래서 BCrypt 라면 사용자가 눈치채지 못한 채 넘어온다.

> 평문·약한 해시를 지원하지 않는 것은 의도다. 인코더에 등록조차 하지 않았다 —
> 이사 편의를 위해 취약한 저장 방식을 살려두면 그게 그대로 운영에 남는다.

---

## 확인

```bash
# 1. 스키마가 생겼나
psql -c "\dt ixauth.*"

# 2. 헬스체크
curl -s http://localhost:9100/health
# {"status":"UP","db":"UP","migration":"OK", ...}

# 3. 옮긴 계정으로 로그인되나
curl -s -X POST http://localhost:9100/auth/login \
  -H "Content-Type: application/json" \
  -H "X-IxAuth-Key: $IXAUTH_SERVICE_KEY" \
  -d '{"email":"someone@example.com","password":"기존비밀번호"}'

# 4. 재해싱이 먹었나 (접두어 확인)
psql -c "select left(password_hash, 10) from ixauth.users where email='someone@example.com'"
```
