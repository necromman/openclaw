-- 연합 신원 교환(federated identity exchange).
--
-- V1~V12 는 고정이다. 이미 배포된 DB 가 그 체크섬을 들고 있으므로 고치면 부팅에 실패한다.
--
-- **이것은 OIDC IdP 화가 아니다.** IX-Auth 는 외부 provider 와 직접 토큰을 교환하지 않고
-- 브라우저를 받지도 않는다(설계 불변식 1·4). 신원을 확인하는 주체는 앱이고, jar 는
-- 앱이 이미 검증한 결과를 계정에 잇는 일만 한다. README 의 ixauth.mode=federated 로
-- 가는 첫 단계다.


-- =====================================================================
-- 1. 외부 신원 연결 — federated_identities
-- =====================================================================

-- **identities(소셜) 와 표를 나눈 이유.**
--
-- identities.provider 는 MICROSOFT|KAKAO|NAVER|GOOGLE 로 코드에 열거된 값이고,
-- 그 행은 jar 가 provider 와 직접 주고받은 결과다. 이쪽 provider 는 운영자가
-- 설정(ixauth.federation.allowed-providers)으로 정하는 자유 문자열이고, 그 행은
-- 앱이 대신 확인해 온 결과다. 신뢰의 출처가 다른 두 가지를 한 표에 섞으면
-- "이 연결을 누가 보증했는가" 를 나중에 구분할 수 없다.
CREATE TABLE federated_identities (
    id            BIGSERIAL    PRIMARY KEY,
    user_id       BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 운영자가 허용 목록에 적은 이름 그대로 (예: nexus-hub). 소문자로 정규화해 저장한다
    provider      VARCHAR(64)  NOT NULL,
    -- 외부 IdP 가 주는 불변 식별자. 이메일이 아니다 —
    -- 이메일은 바뀌고, 바뀐 주소가 남에게 재할당될 수도 있다
    subject       VARCHAR(255) NOT NULL,
    -- **연결 시점의** 주소. 표시·추적용이며 매칭 기준이 아니다.
    -- 이름을 email 이 아니라 email_at_link 로 둔 것은 그 사실을 컬럼 이름이
    -- 스스로 말하게 하기 위해서다 — email 이면 "지금 주소" 로 읽고 조인하게 된다
    email_at_link VARCHAR(320),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

-- 같은 외부 계정이 두 사용자에게 붙으면 누구로 로그인할지 정할 수 없다
CREATE UNIQUE INDEX uq_federated_provider_subject
    ON federated_identities (provider, subject);
CREATE INDEX idx_federated_user ON federated_identities (user_id);


-- =====================================================================
-- 2. 세션이 어느 신원으로 열렸는가 — sessions.idp
-- =====================================================================

-- access token 의 ixauth_idp 클레임이 여기서 나온다.
--
-- 토큰에만 두면 15분마다 도는 refresh 회전 때 앱이 보내 준 값을 그대로 다시 서명하는
-- 꼴이 되고, 그건 "이 세션이 어느 IdP 로 열렸는가" 를 클라이언트가 정할 수 있다는 뜻이다.
-- impersonator_id(V11) 와 같은 이유로 세션 행이 정본이다.
--
-- NULL 이면 IX-Auth 자체 인증(비밀번호·매직 링크·소셜)이다. 기존 행은 전부 그렇게 남는다.
ALTER TABLE sessions ADD COLUMN idp VARCHAR(64);
