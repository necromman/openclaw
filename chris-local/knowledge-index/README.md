# knowledge-index

`openclaw knowledge sync` 가 만드는 마크다운 사이드카가 쌓이는 자리다. 이 폴더는 `chris-local/nas-sample`
과 짝을 이루는 **기본값 전용**이라, `OPENCLAW_KNOWLEDGE_ROOT` 를 비워 둔 채로 배선을 확인할 때만 쓴다.
실제 납품에서는 그 변수에 호스트 절대 경로(예: `/srv/knowledge`)를 넣고 이 폴더는 쓰이지 않는다.

`rnd/`·`qa/` 두 칸은 compose 가 `/mnt/knowledge/rnd`·`/mnt/knowledge/qa` 로 쓰기 가능하게 마운트한다.
생성된 사이드카는 추적하지 않는다(`.gitignore`). 절차는 [../KNOWLEDGE.md](../KNOWLEDGE.md).
