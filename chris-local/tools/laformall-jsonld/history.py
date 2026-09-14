"""생성 이력 저장. %APPDATA%\\laformall-jsonld\\history.json"""

from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path

import settings

MAX_RECORDS = 2000


def _path() -> Path:
    return settings.history_path()


def load() -> list[dict]:
    path = _path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save(records: list[dict]) -> Path:
    path = _path()
    path.write_text(
        json.dumps(records[-MAX_RECORDS:], ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return path


def add(
    prod,
    snippet: str,
    snippet_hash: str,
    saved_path: str = "",
    errors: list[str] | None = None,
    warnings: list[str] | None = None,
    verdict=None,
) -> dict:
    record = {
        "local_status": getattr(verdict, "status", "") or getattr(prod, "local_status", ""),
        "local_missing": list(getattr(verdict, "missing", []) or []),
        "at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "goods_no": str(prod.goods_no),
        "url": prod.url,
        "name": prod.name,
        "price": str(prod.price or ""),
        "list_price": str(getattr(prod, "list_price", "") or ""),
        "availability": prod.availability,
        "image": prod.image,
        "description": prod.description,
        "snippet": snippet,
        "hash": snippet_hash,
        "saved_path": saved_path,
        "errors": list(errors or []),
        "warnings": list(warnings or []),
        "result": "검증 실패" if errors else "검증 통과",
    }
    for key in (
        "category",
        "material",
        "size",
        "weight",
        "color",
        "country",
        "manufacturer",
        "mpn",
        "gtin13",
        "price_valid_until",
        "shipping_fee",
        "return_days",
        "rating_value",
        "review_count",
        "extra_props",
        "certs",
    ):
        record[key] = str(getattr(prod, key, "") or "")
    record["faq"] = [list(pair) for pair in (getattr(prod, "faq", None) or [])]
    records = load()
    records.append(record)
    save(records)
    return record


def google_path() -> Path:
    return settings.data_dir() / "google-results.json"


def load_google() -> list[dict]:
    path = google_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def add_google(result: dict) -> dict:
    records = load_google()
    records.append(result)
    google_path().write_text(
        json.dumps(records[-MAX_RECORDS:], ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return result


def latest_google(goods_no: str) -> dict | None:
    found = [r for r in load_google() if str(r.get("goods_no")) == str(goods_no)]
    return found[-1] if found else None


def delete(indexes: list[int]) -> int:
    records = load()
    keep = [r for i, r in enumerate(records) if i not in set(indexes)]
    removed = len(records) - len(keep)
    save(keep)
    return removed


def clear() -> int:
    count = len(load())
    save([])
    return count


def price_trend(goods_no: str) -> list[tuple[str, str]]:
    """같은 goodsNo 의 (시각, 가격) 기록을 시간순으로 낸다."""
    out: list[tuple[str, str]] = []
    for rec in load():
        if str(rec.get("goods_no")) == str(goods_no):
            out.append((rec.get("at", ""), str(rec.get("price", ""))))
    return out


def price_change_label(goods_no: str, price: str) -> str:
    """같은 goodsNo 의 직전 기록과 비교한 가격 변동 문구."""
    trend = price_trend(goods_no)
    if not trend:
        return "첫 기록"
    prev_at, prev = trend[-1]
    try:
        now_v, prev_v = int(price or 0), int(prev or 0)
    except ValueError:
        return "비교 불가"
    if prev_v == now_v:
        return f"동일 ({prev_at})"
    diff = now_v - prev_v
    arrow = "상승" if diff > 0 else "하락"
    return f"{prev_v:,} -> {now_v:,} ({arrow} {abs(diff):,}원, 직전 {prev_at})"


def export_csv(rows: list[dict], path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    cols = [
        "goods_no",
        "url",
        "name",
        "price",
        "list_price",
        "availability",
        "image",
        "description",
        "category",
        "material",
        "size",
        "weight",
        "color",
        "country",
        "manufacturer",
        "mpn",
        "gtin13",
        "price_valid_until",
        "shipping_fee",
        "return_days",
        "rating_value",
        "review_count",
        "hash",
        "result",
        "local_status",
        "local_missing",
        "google_status",
        "google_detail",
        "saved_path",
        "at",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            flat = {}
            for col in cols:
                value = row.get(col, "")
                flat[col] = ", ".join(str(v) for v in value) if isinstance(value, list) else value
            writer.writerow(flat)
    return path


def read_desc_file(path: str | Path) -> dict[str, str]:
    """goodsNo,설명 매핑 CSV 를 읽는다. 헤더는 있어도 되고 없어도 된다."""
    out: dict[str, str] = {}
    path = Path(path)
    if not path.exists():
        return out
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    for row in csv.reader(text.splitlines()):
        if len(row) < 2:
            continue
        key = row[0].strip()
        if not key.isdigit():
            continue
        out[key] = row[1].strip()
    return out
