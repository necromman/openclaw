"""권한 코드 매칭 — 계약 docs/contract/authz.md §2.

서버의 ``PermissionMatcher.java`` (ix-auth-common), ``@ix-auth/client-node``,
``@ix-auth/client-react`` 와 **같은 규칙**이어야 한다.
규칙이 갈리면 "화면에는 보이는데 API 는 403" 같은 일이 난다.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

_SEGMENT = re.compile(r"[./]")
_ANY = "*"
_ANY_DEEP = "**"


def matches(pattern: str, required: str) -> bool:
    """패턴이 요청 코드를 덮는가."""
    p = (pattern or "").split(":")
    r = (required or "").split(":")
    if len(p) != 3 or len(r) != 3:
        return False
    return all(_part_matches(p[i], r[i]) for i in range(3))


def _part_matches(pattern: str, value: str) -> bool:
    if pattern in (_ANY, _ANY_DEEP):
        return True

    p = _SEGMENT.split(pattern)
    v = _SEGMENT.split(value)

    for i, seg in enumerate(p):
        if seg == _ANY_DEEP:
            return len(v) > i          # 남은 세그먼트 전부 (최소 1개)
        if i >= len(v):
            return False
        if seg != _ANY and seg != v[i]:
            return False
    # 패턴을 다 썼는데 값이 남으면 불일치 — page:admin.* 는 page:admin.users.detail 을 덮지 않는다
    return len(p) == len(v)


def any_matches(granted: Iterable[str] | None, required: str) -> bool:
    """부여된 권한 중 하나라도 걸리면 허용."""
    if not granted:
        return False
    return any(matches(g, required) for g in granted)


def validate_code(code: str) -> None:
    """코드 문법 검증 — 서버 등록 전에 앱에서 미리 거를 때.

    ``**`` 가 중간에 오는 패턴(``a.**.c``)은 지원하지 않는다 (계약 §8).
    """
    parts = (code or "").split(":")
    if len(parts) != 3:
        raise ValueError(f"권한 코드는 '<domain>:<resource>:<action>' 3파트여야 합니다: {code}")
    for part in parts:
        segs = _SEGMENT.split(part)
        for i, seg in enumerate(segs):
            if seg == "":
                raise ValueError(f"빈 세그먼트가 있습니다: {code}")
            if seg == _ANY_DEEP and i != len(segs) - 1:
                raise ValueError(f"'**' 는 마지막 세그먼트에만 올 수 있습니다: {code}")
