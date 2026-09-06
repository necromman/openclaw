# BROWSER.md - 게이트웨이 브라우저 기능 (로컬 WSL 인스턴스)

Control UI 의 "브라우저" 패널이 아래 오류로 실패하던 것을 고친 기록이다.

```
Error: No supported browser found (Chrome/Brave/Edge/Chromium on macOS, Linux, or Windows)
```

---

## 1. 원인

**리눅스 미지원이 아니라 크로미움 계열 바이너리가 WSL 안에 하나도 없었다.**

탐지 코드는 `extensions/browser/src/browser/chrome.executables.ts` 의 `findChromeExecutableLinux()` 이고, 리눅스 후보 경로를 순서대로 훑는다.

```
/usr/bin/google-chrome, /usr/bin/google-chrome-stable, /usr/bin/chrome,
/opt/google/chrome/chrome, /usr/bin/brave-browser(-stable), /usr/bin/brave,
/snap/bin/brave, /opt/brave.com/brave/brave-browser,
/usr/bin/microsoft-edge(-stable),
/usr/bin/chromium, /usr/bin/chromium-browser,
/usr/lib/chromium/chromium, /usr/lib/chromium-browser/chromium-browser,
/snap/bin/chromium,
그리고 Playwright 캐시 (PLAYWRIGHT_BROWSERS_PATH 또는 ~/.cache/ms-playwright 의
chromium-*/chrome-linux64/chrome, chrome-linux/chrome)
```

전부 없으면 `resolveBrowserExecutable()` 이 null 을 돌려주고 `launchOpenClawChrome()` (`chrome.ts`) 이 위 문구로 throw 한다.

실측 (조치 전):

```bash
which chromium chromium-browser google-chrome brave-browser microsoft-edge
# 출력 없음 (전부 부재)
ls ~/.cache/ms-playwright
# No such file or directory
```

즉 코드는 리눅스를 정상 지원하고, 후보 경로 15곳과 Playwright 캐시가 모두 비어 있었을 뿐이다.

### WSLg

이 WSL 에는 WSLg 가 살아 있다. 로그인 셸에서는 헤드풀도 가능하다.

```bash
echo $DISPLAY          # :0
echo $WAYLAND_DISPLAY  # wayland-0
ls /mnt/wslg           # weston.log, runtime-dir, ... 존재
```

다만 **게이트웨이는 systemd user 서비스라 DISPLAY 가 없다.** 서비스 메인 PID 의 `/proc/<pid>/environ` 을 뜯어보면 `XDG_RUNTIME_DIR` 과 `OPENCLAW_*` 만 있고 `DISPLAY` 는 없다.

`chrome.ts` 의 `getManagedBrowserMissingDisplayError()` 는 headless 가 아닌데 DISPLAY 도 없으면 `noDisplayForHeadedProfile` 로 거절한다. `browser.headless` 기본값이 `false` 이므로, 서비스 경로에서는 **headless 를 명시해야** 한다.

---

## 2. 설치 (선택지 (a) 채택: Google Chrome stable .deb)

Ubuntu 24.04 의 `chromium` 은 snap 전용이고 WSL systemd 환경에서 snap 은 불안정하다. 그래서 우선순위 (a) 를 그대로 갔고, 한 번에 성공했다.

```bash
# WSL 안에서 root 로. WSL 은 `wsl -d Ubuntu -u root` 로 암호 없이 root 를 준다
# (일반 사용자 sudo 는 이 머신에서 암호를 요구한다)
cd /tmp
curl -sSL -o gc.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ./gc.deb    # 의존 패키지까지 apt 가 알아서 끌어온다
```

결과:

| 항목          | 값                                                                              |
| ------------- | ------------------------------------------------------------------------------- |
| 버전          | Google Chrome 152.0.7977.82                                                     |
| 실행 파일     | `/usr/bin/google-chrome` (alternatives 심링크), `/usr/bin/google-chrome-stable` |
| 실제 바이너리 | `/opt/google/chrome/chrome`                                                     |
| 디스크        | `/opt/google/chrome` 437 MB, 내려받은 .deb 135 MB                               |

`/usr/bin/google-chrome` 은 리눅스 후보 목록의 **첫 번째**라 OpenClaw 가 설정 없이도 자동 탐지한다.

### 선택하지 않은 경로

- **(b) Playwright chromium**: `node node_modules/playwright-core/cli.js install --with-deps chromium`. 탐지 코드가 `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome` 를 후보에 넣어두어 설치만 하면 역시 자동 탐지된다. Docker 이미지 경로는 이쪽을 쓴다 (4장).
- **(c) snap chromium**: WSL 에서 snapd 가 systemd 와 자주 어긋나 후순위로 두었고, (a) 가 되어 시도하지 않았다.

### 한글 폰트

`fonts-noto-cjk` 는 **이미 설치돼 있었다** (다른 작업이 먼저 깔아둔 것). 중복 설치하지 않았다.

```bash
dpkg -l fonts-noto-cjk
# ii  fonts-noto-cjk  1:20230817+repack1-3  all
du -sh /usr/share/fonts/opentype/noto   # 89M
```

없는 머신이라면 `apt-get install -y fonts-noto-cjk` 한 줄이면 되고, 안 깔면 한글이 두부(tofu)로 렌더된다.

---

## 3. 설정 키

정본은 `src/config/zod-schema.root-shape.ts` 의 `browser` 블록이다 (타입은 `src/config/types.browser.ts`). 공식 문서는 <https://docs.openclaw.ai/tools/browser>.

이 인스턴스 (`~/openclaw-local/.openclaw/openclaw.json`) 에 넣은 값:

```json
{
  "browser": {
    "enabled": true,
    "executablePath": "/usr/bin/google-chrome",
    "headless": true
  }
}
```

| 키                       | 기본값  | 이 인스턴스에서 필요한 이유                                        |
| ------------------------ | ------- | ------------------------------------------------------------------ |
| `browser.enabled`        | `true`  | 명시만 한 것. 원래도 켜져 있었다                                   |
| `browser.executablePath` | (자동)  | 자동 탐지로도 잡히지만 의도를 파일에 남겼다. 없으면 후보 목록 순회 |
| `browser.headless`       | `false` | **필수.** 서비스에 DISPLAY 가 없어 헤드풀이면 거절당한다           |
| `browser.noSandbox`      | `false` | **필요 없다.** WSL 일반 사용자에서 Chrome 샌드박스가 정상 동작한다 |

프로필별 오버라이드도 있다: `browser.profiles.<이름>.{headless,executablePath,cdpPort,cdpUrl,driver}`.

적용:

```bash
systemctl --user restart openclaw-local.service
```

### 헤드리스 / 헤드풀

- **헤드리스 (현재 구성)**: 서비스가 `--headless=new --disable-gpu` 로 띄운다. 렌더러는 SwiftShader (소프트웨어) 라 GPU 없이도 스크린샷이 정상이다.
- **헤드풀 (WSLg)**: WSLg 가 있으므로 창을 띄우는 것도 된다. 다만 서비스 유닛에 DISPLAY 를 넣어줘야 한다.

  ```bash
  systemctl --user set-environment DISPLAY=:0 WAYLAND_DISPLAY=wayland-0
  # 또는 openclaw-local.service 에 Environment=DISPLAY=:0 추가 후 daemon-reload
  ```

  그리고 `browser.headless` 를 `false` 로 되돌린다. 로그인 셸에서 CLI 로 직접 쓸 때는 DISPLAY 가 이미 있으니 아무 설정 없이 헤드풀이 뜬다.

---

## 4. Docker 이미지 경로

**업스트림 `Dockerfile` 이 이미 브라우저 설치를 빌드 인자로 지원한다. 포크 오버레이를 추가하지 않는다.**

```dockerfile
ARG OPENCLAW_INSTALL_BROWSER=""
ENV PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright
# xvfb + playwright chromium 설치
```

한글 폰트만 빠져 있으므로 apt 인자로 얹으면 된다.

```bash
docker build \
  --build-arg OPENCLAW_INSTALL_BROWSER=1 \
  --build-arg OPENCLAW_IMAGE_APT_PACKAGES="fonts-noto-cjk" \
  -t chris-openclaw:browser .
```

이미지 크기 영향 (근거 포함):

| 항목                       | 증가분   | 근거                                                |
| -------------------------- | -------- | --------------------------------------------------- |
| Playwright chromium + xvfb | 약 300MB | Dockerfile 주석의 업스트림 실측치                   |
| `fonts-noto-cjk`           | 약 89MB  | 이 WSL 에서 `du -sh /usr/share/fonts/opentype/noto` |
| 합계                       | 약 390MB |                                                     |

참고로 이 WSL 처럼 Google Chrome .deb 를 쓰면 `/opt/google/chrome` 만 437MB 라 컨테이너에는 Playwright chromium 쪽이 더 가볍다. `OPENCLAW_INSTALL_BROWSER` 를 생략하면 컨테이너가 뜰 때마다 Playwright 설치에 60-90초를 쓴다 (업스트림 주석).

현 배포 형태 (claw01 호스트 npm 설치, FORK.md 11장) 에서는 Docker 를 쓰지 않으므로 지금 당장 구울 일은 없다.

---

## 5. 실측 검증 (2026-09-06)

```bash
# 진단
openclaw browser doctor
#  OK gateway / plugin: enabled / profile: openclaw (cdp)
#  OK browser: running
#  OK graphics: software; ANGLE (SwiftShader)

openclaw browser start
#  browser [openclaw] running: true (headless)

openclaw browser open https://example.org   # opened, tab t2
openclaw browser open https://www.naver.com # opened, tab t3
openclaw browser screenshot t3              # 한글 정상 렌더 (두부 없음)
```

Control UI 패널과 에이전트 도구 호출도 확인했다. 채팅으로 "브라우저로 example.org 열고 페이지 제목 알려줘" 를 시켰더니 Browser 도구를 4회 호출해 `example.org -> "Example Domain"`, `naver.com -> "NAVER"` 표를 돌려주었고, 브라우저 패널에 두 탭이 그대로 살아 있었다.

스크린샷: chris-server `analysis/2026-09-06-openclaw-2/browser-01-panel.png`, `browser-02-korean.png`, `naver-korean-render.png`.

### 함정: example.com 은 이 네트워크에서 안 열린다

`example.com` 은 사내망에서 **DNS 자체가 안 풀린다**. WSL 뿐 아니라 Windows 에서도, 심지어 `Resolve-DnsName example.com -Server 1.1.1.1` 도 타임아웃이다. 브라우저 결함이 아니다. `example.org` 는 정상이므로 검증에는 이쪽을 썼다.

---

## 6. 되돌리기

```bash
# 1) 설정 원복 (백업이 남아 있다)
cp ~/openclaw-local/.openclaw/openclaw.json.bak-browser \
   ~/openclaw-local/.openclaw/openclaw.json
systemctl --user restart openclaw-local.service

# 2) Chrome 제거 (원하면)
apt-get remove -y google-chrome-stable
apt-get autoremove -y
rm -f /etc/apt/sources.list.d/google-chrome.list   # .deb 가 심어둔 저장소

# 3) 프로필 잔재 정리
rm -rf /tmp/openclaw/.chromium
```

`fonts-noto-cjk` 는 이 작업이 설치한 게 아니므로 건드리지 않는다.
