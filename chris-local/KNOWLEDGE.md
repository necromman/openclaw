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

| 옵션                   | 기본값                        | 뜻                                                          |
| ---------------------- | ----------------------------- | ----------------------------------------------------------- |
| `--source <dir>`       | (필수)                        | 읽을 문서 폴더. 절대 쓰지 않는다                            |
| `--out <dir>`          | (필수)                        | 사이드카를 쓸 색인 폴더. `--source` 안이면 거부              |
| `--include <목록>`     | `pdf,docx,xlsx,pptx,md,txt`   | 쉼표로 구분한 확장자. 목록 밖은 건너뛴다                    |
| `--max-bytes <n>`      | `20971520` (20 MiB)           | 이보다 큰 원본은 건너뛴다. 상한 40 MiB                      |
| `--concurrency <n>`    | `2`                           | 동시 변환 수. 상한 8. LibreOffice 가 변환마다 프로세스를 뜬다 |
| `--dry-run`            | 꺼짐                          | 변환·쓰기·삭제를 하지 않고 계획만 낸다                      |
| `--verbose`            | 꺼짐                          | 건너뛴 파일까지 표에 넣는다                                 |
| `--json`               | 꺼짐                          | 요약 객체를 그대로 출력한다                                 |

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
  "include": ["docx", "md", "pdf", "pptx", "txt", "xlsx"],
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

| 품목 | 수량 | 보관 위치 |
| --- | --- | --- |
| 에탄올 99.5% | 12병 | A-1 시약장 |
```

`> 원본:` 한 줄이 frontmatter 바로 아래 있는 것은 장식이 아니다. 인용은 `경로#L12-L30` 형태로 **사이드카의 줄 범위**를 가리키므로(`extensions/memory-core/src/tools.citations.ts`), 답변에 딸려 나오는 스니펫 안에 원본 경로가 같이 있어야 사람이 실제 파일을 찾아갈 수 있다. 인용 장식 코드는 건드리지 않았다.

## 5. 형식별 변환기

| 원본                        | 경로                                             | `converter` 값     | 결과                                    |
| --------------------------- | ------------------------------------------------ | ------------------ | --------------------------------------- |
| `pdf`                       | `clawpdf` 로 페이지별 텍스트                     | `pdf-text`         | 페이지마다 `## p.N` 제목                |
| `docx`                      | `document-extract-html.ts` (jszip, 의존성 0)     | `docx-html`        | 제목 단계·글머리표·표를 마크다운 표로   |
| `xlsx`                      | 같은 모듈                                        | `xlsx-html`        | 시트마다 `## 시트명` + 마크다운 표      |
| `pptx` `doc` `xls` `ppt` 등 | `document-convert.ts` (soffice) -> pdf -> 텍스트 | `soffice-pdf-text` | 슬라이드·페이지마다 `## p.N`            |
| `md` `txt` `csv`            | 디코딩 후 복사                                   | `copy`             | 본문 그대로                             |

**페이지 제목이 요점이다.** 인용이 사이드카의 줄 번호를 주므로, 그 줄 바로 위의 `## p.7` 이 "원본 7쪽" 이라는 뜻이 된다. 문서를 한 덩어리로 뽑으면 그 정보가 사라진다.

**docx·xlsx 는 LibreOffice 없이도 된다.** 미리보기용으로 이미 있는 무의존 OOXML 리더를 재사용하고, 그 리더가 못 여는 파일만 LibreOffice 로 넘긴다. pptx 는 처음부터 LibreOffice 경로다.

**한글 인코딩.** `.txt` 를 UTF-8 로 엄격 디코딩해 보고, 실패하면 CP949 로 다시 읽는다. 관대한 디코딩은 오류 없이 물음표만 남기고, 그 사이드카는 어떤 질의에도 걸리지 않는다. 실패를 분기로 바꾸려고 엄격 모드를 쓴다.

## 6. 두 번째 실행부터 무엇이 일어나는가

| 상태                              | 판정      | 하는 일                                |
| --------------------------------- | --------- | -------------------------------------- |
| 크기·수정시각·경로가 기록과 같다  | `skipped` | 원본을 읽지도 않는다                   |
| 시각은 변했는데 해시가 같다       | `skipped` | frontmatter 의 시각만 갱신(본문 그대로) |
| 해시가 다르다                     | `updated` | 다시 변환해 덮어쓴다                   |
| 색인에 없던 원본                  | `created` | 변환해 새로 쓴다                       |
| 원본이 사라졌다                   | `deleted` | 사이드카를 지우고 빈 폴더를 정리한다   |
| 확장자 밖 / 상한 초과 / 심링크    | `ignored` | 아무것도 쓰지 않는다                   |
| 변환기 없음 / 변환 실패 / 읽기 실패 | `failed`  | 이전 사이드카를 남겨 둔다              |

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

`OPENCLAW_KNOWLEDGE_ROOT` 가 비어 있지 않으면 `start-gateway.sh` 가 부서 에이전트의 `memory.search.extraPaths` 를 그 마운트로 렌더링한다. 비어 있으면 빈 목록이라 이 기능이 없던 때와 똑같이 동작한다.

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

$C exec gateway openclaw knowledge sync --source /mnt/nas/rnd --out /mnt/knowledge/rnd
$C exec gateway openclaw knowledge sync --source /mnt/nas/qa  --out /mnt/knowledge/qa

# 색인기에 새 파일을 알린다
$C exec gateway openclaw memory index --force --agent rnd-bot
$C exec gateway openclaw memory index --force --agent qa-bot

# 확인
$C exec gateway openclaw memory search "에탄올 재고" --agent rnd-bot
```

`knowledge sync` 는 게이트웨이 RPC 를 쓰지 않는다(폴더를 읽어 폴더에 쓸 뿐이다). 그래서 ix-auth 모드에서 다른 CLI 명령이 인가 때문에 막히는 것과 달리 컨테이너 안에서 그대로 돈다.

`memory index --force` 를 빼면 사이드카가 있어도 검색에 안 잡힌다. **사이드카 생성과 색인은 별개의 단계다.**

### 7.3 주기 실행

**납품 스택에서는 호스트 systemd 타이머를 쓴다.** 게이트웨이 cron 자체는 셸 명령 잡을 지원하지만
(`--command` 는 `sh -lc` 로 돈다), ix-auth 모드에서 컨테이너 안 CLI 는 게이트웨이 RPC 인가가 없어
등록 자체가 막힌다. 실측(2026-09-08)에서 아래가 그대로 재현된다.

```bash
$C exec gateway openclaw cron add --name knowledge-sync-rnd --every 30m --command "..."
# {"ok":false,"error":{"type":"cli_error","message":"unauthorized"}}
```

`knowledge sync` 자체는 RPC 를 쓰지 않아 같은 컨테이너에서 잘 돈다. 막히는 것은 cron **등록**뿐이다.
인가가 있는 세션(관리자 화면)에서 만드는 길도 있지만, 절차서에 남길 것은 사람 손이 필요 없는 쪽이라
타이머를 정본으로 둔다. ix-auth 를 쓰지 않는 설치에서는 위 `cron add` 가 그대로 동작한다.

호스트에서는 systemd 타이머가 같은 일을 한다.

```ini
# /etc/systemd/system/openclaw-knowledge.service
[Unit]
Description=Knowledge sidecar sync

[Service]
Type=oneshot
WorkingDirectory=/opt/openclaw/chris-local
ExecStart=/usr/bin/docker compose -f docker-compose.ixauth.yml --env-file ixauth.env exec -T gateway \
  sh -lc 'openclaw knowledge sync --source /mnt/nas/rnd --out /mnt/knowledge/rnd && openclaw memory index --force --agent rnd-bot'
```

```ini
# /etc/systemd/system/openclaw-knowledge.timer
[Unit]
Description=Run knowledge sidecar sync every 30 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=30min

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl enable --now openclaw-knowledge.timer
systemctl list-timers openclaw-knowledge.timer
```

주기를 정할 때 기준은 **사람이 문서를 올린 뒤 몇 분 안에 찾히길 바라는가**다. 30분이면 최악의 경우 30분 늦는다. 공유가 크면 첫 실행만 오래 걸리고 이후에는 바뀐 파일만 변환한다.

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

| 항목                     | 상태                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| hwp / hwpx               | **지원하지 않는다.** 사용자 확정 사항이고 변환기도 없다. `ignored/extension` 으로 집계된다               |
| 이미지 속 글자           | 추출하지 않는다. OCR 이 없으므로 스캔 pdf 는 `ignored/empty` 로 남는다                                   |
| 20 MiB 초과 파일         | 건너뛴다. 상한을 올려도 40 MiB 에서 변환기가 거부한다                                                    |
| 신선도                   | 동기 주기만큼 늦는다. 파일 감시가 아니라 주기 실행이다                                                   |
| 표의 구조                | 병합 셀·수식·차트는 남지 않는다. 셀 텍스트만 남는다                                                     |
| xlsx 의 날짜·서식        | 서식을 적용하지 않아 날짜가 일련번호로 남는다(2026-09-01 -> 46266). 날짜로는 검색되지 않는다             |
| pdf 경유 텍스트          | pdf 텍스트 층을 그대로 읽어 "2026 년" 처럼 벌어진다. trigram 토크나이저라 검색에는 지장이 없다          |
| xlsx 폴백 상한           | 시트 12개, 시트당 300행, 행당 40열. 넘으면 잘림 안내가 붙는다(`document-extract-html.ts`)                |
| 사이드카 이름            | `보고.pdf` -> `보고.pdf.md`. 인용 경로에 확장자가 두 번 보인다                                          |
| 권한                     | 색인 폴더에 들어간 내용은 그 폴더를 `extraPaths` 로 가진 에이전트가 전부 본다. 부서 분리는 폴더 분리로만 |
| NAS ACL 과의 동기화      | 없다. 원본 폴더 권한이 바뀌어도 이미 만들어진 사이드카는 남는다. 지우려면 원본을 옮기고 다시 돌린다      |

마지막 줄이 중요하다. **색인 폴더는 원본 폴더의 권한을 물려받지 않는다.** 어떤 문서가 더는 그 부서에 보이면 안 된다면, 원본을 공유에서 빼고 `knowledge sync` 를 한 번 더 돌려 사이드카를 지워야 한다.

## 9. 되돌리기

```bash
# 색인만 비우기 (원본은 그대로다)
rm -rf /srv/knowledge/rnd/*
docker compose ... exec gateway openclaw memory index --force --agent rnd-bot
```

기능 전체를 끄려면 `.env` 의 `OPENCLAW_KNOWLEDGE_ROOT` 를 비우고 재기동한다. 그러면 `extraPaths` 가 빈 목록으로 렌더링되고, 에이전트는 자기 메모리만 검색한다. 색인 폴더는 남지만 아무도 읽지 않는다.

## 10. 코드 위치

| 파일                                | 역할                                                    |
| ----------------------------------- | ------------------------------------------------------- |
| `src/knowledge/types.ts`            | 요약·frontmatter·기본값 계약                            |
| `src/knowledge/sidecar.ts`          | 사이드카 이름, frontmatter 쓰기·읽기, 경로 안전 검사    |
| `src/knowledge/plan.ts`             | 공유 훑기, 자격 판정, 고아 사이드카 찾기                |
| `src/knowledge/convert.ts`          | 확장자별 변환기 선택                                    |
| `src/knowledge/convert-pdf.ts`      | 페이지별 pdf 텍스트 (`## p.N`)                          |
| `src/knowledge/html-markdown.ts`    | 미리보기 HTML -> 마크다운                               |
| `src/knowledge/sync.ts`             | 증분 판정과 실행                                        |
| `src/commands/knowledge.ts`         | 표·집계·JSON 출력                                       |
| `src/cli/program/register.knowledge.ts` | `openclaw knowledge sync` 등록                       |

재사용한 자산은 `src/gateway/document-convert.ts`(soffice), `src/gateway/document-extract-html.ts`(OOXML), 루트 의존성 `clawpdf`·`jszip`·`iconv-lite` 뿐이고 **새 npm 의존성은 0개**다.
