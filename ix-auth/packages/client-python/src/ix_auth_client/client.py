"""IX-Auth 앱 측 클라이언트.

하는 일은 네 가지뿐이다:
  1. 로그인·갱신·로그아웃 중계
  2. **JWKS 공개키로 토큰 로컬 검증** — 여기서 IX-Auth 를 부르지 않는다 (설계 불변식 2)
  3. **L1 권한 로컬 판정** — permission-map 캐시
  4. L2 인스턴스 권한 조회 — 파일·문서처럼 빈도가 낮은 경로에만

IX-Auth 가 잠시 내려가도 ①④만 막히고, 이미 로그인한 사용자의 ②③은 그대로 동작한다.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

import httpx
import jwt
from jwt import PyJWKClient

from .client_ip import client_ip_from
from .permissions import any_matches


class IxAuthUnreachable(RuntimeError):
    """IX-Auth 에 닿지 못했다. 앱은 503 으로 다루면 된다."""


class IxAuthTokenError(ValueError):
    """토큰이 유효하지 않다. 앱은 401 로 다루면 된다."""


@dataclass
class IxAuthClient:
    base_url: str = field(default_factory=lambda: os.getenv("IXAUTH_BASE_URL", "http://localhost:9100"))
    service_key: str = field(default_factory=lambda: os.getenv("IXAUTH_SERVICE_KEY", ""))
    issuer: str = field(default_factory=lambda: os.getenv("IXAUTH_JWT_ISSUER", ""))
    audience: str | None = None
    leeway: int = 60
    timeout: float = 10.0

    _jwks: PyJWKClient | None = field(default=None, init=False, repr=False)
    _permission_map: dict[str, list[str]] = field(default_factory=dict, init=False, repr=False)
    _permission_version: int = field(default=0, init=False, repr=False)

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")
        if not self.issuer:
            raise ValueError("IX-Auth: issuer 가 필요합니다 (IXAUTH_JWT_ISSUER)")
        if not self.service_key:
            raise ValueError("IX-Auth: service_key 가 필요합니다 (IXAUTH_SERVICE_KEY)")
        # PyJWKClient 가 공개키를 캐싱한다. 모르는 kid 를 만나면 한 번 다시 받는다
        self._jwks = PyJWKClient(
            f"{self.base_url}/.well-known/jwks.json",
            cache_keys=True,
            lifespan=600,
        )

    # ────────────────────── 1) 인증 중계 ──────────────────────

    def login(self, email: str, password: str, *, ip: str | None = None,
              user_agent: str | None = None) -> dict[str, Any]:
        """로그인 중계.

        ``ip`` · ``user_agent`` 는 **최종 사용자의 것**이어야 한다. 빼먹거나
        ``request.client.host`` 를 넣으면 감사 로그가 경유지 주소로 남는다.
        값은 :func:`ix_auth_client.client_ip_from` 으로 뽑는다.
        """
        body: dict[str, Any] = {"email": email, "password": password}
        if ip:
            body["ip"] = ip
        if user_agent:
            body["userAgent"] = user_agent
        return self._call("POST", "/auth/login", json=body, ip=ip, user_agent=user_agent)

    def refresh(self, refresh_token: str, *, ip: str | None = None,
                user_agent: str | None = None) -> dict[str, Any]:
        """갱신.

        본문에 ip 칸이 없으므로 ``ip`` 는 ``X-Forwarded-For`` 헤더로 나간다.
        갱신도 세션 기록을 갱신하므로 빼먹으면 그 자리가 경유지 주소로 덮인다.
        """
        return self._call("POST", "/auth/refresh", json={"refreshToken": refresh_token},
                          ip=ip, user_agent=user_agent)

    def logout(self, refresh_token: str, *, ip: str | None = None,
               user_agent: str | None = None) -> None:
        self._call("POST", "/auth/logout", json={"refreshToken": refresh_token},
                   ip=ip, user_agent=user_agent)

    # ── 연합 신원 교환 (2026-08-27) ──

    def federated_exchange(self, provider: str, subject: str, email: str,
                           name: str | None = None, *, ip: str | None = None,
                           user_agent: str | None = None) -> dict[str, Any]:
        """앱이 **이미 검증한** 외부 신원을 IX-Auth 세션으로 바꾼다.

        응답은 :meth:`login` 과 같은 봉투다 — accessToken · refreshToken ·
        expiresIn · user.

        IX-Auth 는 외부 IdP 와 직접 통신하지 않는다. OAuth 왕복·토큰 교환·
        userinfo 조회는 **앱이 끝낸 뒤**, 그 결과만 여기로 넘긴다.

        Args:
            provider: ``ixauth.federation.allowed-providers`` 에 적힌 이름
                (예: ``nexus-hub``). 대소문자는 가리지 않는다.
            subject: 외부 IdP 의 **불변 식별자**. 이메일을 넣지 않는다 —
                이메일은 바뀌고, 바뀐 주소가 남에게 재할당될 수도 있다.
            email: 연결·생성의 근거가 되는 주소. 없으면
                ``AUTH_FEDERATION_NO_ACCOUNT`` 다.
            name: 표시 이름. 비우면 이메일의 로컬 파트를 쓴다.
            ip: **최종 사용자의** IP. :func:`ix_auth_client.client_ip_from` 으로 뽑는다.
                ``request.client.host`` 를 넣으면 감사 로그가 경유지 주소로 남는다.
            user_agent: 최종 사용자의 User-Agent.

        Raises:
            IxAuthError: ``AUTH_FEDERATION_DISABLED``(403) ·
                ``AUTH_FEDERATION_PROVIDER_NOT_ALLOWED``(403) ·
                ``AUTH_FEDERATION_LINK_DENIED``(409) ·
                ``AUTH_FEDERATION_NO_ACCOUNT``(404) · 계정 상태 게이트(423/403).
        """
        body: dict[str, Any] = {"provider": provider, "subject": subject, "email": email}
        if name:
            body["name"] = name
        if ip:
            body["ip"] = ip
        if user_agent:
            body["userAgent"] = user_agent
        return self._call("POST", "/auth/federated/exchange", json=body,
                          ip=ip, user_agent=user_agent)

    # ── 계정 라이프사이클 ──

    def forgot_password(self, email: str) -> None:
        """재설정 메일 요청. **계정이 없어도 성공한다** — 그것이 계약이다.

        다르게 답하면 이 화면이 가입자 명부를 조회하는 도구가 된다.
        """
        self._call("POST", "/auth/password/forgot", json={"email": email})

    def reset_password(self, token: str, new_password: str) -> None:
        self._call("POST", "/auth/password/reset",
                   json={"token": token, "newPassword": new_password})

    def change_password(self, access_token: str, current_password: str,
                        new_password: str) -> None:
        """access token 이 필요하다 — 서비스 키만으로는 남의 비밀번호를 바꿀 수 없다."""
        self._call("POST", "/auth/password/change", access_token=access_token,
                   json={"currentPassword": current_password, "newPassword": new_password})

    def request_email_verification(self, email: str) -> None:
        self._call("POST", "/auth/email/verify/request", json={"email": email})

    def verify_email(self, token: str) -> None:
        self._call("POST", "/auth/email/verify", json={"token": token})

    def change_email(self, access_token: str, new_email: str,
                     current_password: str) -> None:
        self._call("POST", "/auth/email/change", access_token=access_token,
                   json={"newEmail": new_email, "currentPassword": current_password})

    def accept_invite(self, token: str, password: str, name: str | None = None) -> None:
        self._call("POST", "/auth/invite/accept",
                   json={"token": token, "password": password, "name": name})

    def signup(self, email: str, password: str, name: str | None = None, *,
               agreements: dict[str, bool] | None = None,
               attributes: dict[str, Any] | None = None,
               captcha_token: str | None = None) -> None:
        """자체 가입.

        ``agreements`` 를 보내지 않으면 **무동의 계정**이 된다. 필수 약관이 게시돼
        있으면 서버가 ``AUTH_TERMS_REQUIRED`` 로 막지만, 그 설정이 꺼져 있으면
        조용히 통과한다.
        """
        self._call("POST", "/auth/signup",
                   json={"email": email, "password": password, "name": name,
                         "agreements": agreements, "attributes": attributes,
                         "captchaToken": captcha_token})

    # ── 2단계 인증 (MFA) ──
    # 로그인이 AUTH_MFA_REQUIRED 로 실패하면 err.meta["challenge"] 로 verify_mfa 를 부른다

    def mfa_setup(self, access_token: str) -> dict[str, Any]:
        return self._call("POST", "/auth/mfa/totp/setup", access_token=access_token, json={})

    def mfa_confirm(self, access_token: str, code: str) -> Any:
        return self._call("POST", "/auth/mfa/totp/confirm",
                          access_token=access_token, json={"code": code})

    def verify_mfa(self, challenge: str, code: str, *, ip: str | None = None,
                   user_agent: str | None = None) -> dict[str, Any]:
        """2단계 검증. code 자리에 백업 코드도 넣을 수 있다.

        이 호출이 로그인을 마무리하므로 ``ip`` · ``user_agent`` 를 함께 넘긴다.
        """
        return self._call("POST", "/auth/mfa/verify",
                          json={"challenge": challenge, "code": code},
                          ip=ip, user_agent=user_agent)

    def mfa_status(self, access_token: str) -> dict[str, Any]:
        return self._call("GET", "/auth/mfa/status", access_token=access_token)

    def mfa_disable(self, access_token: str, current_password: str,
                    mfa_code: str | None = None) -> Any:
        """해제. ``mfa.mode`` 가 ``REQUIRED_*`` 면 본인은 끌 수 없다(403)."""
        return self._call("DELETE", "/auth/mfa/totp", access_token=access_token,
                          json={"currentPassword": current_password, "mfaCode": mfa_code})

    # ── 약관 ──

    def terms(self) -> Any:
        """게시된 약관 목록. 가입 화면은 로그인 전이라 서비스 키로 부른다."""
        return self._call("GET", "/auth/terms")

    def agree_terms(self, access_token: str, agreements: dict[str, bool]) -> Any:
        return self._call("POST", "/auth/terms/agree", access_token=access_token,
                          json={"agreements": agreements})

    def my_agreements(self, access_token: str) -> Any:
        return self._call("GET", "/auth/terms/agreements", access_token=access_token)

    # ── 매직 링크 ──

    def magic_link_request(self, email: str, captcha_token: str | None = None) -> Any:
        """계정이 없어도 성공한다 — 그것이 계약이다."""
        return self._call("POST", "/auth/magic-link/request",
                          json={"email": email, "captchaToken": captcha_token})

    def magic_link_verify(self, token: str, *, ip: str | None = None,
                          user_agent: str | None = None) -> dict[str, Any]:
        """링크의 토큰으로 로그인. 로그인이므로 ``ip`` · ``user_agent`` 를 넘긴다."""
        return self._call("POST", "/auth/magic-link/verify", json={"token": token},
                          ip=ip, user_agent=user_agent)

    # ── 소셜 로그인 ──

    def social_providers(self) -> dict[str, Any]:
        """켜져 있는 provider 목록. 앱은 이걸 보고 로그인 버튼을 그린다."""
        return self._call("GET", "/auth/social/providers")

    def social_authorize_url(self, provider: str, redirect_uri: str) -> dict[str, Any]:
        """동의 화면 주소. redirect_uri 는 **앱의** 콜백 주소다."""
        return self._call("GET", f"/auth/social/{provider}/authorize-url",
                          params={"redirectUri": redirect_uri})

    def social_callback(self, provider: str, code: str, state: str, *,
                        ip: str | None = None,
                        user_agent: str | None = None) -> dict[str, Any]:
        """앱이 콜백에서 받은 code 를 중계한다. 성공하면 로그인 응답과 같다.

        로그인이므로 ``ip`` · ``user_agent`` 를 함께 넘긴다.
        """
        return self._call("POST", f"/auth/social/{provider}/callback",
                          json={"code": code, "state": state},
                          ip=ip, user_agent=user_agent)

    def social_link(self, access_token: str, provider: str, code: str,
                    state: str) -> dict[str, Any]:
        """로그인한 사용자가 자기 계정에 연결 — 가장 안전한 경로."""
        return self._call("POST", f"/auth/social/{provider}/link",
                          access_token=access_token,
                          json={"code": code, "state": state})

    def social_links(self, access_token: str) -> Any:
        return self._call("GET", "/auth/social/links", access_token=access_token)

    def social_unlink(self, access_token: str, provider: str) -> Any:
        return self._call("DELETE", f"/auth/social/{provider}/link",
                          access_token=access_token)

    # ── 내 세션 ──

    def list_sessions(self, access_token: str) -> dict[str, Any]:
        return self._call("GET", "/auth/sessions", access_token=access_token)

    def revoke_session(self, access_token: str, session_id: str) -> None:
        self._call("DELETE", f"/auth/sessions/{session_id}", access_token=access_token)

    def revoke_all_sessions(self, access_token: str) -> None:
        self._call("DELETE", "/auth/sessions", access_token=access_token)

    # ────────────── 2) 토큰 로컬 검증 (네트워크 없음) ──────────────

    def verify(self, token: str) -> dict[str, Any]:
        """토큰을 검증하고 클레임을 돌려준다.

        공개키가 캐시돼 있으면 네트워크를 타지 않는다. 이것이 IX-Auth 가 앱의
        성능·가용성에 영향을 주지 않는 이유다.
        """
        assert self._jwks is not None
        try:
            key = self._jwks.get_signing_key_from_jwt(token).key
            return jwt.decode(
                token,
                key,
                algorithms=["RS256", "ES256"],
                issuer=self.issuer,
                audience=self.audience or self.issuer,
                leeway=self.leeway,
            )
        except Exception as e:  # noqa: BLE001 - 원인을 앱에 노출하지 않는다
            raise IxAuthTokenError(str(e)) from e

    # ────────────── 3) L1 권한 (로컬 판정) ──────────────

    def load_permission_map(self) -> dict[str, list[str]]:
        data = self._call("GET", "/authz/permission-map")
        self._permission_version = int(data.get("version", 0))
        self._permission_map = {k: list(v) for k, v in (data.get("roles") or {}).items()}
        return self._permission_map

    def refresh_map_if_stale(self, claims: dict[str, Any]) -> bool:
        """토큰의 pv 가 캐시보다 크면 맵이 낡았다 — 폴링 없이 이 신호만으로 갱신."""
        pv = int(claims.get("ixauth_pv") or 0)
        if pv > self._permission_version:
            self.load_permission_map()
            return True
        return False

    def effective_permissions(self, claims: dict[str, Any]) -> list[str]:
        roles = claims.get("ixauth_roles") or []
        perms: set[str] = set()
        for r in roles:
            perms.update(self._permission_map.get(r, []))
        return sorted(perms)

    def has_permission(self, claims: dict[str, Any], required_code: str) -> bool:
        """L1 판정 — 네트워크 없음."""
        return any_matches(self.effective_permissions(claims), required_code)

    @property
    def permission_map_version(self) -> int:
        return self._permission_version

    # ────────────── 4) L2 인스턴스 권한 (조회) ──────────────

    def check(self, user_id: str, resource_type: str, resource_key: str,
              action: str) -> dict[str, Any]:
        """단건 판정. 목록에서는 batch_check / list_resources 를 쓴다 (N+1 금지)."""
        return self._call("POST", "/authz/check", json={
            "userId": user_id, "resourceType": resource_type,
            "resourceKey": resource_key, "action": action,
        })

    def batch_check(self, user_id: str, checks: list[dict[str, str]]) -> list[dict[str, Any]]:
        return self._call("POST", "/authz/batch-check",
                          json={"userId": user_id, "checks": checks})

    def list_resources(self, user_id: str, resource_type: str,
                       action: str = "read") -> dict[str, Any]:
        return self._call("GET", "/authz/list-resources", params={
            "userId": user_id, "resourceType": resource_type, "action": action,
        })

    # ────────────────────── HTTP ──────────────────────

    def _call(self, method: str, path: str, access_token: str | None = None,
              ip: str | None = None, user_agent: str | None = None,
              **kwargs: Any) -> Any:
        headers = {"X-IxAuth-Key": self.service_key}
        if access_token:
            headers["Authorization"] = f"Bearer {access_token}"
        # IX-Auth 는 본문 ip 가 없으면 X-Forwarded-For 첫 조각을 본다(ClientInfo.java).
        # 그래서 본문에 ip 칸이 없는 갱신·로그아웃도 이 헤더 하나로 실주소가 전달된다.
        # IX-Auth 는 앱만 부를 수 있으므로(설계 불변식 4) 이 헤더를 신뢰하는 것이 설계 의도다
        forwarded = client_ip_from(None, ip)
        if forwarded:
            headers["X-Forwarded-For"] = forwarded
        if user_agent:
            headers["User-Agent"] = user_agent
        try:
            with httpx.Client(timeout=self.timeout) as client:
                res = client.request(
                    method, f"{self.base_url}{path}",
                    headers=headers,
                    **kwargs,
                )
        except httpx.HTTPError as e:
            raise IxAuthUnreachable("IX-Auth 에 연결할 수 없습니다.") from e

        if res.status_code == 204:
            return None
        body = res.json() if res.content else {}
        if res.status_code >= 400:
            err = (body or {}).get("error") or {}
            raise IxAuthError(err.get("code", "INTERNAL"),
                              err.get("message", f"IX-Auth 응답 {res.status_code}"),
                              res.status_code,
                              # meta 를 버리면 2단계 로그인이 성립하지 않는다 —
                              # AUTH_MFA_REQUIRED 가 challenge 를 여기 실어 보낸다
                              meta=err.get("meta"),
                              details=err.get("details"),
                              trace_id=err.get("traceId"))
        return body.get("data", body)


class IxAuthError(RuntimeError):
    """IX-Auth 가 오류를 반환했다. 계약 에러코드를 그대로 들고 있다.

    ``meta`` 는 코드별 부가 정보다 — ``AUTH_MFA_REQUIRED`` 면 ``{"challenge": "..."}``
    가 들어 있고, 그것 없이는 2단계 로그인을 이어갈 수 없다.
    """

    def __init__(self, code: str, message: str, status: int,
                 meta: dict[str, Any] | None = None,
                 details: Any = None, trace_id: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.meta = meta or {}
        self.details = details
        self.trace_id = trace_id


__all__ = [
    "IxAuthClient",
    "IxAuthError",
    "IxAuthTokenError",
    "IxAuthUnreachable",
]
