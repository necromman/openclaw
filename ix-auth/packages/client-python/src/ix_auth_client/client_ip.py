"""실방문자 IP 도출.

앱은 IX-Auth 에게 "누가 로그인했는가" 를 알려 주는 유일한 통로다. 앱이 경유지
주소를 넘기면 감사 로그와 세션 목록에 그 경유지가 박히고, 그렇게 쌓인 기록은
나중에 되돌릴 수 없다(사후에 진짜 주소를 알 방법이 없다).

그래서 우선순위를 이 순서로 고정한다.

  1. ``CF-Connecting-IP`` : Cloudflare 가 실방문자 주소로 채워 넣는다
  2. ``True-Client-IP``   : Akamai·Cloudflare Enterprise 가 쓰는 같은 뜻의 헤더
  3. ``X-Forwarded-For`` 의 첫 조각
  4. ``X-Real-IP``
  5. 소켓 주소(``fallback`` 인자)

CDN 이 없는 환경이면 1·2 가 비어 있으니 자연히 3(XFF)으로 떨어진다. 즉 이
순서는 CDN 이 있든 없든 그대로 쓰면 된다.

**``request.client.host`` 를 쓰지 않는다.** 그것은 프록시 홉의 주소이지
방문자의 주소가 아니다. Cloudflare 뒤에서 XFF 첫 조각만 믿는 것도 같은 함정으로,
그 자리가 엣지 서버 주소로 채워져 나가는 구성이 흔하다(2026-08-25 실측, 소비
프로젝트 2곳 동시 발생). 경위는 ``docs/guides/client-ip.md`` 참고.
"""

from __future__ import annotations

import re
from typing import Any, Mapping

#: 앞에 있을수록 믿는다
IP_HEADER_PRIORITY = ("cf-connecting-ip", "true-client-ip", "x-forwarded-for", "x-real-ip")

_IPV4 = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")
_IPV4_PORT = re.compile(r"^(\d{1,3}(?:\.\d{1,3}){3}):\d+$")
_BRACKETED = re.compile(r"^\[([^\]]+)\](?::\d+)?$")
_IPV6_CHARS = re.compile(r"^[0-9a-fA-F:.]+$")


def client_ip_from(headers: Any, fallback: str | None = None) -> str | None:
    """헤더 묶음에서 실방문자 IP 를 뽑는다.

    ``headers`` 는 Starlette/FastAPI 의 ``request.headers``, Django 의
    ``request.META``, 평범한 ``dict`` 를 전부 받는다. ``fallback`` 은 헤더가
    하나도 없을 때 쓸 소켓 주소다.
    """
    for name in IP_HEADER_PRIORITY:
        raw = _header(headers, name)
        if not raw:
            continue
        # XFF 는 "client, proxy1, proxy2" 형식이라 맨 앞만 쓴다
        candidate = raw.split(",")[0] if name == "x-forwarded-for" else raw
        ip = _normalize(candidate)
        if ip:
            return ip
    return _normalize(fallback)


def client_meta_from(headers: Any, fallback: str | None = None) -> dict[str, str | None]:
    """IX-Auth 호출에 실을 ``{"ip": ..., "user_agent": ...}`` 를 만든다.

    그대로 펼쳐 넘기면 된다::

        ixauth.refresh(rt, **client_meta_from(request.headers))
    """
    return {
        "ip": client_ip_from(headers, fallback),
        "user_agent": _header(headers, "user-agent"),
    }


def _header(headers: Any, name: str) -> str | None:
    """``Headers``·``dict``·Django ``META`` 를 한 가지 방법으로 읽는다."""
    if headers is None:
        return None
    getter = getattr(headers, "get", None)
    if callable(getter):
        value = getter(name)
        if value:
            return _first(value)
    items = headers.items() if isinstance(headers, Mapping) or hasattr(headers, "items") else ()
    for key, value in items:
        if _normalize_key(str(key)) == name and value:
            return _first(value)
    return None


def _normalize_key(key: str) -> str:
    """``HTTP_X_FORWARDED_FOR``(Django) 도 ``x-forwarded-for`` 로 본다."""
    k = key.lower().replace("_", "-")
    return k[5:] if k.startswith("http-") else k


def _first(value: Any) -> str | None:
    if isinstance(value, (list, tuple)):
        return str(value[0]) if value else None
    return str(value) if value is not None else None


def _normalize(value: str | None) -> str | None:
    """포트·IPv6 표기를 서버(``ClientInfo.java``)와 같은 모양으로 맞춘다.

    같은 접속이 ``::1`` 과 ``127.0.0.1`` 두 가지로 찍히면 감사 로그를 IP 로
    묶어 볼 수 없다. 프록시가 채우는 ``unknown`` 같은 값은 흘려보내지 않는다.
    """
    if not isinstance(value, str):
        return None
    v = value.strip()
    if not v:
        return None

    bracketed = _BRACKETED.match(v)          # [2001:db8::1]:443
    if bracketed:
        v = bracketed.group(1)
    else:
        with_port = _IPV4_PORT.match(v)      # 203.0.113.7:51514
        if with_port:
            v = with_port.group(1)

    if v.startswith("::ffff:") and "." in v:
        v = v[len("::ffff:"):]
    if v in ("::1", "0:0:0:0:0:0:0:1"):
        return "127.0.0.1"

    if _IPV4.match(v):
        return v
    if ":" in v and _IPV6_CHARS.match(v):
        return v
    return None


__all__ = ["IP_HEADER_PRIORITY", "client_ip_from", "client_meta_from"]
