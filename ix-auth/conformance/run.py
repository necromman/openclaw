#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""IX-Auth 적합성 검사 — 계약(docs/contract/) 대로 동작하는지 HTTP 로만 확인한다.

**SDK 를 쓰지 않는다.** 표준 라이브러리만으로 친다 — SDK 가 계약을 잘못 읽고 있어도
그 오해가 검사에 섞이지 않게 하기 위해서다. 실제로 이 검사는 그런 불일치
(``batch-check`` 응답이 배열인데 SDK 는 객체로 읽던 것)에서 출발했다.

    python conformance/run.py --base-url http://localhost:9100 \
        --service-key ... --admin-email ... --admin-password ...

세션을 폐기시키는 검사(refresh 재사용·로그아웃·계정 잠금)는 **전용 테스트 계정**을
만들어서 돌린다. 관리자 계정으로 돌리면 지금 그 계정으로 로그인해 있는 사람의
세션이 끊긴다. 계정을 못 만들면 해당 검사는 SKIP 된다.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import struct
import sys
import time
import urllib.error
import urllib.request
import uuid

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"
results: list[tuple[str, str, str, str]] = []   # (상태, ID, 계약근거, 메시지)


class Api:
    def __init__(self, base_url: str, service_key: str) -> None:
        self.base = base_url.rstrip("/")
        self.key = service_key

    def call(self, method, path, body=None, token=None, service_key=True, raw=False):
        """(status, parsed_json) 을 돌려준다. 4xx/5xx 도 예외가 아니라 값이다."""
        req = urllib.request.Request(self.base + path, method=method)
        req.add_header("Content-Type", "application/json")
        if service_key:
            req.add_header("X-IxAuth-Key", self.key)
        if token:
            req.add_header("Authorization", "Bearer " + token)
        data = json.dumps(body).encode() if body is not None else None
        return self._send(req, data, raw)

    def call_text(self, method, path, text, token=None, content_type="text/csv"):
        """JSON 이 아닌 본문 — 일괄 등록의 CSV 가 이 경로로 간다.

        charset 을 명시한다. 빼면 한글 이름이 서버 기본 인코딩에 따라 깨지고,
        그건 이 기능을 실제로 쓰는 방식(엑셀에서 저장한 명단)에서 바로 드러난다.
        """
        req = urllib.request.Request(self.base + path, method=method)
        req.add_header("Content-Type", content_type + ";charset=UTF-8")
        if token:
            req.add_header("Authorization", "Bearer " + token)
        return self._send(req, text.encode("utf-8"), False)

    def _send(self, req, data, raw):
        try:
            with urllib.request.urlopen(req, data, timeout=30) as res:
                text = res.read().decode("utf-8", "replace")
                return res.status, (text if raw else _json(text))
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace")
            return e.code, (text if raw else _json(text))


def _json(text):
    if not text.strip():
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"__raw__": text[:200]}


def claims_of(jwt: str) -> dict:
    part = jwt.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))


def header_of(jwt: str) -> dict:
    part = jwt.split(".")[0]
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))


def check(cid: str, contract: str):
    """검사 하나. fn 이 문자열을 돌려주면 그게 실패 사유, None 이면 통과."""
    def deco(fn):
        try:
            reason = fn()
        except Exception as e:                      # noqa: BLE001 — 검사기가 죽으면 안 된다
            results.append((FAIL, cid, contract, f"검사 중 예외: {type(e).__name__}: {e}"))
            return fn
        if reason is None:
            results.append((PASS, cid, contract, ""))
        elif reason.startswith("SKIP:"):
            results.append((SKIP, cid, contract, reason[5:].strip()))
        else:
            results.append((FAIL, cid, contract, reason))
        return fn
    return deco


def wait_for_rate_window(api, label: str) -> None:
    """속도 제한 창이 지나가길 기다린다.

    잠금(계정당 5회)을 확인하려면 로그인을 여러 번 실패시켜야 하는데, IP 제한이
    먼저 걸린다. **이는 정상 동작이다** — 실제 공격자도 같은 벽을 만난다.
    검사기는 그 벽을 우회하지 않고 기다린다 (우회용 뒷문을 만들면 그게 구멍이 된다).
    """
    st, body = api.call("POST", "/auth/login", {"email": "probe@nowhere.invalid",
                                                "password": "x"})
    if st != 429:
        return
    print(f"   … {label}: 속도 제한 창이 지나가길 기다린다 (최대 65초)")
    for _ in range(65):
        time.sleep(1)
        st, _b = api.call("POST", "/auth/login", {"email": "probe@nowhere.invalid",
                                                 "password": "x"})
        if st != 429:
            return


def err_code(body) -> str | None:
    e = body.get("error") if isinstance(body, dict) else None
    return e.get("code") if isinstance(e, dict) else None


def meta_of(body, field: str):
    e = body.get("error") if isinstance(body, dict) else None
    m = e.get("meta") if isinstance(e, dict) else None
    return m.get(field) if isinstance(m, dict) else None


def items_of(body):
    d = body.get("data") if isinstance(body, dict) else None
    if isinstance(d, dict):
        return d.get("items") or []
    return d if isinstance(d, list) else []


def setting_value(api, token, key):
    """현재 설정 값. 검사가 인스턴스 설정에 따라 갈릴 때 그 값을 먼저 본다.

    **설정을 바꾸지 않는다.** 예컨대 약관 기능을 잠깐 켰다 끄면, 그 사이 로그인한
    사람에게 재동의 요구가 나가고 검사기가 중간에 죽으면 켠 채로 남는다.
    """
    _st, body = api.call("GET", "/admin/settings", token=token)
    for item in items_of(body):
        if item.get("key") == key:
            return item.get("value")
    return None


def totp_code(secret_b32: str, step_offset: int = 0) -> str:
    """RFC 6238 — 검사기가 인증 앱 역할을 한다.

    서버 구현을 가져다 쓰지 않는 것이 이 검사기의 원칙이다(SDK 를 안 쓰는 것과 같은 이유).
    서버가 규격을 잘못 구현했다면 그 오해가 여기 섞이면 안 된다.
    """
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8))
    step = int(time.time()) // 30 + step_offset
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return f"{number % 1000000:06d}"


def run_mfa_flow(api, admin_token: str) -> dict:
    """등록 → 확인 → 로그인 → 검증 → 재사용 → 백업 코드 → 해제를 한 번 돌린다.

    검사마다 로그인을 다시 하면 IP 속도 제한(기본 10/분)에 먼저 걸린다. 그 제한은
    정상 동작이므로 우회하지 않고, 흐름을 한 번만 돌린 뒤 각 단계의 결과를 담아 둔다.
    """
    out: dict = {}
    email = f"conformance-mfa-{uuid.uuid4().hex[:8]}@ix-auth.invalid"
    password = "C0nf0rm!Mfa-" + uuid.uuid4().hex[:6]

    st, created = api.call("POST", "/admin/users",
                           {"email": email, "name": "적합성 검사(2단계)", "password": password},
                           token=admin_token)
    user_id = (created.get("data") or {}).get("id") if st in (200, 201) else None
    if user_id is None:
        out["skip"] = f"테스트 계정 생성 실패({st}) — 2단계 검사를 건너뛴다"
        return out
    out["user_id"] = user_id

    def login():
        wait_for_rate_window(api, "MFA")
        st2, b = api.call("POST", "/auth/login", {"email": email, "password": password})
        if st2 == 429:
            wait_for_rate_window(api, "MFA 재시도")
            st2, b = api.call("POST", "/auth/login", {"email": email, "password": password})
        return st2, b

    def verify(challenge, code):
        return api.call("POST", "/auth/mfa/verify", {"challenge": challenge, "code": code})

    st, body = login()
    token = (body.get("data") or {}).get("accessToken")
    if not token:
        out["skip"] = f"테스트 계정으로 로그인할 수 없다({st})"
        return out

    st, body = api.call("POST", "/auth/mfa/totp/setup", {}, token=token)
    if st != 200:
        out["skip"] = f"등록을 시작할 수 없다({st} / {err_code(body)})"
        return out
    out["setup"] = body.get("data") or {}
    secret = out["setup"].get("otpauthUri", "").split("secret=")[-1].split("&")[0]

    _st, body = api.call("GET", "/auth/mfa/status", token=token)
    out["status_before_confirm"] = body.get("data") or {}

    st, body = api.call("POST", "/auth/mfa/totp/confirm", {"code": totp_code(secret)},
                        token=token)
    if st != 200:
        out["skip"] = (f"코드 확인 실패({st} / {err_code(body)})"
                       " — 서버와 이 PC 의 시계가 어긋났을 수 있다")
        return out

    out["challenge_response"] = login()
    challenge = meta_of(out["challenge_response"][1], "challenge")
    if not challenge:
        return out                      # MFA-2 가 실패로 잡는다

    # 확인에 쓴 스텝은 이미 소모됐다 — 다음 스텝의 코드를 쓴다 (허용 오차 ±1 안이다)
    used_code = totp_code(secret, 1)
    out["verify_response"] = verify(challenge, used_code)
    token = ((out["verify_response"][1].get("data")) or {}).get("accessToken") or token

    # 같은 코드를 새 challenge 로 다시 낸다 — 재사용이면 거부돼야 한다
    _st, body = login()
    out["replay_response"] = verify(meta_of(body, "challenge"), used_code)

    codes = out["setup"].get("backupCodes") or []
    if codes:
        _st, body = login()
        out["backup_response"] = verify(meta_of(body, "challenge"), codes[0])
        token = ((out["backup_response"][1].get("data")) or {}).get("accessToken") or token

        _st, body = api.call("GET", "/auth/mfa/status", token=token)
        out["status_after_backup"] = body.get("data") or {}

        _st, body = login()
        out["backup_replay_response"] = verify(meta_of(body, "challenge"), codes[0])

    out["disable_wrong_password"] = api.call(
        "DELETE", "/auth/mfa/totp", {"currentPassword": "wrong-on-purpose"}, token=token)
    out["disable_response"] = api.call(
        "DELETE", "/auth/mfa/totp", {"currentPassword": password}, token=token)
    out["login_after_disable"] = login()

    # 뒤의 검사들이 쓸 '관리자가 아닌 사용자' 의 토큰. 관리자 계정으로 탈퇴·권한 검사를
    # 치면 그 계정에 흔적이 남고, 실수 하나로 지금 로그인해 있는 사람이 잠긴다
    out["password"] = password
    out["token"] = ((out["login_after_disable"][1].get("data")) or {}).get("accessToken")
    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", default="http://localhost:9100")
    p.add_argument("--service-key", required=True)
    p.add_argument("--admin-email", required=True)
    p.add_argument("--admin-password", required=True)
    p.add_argument("--keep-test-user", action="store_true",
                   help="검사 후 테스트 계정을 비활성화하지 않는다 (디버깅용)")
    a = p.parse_args()

    api = Api(a.base_url, a.service_key)

    # ────────── 공개 엔드포인트 (서비스 키 없이) ──────────

    @check("PUB-1", "http-api.md §1 — /.well-known/jwks.json 은 공개")
    def _():
        st, body = api.call("GET", "/.well-known/jwks.json", service_key=False)
        if st != 200:
            return f"상태 {st}"
        keys = body.get("keys")
        if not isinstance(keys, list) or not keys:
            return f"keys 가 비었다: {body}"
        k = keys[0]
        if k.get("kty") != "RSA" or "kid" not in k:
            return f"RSA 공개키 형식이 아니다: {k}"
        if "d" in k or "p" in k or "q" in k:
            return "★개인키 성분이 JWKS 에 섞여 있다★"
        return None

    # ────────── 서비스 키 검증 ──────────

    @check("SVC-1", "errors.md — SERVICE_KEY_MISSING 401")
    def _():
        st, body = api.call("POST", "/auth/login",
                            {"email": a.admin_email, "password": a.admin_password},
                            service_key=False)
        if st != 401:
            return f"키 없이 {st} 로 통과했다"
        if err_code(body) != "SERVICE_KEY_MISSING":
            return f"코드가 {err_code(body)}"
        return None

    @check("SVC-2", "errors.md — SERVICE_KEY_INVALID 401")
    def _():
        bad = Api(a.base_url, "wrong-key-wrong-key-wrong-key-1234")
        st, body = bad.call("POST", "/auth/login",
                            {"email": a.admin_email, "password": a.admin_password})
        if st != 401:
            return f"틀린 키로 {st} 로 통과했다"
        if err_code(body) != "SERVICE_KEY_INVALID":
            return f"코드가 {err_code(body)}"
        return None

    # ────────── 로그인 ──────────

    st, login = api.call("POST", "/auth/login",
                         {"email": a.admin_email, "password": a.admin_password})
    if st != 200:
        print(f"관리자 로그인 실패({st}) — 검사를 진행할 수 없다: {login}")
        return 2
    d = login.get("data", {})
    admin_token = d.get("accessToken")
    admin_refresh = d.get("refreshToken")

    @check("ENV-1", "http-api.md §1 — 성공 응답은 {\"data\": …}")
    def _():
        if "data" not in login:
            return f"data 봉투가 없다: {list(login)}"
        for f in ("accessToken", "refreshToken", "expiresIn", "user"):
            if f not in d:
                return f"{f} 없음"
        return None

    @check("ENV-2", "http-api.md §1 — 실패 응답은 error.code + traceId")
    def _():
        st2, body = api.call("POST", "/auth/login",
                             {"email": a.admin_email, "password": "definitely-wrong"})
        if st2 != 401:
            return f"상태 {st2}"
        e = body.get("error")
        if not isinstance(e, dict):
            return f"error 봉투가 없다: {body}"
        for f in ("code", "message"):
            if f not in e:
                return f"error.{f} 없음"
        if "traceId" not in e:
            return "traceId 없음 — 운영에서 로그와 대조할 수단이 사라진다"
        return None

    @check("ENV-3", "http-api.md §1 — 응답에 스택트레이스·SQL 을 넣지 않는다")
    def _():
        _, body = api.call("POST", "/auth/login", {"email": "nope"})
        text = json.dumps(body, ensure_ascii=False).lower()
        for leak in ("exception", "\\tat ", "select ", "org.springframework", "hibernate"):
            if leak in text:
                return f"내부 정보 노출 의심: {leak!r} 이 응답에 있다"
        return None

    @check("LOGIN-1", "errors.md — 없는 계정과 틀린 비밀번호를 구분하지 않는다")
    def _():
        _, no_user = api.call("POST", "/auth/login",
                              {"email": f"ghost-{uuid.uuid4().hex[:8]}@nowhere.invalid",
                               "password": "whatever-1234"})
        _, bad_pw = api.call("POST", "/auth/login",
                             {"email": a.admin_email, "password": "definitely-wrong"})
        c1, c2 = err_code(no_user), err_code(bad_pw)
        if c1 != c2:
            return f"코드가 갈린다: 없는 계정={c1}, 틀린 비번={c2} — 계정 존재 여부가 샌다"
        if c1 != "AUTH_INVALID_CREDENTIALS":
            return f"코드가 {c1}"
        m1 = (no_user.get("error") or {}).get("message")
        m2 = (bad_pw.get("error") or {}).get("message")
        if m1 != m2:
            return f"메시지가 갈린다: {m1!r} vs {m2!r}"
        return None

    @check("LOGIN-2", "코딩 규칙 — 응답에 비밀번호·해시를 담지 않는다")
    def _():
        text = json.dumps(login, ensure_ascii=False).lower()
        for leak in ("password", "bcrypt", "$2a$", "$2b$", "passwordhash"):
            if leak in text:
                return f"{leak!r} 이 로그인 응답에 있다"
        return None

    # ────────── 토큰 ──────────

    @check("TOK-1", "token.md — access 는 RS256 JWT, kid 포함")
    def _():
        h = header_of(admin_token)
        if h.get("alg") != "RS256":
            return f"alg 가 {h.get('alg')}"
        if not h.get("kid"):
            return "kid 없음 — 키 회전을 할 수 없다"
        return None

    @check("TOK-2", "token.md — iss/aud/exp/sub + ixauth_roles + ixauth_pv")
    def _():
        c = claims_of(admin_token)
        for f in ("iss", "aud", "exp", "iat", "sub"):
            if f not in c:
                return f"{f} 클레임 없음"
        if "ixauth_roles" not in c:
            return "ixauth_roles 없음 — 앱이 L1 을 로컬 판정할 수 없다"
        if "ixauth_pv" not in c:
            return "ixauth_pv 없음 — 앱이 permission-map 이 낡았는지 알 수 없다"
        return None

    @check("TOK-3", "token.md — refresh 는 불투명 문자열이어야 한다 (JWT 금지)")
    def _():
        # JWT 면 서버가 상태를 안 들고 있다는 뜻이고, 그러면 로그아웃이 실제로 되지 않는다
        if admin_refresh.count(".") == 2:
            try:
                claims_of(admin_refresh)
                return "★refresh 가 JWT 다 — 폐기가 불가능해 로그아웃이 무력해진다★"
            except Exception:
                pass
        return None

    @check("TOK-4", "errors.md — 위조 토큰은 AUTH_TOKEN_INVALID 401")
    def _():
        forged = admin_token[:-6] + "AAAAAA"
        st2, body = api.call("GET", "/admin/users?size=1", token=forged)
        if st2 != 401:
            return f"위조 서명이 {st2} 로 통과했다"
        if err_code(body) not in ("AUTH_TOKEN_INVALID", "AUTH_TOKEN_EXPIRED"):
            return f"코드가 {err_code(body)}"
        return None

    # ────────── 인가 (L1) ──────────

    @check("MAP-1", "authz.md — permission-map 은 version + roles")
    def _():
        st2, body = api.call("GET", "/authz/permission-map")
        if st2 != 200:
            return f"상태 {st2}"
        data = body.get("data", body)
        if "version" not in data or "roles" not in data:
            return f"version/roles 가 없다: {list(data)}"
        if not isinstance(data["roles"], dict):
            return "roles 가 객체가 아니다"
        return None

    @check("MAP-2", "설계 결정 — pv 는 permission-map version 과 같아야 한다")
    def _():
        _, body = api.call("GET", "/authz/permission-map")
        version = body.get("data", body).get("version")
        pv = claims_of(admin_token).get("ixauth_pv")
        if version != pv:
            return f"토큰 pv={pv} 인데 맵 version={version} — 앱이 갱신 시점을 못 잡는다"
        return None

    @check("CODE-1", "errors.md — AUTHZ_INVALID_PERMISSION_CODE 400 ('**' 중간 배치)")
    def _():
        st2, body = api.call("POST", "/admin/permissions",
                             {"code": "page:a.**.c:view", "description": "적합성 검사"},
                             token=admin_token)
        if st2 == 200 or st2 == 201:
            return "★문법 오류 코드가 등록됐다★"
        if err_code(body) != "AUTHZ_INVALID_PERMISSION_CODE":
            return f"{st2} / 코드가 {err_code(body)}"
        return None

    @check("CODE-2", "errors.md — AUTHZ_INVALID_PERMISSION_CODE 400 (3파트 아님)")
    def _():
        st2, body = api.call("POST", "/admin/permissions",
                             {"code": "page:view", "description": "적합성 검사"},
                             token=admin_token)
        if st2 in (200, 201):
            return "★2파트 코드가 등록됐다★"
        if err_code(body) != "AUTHZ_INVALID_PERMISSION_CODE":
            return f"{st2} / 코드가 {err_code(body)}"
        return None

    # ────────── 인가 (L2) ──────────

    user_id = claims_of(admin_token)["sub"]

    @check("L2-1", "authz.md — check 는 판정 근거(reason)를 항상 반환한다")
    def _():
        st2, body = api.call("POST", "/authz/check",
                             {"userId": user_id, "resourceType": "file",
                              "resourceKey": "/conformance/probe.pdf", "action": "read"})
        if st2 != 200:
            return f"상태 {st2}: {body}"
        data = body.get("data", body)
        if "allowed" not in data:
            return f"allowed 없음: {data}"
        if data.get("reason") not in ("GRANT_ALLOW", "GRANT_DENY", "L1_FALLBACK", "NO_MATCH"):
            return f"reason 이 계약 밖의 값: {data.get('reason')!r}"
        return None

    @check("L2-2", "authz.md — batch-check 의 data 는 배열이고 요청 순서를 지킨다")
    def _():
        keys = [f"/conformance/{i}.pdf" for i in range(5)]
        st2, body = api.call("POST", "/authz/batch-check", {
            "userId": user_id,
            "checks": [{"resourceType": "file", "resourceKey": k, "action": "read"} for k in keys],
        })
        if st2 != 200:
            return f"상태 {st2}: {body}"
        data = body.get("data")
        if not isinstance(data, list):
            return f"data 가 배열이 아니다: {type(data).__name__}"
        if len(data) != len(keys):
            return f"{len(keys)}건 물었는데 {len(data)}건 왔다"
        got = [r.get("resourceKey") for r in data]
        if got != keys:
            return f"순서가 어긋난다: {got}"
        return None

    @check("L2-3", "errors.md — AUTHZ_BATCH_TOO_LARGE 400 (100건 초과)")
    def _():
        st2, body = api.call("POST", "/authz/batch-check", {
            "userId": user_id,
            "checks": [{"resourceType": "file", "resourceKey": f"/x/{i}", "action": "read"}
                       for i in range(101)],
        })
        if st2 == 200:
            return "★101건이 그대로 처리됐다 — 상한이 없으면 한 요청으로 jar 를 세울 수 있다★"
        if err_code(body) != "AUTHZ_BATCH_TOO_LARGE":
            return f"{st2} / 코드가 {err_code(body)}"
        return None

    @check("L2-4", "authz.md — list-resources 는 keys + truncated")
    def _():
        st2, body = api.call(
            "GET", f"/authz/list-resources?userId={user_id}&resourceType=file&action=read")
        if st2 != 200:
            return f"상태 {st2}: {body}"
        data = body.get("data", body)
        if "keys" not in data:
            return f"keys 없음: {list(data)}"
        if "truncated" not in data:
            return "truncated 없음 — 잘린 결과를 '권한 없음' 으로 오판하게 된다"
        if not isinstance(data["keys"], list):
            return "keys 가 배열이 아니다"
        return None

    # ────────── 세션 (전용 테스트 계정) ──────────

    probe_email = f"conformance-{uuid.uuid4().hex[:10]}@ix-auth.invalid"
    probe_pw = "C0nf0rm!Probe-" + uuid.uuid4().hex[:6]
    st, created = api.call("POST", "/admin/users",
                           {"email": probe_email, "name": "적합성 검사", "password": probe_pw},
                           token=admin_token)
    probe_id = (created.get("data") or {}).get("id") if st in (200, 201) else None
    if probe_id is None:
        skip_reason = f"SKIP: 테스트 계정 생성 실패({st}) — 관리자 세션을 끊을 수 없어 건너뛴다"
    else:
        skip_reason = None

    def probe_login():
        st2, b = api.call("POST", "/auth/login", {"email": probe_email, "password": probe_pw})
        return st2, b.get("data", {})

    @check("SES-1", "http-api.md — refresh 는 회전한다 (같은 토큰을 다시 주지 않는다)")
    def _():
        if skip_reason:
            return skip_reason
        _, d1 = probe_login()
        st2, body = api.call("POST", "/auth/refresh", {"refreshToken": d1["refreshToken"]})
        if st2 != 200:
            return f"갱신 실패 {st2}: {body}"
        d2 = body.get("data", {})
        if d2.get("refreshToken") == d1["refreshToken"]:
            return "★refresh 가 회전하지 않는다 — 유출된 토큰이 만료까지 계속 쓰인다★"
        return None

    @check("SES-2", "errors.md — refresh 재사용 감지 시 AUTH_SESSION_REVOKED")
    def _():
        if skip_reason:
            return skip_reason
        _, d1 = probe_login()
        old = d1["refreshToken"]
        st2, _b = api.call("POST", "/auth/refresh", {"refreshToken": old})
        if st2 != 200:
            return f"1차 갱신 실패 {st2}"
        st3, body = api.call("POST", "/auth/refresh", {"refreshToken": old})   # 재사용
        if st3 == 200:
            return "★이미 쓴 refresh 가 또 통했다 — 탈취 탐지가 동작하지 않는다★"
        if err_code(body) != "AUTH_SESSION_REVOKED":
            return f"{st3} / 코드가 {err_code(body)}"
        return None

    @check("SES-3", "설계 — 로그아웃하면 그 refresh 는 실제로 죽는다")
    def _():
        if skip_reason:
            return skip_reason
        _, d1 = probe_login()
        st2, _b = api.call("POST", "/auth/logout", {"refreshToken": d1["refreshToken"]})
        if st2 not in (200, 204):
            return f"로그아웃 상태 {st2}"
        st3, body = api.call("POST", "/auth/refresh", {"refreshToken": d1["refreshToken"]})
        if st3 == 200:
            return "★로그아웃 후에도 갱신이 된다 — 로그아웃이 화면에서만 일어난 것★"
        if err_code(body) not in ("AUTH_SESSION_REVOKED", "AUTH_REFRESH_EXPIRED"):
            return f"{st3} / 코드가 {err_code(body)}"
        return None

    @check("ACC-8", "http-api.md §2-1 — 남의 세션은 끊을 수 없다")
    def _():
        if skip_reason:
            return skip_reason
        wait_for_rate_window(api, "ACC-8")
        _, d1 = probe_login()
        if not d1.get("accessToken"):
            return "SKIP: 테스트 계정으로 로그인할 수 없다"
        # 관리자 세션 하나를 골라 테스트 계정 토큰으로 끊어 본다
        _, mine = api.call("GET", "/auth/sessions", token=admin_token)
        targets = [s["id"] for s in mine.get("data", {}).get("items", [])]
        if not targets:
            return "SKIP: 대조할 관리자 세션이 없다"
        st2, body = api.call("DELETE", f"/auth/sessions/{targets[0]}",
                             token=d1["accessToken"])
        if st2 == 200:
            return "★세션 ID 만 알면 남을 로그아웃시킬 수 있다★"
        if err_code(body) != "NOT_FOUND":
            return f"{st2} / 코드가 {err_code(body)}"
        return None

    @check("SES-4", "errors.md — 실패 누적 시 AUTH_ACCOUNT_LOCKED 423")
    def _():
        if skip_reason:
            return skip_reason
        # 계약: 잠김은 '비밀번호가 맞았을 때만' 알려 준다. 그래서 틀린 비밀번호로
        # 아무리 두드려도 계속 AUTH_INVALID_CREDENTIALS 다 — 그게 정상이다.
        #
        # 시도 횟수는 기본 lockout.max-attempts(5) 를 덮을 만큼이면 되고, IP 속도
        # 제한(기본 10/분) 안에 들어가야 한다. 그래서 창을 비우고 8회만 친다
        wait_for_rate_window(api, "SES-4")
        for _ in range(8):
            api.call("POST", "/auth/login",
                     {"email": probe_email, "password": "wrong-on-purpose"})

        # 잠겼는지는 '맞는 비밀번호' 로만 확인된다
        wait_for_rate_window(api, "SES-4 확인")
        st2, body = api.call("POST", "/auth/login",
                             {"email": probe_email, "password": probe_pw})
        if st2 == 200:
            return "12회 연속 실패해도 잠기지 않는다 — 무차별 대입을 막지 못한다"
        if err_code(body) != "AUTH_ACCOUNT_LOCKED":
            return f"{st2} / 코드가 {err_code(body)}"
        if st2 != 423:
            return f"잠금 상태코드가 {st2} (계약은 423)"
        return None

    @check("SES-5", "errors.md — 잠긴 계정도 틀린 비밀번호에는 잠김을 알리지 않는다")
    def _():
        if skip_reason:
            return skip_reason
        # SES-4 가 이미 잠가 둔 상태여야 의미가 있는 검사다
        wait_for_rate_window(api, "SES-5")
        st2, body = api.call("POST", "/auth/login",
                             {"email": probe_email, "password": "still-wrong"})
        if err_code(body) == "AUTH_ACCOUNT_LOCKED":
            return "틀린 비밀번호에도 잠김을 알려 준다 — 계정 존재 여부가 샌다"
        if err_code(body) != "AUTH_INVALID_CREDENTIALS":
            return f"{st2} / 코드가 {err_code(body)}"
        return None

    # ────────── 계정 라이프사이클 ──────────

    @check("ACC-1", "http-api.md §2-1 — forgot 은 계정 유무와 무관하게 같은 응답")
    def _():
        st_known, b_known = api.call("POST", "/auth/password/forgot",
                                     {"email": a.admin_email})
        st_ghost, b_ghost = api.call(
            "POST", "/auth/password/forgot",
            {"email": f"ghost-{uuid.uuid4().hex[:8]}@nowhere.invalid"})
        if st_known != st_ghost:
            return f"상태가 갈린다: 있는 계정={st_known}, 없는 계정={st_ghost} — 명부가 샌다"
        if b_known != b_ghost:
            return f"본문이 갈린다: {b_known} vs {b_ghost} — 명부가 샌다"
        if st_known != 200:
            return f"상태 {st_known}"
        return None

    @check("ACC-2", "http-api.md §2-1 — 잘못된 재설정 토큰은 거부")
    def _():
        st2, body = api.call("POST", "/auth/password/reset",
                             {"token": "not-a-real-token", "newPassword": "Wh4tever!Pass"})
        if st2 == 200:
            return "★아무 토큰이나 통한다★"
        if err_code(body) not in ("AUTH_TOKEN_INVALID", "AUTH_TOKEN_EXPIRED"):
            return f"{st2} / 코드가 {err_code(body)}"
        return None

    @check("ACC-3", "http-api.md §2-1 — 비밀번호 정책은 토큰 소비 전에 본다")
    def _():
        # 정책 위반이 토큰을 태우면 사용자는 메일을 다시 받아야 한다.
        # 토큰 없이도 확인 가능 — 정책 오류가 토큰 오류보다 먼저 나와야 한다
        st2, body = api.call("POST", "/auth/password/reset",
                             {"token": "not-a-real-token", "newPassword": "weak"})
        if err_code(body) != "AUTH_PASSWORD_POLICY":
            return (f"코드가 {err_code(body)} — 정책 검사가 토큰 소비 뒤에 있으면"
                    " 링크가 살아남는 것이 트랜잭션 롤백에 의존하게 된다")
        return None

    @check("ACC-4", "http-api.md §2-1 — 인증 메일 요청도 계정 유무를 알리지 않는다")
    def _():
        st1, b1 = api.call("POST", "/auth/email/verify/request", {"email": a.admin_email})
        st2, b2 = api.call("POST", "/auth/email/verify/request",
                           {"email": f"ghost-{uuid.uuid4().hex[:8]}@nowhere.invalid"})
        if (st1, b1) != (st2, b2):
            return f"응답이 갈린다: {st1}/{b1} vs {st2}/{b2}"
        return None

    @check("ACC-5", "errors.md — 비밀번호 변경은 access token 을 요구한다")
    def _():
        # 서비스 키만으로 통과하면 앱 서버를 쥔 쪽이 아무 계정이나 바꿀 수 있다
        st2, body = api.call("POST", "/auth/password/change",
                             {"currentPassword": "x", "newPassword": "Wh4tever!Pass"})
        if st2 != 401:
            return f"★서비스 키만으로 {st2}★"
        return None

    @check("ACC-6", "http-api.md §2-1 — 내 세션 목록도 access token 전용")
    def _():
        st2, _b = api.call("GET", "/auth/sessions")
        if st2 != 401:
            return f"★서비스 키만으로 {st2}★"
        return None

    @check("ACC-7", "http-api.md §2-1 — 세션 목록은 현재 세션을 표시한다")
    def _():
        st2, body = api.call("GET", "/auth/sessions", token=admin_token)
        if st2 != 200:
            return f"상태 {st2}: {body}"
        items = body.get("data", {}).get("items")
        if not isinstance(items, list) or not items:
            return f"세션이 비었다: {body}"
        for f in ("id", "issuedAt", "expiresAt", "current"):
            if f not in items[0]:
                return f"{f} 없음"
        if not any(s.get("current") for s in items):
            return "current 인 세션이 하나도 없다 — 사용자가 '지금 이 기기' 를 구분할 수 없다"
        return None

    @check("ACC-10", "http-api.md §2-1 — 세션 목록은 사람이 알아보는 기기 이름을 함께 준다")
    def _():
        # UA 원문만 있으면 사용자가 "이 중에 내가 모르는 기기가 있는가" 를 판단할 수 없다.
        # 그 판단이 안 되면 세션 목록은 있으나 마나다
        st2, body = api.call("GET", "/auth/sessions", token=admin_token)
        items = body.get("data", {}).get("items") or []
        if st2 != 200 or not items:
            return f"세션 목록을 받지 못했다({st2})"
        for s in items:
            if "deviceLabel" not in s:
                return "deviceLabel 이 없다 — UA 원문으로는 자기 기기를 알아볼 수 없다"
            if not s["deviceLabel"]:
                return "deviceLabel 이 비어 있다 — 파싱 실패는 '알 수 없는 기기' 여야 한다"
            if "userAgent" not in s:
                return "원문(userAgent)이 사라졌다 — 표시가 틀렸을 때 대조할 것이 없다"
        return None

    @check("ACC-11", "http-api.md §2-1 — 본인 탈퇴는 access token 전용")
    def _():
        # 서비스 키만으로 통과하면 앱 서버를 쥔 쪽이 아무 계정이나 닫을 수 있다
        st2, _b = api.call("POST", "/auth/account/delete", {"currentPassword": "x"})
        if st2 != 401:
            return f"★서비스 키만으로 {st2}★"
        return None

    @check("SET-1", "config.md §5-0 — 새 정책은 관리 화면에서 바꿀 수 있어야 한다")
    def _():
        # 설정 정의에 없으면 yml 을 고치고 재시작해야 한다 = '동적 설정' 이 아니다.
        # 그 순간 고객사마다 배포본이 갈라지기 시작한다 (rules/settings-driven.md)
        st2, body = api.call("GET", "/admin/settings", token=admin_token)
        if st2 != 200:
            return f"상태 {st2}"
        keys = {i.get("key") for i in (body.get("data", {}).get("items") or [])}
        missing = [k for k in ("account.notify-new-device",
                               "account.max-concurrent-sessions",
                               "account.self-delete-mode",
                               "account.self-delete-grace",
                               "mfa.admin-reset") if k not in keys]
        if missing:
            return f"정의 미등록이라 화면에서 바꿀 수 없다: {', '.join(missing)}"
        return None

    @check("ACC-9", "config.md §5-2 — 가입 방식이 의도한 값인가")
    def _():
        st2, body = api.call("POST", "/auth/signup", {
            "email": f"selfsignup-{uuid.uuid4().hex[:8]}@nowhere.invalid",
            "password": "S3lf!Signup123", "name": "적합성 검사"})
        if st2 == 200:
            # 열려 있다면 그것 자체는 설정 선택이므로 실패가 아니다 — 다만 알린다
            return ("SKIP: signup-mode 가 열린 인스턴스다."
                    " 사내용이라면 닫혀 있어야 한다")
        if err_code(body) == "AUTH_TERMS_REQUIRED":
            # 가입은 열려 있고 약관에서 걸렸다. 계정이 만들어지지 않은 것은 같으므로
            # 이 검사의 목적(조용히 계정이 생기지 않는다)은 충족된다
            return ("SKIP: signup-mode 는 열려 있고 필수 약관 동의에서 막혔다."
                    " 계정은 만들어지지 않았다")
        if err_code(body) != "AUTHZ_FORBIDDEN":
            return f"{st2} / 코드가 {err_code(body)}"
        return None

    # ────────── 2단계 인증 (전용 테스트 계정) ──────────
    #
    # 흐름을 **한 번만** 돌리고 각 단계의 결과를 담아 둔다. 검사마다 로그인을 다시 하면
    # IP 속도 제한(기본 10/분)에 먼저 걸려 검사 자체가 흔들린다 — 그 제한은 정상 동작이다.

    mfa = run_mfa_flow(api, admin_token)

    @check("MFA-1", "http-api.md §2-3 — 등록은 otpauth URI 와 백업 코드를 준다")
    def _():
        if mfa.get("skip"):
            return "SKIP: " + mfa["skip"]
        uri = mfa["setup"].get("otpauthUri", "")
        if not uri.startswith("otpauth://totp/"):
            return f"otpauthUri 가 규격이 아니다: {uri[:40]}"
        for token in ("secret=", "digits=6", "period=30"):
            if token not in uri:
                return f"otpauth URI 에 {token} 가 없다 — 인증 앱이 읽지 못한다"
        codes = mfa["setup"].get("backupCodes")
        if not isinstance(codes, list) or not codes:
            return "백업 코드가 없다 — 휴대폰을 잃으면 아무도 못 들어간다"
        if mfa["status_before_confirm"].get("enabled"):
            return "★확인 전인데 이미 켜졌다 — 잘못 스캔한 사람이 계정에서 잠긴다★"
        return None

    @check("MFA-2", "http-api.md §2-3 — 켜진 뒤의 로그인은 토큰 대신 challenge 를 준다")
    def _():
        if mfa.get("skip"):
            return "SKIP: " + mfa["skip"]
        st2, body = mfa["challenge_response"]
        if st2 == 200:
            return "★2단계가 켜졌는데 비밀번호만으로 토큰이 나왔다★"
        if err_code(body) != "AUTH_MFA_REQUIRED":
            return f"{st2} / 코드가 {err_code(body)}"
        meta = (body.get("error") or {}).get("meta") or {}
        if not meta.get("challenge"):
            return "meta.challenge 가 없다 — 앱이 다음 단계를 부를 수 없다"
        if "accessToken" in json.dumps(body):
            return "★실패 응답에 토큰이 실려 있다★"
        return None

    @check("MFA-3", "http-api.md §2-3 — challenge + 코드로 최종 토큰이 나온다")
    def _():
        if mfa.get("skip"):
            return "SKIP: " + mfa["skip"]
        st2, body = mfa["verify_response"]
        if st2 != 200:
            return f"{st2} / {err_code(body)} — 2단계를 통과할 수 없다"
        if not (body.get("data") or {}).get("accessToken"):
            return "토큰이 없다"
        return None

    @check("MFA-4", "http-api.md §2-3 — 같은 코드를 다시 쓰면 거부한다 (재사용 방지)")
    def _():
        if mfa.get("skip"):
            return "SKIP: " + mfa["skip"]
        st2, body = mfa["replay_response"]
        if st2 == 200:
            return "★방금 쓴 코드가 다시 통했다 — 어깨너머로 본 코드가 30초간 유효하다★"
        if err_code(body) != "AUTH_MFA_INVALID":
            return f"{st2} / 코드가 {err_code(body)}"
        return None

    @check("MFA-5", "http-api.md §2-3 — 백업 코드는 한 번만 통하고 소모된다")
    def _():
        if mfa.get("skip"):
            return "SKIP: " + mfa["skip"]
        st2, body = mfa["backup_response"]
        if st2 != 200:
            return f"백업 코드로 들어갈 수 없다: {st2} / {err_code(body)}"
        left = mfa["status_after_backup"].get("backupCodesRemaining")
        issued = len(mfa["setup"].get("backupCodes") or [])
        if left != issued - 1:
            return f"남은 코드가 {left} (발급 {issued}) — 소모되지 않았다"
        st3, _b = mfa["backup_replay_response"]
        if st3 == 200:
            return "★한 번 쓴 백업 코드가 다시 통했다★"
        return None

    @check("MFA-6", "http-api.md §2-3 — 해제는 현재 비밀번호를 요구한다")
    def _():
        if mfa.get("skip"):
            return "SKIP: " + mfa["skip"]
        st_wrong, _b = mfa["disable_wrong_password"]
        if st_wrong == 200:
            return "★비밀번호 없이 2단계를 끌 수 있다 — 자리를 비운 사이 꺼진다★"
        st_ok, body = mfa["disable_response"]
        if st_ok != 200:
            return f"해제 실패: {st_ok} / {err_code(body)}"
        if mfa["login_after_disable"][0] != 200:
            return "해제했는데 비밀번호만으로 로그인되지 않는다"
        return None

    @check("MFA-7", "http-api.md §4 — 2단계 초기화는 관리 권한을 요구한다")
    def _():
        token = mfa.get("token")
        if not token or mfa.get("user_id") is None:
            return "SKIP: 검사용 계정이 없다"
        # 아무나 남의 2단계를 끌 수 있으면 2단계는 아무것도 막지 못한다
        st2, body = api.call("POST", f"/admin/users/{mfa['user_id']}/mfa-reset", {},
                             token=token)
        if st2 == 200:
            return "★권한 없는 토큰으로 남의 2단계를 초기화할 수 있다★"
        if err_code(body) != "AUTHZ_FORBIDDEN":
            return f"{st2} / 코드가 {err_code(body)}"
        return None

    @check("MFA-8", "http-api.md §4 — 관리자 초기화는 반드시 감사 로그에 남는다")
    def _():
        uid = mfa.get("user_id")
        if uid is None:
            return "SKIP: 검사용 계정이 없다"
        st2, body = api.call("POST", f"/admin/users/{uid}/mfa-reset", {}, token=admin_token)
        if st2 == 403 and err_code(body) == "AUTHZ_FORBIDDEN":
            return "SKIP: mfa.admin-reset 이 꺼진 인스턴스다"
        if st2 != 200:
            return f"{st2} / {err_code(body)}"
        # 기록이 남지 않으면 관리자가 남의 2단계를 조용히 끄고 그 계정으로 들어갈 수 있다
        _st, logs = api.call(
            "GET", f"/admin/audit-logs?eventType=MFA_RESET_BY_ADMIN&userId={uid}&size=10",
            token=admin_token)
        if not (logs.get("data", {}).get("items") or []):
            return "★초기화했는데 감사 기록이 없다 — 관리자가 조용히 끌 수 있다는 뜻이다★"
        return None

    @check("ACC-12", "http-api.md §2-1 — 탈퇴는 현재 비밀번호 없이 되지 않는다")
    def _():
        token = mfa.get("token")
        if not token:
            return "SKIP: 검사용 계정 토큰이 없다"
        # 일부러 틀린 비밀번호로 친다 — 맞는 값을 보내면 그 계정이 실제로 닫힌다.
        # 탈퇴가 꺼진 인스턴스면 비밀번호를 보기도 전에 막히는 것이 정상이다
        st2, body = api.call("POST", "/auth/account/delete",
                             {"currentPassword": "definitely-wrong"}, token=token)
        if st2 == 200:
            return "★비밀번호 없이 계정이 닫힌다 — 자리를 비운 사이 남이 닫을 수 있다★"
        if err_code(body) not in ("AUTH_SELF_DELETE_DISABLED", "AUTH_INVALID_CREDENTIALS"):
            return f"{st2} / 코드가 {err_code(body)}"
        return None

    # ────────── 약관 · 속성 · 일괄 등록 ──────────
    #
    # 살아 있는 인스턴스를 건드리는 검사다. 지켜야 할 두 가지:
    #   · **필수 약관을 만들지 않는다.** 게시하는 순간 그 인스턴스의 모든 사용자가
    #     재동의 대상이 되고, 앱이 그 신호를 처리하지 않으면 화면이 멈춘다
    #   · 만든 것은 반드시 치운다. 동의가 붙기 전에 지우므로 증빙을 지우는 일도 없다

    probe_term_id = None
    probe_attr_key = None
    bulk_created: list = []

    @check("TERM-1", "http-api.md §2-1 — 약관 목록은 로그인 전에도 볼 수 있어야 한다")
    def _():
        # access token 을 요구하면 가입하려는 사람이 약관을 읽을 수 없다.
        # 게시된 약관은 어차피 공개 문서라 감출 것이 없다
        st2, body = api.call("GET", "/auth/terms")
        if st2 != 200:
            return f"상태 {st2}: {body}"
        if not isinstance((body.get("data") or {}).get("items"), list):
            return f"items 배열이 아니다: {body}"
        return None

    @check("TERM-2", "http-api.md §2-1 — 초안은 사용자에게 보이지 않는다")
    def _():
        nonlocal probe_term_id
        code = "conformance-probe-" + uuid.uuid4().hex[:8]
        # required=false 로 만든다 — 필수로 만들면 이 인스턴스의 전원이 재동의 대상이 된다
        st2, body = api.call("POST", "/admin/terms", {
            "code": code, "title": "적합성 검사(선택 약관)", "body": "검사용. 곧 삭제된다.",
            "required": False}, token=admin_token)
        if st2 not in (200, 201):
            return f"약관을 만들 수 없다: {st2} / {err_code(body)}"
        probe_term_id = (body.get("data") or {}).get("id")
        if (body.get("data") or {}).get("version") != 1:
            return f"첫 버전이 1 이 아니다: {(body.get('data') or {}).get('version')}"
        if (body.get("data") or {}).get("publishedAt"):
            return "★만들자마자 게시됐다 — 다듬는 중인 문안이 가입 화면에 뜬다★"

        _st, listed = api.call("GET", "/auth/terms")
        if any(t.get("code") == code for t in items_of(listed)):
            return "★초안이 사용자 목록에 나온다★"

        st3, pub = api.call("POST", f"/admin/terms/{probe_term_id}/publish", {},
                            token=admin_token)
        if st3 != 200:
            return f"게시 실패: {st3} / {err_code(pub)}"
        _st, listed = api.call("GET", "/auth/terms")
        shown = any(t.get("code") == code for t in items_of(listed))
        enabled = setting_value(api, admin_token, "terms.enabled") == "true"
        if enabled and not shown:
            return "게시했는데 사용자 목록에 나오지 않는다"
        if not enabled and shown:
            return "terms.enabled 가 꺼져 있는데 목록에 나온다"
        if not enabled:
            return ("SKIP: terms.enabled 가 꺼진 인스턴스다 — 초안 비노출까지만 확인했다."
                    " 켜면 게시본 노출도 함께 검사된다")
        return None

    @check("TERM-3", "config.md §5-2 — 동의 이력을 지우는 경로는 없다")
    def _():
        if probe_term_id is None:
            return "SKIP: 검사용 약관이 없다"
        # 지울 수 있는 경로가 하나라도 있으면 그 순간 증빙이 아니게 된다
        st2, _b = api.call("DELETE", f"/admin/terms/{probe_term_id}/agreements",
                           token=admin_token)
        if st2 in (200, 204):
            return "★동의 이력을 통째로 지우는 엔드포인트가 있다★"
        return None

    @check("ATTR-1", "http-api.md §4 — 속성 정의가 있으면 타입을 검사한다")
    def _():
        nonlocal probe_attr_key
        if skip_reason:
            return skip_reason
        probe_attr_key = "conformanceProbe" + uuid.uuid4().hex[:6]
        # required=false 다. 필수로 두면 정의가 살아 있는 동안 이 인스턴스의 모든
        # 사용자 수정이 400 이 된다
        st2, body = api.call("POST", "/admin/user-attributes", {
            "key": probe_attr_key, "label": "적합성 검사", "type": "ENUM",
            "options": "가,나", "required": False}, token=admin_token)
        if st2 not in (200, 201):
            probe_attr_key = None
            return f"정의를 만들 수 없다: {st2} / {err_code(body)}"

        st3, bad = api.call("PATCH", f"/admin/users/{probe_id}",
                            {"attributes": {probe_attr_key: "다"}}, token=admin_token)
        if st3 == 200:
            return "★선택지에 없는 값이 그대로 저장된다 — 정의가 있으나 마나다★"
        if err_code(bad) != "VALIDATION_FAILED":
            return f"{st3} / 코드가 {err_code(bad)}"
        if probe_attr_key not in json.dumps(bad, ensure_ascii=False):
            return "어느 속성이 틀렸는지 details 에 없다"

        st4, okr = api.call("PATCH", f"/admin/users/{probe_id}",
                            {"attributes": {probe_attr_key: "가"}}, token=admin_token)
        if st4 != 200:
            return f"올바른 값이 거부됐다: {st4} / {err_code(okr)}"
        return None

    @check("BULK-1", "config.md §5-2 — 일괄 등록 상한을 넘으면 통째로 거절한다")
    def _():
        raw = setting_value(api, admin_token, "account.bulk-import-max")
        try:
            limit = int(raw)
        except (TypeError, ValueError):
            return f"SKIP: account.bulk-import-max 를 읽을 수 없다({raw!r})"
        rows = "\n".join(f"overflow-{i}@ix-auth.invalid,초과 {i},USER" for i in range(limit + 1))
        st2, body = api.call_text("POST", "/admin/users/bulk?invite=false",
                                  "email,name,roles\n" + rows, token=admin_token)
        if st2 == 200:
            return "★상한이 없으면 요청 하나로 서버를 세울 수 있다★"
        if err_code(body) != "VALIDATION_FAILED":
            return f"{st2} / 코드가 {err_code(body)}"
        # 앞의 limit 건만 처리하고 나머지를 버렸다면, 일부만 들어간 것을 아무도 모른다
        _st, made = api.call("GET", "/admin/users?q=overflow-0@ix-auth.invalid",
                             token=admin_token)
        if (made.get("data") or {}).get("total"):
            return "★상한을 넘었는데 앞부분이 들어갔다 — 일부만 들어간 것을 알아챌 수 없다★"
        return None

    @check("BULK-2", "http-api.md §4 — 한 줄이 틀려도 나머지는 들어간다")
    def _():
        tag = uuid.uuid4().hex[:8]
        good1 = f"bulk-{tag}-1@ix-auth.invalid"
        good2 = f"bulk-{tag}-2@ix-auth.invalid"
        csv = ("email,name,roles\n"
               f"{good1},일괄 하나,USER\n"
               "not-an-email,일괄 둘,USER\n"
               f"{good2},일괄 셋,USER\n")
        st2, body = api.call_text("POST", "/admin/users/bulk?invite=false", csv,
                                  token=admin_token)
        if st2 != 200:
            return f"{st2} / {err_code(body)}"
        data = body.get("data") or {}
        for email in (good1, good2):
            _st, found = api.call("GET", f"/admin/users?q={email}", token=admin_token)
            for u in items_of(found):
                bulk_created.append(u.get("id"))
        if data.get("created") != 2:
            return (f"★{data.get('created')}건만 들어갔다 — 한 줄 때문에 전체가 실패하면"
                    " 관리자는 고쳐서 통째로 다시 올리게 되고, 그러면 중복 오류가 난다★")
        if data.get("failed") != 1:
            return f"실패가 {data.get('failed')}건 (형식이 틀린 한 줄이어야 한다)"
        results = data.get("results") or []
        broken = [r for r in results if r.get("status") != "CREATED"]
        if not broken or not broken[0].get("line") or not broken[0].get("error"):
            return "실패한 줄의 번호·사유가 없다 — 300줄을 눈으로 훑게 된다"
        return None

    @check("SET-2", "config.md §5-0 — 이번 정책 5종도 전부 화면에서 켜고 끌 수 있다")
    def _():
        st2, body = api.call("GET", "/admin/settings", token=admin_token)
        if st2 != 200:
            return f"상태 {st2}"
        keys = {i.get("key") for i in items_of(body)}
        missing = [k for k in ("terms.enabled", "terms.require-on-signup",
                               "terms.reagreement-required", "password.history-count",
                               "password.check-breached", "account.strict-attributes",
                               "account.bulk-import-max") if k not in keys]
        if missing:
            return f"정의 미등록이라 화면에서 바꿀 수 없다: {', '.join(missing)}"
        return None

    @check("SOC-1", "http-api.md §2-2 — 꺼진 provider 는 404 (존재 여부를 알리지 않는다)")
    def _():
        st2, body = api.call(
            "GET", "/auth/social/definitely-not-a-provider/authorize-url?redirectUri=x")
        if st2 == 200:
            return "★모르는 provider 가 authorize URL 을 돌려줬다★"
        if st2 != 404:
            return f"상태 {st2} (계약은 404 — 400 이면 '설정 안 된 방식' 임이 드러난다)"
        return None

    @check("SOC-2", "http-api.md §2-2 — 위조 state 는 거부")
    def _():
        _, providers = api.call("GET", "/auth/social/providers")
        enabled = (providers.get("data") or {}).get("providers") or []
        if not enabled:
            return "SKIP: 켜져 있는 소셜 provider 가 없다"
        st2, body = api.call("POST", f"/auth/social/{enabled[0].lower()}/callback",
                             {"code": "fake-code", "state": "forged-" + uuid.uuid4().hex})
        if st2 == 200:
            return "★위조 state 로 로그인이 됐다 — CSRF 방어가 없다★"
        if err_code(body) != "AUTH_SOCIAL_STATE_INVALID":
            return f"{st2} / 코드가 {err_code(body)}"
        return None

    @check("SOC-3", "http-api.md §2-2 — state 는 1회용이고 평문으로 저장되지 않는다")
    def _():
        _, providers = api.call("GET", "/auth/social/providers")
        enabled = (providers.get("data") or {}).get("providers") or []
        if not enabled:
            return "SKIP: 켜져 있는 소셜 provider 가 없다"
        name = enabled[0].lower()
        st2, body = api.call(
            "GET", f"/auth/social/{name}/authorize-url?redirectUri=http://localhost/cb")
        if st2 != 200:
            return f"authorize-url 상태 {st2}"
        data = body.get("data", {})
        if not data.get("url", "").startswith("http"):
            return f"url 이 이상하다: {data.get('url')}"
        if not data.get("state"):
            return "state 가 없다 — CSRF 방어가 성립하지 않는다"
        if len(data["state"]) < 20:
            return f"state 가 너무 짧다({len(data['state'])}자) — 추측 가능하다"
        return None

    @check("SOC-4", "http-api.md §2-2 — 소셜 연결 관리는 access token 전용")
    def _():
        st2, _b = api.call("GET", "/auth/social/links")
        if st2 != 401:
            return f"★서비스 키만으로 {st2}★"
        return None

    # ────────── 로그인 수단 4종 (2026-08-08) ──────────

    @check("SOC-5", "config.md §5-3 — Google provider 가 등록돼 있다")
    def _():
        _, providers = api.call("GET", "/auth/social/providers")
        enabled = (providers.get("data") or {}).get("providers") or []
        if "GOOGLE" not in enabled:
            # 키가 없으면 목록에 나오지 않는 것이 계약이다(client-id 미설정 = 꺼짐).
            # 그래도 '모르는 provider' 와 구분되는지는 확인한다
            st2, _b = api.call(
                "GET", "/auth/social/google/authorize-url?redirectUri=http://localhost/cb")
            if st2 != 404:
                return f"꺼진 provider 인데 {st2} — 계약은 404 다"
            return "SKIP: Google 이 설정돼 있지 않다 (client-id 미설정)"

        st2, body = api.call(
            "GET", "/auth/social/google/authorize-url?redirectUri=http://localhost/cb")
        if st2 != 200:
            return f"authorize-url 상태 {st2}"
        url = (body.get("data") or {}).get("url", "")
        if not url.startswith("https://accounts.google.com/o/oauth2/v2/auth"):
            return f"동의 화면 주소가 다르다: {url[:80]}"
        # PKCE 가 빠지면 code 를 가로챈 쪽이 그대로 토큰으로 바꿀 수 있다
        if "code_challenge=" not in url or "code_challenge_method=S256" not in url:
            return "★PKCE(S256)가 붙지 않았다★"
        if "openid" not in url:
            return "scope 에 openid 가 없다 — userinfo 가 sub 를 주지 않아 계정 매칭이 깨진다"
        return None

    @check("MAGIC-1", "http-api.md §2-5 — 매직 링크는 계정 존재를 알려 주지 않는다")
    def _():
        enabled = setting_value(api, admin_token, "account.magic-link-enabled")
        if enabled != "true":
            # 기본값(꺼짐)에서는 전역 스위치라 403 이다. 이건 계정과 무관하므로 알려 줘도 된다
            st2, body = api.call("POST", "/auth/magic-link/request",
                                 {"email": f"nobody-{uuid.uuid4().hex[:6]}@nowhere.invalid"})
            if st2 != 403 or err_code(body) != "AUTHZ_FORBIDDEN":
                return f"꺼져 있는데 {st2} / {err_code(body)} (계약은 403 AUTHZ_FORBIDDEN)"
            return None

        # 켜져 있다면 없는 주소도 성공 응답이어야 한다
        st2, body = api.call("POST", "/auth/magic-link/request",
                             {"email": f"nobody-{uuid.uuid4().hex[:6]}@nowhere.invalid"})
        if st2 != 200:
            return (f"★없는 주소에 {st2} — 응답이 갈리면 이 화면이"
                    " 가입자 명부 조회 도구가 된다★")
        return None

    @check("MAGIC-2", "http-api.md §2-5 — 위조·타용도 토큰으로는 로그인되지 않는다")
    def _():
        enabled = setting_value(api, admin_token, "account.magic-link-enabled")
        if enabled != "true":
            return "SKIP: account.magic-link-enabled 가 꺼져 있다"
        st2, body = api.call("POST", "/auth/magic-link/verify",
                             {"token": "forged-" + uuid.uuid4().hex})
        if st2 == 200:
            return "★위조 토큰으로 로그인이 됐다★"
        if err_code(body) not in ("AUTH_TOKEN_INVALID", "AUTH_TOKEN_EXPIRED"):
            return f"{st2} / 코드가 {err_code(body)}"
        return None

    @check("CAP-1", "config.md §5-6 — CAPTCHA 는 화면에서 켜고, 시크릿은 화면에 없다")
    def _():
        st2, body = api.call("GET", "/admin/settings", token=admin_token)
        if st2 != 200:
            return f"상태 {st2}"
        keys = {i.get("key") for i in items_of(body)}
        missing = [k for k in ("captcha.enabled", "captcha.provider",
                               "captcha.min-score", "captcha.protect") if k not in keys]
        if missing:
            return f"정의 미등록이라 화면에서 바꿀 수 없다: {', '.join(missing)}"
        # 시크릿을 화면에서 편집할 수 있으면 DB·감사로그·백업으로 유출면이 넓어진다
        if "captcha.secret-key" in keys:
            return "★시크릿(captcha.secret-key)이 설정 목록에 노출돼 있다★"
        return None

    @check("CAP-2", "config.md §5-6 — 기본값(꺼짐)에서는 captchaToken 없이 그대로 동작한다")
    def _():
        if setting_value(api, admin_token, "captcha.enabled") == "true":
            return "SKIP: CAPTCHA 가 켜져 있다 (기본값 동작을 확인할 수 없다)"
        # 토큰 없이 보낸 요청이 CAPTCHA 때문에 막히지 않아야 한다.
        # 없는 계정이라 결과는 어차피 조용한 성공이고, 여기서 400 이 나오면 그건 게이트다
        st2, body = api.call("POST", "/auth/password/forgot",
                             {"email": f"nobody-{uuid.uuid4().hex[:6]}@nowhere.invalid"})
        if err_code(body) == "AUTH_CAPTCHA_REQUIRED":
            return "★꺼져 있는데 토큰을 요구한다 — 업그레이드하는 순간 기존 앱이 깨진다★"
        if st2 not in (200, 429):
            return f"상태 {st2}"
        return None

    @check("STEP-1", "config.md §5-4 — step-up 은 기본이 비어 있다 (요구하지 않음)")
    def _():
        st2, body = api.call("GET", "/admin/settings", token=admin_token)
        if st2 != 200:
            return f"상태 {st2}"
        found = None
        for item in items_of(body):
            if item.get("key") == "mfa.step-up-actions":
                found = item
                break
        if found is None:
            return "정의 미등록이라 화면에서 바꿀 수 없다: mfa.step-up-actions"
        # 앱이 mfaCode 를 보내도록 고치기 전에 켜지면 그 화면들이 전부 실패한다
        if (found.get("value") or "").strip():
            return (f"기본이 비어 있지 않다: {found.get('value')!r}"
                    " — 앱을 먼저 고치지 않았다면 민감 작업이 막힌다")
        return None

    @check("STEP-2", "http-api.md §2-6 — 코드 없이도 지금까지처럼 비밀번호를 바꿀 수 있다")
    def _():
        if (setting_value(api, admin_token, "mfa.step-up-actions") or "").strip():
            return "SKIP: step-up 이 켜져 있다 (기본값 동작을 확인할 수 없다)"
        token = mfa.get("token")
        if not token:
            return "SKIP: 검사용 계정 토큰이 없다"
        # 틀린 현재 비밀번호로 친다 — 계정을 실제로 바꾸지 않으면서 게이트만 본다.
        # AUTH_MFA_REQUIRED 가 나오면 step-up 이 꺼져 있는데도 걸린 것이다
        st2, body = api.call("POST", "/auth/password/change",
                             {"currentPassword": "wrong-on-purpose",
                              "newPassword": "N3wPassw0rd!x"}, token=token)
        if err_code(body) == "AUTH_MFA_REQUIRED":
            return "★꺼져 있는데 코드를 요구한다 — 업그레이드하는 순간 기존 앱이 깨진다★"
        if st2 not in (401, 400):
            return f"상태 {st2} / {err_code(body)}"
        return None

    # ────────── 운영·관리 (메일 이력 · 템플릿 · 내보내기 · 상세 · 설정 이력 · 키 회전) ──────────

    @check("MAIL-1", "http-api.md §4 — 발송 이력에 본문·링크를 담지 않는다")
    def _():
        st2, body = api.call("GET", "/admin/mail-deliveries?size=20", token=admin_token)
        if st2 != 200:
            return f"상태 {st2}"
        rows = items_of(body)
        for row in rows:
            for leaked in ("body", "link", "token"):
                if leaked in row:
                    return (f"★이력에 {leaked} 가 실려 있다 — 재설정 링크가 DB 에 남으면"
                            " 그것이 곧 계정 탈취 경로다★")
            for required in ("status", "attempts", "to", "kind"):
                if required not in row:
                    return f"{required} 가 없다 — 운영자가 '안 갔다' 를 알 수 없다"
        if rows and not any(r.get("status") for r in rows):
            return "상태가 비어 있다"
        return None

    @check("MAIL-2", "http-api.md §4 — 메일을 보내면 이력이 남는다")
    def _():
        before = api.call("GET", "/admin/mail-deliveries?size=1", token=admin_token)[1]
        total_before = (before.get("data") or {}).get("total") or 0
        # 계정 유무와 무관하게 같은 응답을 주는 경로다(ACC-1). 있는 계정으로 쳐야 실제로 나간다
        st2, _b = api.call("POST", "/auth/password/forgot", {"email": probe_email})
        if st2 != 200:
            return f"SKIP: forgot 상태 {st2}"
        after = api.call("GET", "/admin/mail-deliveries?size=1", token=admin_token)[1]
        total_after = (after.get("data") or {}).get("total") or 0
        if total_after <= total_before:
            return "★메일을 보냈는데 이력이 늘지 않았다 — 삼키면 아무도 모른다★"
        return None

    @check("MAIL-3", "config.md §5-1 — 템플릿은 ko·en 기본값이 있고 고치기 전엔 '기본값' 이다")
    def _():
        st2, body = api.call("GET", "/admin/mail-templates", token=admin_token)
        if st2 != 200:
            return f"상태 {st2}"
        rows = body.get("data") or []
        pairs = {(r.get("kind"), r.get("locale")) for r in rows}
        for locale in ("ko", "en"):
            if ("PASSWORD_RESET", locale) not in pairs:
                return f"PASSWORD_RESET / {locale} 기본 템플릿이 없다"
        for row in rows:
            if not row.get("subject") or not row.get("body"):
                return f"{row.get('kind')}/{row.get('locale')} 의 제목·본문이 비어 있다"
        return None

    @check("MAIL-4", "http-api.md §4 — 미리보기는 진짜 토큰을 만들지 않는다")
    def _():
        st2, body = api.call("POST", "/admin/mail-templates/preview",
                             {"kind": "PASSWORD_RESET", "locale": "ko"}, token=admin_token)
        if st2 != 200:
            return f"상태 {st2}"
        data = body.get("data") or {}
        if "{name}" in data.get("body", ""):
            return "자리표시자가 치환되지 않았다 — 미리보기의 목적이 그것이다"
        # 미리보기가 유효한 재설정 링크를 만들면, 관리 화면을 여는 것만으로 계정을 가져갈 수 있다
        _st, tokens = api.call("GET", "/admin/system/verification-tokens?size=5",
                               token=admin_token)
        for row in tokens.get("data") or []:
            if row.get("purpose") == "PASSWORD_RESET" and row.get("email", "").startswith("("):
                return "★미리보기가 실제 토큰을 발급했다★"
        return None

    @check("AUD-1", "http-api.md §4 — 감사 로그 CSV 는 상한이 있고 내보낸 사실이 남는다")
    def _():
        st2, text = api.call("GET", "/admin/audit-logs/export?eventType=LOGIN_SUCCESS",
                             token=admin_token, raw=True)
        if st2 != 200:
            return f"상태 {st2}"
        head = text.lstrip("﻿").splitlines()[0] if text.strip() else ""
        if not head.startswith("id,createdAt,eventType"):
            return f"머리글이 다르다: {head[:60]!r}"
        # 내려받은 파일에는 이메일·IP 가 들어 있다. 반출 기록이 없으면 어디로 나갔는지 못 찾는다
        _st, logs = api.call("GET", "/admin/audit-logs?eventType=AUDIT_EXPORTED&size=5",
                             token=admin_token)
        if not items_of(logs):
            return "★내보냈는데 감사 로그에 남지 않았다★"
        return None

    @check("AUD-2", "http-api.md §4 — 감사 로그는 기간으로 좁힐 수 있다")
    def _():
        far = "2000-01-01T00:00:00Z"
        st2, body = api.call("GET", f"/admin/audit-logs?from={far}&to={far}",
                             token=admin_token)
        if st2 != 200:
            return f"상태 {st2}"
        if items_of(body):
            return "★2000년 한 시점으로 좁혔는데 결과가 나온다 — 기간 필터가 먹지 않는다★"
        return None

    @check("USR-1", "http-api.md §4 — 사용자 상세에 시크릿이 실리지 않는다")
    def _():
        if probe_id is None:
            return "SKIP: 검사용 계정이 없다"
        st2, body = api.call("GET", f"/admin/users/{probe_id}/detail", token=admin_token)
        if st2 != 200:
            return f"상태 {st2}"
        data = body.get("data") or {}
        for section in ("roles", "sessions", "identities", "mfa", "recentAudit"):
            if section not in data:
                return f"{section} 가 없다 — 한 사람을 한눈에 보는 것이 이 화면의 목적이다"
        blob = json.dumps(data, ensure_ascii=False).lower()
        for leaked in ("secretenc", "passwordhash", "backupcodeshash", "refreshtoken"):
            if leaked in blob:
                return f"★상세에 {leaked} 가 실려 있다★"
        if "backupCodesLeft" not in json.dumps(data):
            return "백업 코드는 개수만 줘야 한다 (남은 개수 필드가 없다)"
        return None

    @check("SET-3", "config.md §5-0 — 설정 항목별 변경 이력을 볼 수 있다")
    def _():
        st2, body = api.call("GET", "/admin/settings/account.signup-mode/history",
                             token=admin_token)
        if st2 != 200:
            return f"상태 {st2}"
        if not isinstance(body.get("data"), list):
            return "이력이 배열이 아니다"
        # 정의에 없는 키는 거부해야 한다 — 아무 키나 받으면 오타가 조용히 빈 결과가 된다
        st3, body3 = api.call("GET", "/admin/settings/nope.not-a-setting/history",
                              token=admin_token)
        if st3 != 400 or err_code(body3) != "VALIDATION_FAILED":
            return f"모르는 키에 {st3} / {err_code(body3)}"
        return None

    @check("KEY-1", "config.md §4 — 서명 키 회전 주기를 화면에서 바꿀 수 있다")
    def _():
        raw = setting_value(api, admin_token, "jwt.key-rotation-days")
        if raw is None:
            return "정의 미등록이라 화면에서 바꿀 수 없다 — 스케줄러만 있고 손잡이가 없다"
        try:
            if int(raw) < 0:
                return f"값이 이상하다: {raw!r}"
        except (TypeError, ValueError):
            return f"정수가 아니다: {raw!r}"
        # 회전하더라도 구 키는 JWKS 에 남아야 한다 — 즉시 지우면 아직 유효한 토큰이 깨진다
        _st, jwks = api.call("GET", "/.well-known/jwks.json", service_key=False)
        if not (jwks.get("keys") or []):
            return "JWKS 가 비었다"
        return None

    @check("RATE-3", "config.md §9 — 속도 제한 저장소는 기본이 인스턴스 메모리다")
    def _():
        raw = setting_value(api, admin_token, "rate-limit.storage")
        if raw is None:
            return "정의 미등록이라 다중 인스턴스 대응을 켤 수 없다"
        if raw not in ("MEMORY", "DATABASE"):
            return f"값이 이상하다: {raw!r}"
        if raw != "MEMORY":
            return f"SKIP: 이 인스턴스는 {raw} 로 설정돼 있다 (기본값 확인 불가)"
        return None

    # ────────── 사용자 대리 (impersonation) ──────────
    #
    # 전용 계정으로 돈다. 관리자를 대리하면 자기 자신이라 400 이고, 다른 실제
    # 사용자를 골라 쓰면 그 사람 이름으로 감사 로그가 쌓인다.

    imp_email = f"conformance-imp-{uuid.uuid4().hex[:10]}@ix-auth.invalid"
    imp_pw = "C0nf0rm!Imp-" + uuid.uuid4().hex[:6]
    st, created = api.call("POST", "/admin/users",
                           {"email": imp_email, "name": "적합성 검사(대리)", "password": imp_pw},
                           token=admin_token)
    imp_id = (created.get("data") or {}).get("id") if st in (200, 201) else None
    imp_skip = None if imp_id else (
        f"SKIP: 대리 대상 계정 생성 실패({st}) — 관리자를 대리하면 자기 자신이라 검사할 수 없다")
    admin_id = str(claims_of(admin_token).get("sub")) if admin_token else None

    def start_impersonation():
        """(status, data) — 실패해도 값으로 돌려준다"""
        st2, body = api.call("POST", f"/admin/users/{imp_id}/impersonate", {},
                             token=admin_token)
        return st2, (body.get("data") or {}), body

    @check("IMP-1", "http-api.md §4 — 대리 응답은 로그인 봉투 + 대상 사용자")
    def _():
        if imp_skip:
            return imp_skip
        st2, data, body = start_impersonation()
        if st2 != 200:
            return f"상태 {st2}: {body}"
        for field in ("accessToken", "refreshToken", "expiresIn", "user"):
            if field not in data:
                return f"{field} 가 없다 — 로그인과 같은 봉투여야 한다"
        if (data.get("user") or {}).get("email") != imp_email:
            return f"★대상이 아닌 사용자의 토큰이 나왔다: {(data.get('user') or {}).get('email')}★"
        if (data.get("impersonator") or {}).get("id") != admin_id:
            return f"impersonator 가 호출자와 다르다: {data.get('impersonator')}"
        return None

    @check("IMP-2", "token.md §3 — 대리 access token 에 표준 act 클레임")
    def _():
        if imp_skip:
            return imp_skip
        st2, data, body = start_impersonation()
        if st2 != 200:
            return f"상태 {st2}: {body}"
        claims = claims_of(data["accessToken"])
        if str(claims.get("sub")) != str(imp_id):
            return f"★sub 이 대상이 아니다({claims.get('sub')}) — 앱이 엉뚱한 권한으로 동작한다★"
        act = claims.get("act")
        if not isinstance(act, dict):
            return "★act 가 없다 — 누가 대리 중인지 토큰만으로 알 수 없다★"
        if str(act.get("sub")) != admin_id:
            return f"act.sub 이 호출자와 다르다: {act}"
        if "ixauth_act" in claims:
            return "act 는 RFC 8693 표준 이름이다 — ixauth_ 접두어를 붙이지 않는다"
        return None

    @check("IMP-3", "token.md §3 — 평범한 로그인 토큰에는 act 가 없다")
    def _():
        if "act" in claims_of(admin_token):
            return "★대리가 아닌 토큰에 act 가 붙어 있다 — 유무로 대리를 판단할 수 없다★"
        return None

    @check("IMP-4", "http-api.md §4 — 대리 토큰은 대상 사용자로 통한다")
    def _():
        if imp_skip:
            return imp_skip
        st2, data, body = start_impersonation()
        if st2 != 200:
            return f"상태 {st2}: {body}"
        st3, me = api.call("GET", "/auth/me", token=data["accessToken"])
        if st3 != 200:
            return f"/auth/me 상태 {st3}: {me}"
        if (me.get("data") or {}).get("email") != imp_email:
            return f"대상이 아닌 사람으로 인식된다: {me.get('data')}"
        return None

    @check("IMP-5", "http-api.md §4 — 대리 세션은 관리 API 와 재대리를 할 수 없다")
    def _():
        if imp_skip:
            return imp_skip
        st2, data, body = start_impersonation()
        if st2 != 200:
            return f"상태 {st2}: {body}"
        token = data["accessToken"]
        st3, b3 = api.call("GET", "/admin/users", token=token)
        if st3 != 403 or err_code(b3) != "IMPERSONATION_ACTION_FORBIDDEN":
            return f"★관리 API 가 대리 세션에 열려 있다 ({st3} / {err_code(b3)})★"
        st4, b4 = api.call("POST", f"/admin/users/{imp_id}/impersonate", {}, token=token)
        if st4 != 403:
            return f"★재대리가 막히지 않는다 ({st4}) — 대리 사슬을 되짚을 수 없게 된다★"
        st5, b5 = api.call("POST", "/auth/password/change",
                           {"currentPassword": imp_pw, "newPassword": "N3w!" + uuid.uuid4().hex[:8]},
                           token=token)
        if st5 != 403 or err_code(b5) != "IMPERSONATION_ACTION_FORBIDDEN":
            return f"★대리 중에 비밀번호를 바꿀 수 있다 ({st5} / {err_code(b5)})★"
        return None

    @check("IMP-6", "token.md §3 — refresh 회전에도 act 가 유지된다")
    def _():
        if imp_skip:
            return imp_skip
        st2, data, body = start_impersonation()
        if st2 != 200:
            return f"상태 {st2}: {body}"
        st3, rotated = api.call("POST", "/auth/refresh",
                                {"refreshToken": data["refreshToken"]})
        if st3 != 200:
            return f"회전 실패 {st3}: {rotated}"
        claims = claims_of((rotated.get("data") or {})["accessToken"])
        act = claims.get("act")
        if not isinstance(act, dict) or str(act.get("sub")) != admin_id:
            return "★회전하면 대리 사실이 사라진다 — 그 뒤의 조작은 본인이 한 것으로 남는다★"
        return None

    @check("IMP-7", "http-api.md §4 — 자기 자신은 대리할 수 없다")
    def _():
        if admin_id is None:
            return "SKIP: 관리자 id 를 알 수 없다"
        st2, body = api.call("POST", f"/admin/users/{admin_id}/impersonate", {},
                             token=admin_token)
        if st2 != 400 or err_code(body) != "IMPERSONATION_SELF":
            return f"{st2} / 코드가 {err_code(body)}"
        return None

    @check("IMP-8", "http-api.md §4 — 대리 세션은 세션 목록에 보이고 감사 로그에 남는다")
    def _():
        if imp_skip:
            return imp_skip
        st2, _data, body = start_impersonation()
        if st2 != 200:
            return f"상태 {st2}: {body}"

        st3, sessions = api.call("GET", f"/admin/users/{imp_id}/sessions", token=admin_token)
        rows = [s for s in (sessions.get("data") or []) if s.get("impersonated")]
        if st3 != 200 or not rows:
            return f"★대리 세션이 세션 목록에 없다 ({st3}) — 보이지 않으면 끊을 수도 없다★"
        if not rows[0].get("impersonatorEmail"):
            return "누가 대리 중인지 목록에서 알 수 없다"

        st4, audit = api.call(
            "GET", f"/admin/audit-logs?eventType=IMPERSONATION_STARTED&userId={imp_id}",
            token=admin_token)
        entries = items_of(audit)
        if st4 != 200 or not entries:
            return "★대리 시작이 감사 로그에 없다 — 이 기록은 끌 수 없어야 한다★"
        if str(entries[0].get("actorId")) != admin_id:
            return f"actorId 가 호출자와 다르다: {entries[0].get('actorId')}"
        return None

    # ────────── 연합 신원 교환 (federated exchange) ──────────
    #
    # 기본이 꺼짐이라 대부분의 인스턴스에서는 FED-1 만 통과하고 나머지는 SKIP 된다.
    # **설정을 바꾸지 않는다** — 켜면 그 순간부터 서비스 키를 쥔 쪽이 아무 신원이나
    # 주장할 수 있게 되고, 검사기가 중간에 죽으면 켠 채로 남는다.

    fed_enabled = str(setting_value(api, admin_token, "federation.enabled")).lower() == "true"
    fed_providers = [p.strip() for p in
                     str(setting_value(api, admin_token, "federation.allowed-providers") or "")
                     .split(",") if p.strip()]

    def fed_exchange(provider, subject=None, email=None, service_key=True):
        body = {"provider": provider,
                "subject": subject or f"conformance-{uuid.uuid4().hex}",
                "email": email or f"conformance-fed-{uuid.uuid4().hex[:10]}@ix-auth.invalid",
                "name": "적합성 검사(연합)",
                "ip": "203.0.113.7",
                "userAgent": "ix-auth-conformance"}
        return api.call("POST", "/auth/federated/exchange", body, service_key=service_key)

    @check("FED-1", "http-api.md §2-7 — 꺼져 있으면 AUTH_FEDERATION_DISABLED 403")
    def _():
        if fed_enabled:
            return "SKIP: federation.enabled 가 켜진 인스턴스다 (기본값 동작을 확인할 수 없다)"
        st, body = fed_exchange("nexus-hub")
        if st != 403 or err_code(body) != "AUTH_FEDERATION_DISABLED":
            return f"{st} / 코드가 {err_code(body)}"
        return None

    @check("FED-2", "http-api.md §2-7 — 허용 목록 밖 provider 는 403")
    def _():
        if not fed_enabled:
            return "SKIP: federation.enabled 가 꺼져 있다"
        st, body = fed_exchange("conformance-not-allowed-" + uuid.uuid4().hex[:6])
        if st != 403 or err_code(body) != "AUTH_FEDERATION_PROVIDER_NOT_ALLOWED":
            return (f"★허용 목록을 무시하면 이름만 바꿔 오는 모든 요청이 통과한다★ "
                    f"({st} / {err_code(body)})")
        return None

    @check("FED-3", "token.md §3 — 연합 토큰은 로그인 봉투 + ixauth_idp 클레임")
    def _():
        if not fed_enabled:
            return "SKIP: federation.enabled 가 꺼져 있다"
        if not fed_providers:
            return "SKIP: federation.allowed-providers 가 비어 있다"
        provider = fed_providers[0]
        st, body = fed_exchange(provider)
        if st == 404 and err_code(body) == "AUTH_FEDERATION_NO_ACCOUNT":
            return "SKIP: federation.auto-provision 이 꺼져 있어 검사용 계정을 만들 수 없다"
        if st != 200:
            return f"상태 {st}: {body}"
        data = body.get("data") or {}
        for field in ("accessToken", "refreshToken", "expiresIn", "user"):
            if field not in data:
                return f"{field} 가 없다 — 로그인과 같은 봉투여야 한다"
        claims = claims_of(data["accessToken"])
        if claims.get("ixauth_idp") != provider.strip().lower():
            return (f"★ixauth_idp 가 {claims.get('ixauth_idp')!r} 다 — 어느 IdP 로 "
                    f"들어왔는지 토큰만으로 알 수 없다★")
        # 회전해도 남아야 한다. 사라지면 15분 뒤부터 자체 로그인처럼 보인다
        st2, rotated = api.call("POST", "/auth/refresh",
                                {"refreshToken": data["refreshToken"]})
        if st2 != 200:
            return f"회전 실패 {st2}: {rotated}"
        if claims_of((rotated.get("data") or {})["accessToken"]).get("ixauth_idp") != \
                provider.strip().lower():
            return "★회전하면 ixauth_idp 가 사라진다★"
        return None

    @check("FED-4", "http-api.md §2-7 — 서비스 키 없이는 401")
    def _():
        st, body = fed_exchange("nexus-hub", service_key=False)
        if st != 401:
            return (f"★이 경로의 신뢰 근거는 서비스 키 하나뿐이다 — 없이 {st} 가 나오면 "
                    f"아무나 신원을 주장할 수 있다★ ({err_code(body)})")
        return None

    @check("FED-5", "token.md §3 — 자체 인증 토큰에는 ixauth_idp 가 없다")
    def _():
        if "ixauth_idp" in claims_of(admin_token):
            return "★늘 붙어 있으면 앱이 유무가 아니라 내용으로 판단하게 된다★"
        return None

    # 이 검사는 창을 일부러 소진시킨다 — 그래서 마지막에 둔다
    @check("RATE-1", "errors.md — RATE_LIMITED 429 + Retry-After")
    def _():
        # 계정 잠금만으로는 부족하다. 잠금은 계정당이라, 수천 계정에 흔한 비밀번호를
        # 한 번씩 시도하는 방식은 어느 계정도 잠그지 못한 채 통과한다
        seen = None
        for _ in range(40):
            st2, body = api.call("POST", "/auth/login",
                                 {"email": f"rl-{uuid.uuid4().hex[:6]}@nowhere.invalid",
                                  "password": "wrong-on-purpose"})
            if st2 == 429:
                seen = body
                break
        if seen is None:
            return "40회를 연타해도 제한이 걸리지 않는다 — 무차별 대입 속도를 못 막는다"
        if err_code(seen) != "RATE_LIMITED":
            return f"코드가 {err_code(seen)}"
        return None

    @check("RATE-2", "설계 — 헬스체크와 JWKS 는 제한 밖")
    def _():
        # 여기가 막히면 로드밸런서가 인스턴스를 죽은 것으로 보고, 앱은 토큰을
        # 검증할 공개키를 못 받는다 — 제한이 장애를 만든다
        for path in ("/health", "/.well-known/jwks.json"):
            st2, _b = api.call("GET", path, service_key=False)
            if st2 == 429:
                return f"{path} 가 속도 제한에 걸린다"
            if st2 != 200:
                return f"{path} 상태 {st2}"
        return None

    # 테스트 계정 정리 — 계약상 소프트 삭제(DISABLED)다. 물리 삭제는 감사 로그를 끊는다
    if not a.keep_test_user:
        for uid in [probe_id, imp_id, mfa.get("user_id"), *bulk_created]:
            if uid is not None:
                api.call("DELETE", f"/admin/users/{uid}", token=admin_token)

    # 검사용 약관·속성 정의는 **물리적으로** 치운다. 계정과 달리 이쪽은 지워도
    # 잃는 것이 없고(동의가 붙기 전이다), 남겨 두면 실제 사용자에게 보인다.
    # 동의가 하나라도 붙었다면 서버가 409 로 거절하므로 증빙이 지워지는 일은 없다
    if probe_term_id is not None:
        st, _b = api.call("DELETE", f"/admin/terms/{probe_term_id}", token=admin_token)
        if st not in (200, 204):
            print(f"⚠ 검사용 약관(id={probe_term_id})을 지우지 못했다({st})."
                  " 관리 화면 → 약관에서 확인하라.")
    if probe_attr_key is not None:
        st, _b = api.call("DELETE", f"/admin/user-attributes/{probe_attr_key}",
                          token=admin_token)
        if st not in (200, 204):
            print(f"⚠ 검사용 속성 정의({probe_attr_key})를 지우지 못했다({st}).")

    # ────────── 결과 ──────────

    width = max(len(r[1]) for r in results)
    print()
    for status, cid, contract, msg in results:
        mark = {PASS: "  OK ", FAIL: " FAIL", SKIP: " skip"}[status]
        print(f"{mark}  {cid:<{width}}  {contract}")
        if msg:
            print(f"        └ {msg}")

    npass = sum(1 for r in results if r[0] == PASS)
    nfail = sum(1 for r in results if r[0] == FAIL)
    nskip = sum(1 for r in results if r[0] == SKIP)
    print(f"\n{len(results)}건 — 통과 {npass} · 실패 {nfail} · 건너뜀 {nskip}")
    if probe_id is not None and not a.keep_test_user:
        print(f"테스트 계정 {probe_email} 은 비활성화했다 (계약상 소프트 삭제).")
    return 1 if nfail else 0


if __name__ == "__main__":
    sys.exit(main())
