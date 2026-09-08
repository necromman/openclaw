#!/usr/bin/env python3
"""PreToolUse guard: this fork works on chris/main only (user decision 2026-09-08).

Blocks Bash commands that create branches or worktrees, and WSL-side verification
runs (pnpm check / vitest / pnpm format) that the project no longer uses.
"""
import json
import re
import sys

try:
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    payload = json.load(sys.stdin)
except Exception:
    sys.exit(0)

if payload.get("tool_name") not in ("Bash", "PowerShell"):
    sys.exit(0)

cmd = (payload.get("tool_input") or {}).get("command") or ""
if not cmd:
    sys.exit(0)

RULES = [
    (r"\bgit\s+worktree\b", "git worktree 는 이 프로젝트에서 금지다."),
    (r"\bgit\s+checkout\s+(-b|-B|--orphan)\b", "브랜치 생성 금지. chris/main 에서 직접 작업한다."),
    (r"\bgit\s+switch\s+(-c|-C|--orphan)\b", "브랜치 생성 금지. chris/main 에서 직접 작업한다."),
    (r"\bgit\s+branch\s+(?!-[dD]\b|--delete\b|--list\b|--show-current\b|-a\b|-r\b|-v\b|-vv\b|--contains\b|--merged\b|--no-merged\b)[A-Za-z0-9_./-]+", "브랜치 생성 금지. chris/main 에서 직접 작업한다."),
    (r"\bwsl(\.exe)?\b.*\b(pnpm\s+(check|test|format|vitest)|vitest)\b", "WSL 검증은 폐지됐다. 검증은 GitHub Actions + 운영(jinbio.botops.cloud) 실측으로 한다."),
    (r"\bwsl(\.exe)?\b.*\bgit\s+checkout\b", "WSL 체크아웃을 브랜치로 옮기지 않는다. WSL 은 자동 배포 전용이다."),
]

for pattern, reason in RULES:
    if re.search(pattern, cmd):
        print(
            "[main-only-guard] 차단: " + reason
            + " (사용자 확정 2026-09-08, CLAUDE.md 4절). 명령: " + cmd[:200],
            file=sys.stderr,
        )
        sys.exit(2)

sys.exit(0)
