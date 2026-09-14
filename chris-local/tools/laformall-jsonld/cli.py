"""GUI 없이 일괄 생성하는 CLI, 자기검사(--selftest), 구글 테스트(--google-test).

windowed(창 모드) exe 는 표준 출력이 없을 수 있으므로
  1) 부모 콘솔에 붙여 보고(AttachConsole),
  2) 결과를 언제나 출력 폴더의 result.json / selftest.json 에도 남긴다.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

import claims
import fetcher
import fields
import google_test
import history
import schema
import settings
import validator

SELFTEST_GOODS = ["11", "7"]


def ensure_console() -> None:
    """windowed 빌드에서 부모 콘솔에 표준 출력을 붙인다(실패해도 넘어간다)."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    try:
        import ctypes

        ctypes.windll.kernel32.AttachConsole(-1)
    except Exception:
        pass
    for name in ("stdout", "stderr"):
        if getattr(sys, name, None) is None:
            try:
                setattr(sys, name, open("CONOUT$", "w", encoding="utf-8"))
            except Exception:
                setattr(sys, name, open("nul", "w", encoding="utf-8"))


def emit(text: str) -> None:
    try:
        sys.stdout.write(text + "\n")
        sys.stdout.flush()
    except Exception:
        pass


def build_one(
    fetch: fetcher.Fetcher,
    cfg: dict,
    goods_no: str,
    description: str = "",
    check_image: bool = True,
) -> dict:
    prod = fetch.fetch_product(goods_no)
    if description:
        prod.description = description
    elif prod.name and not prod.description:
        prod.description = claims.draft_description(prod.name)
    findings = claims.check_fields(prod.claim_fields())
    data = schema.build_product(prod)
    image_ok = fetch.head_ok(prod.image) if (check_image and prod.image) else None
    verdict = validator.check(prod, image_ok)
    errors = schema.validate(prod, data, image_ok)
    text = schema.full_snippet(prod)
    return {
        "goods_no": prod.goods_no,
        "url": prod.url,
        "name": prod.name,
        "price": prod.price,
        "list_price": prod.list_price,
        "image": prod.image,
        "image_head_200": image_ok,
        "availability": prod.availability,
        "manufacturer": prod.manufacturer,
        "country": prod.country,
        "has_existing_ldjson": prod.has_ldjson,
        "description": prod.description,
        "description_source": "desc-file" if description else "자동 초안",
        "claims_findings": [f.line() for f in findings],
        "local_status": verdict.status,
        "local_errors": verdict.errors,
        "local_warnings": verdict.warnings,
        "missing_required": fields.missing_required(prod),
        "validation_errors": errors,
        "snippet": text,
        "hash": schema.snippet_hash(text),
        "status": prod.status,
        "error": prod.error,
        "product": prod,
    }


def _write_files(results: list[dict], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    bundle: list[str] = []
    for item in results:
        prod = item["product"]
        if item["error"]:
            continue
        path = out_dir / schema.file_name(prod)
        path.write_text(item["snippet"] + "\n", encoding="utf-8")
        item["saved_path"] = str(path)
        bundle.append(f"<!-- goodsNo={prod.goods_no} {prod.name} -->\n{item['snippet']}")
    if bundle:
        (out_dir / schema.bundle_name()).write_text("\n\n".join(bundle) + "\n", encoding="utf-8")


def selftest_example(fetch: fetcher.Fetcher) -> dict:
    """goodsNo=11 에 예시 값을 다 채워 필수·권장 항목이 전부 나가는지 본다."""
    prod = fetch.fetch_product("11")
    for key, value in fields.EXAMPLE.items():
        if key == "availability_label":
            prod.availability = fields.AVAILABILITY.get(value, fields.IN_STOCK)
        elif key == "faq":
            prod.faq = list(value)
        else:
            setattr(prod, key, value)
    image_ok = fetch.head_ok(prod.image)
    data = schema.build_product(prod)
    verdict = validator.check(prod, image_ok)
    errors = schema.validate(prod, data, image_ok)
    text = schema.full_snippet(prod)
    return {
        "goods_no": prod.goods_no,
        "local_status": verdict.status,
        "local_errors": verdict.errors,
        "local_warnings": verdict.warnings,
        "missing_required": fields.missing_required(prod),
        "validation_errors": errors,
        "blocks": text.count("<script"),
        "snippet": text,
        "hash": schema.snippet_hash(text),
    }


def _parse_args(args: list[str]) -> dict:
    opts: dict = {"out": None, "desc": "", "tokens": [], "no_history": False, "no_image": False}
    index = 0
    while index < len(args):
        arg = args[index]
        if arg in ("--cli", "--selftest", "--google-test", "--discover", "--sitemap"):
            pass
        elif arg == "--out":
            index += 1
            opts["out"] = Path(args[index]) if index < len(args) else None
        elif arg.startswith("--out="):
            opts["out"] = Path(arg.split("=", 1)[1])
        elif arg == "--desc-file":
            index += 1
            opts["desc"] = args[index] if index < len(args) else ""
        elif arg.startswith("--desc-file="):
            opts["desc"] = arg.split("=", 1)[1]
        elif arg == "--no-history":
            opts["no_history"] = True
        elif arg == "--no-image-check":
            opts["no_image"] = True
        elif arg.startswith("--"):
            emit(f"알 수 없는 옵션: {arg}")
        else:
            opts["tokens"].append(arg)
        index += 1
    return opts


def run_google(argv: list[str], cfg: dict, out_dir: Path) -> int:
    opts = _parse_args(argv)
    goods, _ = fetcher.parse_input(" ".join(opts["tokens"]))
    if not goods:
        emit("사용법: laformall-jsonld.exe --google-test <goodsNo ...> [--out <폴더>]")
        return 2
    ok, note = google_test.available()
    if not ok:
        emit(note)
        return 2
    pairs = [(g, fetcher.product_url(g, cfg["domain"])) for g in goods]

    def progress(index, total, goods_no):
        emit(f"구글 테스트 {index}/{total} (goodsNo={goods_no})")

    results = google_test.run_many(pairs, progress)
    payload = {
        "mode": "google-test",
        "at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "count": len(results),
        "items": [r.as_dict() for r in results],
    }
    for item in results:
        history.add_google(item.as_dict())
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    emit(text)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "google-test.json").write_text(text + "\n", encoding="utf-8")
    failed = [r for r in results if r.status not in (google_test.STATUS_VALID, google_test.STATUS_WARN)]
    return 1 if failed else 0


def run_discover(cfg: dict, out_dir: Path, make_sitemap: bool) -> int:
    """판매 중 상품을 모아 result.json 에 기록한다. --sitemap 이면 sitemap.xml 도 만든다."""
    import sitemap as sitemap_mod

    fetch = fetcher.Fetcher(cfg)
    live, evidence = fetch.discover_live_goods()
    try:
        sitemap_goods = fetch.sitemap_goods()
        old_xml = fetch.get(cfg.get("sitemap_url", "")).text
    except Exception:
        sitemap_goods, old_xml = [], ""
    rows = [fetch.fetch_product(code) for code in live]
    for row in rows:
        row.exposed = "노출"
    payload = {
        "mode": "discover",
        "at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "live_count": len(live),
        "live_goods": live,
        "sitemap_count": len(sitemap_goods),
        "sitemap_goods": sitemap_goods,
        "only_live": [g for g in live if g not in sitemap_goods],
        "only_sitemap": [g for g in sitemap_goods if g not in live],
        "categories": list(fetch.discovered_categories),
        "evidence": evidence,
        "products": [
            {
                "goods_no": r.goods_no,
                "name": r.name,
                "price": r.price,
                "availability": r.availability,
                "page_state": r.page_state,
                "image": r.image,
                "image_candidates": len(r.image_candidates),
            }
            for r in rows
        ],
    }
    if make_sitemap:
        xml, urls, kept = sitemap_mod.build(
            rows, cfg["domain"], list(fetch.discovered_categories), old_xml=old_xml
        )
        (out_dir / "sitemap.xml").write_text(xml, encoding="utf-8")
        added, removed = sitemap_mod.diff(urls, old_xml)
        payload["sitemap_file"] = str(out_dir / "sitemap.xml")
        payload["sitemap_urls"] = urls
        payload["sitemap_carried_over"] = kept
        payload["sitemap_added"] = added
        payload["sitemap_removed"] = removed
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    emit(text)
    (out_dir / "result.json").write_text(text + "\n", encoding="utf-8")
    return 0


def run_cli(argv: list[str]) -> int:
    ensure_console()
    args = list(argv)
    cfg = settings.load()
    opts = _parse_args(args)
    out_dir = opts["out"] or Path(cfg["out_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)

    if "--google-test" in args:
        return run_google(args, cfg, out_dir)
    if "--discover" in args or "--sitemap" in args:
        return run_discover(cfg, out_dir, make_sitemap="--sitemap" in args)

    selftest = "--selftest" in args
    if selftest:
        goods = list(SELFTEST_GOODS)
    else:
        goods, bad = fetcher.parse_input(" ".join(opts["tokens"]))
        if bad:
            emit("해석하지 못한 입력: " + ", ".join(bad))
        if not goods:
            emit(
                "사용법: laformall-jsonld.exe --cli --out <폴더> <URL 또는 goodsNo ...>\n"
                "        laformall-jsonld.exe --selftest --out <폴더>\n"
                "        laformall-jsonld.exe --discover [--sitemap] --out <폴더>\n"
                "        laformall-jsonld.exe --google-test <goodsNo ...>"
            )
            return 2

    descs = history.read_desc_file(opts["desc"]) if opts["desc"] else {}
    fetch = fetcher.Fetcher(cfg)
    results = [
        build_one(fetch, cfg, gn, descs.get(gn, ""), check_image=not opts["no_image"])
        for gn in goods
    ]
    _write_files(results, out_dir)

    if not opts["no_history"]:
        for item in results:
            if not item["error"]:
                history.add(
                    item["product"],
                    item["snippet"],
                    item["hash"],
                    item.get("saved_path", ""),
                    item["validation_errors"],
                    item["claims_findings"],
                )

    payload = {
        "mode": "selftest" if selftest else "cli",
        "at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "out_dir": str(out_dir),
        "count": len(results),
        "note": "로컬 판정은 참고다. 최종 판정은 구글 리치 결과 테스트(--google-test)다.",
        "items": [{k: v for k, v in item.items() if k != "product"} for item in results],
    }
    if selftest:
        # 수집만으로는 카테고리·재질 같은 AEO 필수 항목을 알 수 없다.
        # 예시 값을 채운 경우까지 함께 검사해 생성 경로 전체를 확인한다.
        payload["example_filled"] = selftest_example(fetch)
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    emit(text)
    name = "selftest.json" if selftest else "result.json"
    (out_dir / name).write_text(text + "\n", encoding="utf-8")
    if selftest:
        broken = [i for i in results if i["error"]]
        example = payload["example_filled"]
        return 1 if (broken or example["validation_errors"]) else 0
    failed = [i for i in results if i["error"] or i["validation_errors"]]
    return 1 if failed else 0
