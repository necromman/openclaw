-- MariaDB 방언 (postgresql/ 원본과 1:1 대응)
-- 리소스 종류 등록 — 파일이 어디에 있느냐(로컬·S3·SeaweedFS·NAS)에 따라
-- 키 표기가 다르고, 표기가 어긋나면 권한이 조용히 없는 것이 된다.
--
-- V1~V4 는 고정이다.
--
-- 지금까지 resource_type 은 자유 문자열이었다. 그래서 'file' 로 부여하고 'files' 로
-- 물으면 NO_MATCH 가 나는데, 그 결과는 "권한 없음" 과 구분되지 않는다.
-- 오타 하나가 조용한 접근 거부가 되고, 반대로 정규화가 없으면 조용한 접근 허용이 된다.

CREATE TABLE resource_types (
    -- 'file' · 's3' · 'doc' 처럼 앱이 쓰는 이름
    code        VARCHAR(40)  PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    -- 키를 어떻게 정규화할지. PATH | S3 | OPAQUE
    key_format  VARCHAR(20)  NOT NULL DEFAULT 'PATH',
    -- 대소문자를 구분하는가. 리눅스 파일시스템은 구분하고 S3 버킷은 구분하지 않는다
    case_sensitive BOOLEAN   NOT NULL DEFAULT true,
    /*
     * true 면 IX-Auth 가 판정하지 않고 "저장소가 알아서 한다" 고 답한다.
     *
     * 파일서버(Nextcloud·MinIO 등)가 자체 권한을 가진 경우, 두 곳에서 각각 판정하면
     * 어느 쪽이 진짜인지 알 수 없게 된다. 그럴 때는 한쪽으로 몰아야 한다.
     */
    delegated   BOOLEAN      NOT NULL DEFAULT false,
    description VARCHAR(500),
    created_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);

-- 기본 종류. 앱이 다른 이름을 쓰면 관리 화면에서 추가한다.
INSERT INTO resource_types (code, name, key_format, case_sensitive, description) VALUES
  ('file', '파일·폴더 (로컬/NAS)', 'PATH', true,
   '서버 파일시스템이나 마운트된 공유 폴더. 키는 /로 시작하고, /로 끝나면 폴더로 보아 하위에 상속된다.'),
  ('s3',   'S3 호환 오브젝트 스토리지', 'S3', false,
   'AWS S3 · MinIO · SeaweedFS(S3 게이트웨이). s3://버킷/키 · 버킷/키 어느 표기로 물어도 같은 것으로 본다.'),
  ('doc',  '문서·레코드', 'OPAQUE', true,
   '경로가 아닌 식별자(문서 ID 등). 상속이 없고 정확히 일치할 때만 걸린다.');
