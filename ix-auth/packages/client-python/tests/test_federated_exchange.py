"""연합 신원 교환 — 요청 계약을 고정한다 (http-api.md §2-7).

네트워크를 타지 않는다. ``httpx.Client`` 를 갈아 끼워 **무엇을 보내는가**만 본다 —
서버 동작은 ``ix-auth-server`` 의 E2E(``FederatedExchangeE2ETest``)가 지킨다.

여기서 잡으려는 것은 하나다: **앱이 최종 사용자의 IP 를 실어 보내는가.**
2026-08-25 에 소비 프로젝트 두 곳이 이 자리를 경유지 주소로 채워 감사 로그가
전부 틀린 채 쌓였고, 그 값은 되돌릴 수 없다 (.claude/rules/client-ip.md).
"""

import httpx
import pytest

from ix_auth_client import client as client_module
from ix_auth_client.client import IxAuthClient, IxAuthError


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict) -> None:
        self.status_code = status_code
        self._payload = payload
        self.content = b"{}"

    def json(self) -> dict:
        return self._payload


def _install_fake(monkeypatch, captured: dict, response: _FakeResponse):
    class FakeClient:
        def __init__(self, **_kwargs) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_exc) -> bool:
            return False

        def request(self, method, url, headers=None, **kwargs):
            captured["method"] = method
            captured["url"] = url
            captured["headers"] = headers or {}
            captured["json"] = kwargs.get("json")
            return response

    monkeypatch.setattr(client_module.httpx, "Client", FakeClient)


@pytest.fixture()
def client() -> IxAuthClient:
    return IxAuthClient(base_url="http://ix-auth:9100",
                        service_key="test-service-key-must-be-at-least-32-chars",
                        issuer="https://app.example.com")


def test_sends_contract_body_and_client_ip(monkeypatch, client):
    captured: dict = {}
    _install_fake(monkeypatch, captured, _FakeResponse(200, {"data": {
        "accessToken": "eyJ…", "refreshToken": "9f2c…", "expiresIn": 900,
        "user": {"id": "1042", "email": "chris@prost.team"},
    }}))

    result = client.federated_exchange(
        "nexus-hub", "8f31c2a0", "chris@prost.team", "이대훈",
        ip="203.0.113.7", user_agent="Mozilla/5.0 (Windows NT 10.0)")

    assert captured["method"] == "POST"
    assert captured["url"] == "http://ix-auth:9100/auth/federated/exchange"
    assert captured["json"] == {
        "provider": "nexus-hub",
        "subject": "8f31c2a0",
        "email": "chris@prost.team",
        "name": "이대훈",
        "ip": "203.0.113.7",
        "userAgent": "Mozilla/5.0 (Windows NT 10.0)",
    }
    # 서버 간 API 다 — 서비스 키가 빠지면 401 이다
    assert captured["headers"]["X-IxAuth-Key"].startswith("test-service-key")
    # 본문의 ip 와 같은 값이 헤더로도 간다. 한쪽만 고치면 다른 쪽이 경유지 주소로 남는다
    assert captured["headers"]["X-Forwarded-For"] == "203.0.113.7"
    assert result["user"]["id"] == "1042"


def test_omits_optional_fields_when_absent(monkeypatch, client):
    captured: dict = {}
    _install_fake(monkeypatch, captured, _FakeResponse(200, {"data": {}}))

    client.federated_exchange("nexus-hub", "8f31c2a0", "chris@prost.team")

    # 빈 문자열을 채워 보내면 서버가 "이름이 빈 사람" 을 만든다.
    # 보내지 않으면 서버가 이메일의 로컬 파트로 채운다
    assert captured["json"] == {
        "provider": "nexus-hub",
        "subject": "8f31c2a0",
        "email": "chris@prost.team",
    }
    assert "X-Forwarded-For" not in captured["headers"]


def test_raises_with_contract_error_code(monkeypatch, client):
    captured: dict = {}
    _install_fake(monkeypatch, captured, _FakeResponse(409, {"error": {
        "code": "AUTH_FEDERATION_LINK_DENIED",
        "message": "같은 이메일의 계정이 이미 있습니다.",
        "traceId": "0f4c",
    }}))

    with pytest.raises(IxAuthError) as raised:
        client.federated_exchange("nexus-hub", "8f31c2a0", "chris@prost.team")

    # 앱은 code 로 분기한다. 절대 message 문자열로 분기하지 않는다 (errors.md)
    assert raised.value.code == "AUTH_FEDERATION_LINK_DENIED"
    assert raised.value.status == 409


def test_unreachable_is_its_own_error(monkeypatch, client):
    class FailingClient:
        def __init__(self, **_kwargs) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_exc) -> bool:
            return False

        def request(self, *_args, **_kwargs):
            raise httpx.ConnectError("boom")

    monkeypatch.setattr(client_module.httpx, "Client", FailingClient)

    # 인증 실패(401/403)와 닿지 못함(503)은 앱이 다르게 다뤄야 한다
    with pytest.raises(client_module.IxAuthUnreachable):
        client.federated_exchange("nexus-hub", "8f31c2a0", "chris@prost.team")
