# chris-local/infra - 납품처 인프라 참조 (로컬 전용 사본)

이 폴더의 `local/` 은 **git 에서 제외**된다(`.gitignore`). 정본은 `D:\PROJECT\chris-server` 이고, 이 프로젝트 세션이 NAS 접속·실측을 바로 할 수 있도록 사본만 둔다.\
`server-inventory.md` 에는 사내 서버 평문 자격증명이 들어 있어 포크 저장소(GitHub, 납품본 후보)에 커밋하면 안 된다. 사용자 지시(2026-09-07)로 로컬 사본을 두되 커밋은 하지 않는 것으로 정했다.

## 사본 목록 (`local/`)

| 파일                                 | 정본                                                                    | 용도                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `jinbio-nas.md`                      | `chris-server/knowledge/infrastructure/jinbio-nas.md`                   | 진바이오테크 NAS(Synology DS218+) 실측, SSH 접속 절차(apps01 OpenVPN 경유), 공유 폴더·사용자 목록           |
| `server-inventory.md`                | `chris-server/knowledge/infrastructure/server-inventory.md`             | 사내 서버 인벤토리와 자격증명(NAS 관리자 비밀번호 포함)                                                     |
| `openclaw-jinbio-nas-feasibility.md` | `chris-server/knowledge/development/openclaw-jinbio-nas-feasibility.md` | NAS 설치·권한 동기화 타당성. 접근 정책은 경로 A(부서·사람 = 에이전트, 워크스페이스 = 허용 폴더 마운트) 채택 |
| `cloudflare-botops.md`               | `chris-server/homelab/homelab-access.md` 5절                            | Cloudflare 계정·API 토큰, 진바이오 터널 ID·커넥터 토큰·DNS·ingress (`jinbio.botops.cloud`)                  |
| `jinbio-deploy.md`                   | NAS 의 `/volume1/docker/openclaw/ixauth.env`                            | M 단계에서 NAS 에 세운 납품 스택의 서비스 키·DB 비밀번호·관리자 계정과 배포 좌표                            |

## 다시 만들기

```bash
mkdir -p chris-local/infra/local
cp /d/PROJECT/chris-server/knowledge/infrastructure/jinbio-nas.md chris-local/infra/local/
cp /d/PROJECT/chris-server/knowledge/infrastructure/server-inventory.md chris-local/infra/local/
cp /d/PROJECT/chris-server/knowledge/development/openclaw-jinbio-nas-feasibility.md chris-local/infra/local/
```

## 적용 규칙

- 서버 명령은 chris-server 의 `logs/command-log.md` 에 기록한다. 서버 설정 변경은 사용자 명시 요청 없이 하지 않는다.
- 사본이 정본보다 오래됐을 수 있다. 실측 전에 정본과 `diff` 한다.
- 시크릿 값은 이 폴더 밖(문서·코드·커밋 메시지)으로 옮기지 않는다.
