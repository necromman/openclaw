"""5단계 재검증. 고도몰에 붙여넣은 뒤 상품을 다시 불러와 "페이지 적용" 을 갱신한다.

수집 방법은 1·2단계("판매 중인 상품 모두 불러오기")와 같다. 다른 점은 이미 폼에
넣은 값을 지우지 않고, 지난 상태와 비교해 새로 적용된 상품을 표시하고, 결과를
"검증 회차" 로 이력에 남기는 것이다.
"""

from __future__ import annotations

import fields
import history

APPLIED_OK = "적용됨(가격 일치)"
MISMATCH = "적용됨(가격 불일치)"
KEEP_SKIP = ("url", "goods_no", "currency", "availability_label")


def counts(rows) -> tuple[int, int, int]:
    """(적용됨, 미적용, 가격 불일치). 적용됨은 가격이 맞는 것만 센다."""
    applied = sum(1 for r in rows if r.applied == APPLIED_OK)
    mismatch = sum(1 for r in rows if r.applied == MISMATCH)
    return applied, len(rows) - applied - mismatch, mismatch


def summary_line(rows) -> str:
    applied, not_applied, mismatch = counts(rows)
    return f"적용됨 {applied}개, 미적용 {not_applied}개, 가격 불일치 {mismatch}개"


def _merge(old, fresh) -> None:
    """사람이 폼에 넣은 값은 살린다. 페이지에서 읽어 온 값이 비었을 때만 채운다."""
    if old is None:
        return
    for key in fields.BY_KEY:
        if key in KEEP_SKIP:
            continue
        value = getattr(old, key, "")
        if value and not getattr(fresh, key, ""):
            setattr(fresh, key, value)
    if getattr(old, "faq", None):
        fresh.faq = old.faq


def _flash_off(app, codes: list[str]) -> None:
    """새로 적용된 행의 강조를 잠시 뒤 끈다. 배지 글자는 그대로 남긴다."""
    try:
        for code in codes:
            row = app.find_row(code)
            if row is not None:
                row.applied_flash = False
        app.refresh_tree()
    except Exception:
        pass


def run(app) -> None:
    """판매 중 상품을 다시 불러와 페이지 적용 열을 갱신하고 회차로 남긴다."""
    client = app.fetch_client()
    before = {r.goods_no: (r.applied or "미확인") for r in app.rows}
    app.set_step(5, "다시 불러와 페이지 적용을 확인합니다")

    def work():
        app.progress(0, None, "라포르몰에서 판매 중인 상품을 다시 찾는 중")
        live, _evidence = client.discover_live_goods(
            progress=lambda d, t, text: app.progress(d, t, text),
            should_stop=app.cancelled,
        )
        fresh = []
        for index, code in enumerate(live, 1):
            if app.cancelled():
                break
            app.progress(index, len(live), f"페이지 적용 확인 goodsNo={code}")
            fresh.append(client.fetch_product(code))
        return live, fresh, list(client.discovered_categories)

    def done(result, exc):
        if exc:
            app.warn("다시 불러와 검증", f"실패했습니다.\n{exc}")
            app.log("다시 불러오지 못했습니다", "error")
            return
        live, fresh, categories = result
        if not fresh:
            app.log("다시 불러온 상품이 없습니다", "warn")
            return
        app.live_goods = list(live)
        app.categories = categories
        old_rows = {r.goods_no: r for r in app.rows}
        newly: list[str] = []
        for row in fresh:
            _merge(old_rows.get(row.goods_no), row)
            row.exposed = "노출"
            was = before.get(row.goods_no, "미확인")
            row.applied_new = bool(
                str(row.applied).startswith("적용됨") and not str(was).startswith("적용됨")
            )
            row.applied_flash = row.applied_new
            if row.applied_new:
                newly.append(row.goods_no)
            app.reverdict(row)
        app.rows = fresh
        keep = app.rows[0].goods_no
        app.refresh_tree(keep=keep)
        app.reload_form()  # 행 객체가 새로 바뀌었으니 폼도 그 행으로 다시 그린다
        applied, not_applied, mismatch = counts(app.rows)
        record = history.add_round(
            len(app.rows),
            applied,
            not_applied,
            mismatch,
            newly,
            [
                {
                    "goods_no": r.goods_no,
                    "name": r.name,
                    "applied": r.applied,
                    "price": str(r.price or ""),
                }
                for r in app.rows
            ],
        )
        _report(app, record, newly, applied, not_applied, mismatch)
        if newly:
            app.root.after(9000, lambda codes=list(newly): _flash_off(app, codes))

    app.background(work, done, "다시 불러와 페이지 적용을 확인하는 중...")


def _report(app, record, newly, applied, not_applied, mismatch) -> None:
    """결과창·상태줄·팝업에 같은 요약을 남긴다."""
    import ui_tabs

    line = f"적용됨 {applied}개, 미적용 {not_applied}개, 가격 불일치 {mismatch}개"
    rows_txt = []
    for row in app.rows:
        mark = " <- 새로 적용" if row.applied_new else ""
        rows_txt.append(
            f"  goodsNo={row.goods_no} {row.name}: {row.applied or '미확인'}"
            f" ({row.applied_detail or '-'}){mark}"
        )
    body = [
        f"{record['round']}회차 검증 결과 ({record['at']})",
        "",
        line,
        f"새로 적용된 상품 {len(newly)}개: {', '.join(newly) or '없음'}",
        "",
        "상품별 결과",
        *rows_txt,
        "",
        "미적용으로 남은 상품은 스니펫을 다시 붙여넣어야 합니다. 에디터가 script 를 지우는"
        " 경우가 있으니 고도몰 상세설명을 HTML 모드(소스 보기)로 열어 확인하세요.",
        "가격 불일치는 화면 판매가와 스니펫의 price 가 다른 경우입니다. 스니펫을 다시 만들어",
        "붙여넣으세요(표시광고 위반이 됩니다).",
        "",
        "회차별 추이는 이력 탭 아래 '검증 회차' 표에서 볼 수 있습니다.",
    ]
    app.write_out("\n".join(body))
    try:
        ui_tabs.reload_rounds(app)
    except Exception:
        pass
    kind = "ok" if applied and not mismatch and not not_applied else (
        "warn" if applied else "error"
    )
    app.log(f"{record['round']}회차 검증: {line}", kind)
    app.info(
        f"{record['round']}회차 검증 결과",
        f"{line}\n\n"
        f"새로 적용된 상품: {', '.join(newly) if newly else '없음'}\n\n"
        "자세한 내용은 결과창에 있습니다.",
    )
