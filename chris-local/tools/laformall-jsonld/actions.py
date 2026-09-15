"""생성 탭의 무거운 동작 세 가지: 관리자 엑셀 가져오기, 판매 중 상품 모으기, 사이트맵 만들기."""

from __future__ import annotations

from pathlib import Path

import admin_excel
import fetcher
import llms
import sitemap as sitemap_mod


def admin_excel_import(app) -> None:
    """관리자 상품 목록 엑셀을 읽어 표를 채운다(가장 정확한 입력)."""
    picked = admin_excel.import_dialog(app)
    if not picked:
        return
    products, stats, path = picked
    app.rows = products
    app.snippets, app.verdicts, app.google = {}, {}, {}
    for row in app.rows:
        app.reverdict(row)
    app.refresh_tree()
    shown = [r.goods_no for r in app.rows if r.exposed != "미노출"]
    if shown:
        app.tree.selection_set(*shown)
        app.form.load(app.find_row(shown[0]))
    app.input.delete("1.0", "end")
    app.input.insert(
        "1.0", "\n".join(r.url for r in app.rows if r.exposed != "미노출")
    )
    app.write_out(
        f"관리자 엑셀을 읽었습니다: {path}\n\n"
        f"상품 {stats['행']}개 (노출 {stats['노출']}, 미노출 {stats['미노출']},"
        f" 품절 {stats['품절']})\n"
        "미노출 상품은 회색 취소선으로 표시하고 선택에서 빼 두었습니다.\n"
        "상품명·판매가는 엑셀 값입니다. 이미지·설명은 '가져오기' 로 페이지에서 채우거나 직접 씁니다."
    )
    app.set_step(2, "가져오기를 누르면 이미지·설명을 페이지에서 읽어 옵니다")
    app.log(
        f"엑셀 {stats['행']}개 (노출 {stats['노출']}, 미노출 {stats['미노출']},"
        f" 품절 {stats['품절']})",
        "ok",
    )


def discover(app) -> None:
    """지금 라포르몰에 진열된 상품을 목록 페이지에서 직접 모은다."""
    client = app.fetch_client()
    app.log("판매 중 상품을 모으는 중")

    def work():
        def report(done_n, total_n, text):
            app.progress(done_n, total_n, text)

        live, evidence = client.discover_live_goods(
            progress=report, should_stop=app.cancelled
        )
        try:
            sitemap_goods = client.sitemap_goods()
        except Exception:
            sitemap_goods = []
        return live, evidence, sitemap_goods, list(client.discovered_categories)

    def done(result, exc):
        if exc:
            app.warn("판매 중 상품", f"불러오지 못했습니다.\n{exc}")
            return
        live, evidence, sitemap_goods, categories = result
        app.live_goods = list(live)
        app.categories = categories
        extra = [g for g in live if g not in sitemap_goods]
        only_map = [g for g in sitemap_goods if g not in live]
        urls = [fetcher.product_url(g, app.cfg["domain"]) for g in live]
        app.input.delete("1.0", "end")
        app.input.insert("1.0", "\n".join(urls))
        lines = [
            f"판매 중 상품 {len(live)}개: {', '.join(live)}",
            f"사이트맵(2020년 파일) {len(sitemap_goods)}개: {', '.join(sitemap_goods)}",
            f"사이트맵에 없는 상품 {len(extra)}개: {', '.join(extra) or '없음'}",
            f"사이트맵에만 있는 상품 {len(only_map)}개: {', '.join(only_map) or '없음'}"
            " (지금은 진열되지 않은 상품입니다)",
            "",
            "수집 근거",
        ]
        for code in live:
            lines.append(f"  goodsNo={code}: {', '.join(evidence.get(code, []))}")
        app.write_out("\n".join(lines))
        app.set_step(2, "가져오기를 누르세요")
        app.log(
            f"판매 중 상품 {len(live)}개 불러옴 (사이트맵 {len(sitemap_goods)}개와 차이: "
            f"추가 {len(extra)}개, 사이트맵에만 {len(only_map)}개)",
            "ok",
        )

    app.background(work, done, "판매 중 상품을 찾는 중...")


def make_sitemap(app) -> None:
    """지금 표의 노출 상품으로 sitemap.xml 을 만든다."""
    rows = [r for r in app.rows if r.exposed != "미노출" and not r.error]
    if not rows:
        app.warn("사이트맵 만들기", "표에 노출 상태인 상품이 없습니다. 먼저 상품을 불러오세요.")
        return
    domain = app.cfg["domain"]
    categories = list(getattr(app, "categories", []))
    client = app.fetch_client()
    try:
        old = client.get(app.cfg.get("sitemap_url", "")).text
    except Exception:
        old = ""
    xml, urls, kept = sitemap_mod.build(rows, domain, categories, old_xml=old)
    out_dir = Path(app.cfg["out_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "sitemap.xml"
    path.write_text(xml, encoding="utf-8")
    app.clipboard(xml)
    added, removed = sitemap_mod.diff(urls, old)
    lines = [
        f"sitemap.xml 을 만들었습니다: {path}",
        "클립보드에도 복사했습니다.",
        "",
        f"URL {len(urls)}개 (메인 1 + 카테고리 {len(categories)} + 상품 {len(rows)}"
        f" + 기존 사이트맵에서 살려 온 정적 페이지 {kept})",
        f"기존 사이트맵과 비교: 추가 {len(added)}개, 빠짐 {len(removed)}개",
    ]
    if added:
        lines += ["", "추가된 URL"] + [f"  + {u}" for u in added[:30]]
    if removed:
        lines += ["", "빠진 URL(지금 진열되지 않거나 제외 규칙에 걸린 주소)"] + [
            f"  - {u}" for u in removed[:30]
        ]
    lines += [
        "",
        "올리는 방법",
        "  1. 고도몰 관리자 > 상점관리 > 검색엔진 최적화(SEO) 에서 사이트맵 파일을 올립니다.",
        "     메뉴 이름은 고도몰 버전마다 다릅니다. 사이트맵 업로드 항목이 없으면",
        "     디자인 > 디자인 관리에서 스킨 루트에 sitemap.xml 을 올립니다.",
        "  2. robots.txt 에 다음 한 줄을 넣습니다.",
        f"     {sitemap_mod.robots_line(domain)}",
        "  3. 구글 서치 콘솔과 네이버 서치어드바이저에 사이트맵 주소를 제출합니다.",
        "",
        xml,
    ]
    app.write_out("\n".join(lines))
    app.log(f"sitemap.xml {len(urls)}개 URL 을 저장했습니다: {path}")


def make_llms(app) -> None:
    """사이트맵과 같은 목록으로 llms.txt 를 만든다(효과 미검증 부가 항목)."""
    rows = [r for r in app.rows if r.exposed != "미노출" and not r.error]
    if not rows:
        app.warn("llms.txt 만들기", "표에 노출 상태인 상품이 없습니다. 먼저 상품을 불러오세요.")
        return
    client = app.fetch_client()
    try:
        old = client.get(app.cfg.get("sitemap_url", "")).text
    except Exception:
        old = ""
    text = llms.build(rows, app.cfg["domain"], old_xml=old)
    out_dir = Path(app.cfg["out_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "llms.txt"
    path.write_text(text, encoding="utf-8")
    app.clipboard(text)
    app.write_out(
        f"llms.txt 를 만들었습니다: {path}\n"
        "클립보드에도 복사했습니다.\n\n"
        "AI 크롤러에게 사이트 구조를 알려 주는 파일입니다. 사이트 루트에 올립니다"
        f" ({app.cfg['domain'].rstrip('/')}/llms.txt).\n"
        "실측 효과가 확인되지 않은 부가 항목이라 사이트맵 다음에 여력이 있을 때 하면 됩니다.\n"
        "설명을 채운 상품은 설명까지 함께 들어갑니다.\n\n" + text
    )
    app.log(f"llms.txt 를 저장했습니다: {path}")


def quick_start(app) -> None:
    """한 번 눌러 1·2단계를 다 한다. 판매 중 상품을 찾아 정보까지 가져온다."""
    client = app.fetch_client()

    def work():
        app.progress(0, None, "라포르몰에서 판매 중인 상품을 찾는 중")
        live, evidence = client.discover_live_goods(
            progress=lambda d, t, text: app.progress(d, t, text),
            should_stop=app.cancelled,
        )
        rows = []
        for index, code in enumerate(live, 1):
            if app.cancelled():
                break
            app.progress(index, len(live), f"상품 정보 가져오기 goodsNo={code}")
            rows.append(client.fetch_product(code))
        return live, evidence, rows, list(client.discovered_categories)

    def done(result, exc):
        if exc:
            app.warn("상품 불러오기", f"실패했습니다.\n{exc}")
            app.log("상품을 불러오지 못했습니다", "error")
            return
        live, evidence, rows, categories = result
        app.live_goods = list(live)
        app.categories = categories
        for row in rows:
            row.exposed = "노출"
            app.reverdict(row)
        app.rows = rows
        app.snippets, app.google = {}, {}
        app.refresh_tree()
        if rows:
            app.tree.selection_set(rows[0].goods_no)
            app.form.load(rows[0])
        app.input.delete("1.0", "end")
        app.input.insert("1.0", "\n".join(r.url for r in rows))
        applied = [r for r in rows if str(r.applied).startswith("적용됨")]
        filled = [r for r in rows if r.filled_from_page]
        app.set_step(3, "목록에서 상품을 고르고 오른쪽 폼을 채우세요")
        app.write_out(
            f"판매 중 상품 {len(rows)}개를 불러와 정보까지 가져왔습니다.\n\n"
            f"페이지에 정보표가 이미 있는 상품: {len(applied)}개"
            + (f" (그중 {len(filled)}개는 그 값을 폼에 채웠습니다)" if filled else "")
            + "\n\n다음으로 할 일: 왼쪽 목록에서 상품을 하나 고르면 오른쪽 폼에 뜹니다.\n"
            "빨간 별표가 붙은 항목을 채우고 '스니펫 생성' 을 누르세요."
        )
        app.log(f"상품 {len(rows)}개를 불러왔습니다. 이제 목록에서 상품을 고르세요", "ok")

    app.background(work, done, "상품 불러와서 정보 가져오는 중...")


def sitemap_load(app) -> None:
    """사이트맵 파일을 받아 기준 날짜와 상품 수를 보여 주고 입력칸을 채운다."""
    client = app.fetch_client()

    def work():
        import re as _re

        text = client.get(app.cfg.get("sitemap_url", "")).text
        goods = sorted(set(_re.findall(r"goodsNo=(\d+)", text)), key=int)
        dates = sorted(_re.findall(r"<lastmod>\s*([0-9]{4}-[0-9]{2}-[0-9]{2})", text))
        locs = len(_re.findall(r"<loc>", text))
        return goods, dates[-1] if dates else "", locs

    def done(result, exc):
        if exc:
            app.warn("사이트맵", f"불러오지 못했습니다.\n{exc}")
            app.log("사이트맵을 불러오지 못했습니다", "error")
            return
        goods, lastmod, locs = result
        urls = [fetcher.product_url(g, app.cfg["domain"]) for g in goods]
        app.input.delete("1.0", "end")
        app.input.insert("1.0", "\n".join(urls))
        stamp = f"{lastmod} 기준" if lastmod else "날짜 표기 없음"
        app.write_out(
            f"사이트맵을 읽었습니다 ({app.cfg.get('sitemap_url')})\n\n"
            f"{stamp}, URL {locs}개, 상품 {len(goods)}개\n"
            f"상품 goodsNo: {', '.join(goods)}\n\n"
            "오래된 파일이면 지금 진열과 다를 수 있습니다. 그때는 "
            "'판매 중 상품 불러오기' 나 '관리자 엑셀 가져오기' 를 쓰세요."
        )
        app.set_step(2, "가져오기를 누르세요")
        app.log(f"사이트맵 {stamp}, 상품 {len(goods)}개", "ok")

    app.background(work, done, "사이트맵을 받는 중...")
