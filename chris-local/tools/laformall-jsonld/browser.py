"""PC 에 설치된 Edge(없으면 Chrome)를 직접 띄워 DevTools 프로토콜로 제어한다.

파이썬이 없는 PC 에서도 이 실행 파일 하나로 돌아가야 하므로 Playwright 를 쓰지 않는다.
브라우저를 `--remote-debugging-port` 로 띄우고 `http://127.0.0.1:<port>/json` 으로 탭을 찾아
websocket 으로 Page.navigate·Runtime.evaluate 만 보낸다.

구글 리치 결과 테스트는 headless 접속에 "로그인한 후 다시 시도해 보세요" 를 내보낸다.
그래서 창을 띄우되 화면 밖(-32000, -32000)에 두는 것이 기본이다.
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

NO_WINDOW = 0x08000000
OFFSCREEN_ARGS = ["--window-position=-32000,-32000", "--window-size=1280,900"]
COMMON_ARGS = [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--lang=ko-KR",
]

EDGE_PATHS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]

NO_BROWSER = (
    "이 PC 에서 Edge 나 Chrome 을 찾지 못했습니다. 구글 자동 테스트에는 둘 중 하나가 "
    "설치돼 있어야 합니다(설치만 되어 있으면 되고 따로 설정할 것은 없습니다)."
)


def _app_paths(name: str) -> str | None:
    try:
        import winreg
    except Exception:
        return None
    key = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\\" + name
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        try:
            with winreg.OpenKey(hive, key) as handle:
                path = winreg.QueryValue(handle, None)
                if path and os.path.exists(path):
                    return path
        except OSError:
            continue
    return None


def find_browser() -> tuple[str, str] | None:
    """(실행 파일 경로, 이름) 을 낸다. Edge 를 먼저 찾고 없으면 Chrome."""
    for exe_name, label, paths, env_keys in (
        ("msedge.exe", "Edge", EDGE_PATHS, ("ProgramFiles(x86)", "ProgramFiles")),
        ("chrome.exe", "Chrome", CHROME_PATHS, ("ProgramFiles", "ProgramFiles(x86)")),
    ):
        found = _app_paths(exe_name)
        if found:
            return found, label
        for path in paths:
            if os.path.exists(path):
                return path, label
        rel = (
            r"Microsoft\Edge\Application\msedge.exe"
            if exe_name == "msedge.exe"
            else r"Google\Chrome\Application\chrome.exe"
        )
        for env_key in env_keys:
            base = os.environ.get(env_key)
            if base:
                candidate = os.path.join(base, rel)
                if os.path.exists(candidate):
                    return candidate, label
        local = os.environ.get("LOCALAPPDATA")
        if local:
            candidate = os.path.join(local, rel)
            if os.path.exists(candidate):
                return candidate, label
    found = shutil.which("msedge") or shutil.which("chrome")
    if found:
        return found, "Edge" if "msedge" in found.lower() else "Chrome"
    return None


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _fetch(url: str, timeout: float = 3.0) -> str:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


class Browser:
    """DevTools 로 제어하는 브라우저 한 개. with 문으로 쓰면 반드시 정리된다."""

    def __init__(self, offscreen: bool = True, keep_open: bool = False):
        self.offscreen = offscreen
        self.keep_open = keep_open
        self.proc: subprocess.Popen | None = None
        self.profile = ""
        self.port = 0
        self.label = ""
        self.socket = None
        self._msg_id = 0

    # -------------------------------------------------------------- 실행·정리
    def start(self) -> None:
        found = find_browser()
        if not found:
            raise RuntimeError(NO_BROWSER)
        exe, self.label = found
        self.port = free_port()
        self.profile = tempfile.mkdtemp(prefix="laformall-cdp-")
        args = [
            exe,
            f"--remote-debugging-port={self.port}",
            f"--user-data-dir={self.profile}",
            *COMMON_ARGS,
        ]
        if self.offscreen:
            args += OFFSCREEN_ARGS
        args.append("about:blank")
        self.proc = subprocess.Popen(
            args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=NO_WINDOW,
        )
        self._wait_ready()

    def _wait_ready(self, timeout: float = 40.0) -> None:
        deadline = time.time() + timeout
        last = ""
        while time.time() < deadline:
            try:
                _fetch(f"http://127.0.0.1:{self.port}/json/version")
                return
            except Exception as exc:
                last = str(exc)
                if self.proc and self.proc.poll() is not None:
                    raise RuntimeError(f"{self.label} 이 바로 종료됐습니다(코드 {self.proc.returncode})")
                time.sleep(0.4)
        raise RuntimeError(f"{self.label} 디버깅 포트가 열리지 않았습니다: {last}")

    def close(self) -> None:
        with contextlib.suppress(Exception):
            if self.socket:
                self.socket.close()
        self.socket = None
        if not self.keep_open:
            with contextlib.suppress(Exception):
                _fetch(f"http://127.0.0.1:{self.port}/json/close", timeout=2.0)
            if self.proc:
                with contextlib.suppress(Exception):
                    self.proc.terminate()
                    self.proc.wait(timeout=10)
                with contextlib.suppress(Exception):
                    if self.proc.poll() is None:
                        self.proc.kill()
            for _ in range(6):
                if not os.path.isdir(self.profile):
                    break
                shutil.rmtree(self.profile, ignore_errors=True)
                time.sleep(0.5)

    def __enter__(self) -> "Browser":
        self.start()
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    # -------------------------------------------------------------- 탭·명령
    def _page_target(self) -> dict:
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                items = json.loads(_fetch(f"http://127.0.0.1:{self.port}/json/list"))
            except Exception:
                items = []
            pages = [
                item
                for item in items
                if item.get("type") == "page" and item.get("webSocketDebuggerUrl")
            ]
            if pages:
                return pages[0]
            time.sleep(0.4)
        raise RuntimeError("제어할 탭을 찾지 못했습니다")

    def connect(self) -> None:
        import websocket

        target = self._page_target()
        # DevTools 는 Origin 헤더가 붙은 연결을 거부한다(403 Rejected an incoming
        # WebSocket connection). websocket-client 가 기본으로 붙이므로 끈다.
        self.socket = websocket.create_connection(
            target["webSocketDebuggerUrl"],
            timeout=30,
            max_size=64 * 1024 * 1024,
            suppress_origin=True,
        )

    def send(self, method: str, params: dict | None = None, timeout: float = 30.0) -> dict:
        if self.socket is None:
            self.connect()
        self._msg_id += 1
        msg_id = self._msg_id
        self.socket.settimeout(timeout)
        self.socket.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            raw = self.socket.recv()
            try:
                data = json.loads(raw)
            except Exception:
                continue
            if data.get("id") == msg_id:
                if "error" in data:
                    raise RuntimeError(f"{method}: {data['error']}")
                return data.get("result", {})
        raise RuntimeError(f"{method} 응답이 없습니다")

    def navigate(self, url: str) -> None:
        self.send("Page.enable")
        self.send("Runtime.enable")
        self.send("Page.navigate", {"url": url}, timeout=60)

    def body_text(self) -> str:
        result = self.send(
            "Runtime.evaluate",
            {"expression": "document.body ? document.body.innerText : ''", "returnByValue": True},
        )
        value = (result.get("result") or {}).get("value")
        return value if isinstance(value, str) else ""


def view_profile() -> str:
    """보기용 창이 쓰는 고정 프로필 폴더. 창을 열 때마다 늘어나지 않게 한 곳을 쓴다."""
    import settings

    path = settings.data_dir() / "view-profile"
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def open_window(url: str) -> tuple[bool, str]:
    """화면 안에 브라우저 창을 띄워 주소를 연다(내장 창이 안 될 때의 폴백)."""
    found = find_browser()
    if not found:
        return False, NO_BROWSER
    exe, label = found
    profile = view_profile()
    try:
        subprocess.Popen(
            [
                exe,
                f"--user-data-dir={profile}",
                "--window-size=1280,900",
                "--new-window",
                *COMMON_ARGS,
                url,
            ],
            creationflags=NO_WINDOW,
        )
        return True, label
    except Exception as exc:
        return False, str(exc)
