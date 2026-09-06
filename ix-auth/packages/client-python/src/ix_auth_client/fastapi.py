"""FastAPI 연동 — Depends 헬퍼.

앱이 붙일 것은 두 가지뿐이다: ``current_user`` 와 ``require_permission``.
"""

from __future__ import annotations

from typing import Annotated, Any, Callable

from fastapi import Depends, HTTPException, Request, status

from .client import IxAuthClient, IxAuthTokenError, IxAuthUnreachable

ACCESS_COOKIE = "ixauth_at"
REFRESH_COOKIE = "ixauth_rt"


def _token_of(request: Request, cookie_name: str) -> str | None:
    token = request.cookies.get(cookie_name)
    if token:
        return token
    header = request.headers.get("authorization", "")
    return header[7:] if header.startswith("Bearer ") else None


def build_dependencies(
    client: IxAuthClient,
    *,
    access_cookie: str = ACCESS_COOKIE,
) -> tuple[Callable[..., Any], Callable[[str], Any]]:
    """``(current_user, require_permission)`` 을 만들어 돌려준다.

    사용::

        ixauth = IxAuthClient()
        current_user, require_permission = build_dependencies(ixauth)

        @app.get("/api/me")
        async def me(user: Annotated[dict, Depends(current_user)]):
            return {"email": user["email"]}

        @app.get("/api/reports", dependencies=[Depends(require_permission("page:reports:view"))])
        async def reports():
            ...
    """

    async def current_user(request: Request) -> dict[str, Any]:
        token = _token_of(request, access_cookie)
        if not token:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "로그인이 필요합니다.")
        try:
            claims = client.verify(token)          # ← 네트워크 없음
        except IxAuthTokenError as e:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "다시 로그인하세요.") from e
        try:
            client.refresh_map_if_stale(claims)
        except IxAuthUnreachable:
            # 맵 갱신 실패는 치명적이지 않다 — 캐시된 것으로 계속 판정한다
            pass
        request.state.ixauth_claims = claims
        return claims

    def require_permission(code: str) -> Callable[..., Any]:
        async def dependency(
            claims: Annotated[dict[str, Any], Depends(current_user)],
        ) -> dict[str, Any]:
            if not client.has_permission(claims, code):
                # 무엇이 없어서 막혔는지 응답에 담지 않는다 (계약 errors.md)
                raise HTTPException(status.HTTP_403_FORBIDDEN, "권한이 없습니다.")
            return claims

        return dependency

    return current_user, require_permission


def require_resource(
    client: IxAuthClient,
    resolve: Callable[[Request], tuple[str, str, str]],
    *,
    current_user: Callable[..., Any],
    fallback: str = "deny",
) -> Callable[..., Any]:
    """L2 인스턴스 권한 — IX-Auth 를 조회한다.

    ``resolve(request)`` 가 ``(resource_type, resource_key, action)`` 을 돌려준다.
    ``fallback='l1'`` 이면 IX-Auth 미도달 시 L1 광역 권한으로 폴백한다 (기본은 fail-secure).
    """

    async def dependency(
        request: Request,
        claims: Annotated[dict[str, Any], Depends(current_user)],
    ) -> dict[str, Any]:
        resource_type, resource_key, action = resolve(request)
        try:
            verdict = client.check(claims["sub"], resource_type, resource_key, action)
        except IxAuthUnreachable:
            if fallback == "l1":
                code = f"{resource_type}:{resource_key.lstrip('/')}:{action}"
                if client.has_permission(claims, code):
                    return claims
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                                "권한을 확인할 수 없습니다.") from None
        if not verdict.get("allowed"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "권한이 없습니다.")
        return claims

    return dependency


__all__ = [
    "ACCESS_COOKIE",
    "REFRESH_COOKIE",
    "build_dependencies",
    "require_resource",
]
