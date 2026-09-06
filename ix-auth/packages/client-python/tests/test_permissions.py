"""권한 매칭 — 계약 authz.md §2 의 예시를 그대로 고정한다.

Java(``PermissionMatcher.java``)·JS(``permissions.js``) 판과 **같은 케이스**를 쓴다.
셋 중 하나라도 어긋나면 앱과 jar 의 판정이 갈린다.
"""

import pytest

from ix_auth_client.permissions import any_matches, matches, validate_code


@pytest.mark.parametrize(
    ("pattern", "required", "expected"),
    [
        # 계약 문서에 명시된 예시
        ("page:*:view", "page:admin.users:view", True),
        ("page:admin.*:view", "page:admin.users:view", True),
        ("page:admin.*:view", "page:admin.users.detail:view", False),
        ("page:admin.**:view", "page:admin.users.detail:view", True),
        ("file:contracts/**:download", "file:contracts/2026/a.pdf:download", True),
        ("*:*:*", "page:admin.users:view", True),
        # 경계
        ("page:admin.users:view", "page:admin.users:view", True),
        ("page:admin.users:view", "page:admin.users:edit", False),
        ("page:admin.users:*", "page:admin.users:edit", True),
        ("board:notice:write", "board:notice:read", False),
        ("file:contracts/**:download", "file:public/a.pdf:download", False),
        # '**' 는 최소 한 세그먼트를 요구한다
        ("page:admin.**:view", "page:admin:view", False),
        # 3파트가 아니면 매칭 자체가 실패
        ("page:view", "page:admin:view", False),
    ],
)
def test_matches(pattern: str, required: str, expected: bool) -> None:
    assert matches(pattern, required) is expected


def test_any_matches() -> None:
    granted = ["board:notice:read", "page:admin.**:view"]
    assert any_matches(granted, "page:admin.users:view") is True
    assert any_matches(granted, "page:admin.users:edit") is False
    assert any_matches([], "page:x:view") is False
    assert any_matches(None, "page:x:view") is False


def test_validate_rejects_middle_double_star() -> None:
    with pytest.raises(ValueError, match="마지막 세그먼트"):
        validate_code("page:a.**.c:view")


def test_validate_rejects_malformed() -> None:
    with pytest.raises(ValueError, match="3파트"):
        validate_code("page:view")
    with pytest.raises(ValueError, match="빈 세그먼트"):
        validate_code("page:a..c:view")


def test_validate_accepts_valid() -> None:
    validate_code("page:admin.users:view")
    validate_code("file:contracts/**:download")
    validate_code("*:*:*")
