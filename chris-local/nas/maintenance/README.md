# 배포 중 안내 화면

Cloudflare Tunnel → `maintenance:8080` → `gateway:18789` 순서로 요청을 전달한다. 게이트웨이 이미지가 교체되어도 독립 nginx 컨테이너가 한글 안내 화면을 제공한다. 새 제품 설정이나 데이터 저장소는 추가하지 않는다.

브라우저의 GET 화면 탐색에서 업스트림이 502·503·504를 반환하면 안내 화면을 HTTP 503으로 제공한다. API의 업스트림 응답은 상태와 본문을 보존하고, nginx의 연결 실패만 JSON 503으로 응답한다. WebSocket 업그레이드와 스트리밍도 전달한다. 진행 중이던 요청을 재전송하지 않는다.

안내 화면은 5초마다 캐시 없이 `/__system-update/status`를 확인한다. 게이트웨이 `/readyz`가 HTTP 200과 `ready: true`를 함께 반환해야 현재 주소를 다시 연다. 주소를 변경하지 않으므로 경로·쿼리·해시가 유지된다. 인증 리디렉션이나 HTML 200을 완료로 간주하지 않는다.

## 운영 반영 순서

1. NAS의 기존 compose와 env, 터널 ingress 설정을 백업한다. `maintenance/` 전체와 `docker-compose.nas.yml`을 NAS 배포 루트에 복사한다. 이미지 배포 cron은 이 파일들을 복사하지 않는다.
2. NAS에서 nginx 이미지를 받고 `maintenance`만 먼저 기동한다. `nginx -t`, 컨테이너 health, 터널 컨테이너에서 접근한 readiness와 로그인 경로를 확인한다.
3. 기존 `OPENCLAW_TRUSTED_PROXIES`에 `172.16.240.11`을 추가하고 게이트웨이에 반영한다. 기존 cloudflared 주소 `172.16.240.10`은 전환·복구용으로 유지한다. 전체 서브넷을 신뢰하지 않는다.
4. Cloudflare Tunnel의 해당 호스트 origin을 `http://maintenance:8080`으로 변경한다. 기존 ingress의 다른 호스트와 origin 옵션은 보존한다.
5. 공개 주소에서 로그인, Secure 쿠키, 실제 사용자 IP, WebSocket 연결을 확인한다. 실제 다음 게이트웨이 교체 때 안내 화면·API·자동 복귀를 실측한다.

정상 배포에서 `maintenance`와 `cloudflared`를 재시작할 필요는 없다. nginx 설정 변경 시 `nginx -t` 후 reload한다. NAS·Docker·터널 자체가 중단되면 이 화면도 제공할 수 없다. 열린 앱의 기존 WebSocket은 앱이 재연결하고, 이 안내는 화면을 새로 여는 요청에 적용된다.

복구는 터널 origin을 `http://gateway:18789`로 되돌리는 순서가 먼저다. 게이트웨이에서 `.10` 신뢰를 유지한 상태에서 로그인과 연결을 확인한다.

## 배포 시 확인할 시나리오

- 정상 상태에서 로그인·설정 조회·WebSocket이 동작하고, API의 401·403 응답이 안내 HTML로 바뀌지 않는다.
- 실제 게이트웨이 중단 중 `/settings/folders?probe=1#keep`을 브라우저에서 열면 한글 안내와 HTTP 503, `Cache-Control: no-store`, `Retry-After: 5`가 나온다.
- 같은 중단 중 JSON GET과 POST는 JSON 503을 받고, 스크립트·스타일 요청은 안내 HTML로 바뀌지 않는다.
- 게이트웨이 재생성으로 컨테이너 IP가 바뀌어도 nginx를 재시작하지 않고 연결이 회복된다.
- `/readyz`가 false인 동안 화면을 유지하며, true가 된 뒤 원래 경로·쿼리·해시로 자동 복귀한다.
- 다른 컨테이너가 위조한 전달 헤더는 거부된다. cloudflared에서 오는 실제 요청은 HTTPS와 클라이언트 IP가 유지된다.
- 좁은 화면, 키보드 버튼 조작, 인터넷 끊김과 회복도 확인한다.

## 기존 OSS 선택 근거

공식 nginx의 [오류 응답과 내부 이동](https://nginx.org/en/docs/http/ngx_http_core_module.html#error_page), [업스트림 전달](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [WebSocket 전달](https://nginx.org/en/docs/http/websocket.html), [DNS resolver](https://nginx.org/en/docs/http/ngx_http_core_module.html#resolver)를 사용한다. 별도 서버 프로그램이나 유료 Cloudflare 오류 페이지 기능은 필요하지 않다. 이미지 버전은 [Docker 공식 nginx 이미지 목록](https://github.com/docker-library/official-images/blob/master/library/nginx)에서 확인한 stable Alpine 태그를 고정한다.
