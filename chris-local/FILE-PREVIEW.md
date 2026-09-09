# FILE-PREVIEW.md - 문서 미리보기 (PDF / Word / Excel / PowerPoint)

> 채팅 오른쪽 **파일** 패널에서 `sample.docx` 가 이름·크기만 있는 카드로 보이고 내용이 안 나오던 문제를 없앤 작업의 정본이다.\
> 운영·설치 절차는 [FORK.md](../FORK.md), 코드 구조 전반은 [CODEBASE.md](CODEBASE.md) 가 정본이고 이 문서는 **문서 미리보기 한 기능**만 다룬다.

- 작성 2026-09-06 (KST, 일요일). 브랜치 `chris/file-preview` -> `chris/main` 병합.
- 편집 체크아웃 `D:\PROJECT\openclaw` / 빌드·실행 정본 WSL `~/openclaw` / 로컬 인스턴스 `http://127.0.0.1:18789/`

---

## 1. 손대기 전 상태 (실측)

| 형식                                              | 파일 패널에서 보이던 것                           | 근거                                                             |
| ------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| `.ts` `.md` `.json` 등 텍스트                     | CodeMirror 코드 뷰                                | `ui/src/pages/chat/components/chat-session-workspace.ts:277-367` |
| `png` `jpeg` `gif` `webp` `avif`                  | `<img>` (data URL)                                | 같은 파일 `:247-263`, 허용 목록 `:48-54`                         |
| **그 외 전부 (`pdf` `docx` `xlsx` `pptx` `hwp`)** | **"This file is not previewable inline." 안내문** | 같은 파일 `:264-266`, 문구 생성 `:84-104`                        |
| 채팅 메시지 첨부 카드                             | 이름·크기·다운로드 버튼만                         | `ui/src/pages/chat/components/chat-sidebar-content.ts:119-125`   |

판정은 **게이트웨이가** 내린다. `src/gateway/server-methods/sessions-files.ts:420-445` 의 `applyInlineFilePreview()` 가 파일을 읽어 이미지 MIME 허용목록이면 `image`, UTF-8 로 디코딩되면 `text`, 아니면 `unsupported` 를 붙인다. docx 는 zip 바이너리라 무조건 `unsupported` 였다. **PDF 렌더러도, pdf.js 도, `<object>`/`<embed>` 도 저장소 어디에도 없었다.**

## 2. 플러그인 생태계 조사 결과

**Control UI 안에서 문서를 그려 주는 플러그인은 없다.** ClawHub 실검색 결과다.

| 검색                               | 결과                                                      | 성격                                                                                              |
| ---------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `plugins search pdf`               | 20건 (`pdfapihub`, `pdf-to-jpg`, `pdf-extract-text`, ...) | 전부 **PDFAPIHub 외부 SaaS 호출**. API 키 필요, 문서를 외부로 전송                                |
| `plugins search docx`              | 1건 `docx-to-pdf`                                         | 같은 SaaS                                                                                         |
| `plugins search document`          | 13건 (`doc-to-pdf`, `scan-document`, ...)                 | 같은 SaaS + 메모리 플러그인                                                                       |
| `skills search document`           | 10건 (`document-reader`, `document-pro`, ...)             | **에이전트가 읽는** 스킬. 화면 렌더링과 무관                                                      |
| 번들 `extensions/document-extract` | 있음                                                      | `documentExtractors` 계약. PDF 텍스트/이미지를 **모델 입력용**으로 뽑는다. UI 미리보기용이 아니다 |

즉 이 기능은 **직접 만들어야** 했다. 다만 `extensions/document-extract` 가 쓰는 `clawpdf` 와 루트 의존성 `jszip@3.10.1` 은 재사용 가능한 자산이었다.

## 3. 제약 조건 (여기서 선택지가 갈린다)

| 제약                  | 실측값                                                                                                   | 출처                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| CSP `frame-src`       | `'self' http: https:` (blob: **없음**)                                                                   | 라이브 응답 헤더, `src/gateway/control-ui-csp.ts:83-98` |
| CSP `object-src`      | `'none'` -> `<object>` `<embed>` **사용 불가**                                                           | 같은 곳                                                 |
| CSP `img-src`         | `'self' data: blob:`                                                                                     | 같은 곳                                                 |
| 외부 CDN              | `script-src 'self'` 뿐 -> **CDN 로드 불가**, 전부 번들                                                   | 같은 곳                                                 |
| 파일 바이트 HTTP 경로 | `/__openclaw__/assistant-media` 는 `X-Frame-Options: DENY` + `frame-ancestors 'none'` -> **iframe 불가** | `src/gateway/control-ui.ts:206-217, 558`                |
| 인증                  | 베어러 헤더 전용(쿠키 없음). `<img src>` 는 쿼리 `mediaTicket` 으로만 통과                               | `src/gateway/http-auth-utils.ts:171-228`                |
| **UI 번들 상한**      | **JS 자산 1개당 gzip 215 KiB** (전체 자산 대상, mermaid 만 예외)                                         | `scripts/check-control-ui-performance.mts:47`           |
| 인라인 미리보기 상한  | 256 KiB (`WORKSPACE_PREVIEW_MAX_BYTES`)                                                                  | `src/gateway/server-methods/workspace-fs.ts:17`         |

**215 KiB 상한이 결정타다.** SheetJS(xlsx) 커뮤니티판은 gzip 약 290 KiB 라 청크를 쪼개도 이 검사에서 빌드가 깨진다. pdf.js 도 같은 이유로 탈락한다.

## 4. 선택지 비교표

| #   | 방식                                                         | CSP 적합                                                                  | 번들 증가                    | 라이선스                                        | 한글 폰트                       | 난이도                  | 판정                   |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------- | ------------------------------- | ----------------------- | ---------------------- |
| a1  | **PDF: 브라우저 내장 뷰어 + blob iframe**                    | `frame-src` 에 `blob:` **한 단어 추가 필요**                              | **0**                        | -                                               | 문서가 폰트를 임베드하므로 무관 | 낮음                    | **채택**               |
| a2  | PDF: 게이트웨이 URL iframe                                   | 새 HTTP 라우트 필요(기존 라우트는 `XFO: DENY`). 티켓 발급 머신 복제 200줄 | 0                            | -                                               | 무관                            | 높음                    | 기각(과설계)           |
| a3  | PDF: pdf.js 번들                                             | 적합                                                                      | **+290 KiB gz -> 상한 초과** | Apache-2.0                                      | 무관                            | 중간                    | **기각(상한)**         |
| b   | docx: mammoth 클라이언트                                     | 적합(srcdoc sandbox)                                                      | +55 KiB gz                   | MIT                                             | 브라우저 폰트                   | 중간                    | 조건부 기각(아래)      |
| c   | xlsx: SheetJS 커뮤니티판                                     | 적합                                                                      | **+290 KiB gz -> 상한 초과** | Apache-2.0                                      | 브라우저 폰트                   | 중간                    | **기각(상한)**         |
| d   | pptx: 클라이언트 렌더러                                      | -                                                                         | -                            | -                                               | -                               | 매우 높음               | 기각(쓸만한 구현 없음) |
| e   | **서버 통합 변환 LibreOffice -> PDF**                        | 적합(결과가 PDF 라 a1 로 합류)                                            | **0**                        | **MPL-2.0** (배포 의무 없음, 별도 프로세스)     | **호스트에 CJK 폰트 필요**      | 중간                    | **채택**               |
| e2  | **서버 내장 추출 OOXML -> 안전 HTML** (jszip, 신규 의존성 0) | 적합(srcdoc `sandbox=""`)                                                 | 0                            | -                                               | 뷰어 폰트                       | 중간                    | **채택(폴백)**         |
| f   | OnlyOffice / Collabora 문서 서버                             | 적합                                                                      | 0                            | **AGPL-3.0** (납품 시 소스 공개 의무 검토 필요) | 이미지에 포함                   | 높음(컨테이너 1대 추가) | 기각                   |

### 왜 mammoth·SheetJS 를 안 썼나 (지시와 다른 선택의 근거)

1. **xlsx 는 애초에 클라이언트로 못 간다.** SheetJS 는 번들 상한을 넘긴다. xlsx 가 서버 변환이라면 docx 만 클라이언트로 두는 것은 **같은 기능에 렌더러 두 종류**를 남기는 셈이라 출력이 서로 다르게 보인다.
2. **pptx 는 어차피 LibreOffice 가 필요하다.** 변환기를 이미 깔 거라면 docx·xlsx 도 같은 경로로 보내는 편이 정확도가 높다(표·차트·이미지·머리글이 그대로 나온다).
3. **npm 의존성 추가가 이 포크에서는 비싸다.** `pnpm-lock.yaml` 갱신은 WSL 에서만 가능한데(윈도우 Node 가 구버전), 자동배포 레인이 `git pull --ff-only` 라 WSL 쪽 로컬 커밋이 생기면 배포가 멈춘다.
4. **의존성 0 폴백을 대신 넣었다.** LibreOffice 가 없는 호스트에서도 docx·xlsx 는 `jszip`(이미 루트 의존성)으로 OOXML 을 직접 읽어 **서버에서 이스케이프한 HTML** 로 보여 준다. 즉 mammoth 가 하던 일을 서버에서, 번들 증가 0 으로 한다.

결과적으로 **클라이언트 번들 증가는 0 바이트**이고 새 npm 의존성도 0 개다.

---

## 5. 구현 구조

```
문서 열기
   |
   v
UI  documentPreviewKindForPath(name)          ui/src/components/file-preview/document-preview-kinds.ts
   |  pdf/word/sheet/slides 면
   v
RPC sessions.files.get { documentPreview: true }
   |
   v
게이트웨이  buildSessionFileDocumentPreview()   src/gateway/server-methods/sessions-files-document.ts
   |
   +-- pdf            -> 원본 바이트 그대로            format "pdf"
   +-- office + 변환기 -> LibreOffice headless -> PDF   format "pdf"   (src/gateway/document-convert.ts)
   +-- docx/xlsx 폴백 -> jszip 로 OOXML -> 안전 HTML    format "html"  (src/gateway/document-extract-html.ts)
   +-- hwp/hwpx       -> 내장 한글 리더 -> 안전 HTML    format "html"  (src/gateway/document-extract-hangul.ts)
   +-- 그 외          -> documentError
   |
   v
UI  <openclaw-document-preview>               ui/src/components/file-preview/document-preview.ts
       format pdf  -> Blob -> objectURL -> <iframe src>        (브라우저 내장 PDF 뷰어)
       format html -> <iframe sandbox="" srcdoc>               (스크립트·폼·동일출처 전부 차단)
```

### 파일 목록

| 파일                                                         | 성격 | 역할                                                                            |
| ------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------- |
| `src/gateway/document-convert.ts`                            | 신규 | soffice 탐지·변환·타임아웃·동시성 제한·결과 캐시                                |
| `src/gateway/document-extract-html.ts`                       | 신규 | jszip 으로 docx/xlsx -> 이스케이프된 HTML (의존성 0). 9절에서 hwp/hwpx 도 받는다 |
| `src/gateway/document-cfb.ts`                                | 신규 | OLE2 복합 파일(CFB) 읽기 전용 리더 (S 단계)                                     |
| `src/gateway/document-extract-hangul.ts`                     | 신규 | hwp 5.0 / hwpx 본문 추출 (S 단계)                                               |
| `src/gateway/server-methods/sessions-files-document.ts`      | 신규 | 위 둘을 묶어 `SessionFileEntry` 를 채우는 결정표                                |
| `packages/gateway-protocol/src/schema/sessions.ts`           | 수정 | `previewKind: "document"` + `document` / `documentError` 필드 + 요청 플래그 2개 |
| `src/gateway/server-methods/sessions-files.ts`               | 수정 | `sessions.files.get` 에 분기 1개 (`documentPreview === true`)                   |
| `src/gateway/control-ui-csp.ts`                              | 수정 | `frame-src` 에 `blob:` 한 단어                                                  |
| `ui/src/components/file-preview/document-preview-kinds.ts`   | 신규 | 확장자 -> 미리보기 종류 (순수 함수)                                             |
| `ui/src/components/file-preview/document-preview.ts`         | 신규 | Lit 엘리먼트 `<openclaw-document-preview>`                                      |
| `ui/src/pages/chat/components/chat-sidebar-content-types.ts` | 수정 | `SidebarContent` 에 `document` 변형 추가                                        |
| `ui/src/pages/chat/components/chat-sidebar-content.ts`       | 수정 | `case "document"` 분기                                                          |
| `ui/src/pages/chat/components/chat-session-workspace.ts`     | 수정 | 문서 확장자면 `documentPreview: true` 로 요청하고 결과를 라우팅                 |
| `ui/src/lib/sessions/session-requests.ts`                    | 수정 | 요청 옵션에 플래그 전달                                                         |
| `ui/src/i18n/locales/en.ts`                                  | 수정 | `documentPreview.*` 문구 (영어만; 나머지 로케일은 자동 폴백)                    |

### 보안 경계

- **경로**: 워크스페이스 파일 접근은 전부 기존 `readWorkspaceFile()` (fs-safe root, 심링크·하드링크 거부, 루트 밖 탈출 차단)을 통과한다. 새 경로 해석 코드를 만들지 않았다.
- **인증**: 새 HTTP 라우트가 없다. 문서 바이트는 이미 인증된 WebSocket RPC 로만 흐른다. 토큰이 URL 에 실리는 일이 없다.
- **변환기**: 임시 디렉터리는 매 호출 `mkdtemp` 로 새로 만들고 `finally` 에서 재귀 삭제한다. 셸을 거치지 않고 인자 배열로 spawn 한다. 확장자 화이트리스트(`doc docx odt rtf xls xlsx ods csv ppt pptx odp`) 밖은 아예 실행하지 않는다. 타임아웃 60초, 출력 상한 40 MiB, 동시 실행 2개.
  - 바이너리는 `SOFFICE_BIN` -> PATH 의 `soffice` -> `libreoffice` 순으로 찾는다. `SOFFICE_BIN` 을 주면 그 값만 신뢰하고 PATH 로 몰래 되돌아가지 않는다(잘못된 핀을 숨기지 않기 위해서다). 못 찾으면 60초 뒤 다시 탐지하므로, 나중에 LibreOffice 를 설치해도 게이트웨이를 재시작할 필요가 없다.
  - **이름에 `OPENCLAW_` 접두사를 쓰지 않았다.** `scripts/check-env-var-count.mts` 가 `origin/main` 대비 `OPENCLAW_*` 이름 증가를 승인 없이 막는 래칫이고, 이 값은 서드파티 바이너리를 가리키므로 `EDITOR`·`BROWSER` 와 같은 계열로 두는 편이 맞다.
- **HTML 폴백**: 모든 텍스트는 서버에서 `& < > " '` 를 이스케이프하고, 허용 태그 목록 밖은 만들지 않는다. 그 위에 `sandbox=""` iframe 이라 스크립트·폼·팝업·동일출처 접근이 전부 죽는다.
- **blob iframe**: 우리 스크립트가 인증 채널로 받은 바이트로 직접 만든 blob 이다. PDF 는 브라우저 내장 뷰어(별도 프로세스)가 그리므로 문서 안의 JavaScript 가 Control UI DOM 에 닿지 않는다. `URL.revokeObjectURL` 로 교체·해제 시 반드시 회수한다.

### 제한

| 제한                          | 값                                 | 이유                                                               |
| ----------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| 미리보기 최대 파일 크기       | 20 MiB                             | base64 로 WS 를 타므로 실제 전송량은 약 1.34배                     |
| 변환 타임아웃                 | 60초                               | LibreOffice 가 드물게 멈춘다                                       |
| HTML 폴백 시트 상한           | 12 시트 / 시트당 300행 / 행당 40열 | 잘리면 안내 문구가 붙는다                                          |
| hwp / hwpx                    | **지원** (텍스트 HTML)             | 9절. 서식·그림 없이 본문과 표 칸 글자만 나온다                     |
| 이미지가 든 docx 의 HTML 폴백 | 이미지 생략                        | 폴백은 텍스트·표 구조만 살린다. 정확한 그림은 LibreOffice 경로에서 |

### 되돌리기

```bash
git revert <병합 커밋>          # 기능 전체
```

부분 비활성화가 필요하면 `documentPreviewKindForPath()` 가 항상 `null` 을 반환하게 만들면 UI 는 즉시 원래의 "미리보기 불가" 안내로 돌아간다. 게이트웨이 쪽은 요청이 안 오면 아무 일도 하지 않는다.

---

## 6. 한글 폰트 (PDF 생성·변환 공통)

**증상**: "PDF 만들어 줘" 라고 하면 한글 폰트가 없어 오류가 나거나 네모(두부)로 찍힌다. 미리보기용 변환도 같은 뿌리다. LibreOffice 는 자기가 찾은 폰트를 PDF 에 임베드하므로, **호스트에 CJK 폰트가 없으면 변환 결과부터 이미 깨져 있다.**

### 설치 (WSL Ubuntu 24.04, 실행 완료)

```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  fonts-noto-cjk fonts-nanum \
  libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-core
sudo fc-cache -f
```

### 확인

```bash
fc-list :lang=ko family | sort -u     # 한글을 그릴 수 있는 패밀리 목록
soffice --version                     # 변환기 존재 확인
```

실측 결과 (2026-09-06):

| 항목                  | 값                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 한글 지원 폰트 face   | **42개** (Noto Sans/Serif CJK KR·JP·SC·HK, NanumGothic, NanumMyeongjo, NanumBarunGothic, NanumSquare, NanumGothicCoding) |
| LibreOffice           | **24.2.7.2** (`/usr/bin/soffice`)                                                                                        |
| 디스크 증가           | `/usr` 7.2G -> 7.7G (**약 +500 MB**). 내역: LibreOffice 313M, Noto CJK 89M, Nanum 33M                                    |
| docx -> PDF 변환 시간 | **0.68초** (3.2 KB 한글 docx)                                                                                            |
| pptx -> PDF           | 0.54초 / xlsx -> PDF 0.48초                                                                                              |
| 변환 PDF 임베드 폰트  | `NotoSansCJKsc-Regular`, `NotoSansCJKsc-Bold` (+DejaVu) -> **한글 정상 임베드**                                          |

> Noto Sans CJK 는 한 폰트의 지역 변형이라 `sc` 로 잡혀도 한글 글리프는 동일하다. 한자 자형까지 한국식으로 맞추려면 fontconfig 에서 `:lang=ko` 우선순위를 `KR` 로 고정하면 된다(현재는 기본값 그대로 둠).

### Docker 이미지 반영

**Dockerfile 을 고칠 필요가 없다.** 업스트림이 이미 빌드 인자를 노출한다 (`Dockerfile` 의 `OPENCLAW_IMAGE_APT_PACKAGES`).

```bash
docker build \
  --build-arg OPENCLAW_IMAGE_APT_PACKAGES="fonts-noto-cjk fonts-nanum libreoffice-writer libreoffice-calc libreoffice-impress" \
  -t openclaw-fork:doc-preview .
```

이미지 크기 증가는 런타임 베이스(`node:24-bookworm-slim`)에 같은 패키지를 넣어 **실측**했다 (전체 이미지 빌드는 시간이 오래 걸려 대신 런타임 레이어만 측정).

| 항목                       | 값                                      |
| -------------------------- | --------------------------------------- |
| 설치 전 루트 파일시스템    | 239,220 KB (약 234 MiB)                 |
| 설치 후 (apt 캐시 정리 뒤) | 834,064 KB (약 815 MiB)                 |
| **증가**                   | **+594,844 KB = 약 +581 MiB**           |
| 컨테이너 안 LibreOffice    | 7.4.7.2 (bookworm), 한글 폰트 face 42개 |

폰트만 필요하고 변환기는 필요 없다면 `fonts-noto-cjk` 만 넣는다 (증가폭이 크게 줄어든다). 그 경우 문서 미리보기는 HTML 폴백 경로로만 동작한다.

**compose 반영 2026-09-07.** 납품 스택 `chris-local/docker-compose.ixauth.yml` 의 gateway 빌드 인자 `OPENCLAW_IMAGE_APT_PACKAGES` 가 위 예시와 같은 패키지 집합(`fonts-noto-cjk fonts-noto-cjk-extra fonts-noto-color-emoji fonts-nanum libreoffice-writer libreoffice-calc libreoffice-impress`)을 쓴다. 그 전까지는 폰트 3종만 들어 있어 컨테이너에 `soffice` 가 없었고, docx·xlsx 는 이미지 없는 HTML 폴백, pptx·doc·xls·ppt 는 실패였다. `chris-local/ixauth-verify.sh` 는 IX-Auth 이미지만 빌드하고 게이트웨이 이미지는 만들지 않으므로 동기화할 것이 없다.

### 에이전트가 PDF 를 만들 때의 규칙

규칙 원문은 `chris-local/workspace-pdf-rules.md` 이고, `chris-local/install-pdf-rules.sh` 가 로컬 인스턴스 워크스페이스 `AGENTS.md` 에 멱등으로 덧붙인다 (설치 완료).

요지:

1. **PDF 는 LibreOffice headless 로 만든다** (`soffice --headless --convert-to pdf`). 폰트를 임베드하므로 받는 쪽 환경을 타지 않는다.
2. HTML -> PDF 로 직접 그릴 때는 `font-family` 에 `"Noto Sans CJK KR", "NanumGothic"` 을 **명시**한다. 맨 `sans-serif` 에 맡기지 않는다.
3. 만들기 전에 `fc-list :lang=ko family`, 만든 뒤에 임베드 폰트 목록을 확인한다. 한글 문서인데 라틴 폰트만 있으면 두부가 찍힌 것이다.
4. **실패를 숨기지 않는다.** 폰트가 없어 실패하면 "호스트에 한글 폰트가 없어서 PDF 생성이 실패했다, `fonts-noto-cjk` 를 설치하고 다시 시도하라" 라고 원인을 그대로 말한다. 조용히 재시도하거나 영문으로 갈아치우지 않는다.

### 폰트를 못 찾을 때 실제로 무슨 일이 일어나는가 (실측 1회)

존재하지 않는 폰트 이름(`NoSuchKoreanFont-XYZ`)을 지정한 HTML 과, 실제 이름(`Noto Sans CJK KR`)을 지정한 HTML 을 같은 조건으로 변환해 임베드 폰트를 비교했다.

| 지정한 font-family                 | `fc-match` 결과                      | 변환 종료코드 | PDF 임베드 폰트                             |
| ---------------------------------- | ------------------------------------ | ------------- | ------------------------------------------- |
| `NoSuchKoreanFont-XYZ` (없는 이름) | `DejaVu Sans` (**한글 글리프 없음**) | **0 (성공)**  | `NotoSansCJKsc-Regular/Bold` + `DejaVuSans` |
| `Noto Sans CJK KR` (실제 이름)     | `Noto Sans CJK KR`                   | 0             | `NotoSansCJKkr-Regular/Bold`                |

**핵심**: 폰트 이름이 틀려도 **오류가 나지 않는다.** LibreOffice 가 자체 폴백으로 CJK 폰트를 찾아 끼워 넣기 때문에 종료코드는 0 이고 문서도 읽힌다. 다만 지역 변형이 `kr` 이 아니라 `sc` 로 밀리고, **호스트에 CJK 폰트가 아예 없으면 같은 종료코드 0 으로 두부만 찍힌 PDF 가 나온다.** 그래서 "오류가 안 났으니 됐다" 는 판정이 성립하지 않고, **임베드 폰트 목록 확인이 유일한 신뢰 신호**다. 규칙 3·4번이 이 실측 때문에 존재한다.

### 실측: 에이전트에게 시켜본 결과 (2026-09-06 23:04 KST)

"한글이 들어간 2페이지 보고서를 PDF 로 만들어 달라" 고 요청했더니 에이전트가 AGENTS.md 규칙대로 움직였다.

1. 먼저 `fc-list :lang=ko` 와 `soffice --version` 으로 **폰트·변환기 존재를 확인**하고 "한글 폰트와 LibreOffice 모두 확인됐습니다" 라고 보고했다.
2. HTML 을 headless Chrome 으로 PDF 화한 뒤 **임베드 폰트를 검사해 스스로 반려**했다: "Chrome 은 2페이지로 잘 맞췄지만 글자를 Type3 경로로 그려 실제 폰트를 임베드하지 않았습니다. LibreOffice 쪽이 진짜 폰트를 넣으므로 그쪽 레이아웃을 조정하겠습니다."
3. LibreOffice 경로로 다시 만들어 `output/한글보고서.pdf` (146 KB)를 냈고, 파일 패널 미리보기에서 제목·본문·표가 전부 정상 한글로 보인다 (`preview-05-korean-pdf.png`).

즉 **폰트 검증 단계가 없었다면 Type3 PDF 가 그대로 납품될 뻔했다.** 규칙이 실제로 한 번 걸러냈다.

---

## 7. 검증 결과 (2026-09-06)

| 항목                           | 결과                                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check` 사전 점검 18종    | **전부 통과** (충돌 마커·max-lines 래칫·SAFETY 주석·패키지 락 가드 등)                                                                                    |
| `pnpm check` typecheck         | 이 브랜치가 만든 오류 **0**. 별건으로 `ui/src/pages/apps/route.ts` 의 반환 타입 오류가 있었고 브랜딩 담당이 `35be7a8c7dc` 로 고쳤다                       |
| 신규 유닛 테스트               | `document-extract-html.test.ts` 6건, `document-convert.test.ts` 4건, `document-preview-kinds.test.ts`·`document-preview.test.ts` 포함 **전부 통과**       |
| 기존 회귀                      | `sessions-files.test.ts`·`sessions-files.preview.test.ts`·`control-ui-csp.test.ts` **71건 통과**                                                          |
| `pnpm build` + `pnpm ui:build` | **성공**                                                                                                                                                  |
| **번들 증가**                  | **사실상 0.** 시작 JS 341.0 KiB gzip (기준선 350,377 B 보다 **1,241 B 적다**). 최대 JS 청크 211.0 KiB / 상한 215.0 KiB, 최대 CSS 44,169 B / 상한 53,400 B |
| 신규 npm 의존성                | **0개**                                                                                                                                                   |
| CSP 위반 콘솔 오류             | **0건** (남은 404 는 다른 세션의 link-favicon 조회로 이 기능과 무관)                                                                                      |
| 형식별 실측                    | PDF·docx·xlsx·pptx 4종 + 에이전트 생성 한글 PDF 1종, **전부 한글 정상**                                                                                   |

스크린샷: `D:\PROJECT\chris-server\analysis\2026-09-06-openclaw-2\preview-01-pdf.png` ~ `preview-05-korean-pdf.png`

### 실측에서 확인된 동작

- PDF 는 `blob:` iframe 안에서 **브라우저 내장 뷰어**가 그린다. 페이지 이동·확대·인쇄·다운로드가 그대로 살아 있다.
- docx 는 표·글머리표·제목 단계가 원본 그대로 나온다. 툴바에 "Converted for preview" 표시가 붙는다.
- xlsx·pptx 도 같은 뷰어로 통일돼 보인다.
- 변환 지연은 체감상 1초 미만이고, 같은 파일을 다시 열면 캐시가 걸려 즉시 뜬다.

---

## 8. 채팅 첨부 재참조 도구 (2026-09-08, N 단계)

미리보기는 **파일 패널**에 있는 문서를 사람이 보는 기능이다. 이 절은 그 짝인 **채팅에 올린 첨부를 모델이 다시 꺼내 보는** 경로다.

### 8-1. 왜 필요했나

Control UI 에서 파일을 붙여 보내면 서버가 `<stateDir>/media/inbound/` 에 저장하고, 전사에는 `media://inbound/<id>` 라는 불투명한 표시만 남는다. 모델 프롬프트에도 `[media attached: media://inbound/...]` 한 줄만 간다. 그래서 세 가지가 안 됐다.

- 그 턴이 문맥 창에서 밀려나면 모델은 파일이 아직 있다는 사실조차 모른다.
- 비이미지 첨부는 `hydrationSuppressed` 라 다음 턴부터는 아예 안 보인다.
- `tools.fs.workspaceOnly: true` 라 `read` 로 미디어 폴더를 열 수 없다.

사용자 요구는 "사용자가 채팅에 올린 파일은 나중에도 참조 가능해야 한다" 였다.

### 8-2. 도구 두 개

| 도구         | 하는 일                                                                                                          | 정본                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `media_list` | 올린 첨부 목록. id, 원본명, 형식, 크기, 올린 시각, 세션 키, 에이전트. 최근순, 상한 50, `search` 로 이름 부분일치 | `src/agents/tools/media-list-tool.ts`         |
| `media_read` | id 로 첨부 하나를 모델 입력으로 돌려준다                                                                         | `src/agents/tools/media-read-tool.ts`         |
| 공통 결정    | 누구의 것을 어디까지 보여 줄지                                                                                   | `src/agents/tools/media-reference-context.ts` |

`media_read` 의 형식별 동작은 미리보기와 같은 서버 변환기를 쓴다. 정확히는 문서 색인(`openclaw knowledge sync`)이 쓰는 `convertKnowledgeSource`(`src/knowledge/convert.ts`) 를 그대로 부른다.

| 첨부                          | 결과                                                                      |
| ----------------------------- | ------------------------------------------------------------------------- |
| 이미지                        | 이미지 블록으로 모델 문맥에 들어간다(사용자 답변에 첨부되지는 않는다)     |
| PDF                           | 페이지별 텍스트. 텍스트 층이 없는 스캔본은 "본문 추출 불가" 로 돌아온다   |
| docx · xlsx                   | 내장 OOXML 리더 -> 마크다운. 비면 LibreOffice -> PDF -> 텍스트로 넘어간다 |
| hwp · hwpx                    | 내장 한글 리더 -> 텍스트 (9절). LibreOffice 를 거치지 않는다             |
| pptx · ppt · doc · xls · 기타 | LibreOffice -> PDF -> 텍스트. 변환기가 없으면 "본문 추출 불가"            |
| txt · md · csv                | UTF-8 로 읽고 실패하면 CP949 로 다시 읽는다                               |

상한은 도구가 스스로 건다. 읽는 바이트 **20 MB**(`MEDIA_READ_MAX_BYTES`), 모델에 넘기는 글자 **60,000자**(`MEDIA_READ_MAX_CHARS`). 넘으면 잘라서 주고 잘렸다고 말한다.

### 8-3. 누구의 파일까지 보이나

**도구가 인자로 받는 사람 정보는 없다.** 세션에서 서버가 정한다.

1. 지금 세션의 **생성자 프로필**이 소유자다(`sessionCreatorProfileId`). 모델이 남의 이름을 넣어 부를 방법이 없다.
2. 첨부가 기록된 **에이전트의 부서 바인딩**이 지금 에이전트의 것과 같아야 한다. 둘 다 미바인딩(공용)인 경우도 같은 것으로 본다.
3. 세션이 지워진 첨부(`deleted_at`)는 목록에서 빠지고 `media_read` 도 "not found" 로 답한다.

거부는 종류를 가리지 않고 전부 같은 문구다. 남의 id 를 찍어 보는 것과 없는 id 를 찍는 것이 구분되면 안 된다.

**ix-auth 모드가 아닐 때**(토큰 모드, WSL 로컬)는 귀속시킬 계정이 없다. 이때는 **지금 세션의 첨부만** 보여 준다. 기존 세션 가시성 기본값이 `self`(HANDOFF 4절 표) 이므로, 첨부만 그보다 넓어지면 안 된다는 판단이다.

경계 자체의 정본은 [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md) 7-1 이다. HTTP 로 첨부를 직접 받는 경로도 같은 절이 다룬다.

### 8-4. 프로필과 시스템 프롬프트

두 도구는 도구 카탈로그(`src/agents/tool-catalog.ts`)의 `media` 절에 있고 `readonly` · `coding` · `messaging` 프로필에 들어간다. 납품 부서 에이전트가 `readonly` 프로필이라 그쪽에서도 그대로 쓸 수 있다. `minimal` 에는 넣지 않았다(그 프로필은 `session_status` 하나만 두는 것이 취지다).

시스템 프롬프트에는 두 도구가 **모두 있을 때만** 한 줄이 붙는다(`src/agents/system-prompt.ts`).

```text
Looking for a file the user uploaded earlier: `media_list` first, then `media_read` with that id.
```

### 8-5. 보존

`attachments.ttlHours` 는 납품 템플릿(`chris-local/ixauth-gateway-config/openclaw.json`)에 **넣지 않는다.** 넣으면 그 시간이 지난 첨부가 삭제돼 재참조 요구와 정면으로 충돌한다. 값이 없으면 인바운드 첨부는 무기한 남는다(`src/gateway/server-maintenance.ts` 의 미디어 정리는 값이 없으면 아웃바운드만 정리한다).

세션을 지워도 파일은 지우지 않고 소유권 행에 삭제 표시만 남긴다. 사용량이 걱정되면 게이트웨이 상태 볼륨에서 직접 본다.

```bash
docker compose -f chris-local/docker-compose.ixauth.yml --env-file chris-local/ixauth.env   exec gateway du -sh /home/node/.openclaw/media/inbound
```

---

## 9. 한글 문서 hwp / hwpx (2026-09-09, S 단계)

납품처 NAS 공유에서 hwp 가 **29,867개**로 xlsx 다음으로 많은데(pdf 23,355 / docx 7,887), 그때까지 색인도 미리보기도 되지 않았다(`NAS-FOLDER-ACL.md` 2.2). 사용자 확정(2026-09-09)으로 변환기를 넣었다.

### 9-1. LibreOffice 로는 안 된다 (실측)

납품 이미지에는 이미 LibreOffice 7.4.7.2 가 있고 `libhwplo.so` 라는 한글 필터도 들어 있다. 그런데 그 필터는 **2005년 이전의 HWP 3.0** 만 안다. 공유에서 무작위로 고른 실제 파일 18개를 컨테이너 안에서 변환해 봤다.

| 후보                     | 성공 | 실패 | 결과                                                                                         |
| ------------------------ | ---- | ---- | -------------------------------------------------------------------------------------------- |
| LibreOffice 7.4.7.2      | 0/17 | 17   | **종료코드 0 인데 PDF 가 만들어지지 않는다.** 0바이트 파일 1개만 빈 PDF 를 냈다              |
| pyhwp `hwp5txt` 0.1b15   | 15/16 | 1   | 돌기는 하나 **표 칸 글자를 버린다**. 발주서·일일보고 같은 표 문서에서 561자 대신 46자만 나옴 |
| **내장 리더 (채택)**     | **17/17** | 0 | 표 칸까지 전부. 최대 59ms                                                                    |

pyhwp 를 버린 이유는 세 가지다. (1) 표를 버려서 공유 문서 대부분인 발주서·보고서가 거의 빈 껍데기가 된다. (2) 2020년 이후 유지보수가 없고 의존성 `six` 선언이 빠져 있어 그냥 설치하면 `ModuleNotFoundError` 로 죽는다. (3) 라이선스가 AGPL-3.0 이라 납품 재배포에 법무 확인이 붙는다. LibreOffice 를 최신판으로 올리는 길도 있으나 bookworm 에는 없고, 베이스 이미지를 바꾸는 비용이 이 기능 하나보다 크다.

### 9-2. 그래서 직접 읽는다 (새 의존성 0, 이미지 증가 0)

두 컨테이너 모두 이미 있는 것만으로 열린다.

- **hwp**: OLE2 복합 파일(CFB). `src/gateway/document-cfb.ts` 가 FAT·미니FAT·디렉터리 트리를 따라 스트림을 꺼내고, `document-extract-hangul.ts` 가 `FileHeader` 의 플래그를 보고 `BodyText/SectionN` 을 raw deflate 로 풀어 레코드를 훑는다. 본문은 태그 67(문단 텍스트)에 UTF-16LE 로 들어 있다. 제어문자 중 표·그림·필드 시작 등 21종은 8글자 폭을 차지하므로 그만큼 건너뛴다. 이 처리를 빼면 그 자리의 레이아웃 바이트가 글자로 새어 나온다.
- **hwpx**: zip + xml. `Contents/sectionN.xml` 의 `<hp:t>` 를 문단(`<hp:p>`) 단위로 모은다. zip 은 이미 루트 의존성인 `jszip` 으로 연다.

읽지 못하는 것은 **읽지 못한다고 말한다.** 암호 문서(플래그 비트 1), 배포용 문서(비트 2, 본문 레코드가 문서별 키로 암호화됨), HWP 3.0 은 각각 `encrypted` · `distribution` · `legacy-format` 이라는 서로 다른 사유로 보고된다. 손상 파일과 한 칸에 뭉뚱그리지 않는다.

상한은 압축 해제 64 MiB, 추출 글자 100만, 구역 256개다. 넘으면 잘리고 잘렸다고 적는다.

### 9-3. 실측 (2026-09-09, 공유 7곳 2013~2025년 문서 18개)

파일명은 고객 자료라 가린다. 크기는 원본 바이트, 시간은 추출에 걸린 시간이다.

| #   | 공유       | 형식 | 크기      | 결과  | 추출 글자 | 시간  |
| --- | ---------- | ---- | --------- | ----- | --------- | ----- |
| 1   | 공용       | hwpx | 337,477   | 성공  | 7,783     | 59ms  |
| 2   | 공용       | hwpx | 1,007,297 | 성공  | 3,013     | 4ms   |
| 3   | 공용       | hwp  | 131,072   | 성공  | 1,185     | 2ms   |
| 4   | 공용       | hwp  | 1,685,506 | 성공  | 214,466   | 24ms  |
| 5   | 공용       | hwp  | 12,800    | 성공  | 540       | 0ms   |
| 6   | 개인 A     | hwp  | 0         | empty | -         | 0ms   |
| 7   | 개인 A     | hwp  | 378,880   | 성공  | 1,244     | 0ms   |
| 8   | 개인 B     | hwp  | 58,880    | 성공  | 4,887     | 1ms   |
| 9   | 개인 B     | hwp  | 60,928    | 성공  | 531       | 0ms   |
| 10  | 개인 B     | hwp  | 59,392    | 성공  | 409       | 0ms   |
| 11  | 개인 C     | hwp  | 384,000   | 성공  | 33,458    | 2ms   |
| 12  | 개인 D     | hwp  | 30,208    | 성공  | 1,870     | 0ms   |
| 13  | 개인 D     | hwp  | 94,208    | 성공  | 1,424     | 0ms   |
| 14  | 개인 E     | hwp  | 48,640    | 성공  | 409       | 0ms   |
| 15  | 개인 E     | hwp  | 81,920    | 성공  | 544       | 0ms   |
| 16  | 개인 E     | hwp  | 81,920    | 성공  | 619       | 0ms   |
| 17  | 디자인PC   | hwp  | 10,752    | 성공  | 256       | 0ms   |
| 18  | 디자인PC   | hwp  | 30,208    | 성공  | 1,289     | 0ms   |

**내용 있는 17개 전부 성공.** 6번은 휴지통 폴더의 0바이트 파일이라 색인 단계에서 `ignored/empty` 로 빠진다. 한글이 깨진 문서는 하나도 없었고, 표는 칸마다 한 문단으로 풀려 나온다(칸 사이 줄이 끊기지만 검색에는 지장이 없다. trigram 토크나이저라 붙여 쓰든 나눠 쓰든 걸린다).

공유 전체 조사에서 hwpx 는 2개뿐이고 나머지는 전부 hwp 5.0(CFB)이었다. HWP 3.0 은 표본에 없었다.

### 9-4. 안 되는 것

| 항목                   | 이유                                                                            |
| ---------------------- | --------------------------------------------------------------------------------- |
| 서식 · 그림 · 표 테두리 | 본문 글자만 뽑는다. 원본 모양대로 보려면 파일을 내려받아 한글에서 연다           |
| 암호 문서              | 비밀번호 없이는 본문 레코드를 풀 수 없다. `encrypted` 로 보고한다                |
| 배포용 문서            | 문서별 키로 암호화돼 있다. `distribution` 으로 보고한다                         |
| HWP 3.0                | 형식이 다르다. `legacy-format` 으로 보고한다. 표본에는 없었다                   |
| 표 구조                | 병합 셀·행열 관계는 남지 않는다. 칸 글자만 순서대로 남는다                      |
| 그림 속 글자           | OCR 이 없다                                                                      |
