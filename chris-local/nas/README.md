# chris-local/nas - 납품 호스트 배치 파일 (진바이오 NAS)

이 폴더는 **납품 호스트에 복사하는 파일의 정본**이다. 절차·되돌리기·확인 항목은 전부 [DEPLOY.md](../DEPLOY.md) 13절에 있고, 여기에는 무엇이 무엇인지만 적는다.

| 파일                     | 역할                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `docker-compose.nas.yml` | 빌드하지 않고 ghcr 이미지를 받아 쓰는 compose. `docker-compose.ixauth.yml` 의 형제이고 다른 점은 파일 머리말에 적혀 있다 |
| `deploy.sh`              | NAS 에서 root cron 이 5분마다 부르는 배포 스크립트. ghcr 태그 다이제스트가 움직였을 때만 pull 하고 다시 띄운다           |

## NAS 에 올라가는 것

NAS 에는 git 이 없어 저장소를 클론하지 않는다. `/volume1/docker/openclaw/` 에 두는 것은 다음뿐이다.

```
/volume1/docker/openclaw/
  docker-compose.nas.yml      이 폴더에서 복사
  deploy.sh                   이 폴더에서 복사
  ixauth-gateway-config/      chris-local/ixauth-gateway-config/ 에서 복사 (openclaw.json, start-gateway.sh)
  nas-sample/                 chris-local/nas-sample/ 에서 복사 (실제 공유 매핑 전까지의 자리표시)
  knowledge-index/rnd, /qa    빈 폴더로 생성
  ixauth.env                  복사하지 않는다. ixauth.env.example 을 보고 호스트에서 만든다
```

`knowledge-index/` 는 compose 가 쓰기 가능하게 마운트하고 `openclaw knowledge sync` 가 거기에 마크다운 사이드카를 쌓는다.

## 이미지는 어디서 오는가

`.github/workflows/chris-deliver-images.yml` 이 `chris/main` 푸시마다 두 이미지를 굽고 `ghcr.io/necromman/openclaw-gateway` 와 `ghcr.io/necromman/openclaw-ix-auth` 에 민다.

태그는 두 개다. `chris-main` 은 브랜치를 따라 움직이고 `deploy.sh` 가 그것을 본다. `sha-<짧은 커밋>` 은 움직이지 않으며, 되돌릴 때 이름으로 쓴다.

## 시크릿

`ixauth.env` 의 실물은 **NAS 에만** 둔다. 저장소에는 `chris-local/ixauth.env.example` 만 있고 `.gitignore` 가 `chris-local/ixauth.env` 를 막는다. 이 폴더에는 env 파일을 만들지 않는다.

NAS 에서 만든 관리자 비밀번호·서비스 키·터널 토큰[<sup>1</sup>](#g1)은 `chris-local/infra/local/jinbio-deploy.md`(git 제외)에만 기록한다.

## 용어 설명

1. <a id="g1"></a>**토큰** - 비밀번호 대신 쓰는 긴 문자열 열쇠. 가진 쪽이 그 권한을 그대로 쓸 수 있어 비밀번호처럼 다룬다.
