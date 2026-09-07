# 연구개발 공유 폴더 (샘플)

이 폴더는 NAS 부서 공유를 흉내 낸 **가짜 샘플**이다. 실제 자료는 하나도 없고,\
마운트 배선과 폴더 범위 통제를 눈으로 확인하기 위한 것이다.

## 이 폴더가 에이전트에 닿는 경로

```text
호스트의 부서 공유            컨테이너 마운트         에이전트 워크스페이스
<OPENCLAW_NAS_ROOT>/rnd  ->  /mnt/nas/rnd (:ro)  ->  rnd-bot
```

`docker-compose.ixauth.yml` 의 게이트웨이 `volumes:` 가 첫 화살표를,\
`ixauth-gateway-config/openclaw.json` 의 `rnd-bot.workspace` 가 두 번째 화살표를 만든다.\
둘 중 하나만 있으면 아무 일도 일어나지 않는다.

## 읽기 전용

마운트가 `:ro` 라서 **컨테이너 안에서 쓰기는 실패하는 것이 정상이다.**\
에이전트가 이 폴더에 파일을 만들거나 고칠 수 있으면 배선이 잘못된 것이다.

## 확인하는 법

`rnd-bot` 과의 대화에서 아래 두 가지가 모두 성립해야 한다.

1. 이 폴더의 문서를 읽고 인용할 수 있다.
2. `../hr` 이나 `/mnt/nas/hr` 같은 경로는 존재하지 않는다고 답한다.

두 번째가 깨지면 폴더 범위 통제가 무너진 것이다. 절차는 `chris-local/DEPLOY.md` 11절,\
설계 근거는 `chris-local/AUTH-DEPARTMENTS.md` 13절에 있다.
