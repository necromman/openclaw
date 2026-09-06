# FILE-PREVIEW.md - 문서 미리보기 (PDF / Word / Excel / PowerPoint)

> 채팅 오른쪽 **파일** 패널에서 `sample.docx` 가 이름·크기만 있는 카드로 보이고 내용이 안 나오던 문제를 없앤 작업의 정본이다.\
> 운영·설치 절차는 [FORK.md](../FORK.md), 코드 구조 전반은 [CODEBASE.md](CODEBASE.md) 가 정본이고 이 문서는 **문서 미리보기 한 기능**만 다룬다.

- 작성 2026-09-06 (KST, 일요일). 브랜치 `chris/file-preview` -> `chris/main` 병합.
- 편집 체크아웃 `D:\PROJECT\openclaw` / 빌드·실행 정본 WSL `~/openclaw` / 로컬 인스턴스 `http://127.0.0.1:18789/`

---

## 1. 손대기 전 상태 (실측)

| 형식 | 파일 패널에서 보이던 것 | 근거 |
| --- | --- | --- |
| `.ts` `.md` `.json` 등 텍스트 | CodeMirror 코드 뷰 | `ui/src/pages/chat/components/chat-session-workspace.ts:277-367` |
| `png` `jpeg` `gif` `webp` `avif` | `<img>` (data URL) | 같은 파일 `:247-263`, 허용 목록 `:48-54` |
| **그 외 전부 (`pdf` `docx` `xlsx` `pptx` `hwp`)** | **"This file is not previewable inline." 안내문** | 같은 파일 `:264-266`, 문구 생성 `:84-104` |
| 채팅 메시지 첨부 카드 | 이름·크기·다운로드 버튼만 | `ui/src/pages/chat/components/chat-sidebar-content.ts:119-125` |

판정은 **게이트웨이가** 내린다. `src/gateway/server-methods/sessions-files.ts:420-445` 의 `applyInlineFilePreview()` 가 파일을 읽어 이미지 MIME 허용목록이면 `image`, UTF-8 로 디코딩되면 `text`, 아니면 `unsupported` 를 붙인다. docx 는 zip 바이너리라 무조건 `unsupported` 였다. **PDF 렌더러도, pdf.js 도, `<object>`/`<embed>` 도 저장소 어디에도 없었다.**

## 2. 플러그인 생태계 조사 결과

**Control UI 안에서 문서를 그려 주는 플러그인은 없다.** ClawHub 실검색 결과다.

| 검색 | 결과 | 성격 |
| --- | --- | --- |
| `plugins search pdf` | 20건 (`pdfapihub`, `pdf-to-jpg`, `pdf-extract-text`, ...) | 전부 **PDFAPIHub 외부 SaaS 호출**. API 키 필요, 문서를 외부로 전송 |
| `plugins search docx` | 1건 `docx-to-pdf` | 같은 SaaS |
| `plugins search document` | 13건 (`doc-to-pdf`, `scan-document`, ...) | 같은 SaaS + 메모리 플러그인 |
| `skills search document` | 10건 (`document-reader`, `document-pro`, ...) | **에이전트가 읽는** 스킬. 화면 렌더링과 무관 |
| 번들 `extensions/document-extract` | 있음 | `documentExtractors` 계약. PDF 텍스트/이미지를 **모델 입력용**으로 뽑는다. UI 미리보기용이 아니다 |

즉 이 기능은 **직접 만들어야** 했다. 다만 `extensions/document-extract` 가 쓰는 `clawpdf` 와 루트 의존성 `jszip@3.10.1` 은 재사용 가능한 자산이었다.

## 3. 제약 조건 (여기서 선택지가 갈린다)

| 제약 | 실측값 | 출처 |
| --- | --- | --- |
| CSP `frame-src` | `'self' http: https:` (blob: **없음**) | 라이브 응답 헤더, `src/gateway/control-ui-csp.ts:83-98` |
| CSP `object-src` | `'none'` -> `<object>` `<embed>` **사용 불가** | 같은 곳 |
| CSP `img-src` | `'self' data: blob:` | 같은 곳 |
| 외부 CDN | `script-src 'self'` 뿐 -> **CDN 로드 불가**, 전부 번들 | 같은 곳 |
| 파일 바이트 HTTP 경로 | `/__openclaw__/assistant-media` 는 `X-Frame-Options: DENY` + `frame-ancestors 'none'` -> **iframe 불가** | `src/gateway/control-ui.ts:206-217, 558` |
| 인증 | 베어러 헤더 전용(쿠키 없음). `<img src>` 는 쿼리 `mediaTicket` 으로만 통과 | `src/gateway/http-auth-utils.ts:171-228` |
| **UI 번들 상한** | **JS 자산 1개당 gzip 215 KiB** (전체 자산 대상, mermaid 만 예외) | `scripts/check-control-ui-performance.mts:47` |
| 인라인 미리보기 상한 | 256 KiB (`WORKSPACE_PREVIEW_MAX_BYTES`) | `src/gateway/server-methods/workspace-fs.ts:17` |

**215 KiB 상한이 결정타다.** SheetJS(xlsx) 커뮤니티판은 gzip 약 290 KiB 라 청크를 쪼개도 이 검사에서 빌드가 깨진다. pdf.js 도 같은 이유로 탈락한다.

## 4. 선택지 비교표

| # | 방식 | CSP 적합 | 번들 증가 | 라이선스 | 한글 폰트 | 난이도 | 판정 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| a1 | **PDF: 브라우저 내장 뷰어 + blob iframe** | `frame-src` 에 `blob:` **한 단어 추가 필요** | **0** | - | 문서가 폰트를 임베드하므로 무관 | 낮음 | **채택** |
| a2 | PDF: 게이트웨이 URL iframe | 새 HTTP 라우트 필요(기존 라우트는 `XFO: DENY`). 티켓 발급 머신 복제 200줄 | 0 | - | 무관 | 높음 | 기각(과설계) |
| a3 | PDF: pdf.js 번들 | 적합 | **+290 KiB gz -> 상한 초과** | Apache-2.0 | 무관 | 중간 | **기각(상한)** |
| b | docx: mammoth 클라이언트 | 적합(srcdoc sandbox) | +55 KiB gz | MIT | 브라우저 폰트 | 중간 | 조건부 기각(아래) |
| c | xlsx: SheetJS 커뮤니티판 | 적합 | **+290 KiB gz -> 상한 초과** | Apache-2.0 | 브라우저 폰트 | 중간 | **기각(상한)** |
| d | pptx: 클라이언트 렌더러 | - | - | - | - | 매우 높음 | 기각(쓸만한 구현 없음) |
| e | **서버 통합 변환 LibreOffice -> PDF** | 적합(결과가 PDF 라 a1 로 합류) | **0** | **MPL-2.0** (배포 의무 없음, 별도 프로세스) | **호스트에 CJK 폰트 필요** | 중간 | **채택** |
| e2 | **서버 내장 추출 OOXML -> 안전 HTML** (jszip, 신규 의존성 0) | 적합(srcdoc `sandbox=""`) | 0 | - | 뷰어 폰트 | 중간 | **채택(폴백)** |
| f | OnlyOffice / Collabora 문서 서버 | 적합 | 0 | **AGPL-3.0** (납품 시 소스 공개 의무 검토 필요) | 이미지에 포함 | 높음(컨테이너 1대 추가) | 기각 |

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
   +-- 그 외          -> documentError
   |
   v
UI  <openclaw-document-preview>               ui/src/components/file-preview/document-preview.ts
       format pdf  -> Blob -> objectURL -> <iframe src>        (브라우저 내장 PDF 뷰어)
       format html -> <iframe sandbox="" srcdoc>               (스크립트·폼·동일출처 전부 차단)
```

### 파일 목록

| 파일 | 성격 | 역할 |
| --- | --- | --- |
| `src/gateway/document-convert.ts` | 신규 | soffice 탐지·변환·타임아웃·동시성 제한·결과 캐시 |
| `src/gateway/document-extract-html.ts` | 신규 | jszip 으로 docx/xlsx -> 이스케이프된 HTML (의존성 0) |
| `src/gateway/server-methods/sessions-files-document.ts` | 신규 | 위 둘을 묶어 `SessionFileEntry` 를 채우는 결정표 |
| `packages/gateway-protocol/src/schema/sessions.ts` | 수정 | `previewKind: "document"` + `document` / `documentError` 필드 + 요청 플래그 2개 |
| `src/gateway/server-methods/sessions-files.ts` | 수정 | `sessions.files.get` 에 분기 1개 (`documentPreview === true`) |
| `src/gateway/control-ui-csp.ts` | 수정 | `frame-src` 에 `blob:` 한 단어 |
| `ui/src/components/file-preview/document-preview-kinds.ts` | 신규 | 확장자 -> 미리보기 종류 (순수 함수) |
| `ui/src/components/file-preview/document-preview.ts` | 신규 | Lit 엘리먼트 `<openclaw-document-preview>` |
| `ui/src/pages/chat/components/chat-sidebar-content-types.ts` | 수정 | `SidebarContent` 에 `document` 변형 추가 |
| `ui/src/pages/chat/components/chat-sidebar-content.ts` | 수정 | `case "document"` 분기 |
| `ui/src/pages/chat/components/chat-session-workspace.ts` | 수정 | 문서 확장자면 `documentPreview: true` 로 요청하고 결과를 라우팅 |
| `ui/src/lib/sessions/session-requests.ts` | 수정 | 요청 옵션에 플래그 전달 |
| `ui/src/i18n/locales/en.ts` | 수정 | `documentPreview.*` 문구 (영어만; 나머지 로케일은 자동 폴백) |

### 보안 경계

- **경로**: 워크스페이스 파일 접근은 전부 기존 `readWorkspaceFile()` (fs-safe root, 심링크·하드링크 거부, 루트 밖 탈출 차단)을 통과한다. 새 경로 해석 코드를 만들지 않았다.
- **인증**: 새 HTTP 라우트가 없다. 문서 바이트는 이미 인증된 WebSocket RPC 로만 흐른다. 토큰이 URL 에 실리는 일이 없다.
- **변환기**: 임시 디렉터리는 매 호출 `mkdtemp` 로 새로 만들고 `finally` 에서 재귀 삭제한다. 셸을 거치지 않고 인자 배열로 spawn 한다. 확장자 화이트리스트(`doc docx odt rtf xls xlsx ods csv ppt pptx odp`) 밖은 아예 실행하지 않는다. 타임아웃 60초, 출력 상한 40 MiB, 동시 실행 2개.
- **HTML 폴백**: 모든 텍스트는 서버에서 `& < > " '` 를 이스케이프하고, 허용 태그 목록 밖은 만들지 않는다. 그 위에 `sandbox=""` iframe 이라 스크립트·폼·팝업·동일출처 접근이 전부 죽는다.
- **blob iframe**: 우리 스크립트가 인증 채널로 받은 바이트로 직접 만든 blob 이다. PDF 는 브라우저 내장 뷰어(별도 프로세스)가 그리므로 문서 안의 JavaScript 가 Control UI DOM 에 닿지 않는다. `URL.revokeObjectURL` 로 교체·해제 시 반드시 회수한다.

### 제한

| 제한 | 값 | 이유 |
| --- | --- | --- |
| 미리보기 최대 파일 크기 | 20 MiB | base64 로 WS 를 타므로 실제 전송량은 약 1.34배 |
| 변환 타임아웃 | 60초 | LibreOffice 가 드물게 멈춘다 |
| HTML 폴백 시트 상한 | 12 시트 / 시트당 300행 / 행당 40열 | 잘리면 안내 문구가 붙는다 |
| hwp / hwpx | **미지원** | 이번 범위 밖. "변환 후 미리보기 예정" 안내만 |
| 이미지가 든 docx 의 HTML 폴백 | 이미지 생략 | 폴백은 텍스트·표 구조만 살린다. 정확한 그림은 LibreOffice 경로에서 |

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

| 항목 | 값 |
| --- | --- |
| 한글 지원 폰트 face | **42개** (Noto Sans/Serif CJK KR·JP·SC·HK, NanumGothic, NanumMyeongjo, NanumBarunGothic, NanumSquare, NanumGothicCoding) |
| LibreOffice | **24.2.7.2** (`/usr/bin/soffice`) |
| 디스크 증가 | `/usr` 7.2G -> 7.7G (**약 +500 MB**). 내역: LibreOffice 313M, Noto CJK 89M, Nanum 33M |
| docx -> PDF 변환 시간 | **0.68초** (3.2 KB 한글 docx) |
| pptx -> PDF | 0.54초 / xlsx -> PDF 0.48초 |
| 변환 PDF 임베드 폰트 | `NotoSansCJKsc-Regular`, `NotoSansCJKsc-Bold` (+DejaVu) -> **한글 정상 임베드** |

> Noto Sans CJK 는 한 폰트의 지역 변형이라 `sc` 로 잡혀도 한글 글리프는 동일하다. 한자 자형까지 한국식으로 맞추려면 fontconfig 에서 `:lang=ko` 우선순위를 `KR` 로 고정하면 된다(현재는 기본값 그대로 둠).

### Docker 이미지 반영

**Dockerfile 을 고칠 필요가 없다.** 업스트림이 이미 빌드 인자를 노출한다 (`Dockerfile` 의 `OPENCLAW_IMAGE_APT_PACKAGES`).

```bash
docker build \
  --build-arg OPENCLAW_IMAGE_APT_PACKAGES="fonts-noto-cjk fonts-nanum libreoffice-writer libreoffice-calc libreoffice-impress" \
  -t openclaw-fork:doc-preview .
```

이미지 크기 증가는 런타임 베이스(`node:24-bookworm-slim`)에 같은 패키지를 넣어 **실측**했다 (전체 이미지 빌드는 시간이 오래 걸려 대신 런타임 레이어만 측정).

| 항목 | 값 |
| --- | --- |
| 설치 전 루트 파일시스템 | 239,220 KB (약 234 MiB) |
| 설치 후 (apt 캐시 정리 뒤) | 834,064 KB (약 815 MiB) |
| **증가** | **+594,844 KB = 약 +581 MiB** |
| 컨테이너 안 LibreOffice | 7.4.7.2 (bookworm), 한글 폰트 face 42개 |

폰트만 필요하고 변환기는 필요 없다면 `fonts-noto-cjk` 만 넣는다 (증가폭이 크게 줄어든다). 그 경우 문서 미리보기는 HTML 폴백 경로로만 동작한다.

### 에이전트가 PDF 를 만들 때의 규칙

규칙 원문은 `chris-local/workspace-pdf-rules.md` 이고, `chris-local/install-pdf-rules.sh` 가 로컬 인스턴스 워크스페이스 `AGENTS.md` 에 멱등으로 덧붙인다 (설치 완료).

요지:

1. **PDF 는 LibreOffice headless 로 만든다** (`soffice --headless --convert-to pdf`). 폰트를 임베드하므로 받는 쪽 환경을 타지 않는다.
2. HTML -> PDF 로 직접 그릴 때는 `font-family` 에 `"Noto Sans CJK KR", "NanumGothic"` 을 **명시**한다. 맨 `sans-serif` 에 맡기지 않는다.
3. 만들기 전에 `fc-list :lang=ko family`, 만든 뒤에 임베드 폰트 목록을 확인한다. 한글 문서인데 라틴 폰트만 있으면 두부가 찍힌 것이다.
4. **실패를 숨기지 않는다.** 폰트가 없어 실패하면 "호스트에 한글 폰트가 없어서 PDF 생성이 실패했다, `fonts-noto-cjk` 를 설치하고 다시 시도하라" 라고 원인을 그대로 말한다. 조용히 재시도하거나 영문으로 갈아치우지 않는다.
