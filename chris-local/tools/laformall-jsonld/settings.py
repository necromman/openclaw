"""설정 저장·로드. %APPDATA%\\laformall-jsonld\\settings.json"""

from __future__ import annotations

import json
import os
from pathlib import Path

APP_DIR_NAME = "laformall-jsonld"

DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

DEFAULTS = {
    "brand": "라포르",
    "seller": "진바이오테크",
    "domain": "https://cstpillow.com",
    "fetch_domain": "https://www.cstpillow.com",
    "user_agent": DEFAULT_UA,
    "out_dir": "",
    "timeout": 20,
    "retries": 2,
    "sitemap_url": "https://www.cstpillow.com/sitemap.xml",
    "check_image_head": True,
}


def data_dir() -> Path:
    base = os.environ.get("APPDATA") or os.environ.get("LOCALAPPDATA")
    if not base:
        base = str(Path.home())
    p = Path(base) / APP_DIR_NAME
    p.mkdir(parents=True, exist_ok=True)
    return p


def settings_path() -> Path:
    return data_dir() / "settings.json"


def history_path() -> Path:
    return data_dir() / "history.json"


def default_out_dir() -> Path:
    p = data_dir() / "output"
    p.mkdir(parents=True, exist_ok=True)
    return p


def load() -> dict:
    cfg = dict(DEFAULTS)
    path = settings_path()
    if path.exists():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                for key in DEFAULTS:
                    if key in raw and raw[key] not in (None, ""):
                        cfg[key] = raw[key]
        except Exception:
            pass
    if not cfg.get("out_dir"):
        cfg["out_dir"] = str(default_out_dir())
    try:
        cfg["timeout"] = max(3, int(cfg["timeout"]))
    except Exception:
        cfg["timeout"] = DEFAULTS["timeout"]
    try:
        cfg["retries"] = max(0, min(5, int(cfg["retries"])))
    except Exception:
        cfg["retries"] = DEFAULTS["retries"]
    return cfg


def save(cfg: dict) -> Path:
    path = settings_path()
    keep = {k: cfg.get(k, DEFAULTS[k]) for k in DEFAULTS}
    path.write_text(
        json.dumps(keep, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return path


def reset() -> dict:
    cfg = dict(DEFAULTS)
    cfg["out_dir"] = str(default_out_dir())
    save(cfg)
    return cfg
