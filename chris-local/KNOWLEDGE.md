# KNOWLEDGE.md - NAS 문서를 검색 가능한 자료로 만들기

> 부서 공유의 pdf·docx·xlsx·pptx 를 마크다운 사이드카로 뽑아 에이전트가 찾고 인용하게 만드는 작업의 정본이다.\
> 폴더 접근 통제는 [AUTH-DEPARTMENTS.md](AUTH-DEPARTMENTS.md) 13절, 설치·기동은 [DEPLOY.md](DEPLOY.md) 12절,\
> 화면에서 문서를 열어 보는 기능은 [FILE-PREVIEW.md](FILE-PREVIEW.md) 가 정본이다. 이 문서는 **색인 한 가지**만 다룬다.

작성 2026-09-08 (KST). 브랜치 `chris/delivery-i`. 계획은 [DELIVERY-PLAN.md](DELIVERY-PLAN.md) 3절 I 단계.

---

## 1. 문제

메모리 색인기는 **`.md` 파일만 모은다**(`packages/memory-host-sdk/src/host/internal.ts:175-182`, 이미지·오디오는 별도 설정으로 추가). 그래서 NAS 공유를 `memory.search.extraPaths` 로 통째로 가리켜도, 그 안의 pdf·docx·xlsx·pptx 는 **한 글자도 색인되지 않는다.** "시약 재고 문서에서 에탄올 수량 찾아줘" 가 빈손으로 끝나는 이유가 이것이다.

색인기를 고치는 선택지는 버렸다. `memory-host-sdk` 는 업스트림 패키지라 손대면 리베이스 비용이 계속 든다. 대신 **공유 밖에서 마크다운을 만들어 준다.**

## 2. 방식 한 줄

**원본 문서 1개 = 마크다운 사이드카 1개.** 사이드카는 NAS 가 아니라 **호스트 로컬 색인 폴더**에 쌓이고, 에이전트는 그 폴더를 `extraPaths` 로 본다.

```text
NAS 공유 (읽기 전용)                호스트 로컬 색인            에이전트
/mnt/nas/rnd/시약-재고-현황.docx  ->  /mnt/knowledge/rnd/          memory.search.extraPaths
/mnt/nas/rnd/신규과제-착수보고.pptx     시약-재고-현황.docx.md        = ["/mnt/knowledge/rnd"]
/mnt/nas/rnd/2026-계획.pdf              신규과제-착수보고.pptx.md
                                        2026-계획.pdf.md
        ^                                       ^
        |                                       |
        +--- openclaw knowledge sync -----------+
             (읽기만 한다)          (여기에만 쓴다)
```

공유에는 **아무것도 쓰지 않는다.** 마운트가 `:ro` 인 것과 색인 폴더가 따로 있는 것은 같은 규칙의 두 면이고, 명령 자체도 `--out` 이 `--source` 안이면 거부한다.

## 3. 명령

```bash
openclaw knowledge sync --source <문서 폴더> --out <색인 폴더> [옵션]
```

| 옵션                | 기본값                               | 뜻                                                            |
| ------------------- | ------------------------------------ | ------------------------------------------------------------- |
| `--source <dir>`    | (필수)                               | 읽을 문서 폴더. 절대 쓰지 않는다                              |
| `--out <dir>`       | (필수)                               | 사이드카를 쓸 색인 폴더. `--source` 안이면 거부               |
| `--include <목록>`  | `pdf,docx,xlsx,pptx,hwp,hwpx,md,txt` | 쉼표로 구분한 확장자. 목록 밖은 건너뛴다                      |
| `--max-bytes <n>`   | `20971520` (20 MiB)                  | 이보다 큰 원본은 건너뛴다. 상한 40 MiB                        |
| `--concurrency <n>` | `2`                                  | 동시 변환 수. 상한 8. LibreOffice 가 변환마다 프로세스를 뜬다 |
| `--dry-run`         | 꺼짐                                 | 변환·쓰기·삭제를 하지 않고 계획만 낸다                        |
| `--verbose`         | 꺼짐                                 | 건너뛴 파일까지 표에 넣는다                                   |
| `--json`            | 꺼짐                                 | 요약 객체를 그대로 출력한다                                   |

기본 출력은 표 한 장과 집계 한 줄이다. 표에는 **신규·갱신·삭제·실패**만 나오고, 건너뛴 파일은 집계에만 잡힌다(`--verbose` 로 펼친다).

```text
ACTION   CONVERTER          SOURCE                        DETAIL
created  docx-html          시약-재고-현황.docx           -
created  soffice-pdf-text   신규과제-착수보고.pptx        -
created  pdf-text           2026-1분기-연구개발-계획.pdf  -
created=5  updated=0  deleted=0  skipped=0  ignored=1  failed=0  (3412ms)
```

`--json` 요약의 모양:

```json
{
  "source": "/mnt/nas/rnd",
  "out": "/mnt/knowledge/rnd",
  "dryRun": false,
  "include": ["docx", "hwp", "hwpx", "md", "pdf", "pptx", "txt", "xlsx"],
  "maxBytes": 20971520,
  "concurrency": 2,
  "startedAt": "2026-09-08T07:40:00.000Z",
  "finishedAt": "2026-09-08T07:40:03.412Z",
  "durationMs": 3412,
  "counts": { "created": 5, "updated": 0, "deleted": 0, "skipped": 0, "ignored": 1, "failed": 0 },
  "converterMissing": false,
  "entries": [
    {
      "action": "created",
      "relativePath": "시약-재고-현황.docx",
      "sidecarPath": "시약-재고-현황.docx.md",
      "converter": "docx-html",
      "sourceBytes": 6210,
      "sidecarBytes": 812
    }
  ]
}
```

`converterMissing` 이 `true` 면 LibreOffice 가 없어 pptx·doc·xls·ppt 가 통째로 빠졌다는 뜻이다. 종료 코드로는 구분되지 않으므로 자동화에서는 이 값을 본다.

## 4. 사이드카 계약

파일 이름은 **원본 상대경로 + `.md`** 다. 확장자를 갈아치우지 않고 뒤에 붙이는 이유는 한 폴더의 `보고.pdf` 와 `보고.docx` 가 같은 사이드카를 덮어쓰지 않게 하기 위해서다. 대가로 마크다운 원본은 `README.md.md` 가 된다.

```markdown
---
source_path: "/mnt/nas/rnd/시약-재고-현황.docx"
source_relative: "시약-재고-현황.docx"
source_mtime: "2026-09-08T07:29:11.000Z"
source_size: 6210
source_sha256: "9f2c...(64자)"
converted_at: "2026-09-08T07:40:01.104Z"
converter: "docx-html"
---

> 원본: /mnt/nas/rnd/시약-재고-현황.docx

# 시약 재고 현황

| 품목         | 수량 | 보관 위치  |
| ------------ | ---- | ---------- |
| 에탄올 99.5% | 12병 | A-1 시약장 |
```

`> 원본:` 한 줄이 frontmatter 바로 아래 있는 것은 장식이 아니다. 인용은 `경로#L12-L30` 형태로 **사이드카의 줄 범위**를 가리키므로(`extensions/memory-core/src/tools.citations.ts`), 답변에 딸려 나오는 스니펫 안에 원본 경로가 같이 있어야 사람이 실제 파일을 찾아갈 수 있다. 인용 장식 코드는 건드리지 않았다.

## 5. 형식별 변환기

| 원본                        | 경로                                             | `converter` 값     | 결과                                  |
| --------------------------- | ------------------------------------------------ | ------------------ | ------------------------------------- |
| `pdf`                       | `clawpdf` 로 페이지별 텍스트                     | `pdf-text`         | 페이지마다 `## p.N` 제목              |
| `docx`                      | `document-extract-html.ts` (jszip, 의존성 0)     | `docx-html`        | 제목 단계·글머리표·표를 마크다운 표로 |
| `xlsx`                      | 같은 모듈                                        | `xlsx-html`        | 시트마다 `## 시트명` + 마크다운 표    |
| `hwp` `hwpx`                | `rhwp` CLI (`document-hangul-cli.ts`)            | `hwp-markdown`     | 쪽마다 `## p.N` + 표를 마크다운 표로  |
| 같은 형식, rhwp 없거나 실패 | `document-extract-hangul.ts` (의존성 0)          | `hwp-text`         | 문단·표 칸을 순서대로 (구조는 없다)   |
| `pptx` `doc` `xls` `ppt` 등 | `document-convert.ts` (soffice) -> pdf -> 텍스트 | `soffice-pdf-text` | 슬라이드·페이지마다 `## p.N`          |
| `md` `txt` `csv`            | 디코딩 후 복사                                   | `copy`             | 본문 그대로                           |

**페이지 제목이 요점이다.** 인용이 사이드카의 줄 번호를 주므로, 그 줄 바로 위의 `## p.7` 이 "원본 7쪽" 이라는 뜻이 된다. 문서를 한 덩어리로 뽑으면 그 정보가 사라진다.

**hwp·hwpx 는 rhwp 가 1순위, 내장 리더가 폴백이다 (S 단계).** rhwp 는 표를 마크다운 표로 그대로 내주지만 어떤 문서에서는 본문을 통째로 잃는다(종료 코드는 0). 그래서 두 리더를 다 돌려 내용 글자 수를 견주고, rhwp 가 내장 리더의 60% 미만이면 내장 리더 본문을 쓴다. 실측·설치·버전 고정 이유는 [FILE-PREVIEW.md](FILE-PREVIEW.md) 9-5.

**둘 다 LibreOffice 없이 된다 (S 단계).** 오히려 LibreOffice 로는 **안 된다**. 이미지의 LibreOffice 7.4 한글 필터는 2005년 이전 HWP 3.0 만 알아서, 요즘 hwp 를 주면 종료코드 0 을 내고 아무 파일도 만들지 않는다(실측 17개 중 0개 성공). 그래서 내장 리더가 hwp 5.0 의 CFB 컨테이너와 hwpx 의 zip+xml 을 직접 읽는다. 근거·비교표·실측은 [FILE-PREVIEW.md](FILE-PREVIEW.md) 9절.

**docx·xlsx 는 LibreOffice 없이도 된다.** 미리보기용으로 이미 있는 무의존 OOXML 리더를 재사용하고, 그 리더가 못 여는 파일만 LibreOffice 로 넘긴다. pptx 는 처음부터 LibreOffice 경로다.

**xlsx 의 날짜는 서식을 읽어야 날짜가 된다 (K 단계).** 통합 문서는 2026-01-01 을 46023 으로 저장하고, 그것이 날짜라는 사실은 셀에 붙은 서식에만 있다. 그래서 `xl/styles.xml` 의 `cellXfs` 를 읽어 셀 서식이 날짜형이면 `YYYY-MM-DD` 로, 시각이 있으면 `YYYY-MM-DD HH:mm` 으로 쓴다. 내장 서식 번호(14~~22·27~~36·45~~47·50~~58)와 사용자 서식을 모두 본다. 사용자 서식은 따옴표 리터럴과 대괄호 구역을 걷어낸 뒤 `y`·`d`(날짜)와 `h`·`s`(시각) 만 본다. `m` 은 월도 분도 되므로 혼자서는 아무것도 정하지 않는다.

세 가지를 알아 두어야 한다.

- **1900-02-29 이라는 없는 날.** 통합 문서 형식이 그 날짜를 가지고 있어서 일련번호 60 이하는 기준일이 하루 다르다. 그 구간만 기준을 옮겨 1 이 1900-01-01 이 되게 한다.
- **초는 버린다.** 09:30 이 부동소수점으로 09:29:59.9999 로 도착한다. 그대로 적으면 없는 정밀도가 색인에 들어가므로 분 단위로 반올림한다.
- **1904 기준 통합 문서는 다루지 않는다.** 맥 전용 옛 설정이고, 잘못 짐작하면 모든 날짜가 조용히 4년 어긋난다. 그런 파일은 지금까지처럼 일련번호가 남는다.

같은 추출기를 문서 미리보기도 쓰므로 파일 패널의 xlsx 미리보기도 같이 고쳐진다. 코드는 `src/gateway/document-xlsx-dates.ts`.

**한글 인코딩.** `.txt` 를 UTF-8 로 엄격 디코딩해 보고, 실패하면 CP949 로 다시 읽는다. 관대한 디코딩은 오류 없이 물음표만 남기고, 그 사이드카는 어떤 질의에도 걸리지 않는다. 실패를 분기로 바꾸려고 엄격 모드를 쓴다.

## 6. 두 번째 실행부터 무엇이 일어나는가

| 상태                                | 판정      | 하는 일                                 |
| ----------------------------------- | --------- | --------------------------------------- |
| 크기·수정시각·경로가 기록과 같다    | `skipped` | 원본을 읽지도 않는다                    |
| 시각은 변했는데 해시가 같다         | `skipped` | frontmatter 의 시각만 갱신(본문 그대로) |
| 해시가 다르다                       | `updated` | 다시 변환해 덮어쓴다                    |
| 색인에 없던 원본                    | `created` | 변환해 새로 쓴다                        |
| 원본이 사라졌다                     | `deleted` | 사이드카를 지우고 빈 폴더를 정리한다    |
| 확장자 밖 / 상한 초과 / 심링크      | `ignored` | 아무것도 쓰지 않는다                    |
| 변환기 없음 / 변환 실패 / 읽기 실패 | `failed`  | 이전 사이드카를 남겨 둔다               |

시각만 바뀐 경우를 굳이 처리하는 것은 백업 복원이 파일 내용을 그대로 두고 시각만 밀기 때문이다. 그때 전부 재변환하면 30분마다 도는 작업이 코어 하나를 계속 물고 있게 된다.

**삭제는 이 도구가 쓴 파일에만 한다.** 색인 폴더의 파일이라도 이름이 `.md` 로 끝나지 않거나 첫 줄이 frontmatter 울타리가 아니면 손대지 않는다. 운영자가 색인 폴더에 직접 넣은 메모는 그대로 남는다.

## 7. 납품 스택에 붙이기

### 7.1 변수 하나

```bash
# chris-local/ixauth.env
OPENCLAW_NAS_ROOT=/srv/nas              # 부서 공유의 부모 (읽기 전용 마운트)
OPENCLAW_KNOWLEDGE_ROOT=/srv/knowledge  # 색인의 부모 (쓰기 가능, NAS 아님)
```

compose 가 두 쌍을 마운트한다.

```yaml
- ${OPENCLAW_NAS_ROOT:-./nas-sample}/rnd:/mnt/nas/rnd:ro
- ${OPENCLAW_KNOWLEDGE_ROOT:-./knowledge-index}/rnd:/mnt/knowledge/rnd
```

`OPENCLAW_KNOWLEDGE_ROOT` 는 마운트가 호스트의 어디를 가리킬지만 정한다. 그 마운트를 실제로 읽는 것은 에이전트 항목의 `memory.search.extraPaths` 이고, **현재 납품 템플릿에는 그 에이전트가 없다**(에이전트는 `main` 하나뿐이다). 되켜는 순서는 [DEPLOY.md](DEPLOY.md) 3.3-1 이다.

```json
"rnd-bot": {
  "workspace": "/mnt/nas/rnd",
  "memory": { "search": { "extraPaths": ["/mnt/knowledge/rnd"] } },
  "tools": { "profile": "readonly", "permissionMode": "read-only" }
}
```

`extraPaths` 는 전역과 에이전트별 값의 **합집합**이다(`src/agents/memory-search.ts:198-201`). 부서별로만 적고 전역에는 적지 않는 이유가 그것이다. 전역에 적으면 모든 에이전트가 모든 부서 색인을 본다.

### 7.2 첫 색인

```bash
cd chris-local
C="docker compose -f docker-compose.ixauth.yml --env-file ixauth.env"

# 먼저 규모를 본다. 파일 수와 제외 사유를 세어 준다
$C exec gateway openclaw knowledge sync --source /mnt/nas/00_공용폴더   --out /mnt/knowledge/00_공용폴더 --dry-run --json

$C exec gateway openclaw knowledge sync --source /mnt/nas/00_공용폴더   --out /mnt/knowledge/00_공용폴더

# 색인기에 새 파일을 알린다
$C exec gateway openclaw memory index --force --agent main

# 확인
$C exec gateway openclaw memory search "출장 신청서" --agent main
```

`knowledge sync` 는 게이트웨이 RPC 를 쓰지 않는다(폴더를 읽어 폴더에 쓸 뿐이다). 그래서 ix-auth
모드에서 다른 CLI 명령이 인가 때문에 막히는 것과 달리 컨테이너 안에서 그대로 돈다.

`memory index --force` 를 빼면 사이드카가 있어도 검색에 안 잡힌다. **사이드카 생성과 색인은 별개의
단계다.**

#### 진바이오 첫 색인 실측 (2026-09-09, X 단계)

공유 아홉 개를 한꺼번에 색인하면 파일 50만 개다. `00_공용폴더` 하나로 시작해 규모를 재고 나머지
일정을 그 수치로 잡는다.

**계획 단계 (`--dry-run`)**

| 항목 | 값 |
| --- | --- |
| 색인 대상 | **6,298 파일** (원본 합계 6.22 GB) |
| 제외: 확장자 밖 | 32,222 (eml 16,179 · jpg 8,684 · png 2,135 · mp4 967 등) |
| 제외: 숨김 폴더 | 1,523 줄 (폴더당 한 줄. `@eaDir`·`#recycle`·`#경영회의`·`##직원전용`) |
| 제외: 20 MiB 초과 | 194 |
| 제외: 빈 파일 | 1 |
| 계획을 세우는 데 걸린 시간 | 163초 (변환은 하지 않는다) |

**실제 색인** (2026-09-09, 이 보고 시점에 진행 중)

| 항목 | 값 |
| --- | --- |
| 만든 사이드카 | 3,298 / 6,298 (17:11 기준, 45 MB) |
| 사이드카 하나 평균 | 약 15 KB |
| 속도 | 0.5~2.2 개/초. 같은 기계에서 이미지 배포와 질의가 함께 돌면 아래쪽, 색인만 돌면 위쪽이다 |
| 6,298개를 다 만들었을 때 예상 용량 | 약 95 MB (원본 6.22 GB 의 1.5%) |
| 남은 시간 추정 | 30~90분. 끝내지 못하면 그날 밤 크론이 이어서 한다(증분이라 이미 만든 것은 건너뛴다) |

진행 확인:

```bash
sudo $D exec openclaw-ixauth_gateway_1 sh -lc   'find /mnt/knowledge/00_공용폴더 -name "*.md" | wc -l; du -sh /mnt/knowledge/00_공용폴더'
```

**색인이 도는 동안 게이트웨이가 느려진다.** 2코어를 문서 변환이 채우면 관리 화면의 폴더 목록
한 번이 20초 넘게 걸린다(실측). 업무 시간을 피해 새벽에 돌리는 이유가 이것이기도 하다.

**첫 색인에서 드러난 결함 두 가지를 고쳤다. 둘 다 파일 하나가 실행 전체를 끝내는 종류였다.**

| 무엇 | 어디서 멈췄나 | 왜 |
| --- | --- | --- |
| 파워포인트 잠금 파일(`~$이름.pptx`) | 711 / 6,298 | 훑기가 이름을 보고 크기를 재려는 순간 사라져 ENOENT 가 그대로 올라갔다. 제외 사유 `vanished` 로 넘긴다 |
| 암호가 걸린 PDF | 1,163 / 6,298 | 엔진이 답 대신 예외를 던졌다("PDF password is required or incorrect"). PDF 경로에서 받아 `encrypted` 로 보고하고, 그 위에서 변환기 호출 전체를 감싼다 |

**사람이 쓰고 있는 공유에서는 둘 다 평범한 파일이다.** 고친 이미지에서 같은 지점을 지나
3,298개까지 이어진 것을 실측으로 확인했다. 새 변환기를 붙일 때도 같은 규칙을 지킨다.
**파일 하나의 실패는 파일 하나의 실패여야 한다.**

**나머지 공유의 규모 (2026-09-09, 컨테이너 안에서 잰 값)**

컨테이너가 보는 것만 센다. 각 공유의 `보안폴더` 는 NAS ACL 이 막고 있어(NAS-FOLDER-ACL.md 12.1)
그 안은 훑기에도 색인에도 잡히지 않는다. 호스트에서 root 로 세면 훨씬 큰 값이 나오는 이유가 이것이다.

| 공유 | 폴더 | 색인 대상 파일 | 원본 | 20 MiB 초과(제외) | 비고 |
| --- | --- | --- | --- | --- | --- |
| `00_공용폴더` | 2,441 | **6,298** | 6.22 GB | 194 | 첫 색인 대상 |
| `02_최병만` | 479 | 2,308 | 0.34 GB | 4 | hwp 1,258 |
| `03_장혜린` | 1 | 3 | 0 | 0 | 거의 전부 보안폴더 안 |
| `04_김서희` | 189 | 1,014 | 0.10 GB | 0 | xlsx 808 |
| `05_이대훈` | 4,204 | 1,431 | 0.23 GB | 5 | 웹 자산 위주(jpg·php·gif) |
| `06_박정현` | 3,615 | 14,870 | 5.83 GB | 121 | hwp 7,966 · pdf 4,554 |
| `디자인PC` | 8,026 | 2,287 | 3.65 GB | 409 | 파일 99,288개 중 대부분이 이미지 |
| `이영준한의원` | 1 | 0 | 0 | 0 | zip 하나뿐 |
| **합계(색인 대상 8개)** | **18,956** | **28,211** | **16.4 GB** | 733 | |
| `01_이화정` (제외) | 169 | 400 | 0.55 GB | 13 | 관리자 전용. 색인하지 않는다 |

**일정 산정.** 실측 속도 0.5개/초(보수적으로)로 잡으면 파일 수를 이렇게 나눈다.

| 공유 | 색인 대상 | 예상 소요 | 몇 밤 |
| --- | --- | --- | --- |
| `00_공용폴더` | 6,298 | 3~4시간 | 1 |
| `06_박정현` | 14,870 | 8~9시간 | 2 |
| `02_최병만` | 2,308 | 1~2시간 | 같은 밤에 하나 더 |
| `디자인PC` | 2,287 | 1~2시간 | 같은 밤에 하나 더 |
| `05_이대훈` | 1,431 | 1시간 | |
| `04_김서희` | 1,014 | 1시간 | |
| `03_장혜린`·`이영준한의원` | 3 | 즉시 | |
| **합계** | **28,211** | **16~20시간** | **밤 4~5회** |

한 번에 하나씩 늘린다. `nightly-index.sh` 의 `SHARES` 에 공유를 하나 더하고 그 다음 날 로그로
결과를 본 뒤 다음 공유를 더한다. 두 번째 밤부터는 이미 만든 사이드카를 건너뛰므로(크기·시각이
같으면 원본을 읽지도 않는다) 새 문서만 변환한다.

**용량은 제약이 아니다.** 사이드카는 원본의 약 1.6% 이고 8개 공유 전부라도 300 MB 를 넘지 않는다.
`/volume1` 여유는 2.9 TB 다. **제약은 시간과 CPU** 이며, 그래서 업무 시간을 피한다.

### 7.3 주기 실행

**납품 스택에서는 호스트의 일정 관리가 이 명령을 부른다.** 게이트웨이 cron 자체는 셸 명령 잡을
지원하지만(`--command` 는 `sh -lc` 로 돈다), ix-auth 모드에서 컨테이너 안 CLI 는 게이트웨이 RPC
인가가 없어 **등록 자체가 막힌다.** 실측(2026-09-08)에서 아래가 그대로 재현된다.

```bash
$C exec gateway openclaw cron add --name knowledge-sync --every 30m --command "..."
# {"ok":false,"error":{"type":"cli_error","message":"unauthorized"}}
```

`knowledge sync` 자체는 RPC 를 쓰지 않아 같은 컨테이너에서 잘 돈다. 막히는 것은 cron **등록**뿐이다.

**진바이오 배치(DSM 6, systemd 없음)는 `/etc/crontab` 한 줄 + 스크립트 하나다.** 정본은
`chris-local/nas/nightly-index.sh` 이고 절차는 [DEPLOY.md](DEPLOY.md) 12.3 이다. 스크립트가
`folders scan` -> `knowledge sync` -> `memory index` 를 순서대로 돌리고, `deploy.sh` 와 같은
`mkdir` 잠금·로그 회전 규칙을 쓴다.

```
20	3	*	*	*	root	/volume1/docker/openclaw/nightly-index.sh
```

**주기를 30분이 아니라 하루 한 번으로 잡았다.** 기준은 두 가지가 부딪힌다. 사람이 문서를 올린 뒤
몇 분 안에 찾히길 바라는가, 그리고 그동안 NAS 가 얼마나 느려져도 되는가. 이 배치의 NAS 는 2코어
DS218+ 이고 낮에는 회사의 파일 서버다. 문서 변환은 코어를 오래 물고 있어 업무 시간에 돌리면 사람이
파일을 여는 속도가 같이 느려진다. 그래서 업무 시간을 피해 새벽에 한 번 돌리고, 새 문서는 다음 날
아침부터 검색된다. 급하면 손으로 한 번 돌린다.

systemd 가 있는 호스트라면 타이머가 더 낫다.

```ini
# /etc/systemd/system/openclaw-knowledge.service  (Type=oneshot)
ExecStart=/usr/bin/docker compose -f docker-compose.ixauth.yml --env-file ixauth.env exec -T gateway   sh -lc 'openclaw knowledge sync --source /mnt/nas/rnd --out /mnt/knowledge/rnd && openclaw memory index --force --agent main'
```

```ini
# /etc/systemd/system/openclaw-knowledge.timer
[Timer]
OnCalendar=*-*-* 03:20:00
```

### 7.4 임베딩 없이 색인한다

납품 템플릿은 `memory.search.provider` 를 `"none"` 으로 둔다. 기본값은 `openai` 이고, 그 경우
`memory index` 가 문서 조각마다 임베딩 API 를 부른다. 외부 키가 없는 사내 배포에서는 색인이
통째로 실패한다. 실측(2026-09-08)에서 다음이 그대로 나왔다.

```text
Memory index failed (rnd-bot): openai embeddings failed: 429 ... credit_balance_exhausted
```

`"none"` 은 내장 FTS 만 쓰는 값이다. 한국어가 검색되는 것은 같은 절에 이미 있던
`memory.search.store.fts.tokenizer: "trigram"` 덕분이고, 이 두 값이 짝이다. 트라이그램은 형태소
분석 없이 세 글자씩 잘라 색인하므로 "에탄올 재고" 같은 질의가 조사·띄어쓰기와 무관하게 걸린다.

의미 검색이 필요하면 사내 ollama 임베딩 모델을 붙이고 그때 `provider` 를 바꾼다. 외부 API 키를
쓰는 선택은 문서가 외부로 나간다는 뜻이므로 납품 기본값으로 두지 않는다.

## 8. 한계

| 항목                | 상태                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| hwp / hwpx          | **지원한다**(S 단계, 기본 `--include` 에 들어 있다). 서식·그림은 남지 않는다. 표는 rhwp 경로에서만 표로 남는다 |
| rhwp 가 없는 설치   | 내장 리더만 돈다. 색인은 되지만 표 구조가 사라진다. `converter` 값이 `hwp-text` 면 그 경우다                   |
| 암호·배포용 hwp     | 읽지 못한다. `failed/encrypted` · `failed/distribution` 으로 사유가 따로 잡힌다                                |
| HWP 3.0             | 읽지 못한다. `failed/legacy-format`. 실측 표본에는 없었다                                                      |
| 이미지 속 글자      | 추출하지 않는다. OCR 이 없으므로 스캔 pdf 는 `ignored/empty` 로 남는다                                         |
| 20 MiB 초과 파일    | 건너뛴다. 상한을 올려도 40 MiB 에서 변환기가 거부한다                                                          |
| 신선도              | 동기 주기만큼 늦는다. 파일 감시가 아니라 주기 실행이다                                                         |
| 표의 구조           | 병합 셀·수식·차트는 남지 않는다. 셀 텍스트만 남는다                                                            |
| xlsx 의 서식        | 통화·백분율·자릿수 서식은 적용하지 않는다. 날짜만 서식을 읽어 변환한다(K 단계, 아래)                           |
| pdf 경유 텍스트     | pdf 텍스트 층을 그대로 읽어 "2026 년" 처럼 벌어진다. trigram 토크나이저라 검색에는 지장이 없다                 |
| xlsx 폴백 상한      | 시트 12개, 시트당 300행, 행당 40열. 넘으면 잘림 안내가 붙는다(`document-extract-html.ts`)                      |
| 사이드카 이름       | `보고.pdf` -> `보고.pdf.md`. 인용 경로에 확장자가 두 번 보인다                                                 |
| 권한                | 색인 폴더에 들어간 내용은 그 폴더를 `extraPaths` 로 가진 에이전트가 전부 본다. 부서 분리는 폴더 분리로만       |
| NAS ACL 과의 동기화 | 없다. 원본 폴더 권한이 바뀌어도 이미 만들어진 사이드카는 남는다. 지우려면 원본을 옮기고 다시 돌린다            |

마지막 줄이 중요하다. **색인 폴더는 원본 폴더의 권한을 물려받지 않는다.** 어떤 문서가 더는 그 부서에 보이면 안 된다면, 원본을 공유에서 빼고 `knowledge sync` 를 한 번 더 돌려 사이드카를 지워야 한다.

## 8-1. 폴더 접근권한 규칙과의 관계 (2026-09-09, V 단계)

관리 화면(`/settings/folders`)의 폴더 규칙이 색인에도 걸린다. 정본은 [NAS-FOLDER-ACL.md](NAS-FOLDER-ACL.md) 13.2 이고, 여기에는 운영자가 알아야 할 것만 적는다.

### 규칙 한 줄

**규칙이 누군가에게 열어 준 폴더만 색인한다. 아무도 못 보는 폴더는 이름도 읽지 않는다.**

### 왜 "사람" 이 아니라 "폴더" 로 판정하나

색인을 도는 것은 사람이 아니라 CLI 와 크론이다. 요청자 신원이 없고, 만들어진 사이드카는 메모리 검색이 읽는 공용 풀 하나에 쌓이며, 그 풀에서 나갈 때 사람별 필터가 걸리지 않는다. 그래서 그 시점에 성립하는 문장은 하나뿐이다. "이 폴더를 볼 수 있는 주체가 하나라도 있는가."

덤으로 셋이 따라온다.

- **비용**: 실측 트리가 37,356 폴더다. 걷고 나서 거르면 숨김 폴더의 파일 이름을 전부 읽고 버린다. 걷기를 자르면 그 비용이 0 이다.
- **회수**: 걷지 않은 폴더의 파일은 "원본을 못 찾은 사이드카" 가 되어 기존 고아 정리가 지운다. 나중에 숨김이 된 폴더의 사이드카는 다음 동기에서 저절로 사라진다.
- **보고서**: 숨김 폴더는 파일마다가 아니라 폴더당 한 줄(`ignored / folder-hidden`)로만 남는다. 폴더 안에 무엇이 있었는지는 보고서에도 남지 않는다.

### 언제 켜지나

| 조건 | 결과 |
| --- | --- |
| `/mnt/nas` 가 이 컨테이너에 없다 | 규칙 미적용(종전대로) |
| `--source` 가 `/mnt/nas` 밖이다 | 규칙 미적용 |
| 규칙 표가 그 공유를 한 번도 언급하지 않았다 | 규칙 미적용 |
| 그 공유·하위·상속되는 조상에 규칙이 하나라도 있다 | **규칙 적용.** 그 안의 기본값은 숨김 |
| `--no-folder-rules` 를 줬다 | 이번 실행만 미적용 |

세 번째 줄이 안전장치다. 규칙이 한 번도 언급하지 않은 공유는 "아직 설명되지 않은" 것이지 "전부 비밀" 이 아니다. 그렇게 읽으면 운영자가 손대지도 않은 공유의 색인이 첫 규칙 하나에 통째로 비워진다.

**반대로, 어떤 공유에 규칙을 처음 하나 쓰는 순간 그 공유의 색인 범위가 규칙이 있는 곳으로 좁아진다.** 규칙을 처음 걸 때는 `--dry-run` 으로 무엇이 빠지는지 먼저 본다.

```bash
$C exec gateway openclaw knowledge sync   --source /mnt/nas/00_공용폴더 --out /mnt/knowledge/gongyong --dry-run --verbose
```

### 부수 효과

`#recycle`(휴지통)·`@eaDir`(Synology 색인)·`@tmp` 는 판정 모듈이 이미 숨김으로 답한다. 규칙이 걸린 공유에서는 색인에서도 빠진다. 그전에는 색인되고 있었다.

### 여전히 남는 구멍

한 부서에 열어 준 폴더와 다른 부서에 열어 준 폴더가 같은 색인 풀에 들어간다. **색인 자체는 부서 경계가 아니다.** 부서를 나누려면 색인 폴더를 나누고 에이전트마다 `extraPaths` 를 달리 준다(7절). 도구 계층에서 닫는 것은 폴더 권한 3단계다.

## 8-2. NAS 자체 색인(Universal Search)을 쓸 수 있나 (2026-09-09 조사)

사용자 질문: "인덱싱이 NAS 에도 되어 있지 않아? NAS 인덱싱을 이용하면 어때?"

**답: 쓰지 않는다.** 조사 결과와 근거를 남긴다. 읽기 전용으로만 조사했고 NAS 설정은 한 줄도
바꾸지 않았다.

### 무엇이 돌고 있나

| 항목 | 값 |
| --- | --- |
| 패키지 | **SynoFinder 1.5.2-0323** (Universal Search). `synopkg status` = started |
| 데몬 | `synoelasticd`(PID 상주, 누적 CPU 1시간 17분) · `fileindexd` · `synoindexd`(미디어) |
| 색인 대상 공유 8개 | `00_공용폴더` `01_이화정` `02_최병만` `03_장혜린` `04_김서희` `05_이대훈` `06_박정현` `디자인PC` (`이영준한의원` 만 빠져 있다) |
| 대상 종류 | 설정에 `document`·`photo`·`video`·`audio` 가 모두 `true` |
| 상태 | `fileindex -a is_idle` = `yes` (밀린 작업 없음). 로그가 실시간으로 갱신된다 |
| 갱신 방식 | 파일 이벤트 감시(`synotifyd_event_mask`)라 사실상 실시간이다 |

**즉 NAS 는 이미 문서 본문까지 색인하고 있다.** 그런데도 쓰지 않는 이유는 아래 셋이다.

### (가) 폴더 트리에 쓸 수 있나 - 쓸 이유가 없다

색인에 디렉터리 항목도 들어 있다(`00_공용폴더` 색인에 3,189개). 그러나 우리 훑기는 공유 11개
19,136 폴더를 **17.5초**에 끝낸다([NAS-FOLDER-ACL.md](NAS-FOLDER-ACL.md) 14.7). 남의 색인을
읽으려고 접근 경로와 권한을 새로 만들 만한 이득이 없다.

### (나) 문서 본문에 쓸 수 있나 - **못 쓴다**

`00_공용폴더` 색인 전체를 덤프해(24,655 문서) 확장자별로 본문 필드(`SYNOMDTextContent`) 길이를
쟀다.

| 확장자 | 색인된 문서 | 본문 필드 있음 | 본문 길이 중앙값 | 상위 10% | 최대 |
| --- | --- | --- | --- | --- | --- |
| pdf | 1,609 | 1,608 | **59자** | 2,448자 | 39,557자 |
| xlsx | 1,311 | 1,311 | **0자** | 5,202자 | 182,171자 |
| docx | 831 | 831 | **0자** | 664자 | 43,220자 |
| **hwp** | 685 | **55 (8%)** | 975자 | 2,769자 | 7,526자 |
| pptx | 251 | 251 | 0자 | 2,416자 | 100,097자 |

세 가지가 걸린다.

1. **본문이 대부분 비어 있다.** 중앙값이 0~59자다. 절반이 넘는 문서에서 본문이 사실상 없고,
   있는 것도 앞부분만 남은 경우가 많다. 우리 사이드카는 문서 하나에 평균 **16 KB** 의 본문을
   쪽 표시(`## p.N`)와 표까지 살려 담는다.
2. **한글(hwp) 이 8% 다.** 이 회사 문서의 큰 축이 hwp 인데(00_공용폴더 808개, 06_박정현 7,966개)
   NAS 색인은 그중 55개에서만 본문을 얻었다. 우리는 rhwp + 내장 리더로 전부 읽는다(5절).
3. **파일 수도 다르다.** 우리가 보는 pdf 3,024개 중 색인에는 1,609개만 있다.

### (다) 권한 경계 - 다시 걸러야 한다

NAS 색인은 우리 앱의 폴더 규칙을 모른다. `01_이화정` 도 본문까지 색인돼 있다(검색 실측으로
확인). 그 결과를 그대로 쓰면 관리자만 봐야 할 폴더가 비서의 답변으로 새어 나간다. 즉 NAS 색인을
쓰더라도 **우리 규칙으로 한 번 더 걸러야** 하므로, 규칙 판정을 없앨 수 있는 것도 아니다.

> **운영에 알려 둘 것**: 이것은 우리 앱과 무관하게 **DSM 의 Universal Search 가 이미 하고 있는
> 일**이다. NAS 에 계정이 있고 그 공유에 접근권이 있는 사람은 DSM 검색으로 `01_이화정` 의 문서
> 본문을 찾을 수 있다. 그것을 막으려면 DSM 의 색인 설정에서 그 공유를 빼야 하고, 그것은 NAS
> 관리자의 결정이다(우리는 설정을 바꾸지 않았다).

### 접근 방법도 좁다

| 경로 | 가능한가 |
| --- | --- |
| 호스트 CLI `synoelastic -a search/dump` | **된다.** 다만 root 권한이 필요하고 NAS 호스트에서만 돈다. 게이트웨이 컨테이너에서는 부를 수 없다 |
| DSM 웹 API `SYNO.Finder.FileIndexing.Search` | API 는 존재한다. 그러나 로그인이 필요하고 관리자 계정은 2단계 인증이라 `SYNO.API.Auth` 가 403 을 낸다. 쓰려면 전용 DSM 계정을 새로 만들어야 하고, 결과는 그 계정의 NAS 권한으로 걸러진다 |
| 색인 파일 직접 읽기 | Lucene 계열 자체 포맷이고 `SynoFinder` 사용자 소유다. 컨테이너의 `openclaw-ro` 그룹으로는 읽히지 않는다 |

### 결론

**우리 사이드카 색인을 그대로 간다.** NAS 색인은 "파일을 이름으로 찾는" 용도로는 이미 충분히
좋고 사람이 DSM 에서 그렇게 쓰면 된다. 우리가 필요한 것은 **문서 본문 전체**이고, 그것은 NAS
색인에 없다. 이 조사 때문에 설계를 바꾸지 않았다.

## 9. 되돌리기

```bash
# 색인만 비우기 (원본은 그대로다)
rm -rf /srv/knowledge/rnd/*
docker compose ... exec gateway openclaw memory index --force --agent rnd-bot
```

기능 전체를 끄려면 `.env` 의 `OPENCLAW_KNOWLEDGE_ROOT` 를 비우고 재기동한다. 그러면 `extraPaths` 가 빈 목록으로 렌더링되고, 에이전트는 자기 메모리만 검색한다. 색인 폴더는 남지만 아무도 읽지 않는다.

## 10. 코드 위치

| 파일                                     | 역할                                                 |
| ---------------------------------------- | ---------------------------------------------------- |
| `src/knowledge/types.ts`                 | 요약·frontmatter·기본값 계약                         |
| `src/knowledge/sidecar.ts`               | 사이드카 이름, frontmatter 쓰기·읽기, 경로 안전 검사 |
| `src/knowledge/plan.ts`                  | 공유 훑기, 자격 판정, 고아 사이드카 찾기             |
| `src/knowledge/folder-rule-filter.ts`    | 폴더 접근권한 규칙을 색인 시점 판정으로 바꾼다       |
| `src/knowledge/convert.ts`               | 확장자별 변환기 선택                                 |
| `src/gateway/document-cfb.ts`            | OLE2 복합 파일 리더 (hwp 컨테이너)                   |
| `src/gateway/document-extract-hangul.ts` | hwp 5.0 · hwpx 본문 추출                             |
| `src/knowledge/convert-pdf.ts`           | 페이지별 pdf 텍스트 (`## p.N`)                       |
| `src/knowledge/html-markdown.ts`         | 미리보기 HTML -> 마크다운                            |
| `src/knowledge/sync.ts`                  | 증분 판정과 실행                                     |
| `src/commands/knowledge.ts`              | 표·집계·JSON 출력                                    |
| `src/cli/program/register.knowledge.ts`  | `openclaw knowledge sync` 등록                       |

재사용한 자산은 `src/gateway/document-convert.ts`(soffice), `src/gateway/document-extract-html.ts`(OOXML), 루트 의존성 `clawpdf`·`jszip`·`iconv-lite` 뿐이고 **새 npm 의존성은 0개**다.
