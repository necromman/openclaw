"""구글 리치 결과 테스트 실행 화면. 상품별 단계를 표에 실시간으로 보여 준다."""

from __future__ import annotations

import time

import google_test
import history
import ui_steps

STAGE_WAIT = "대기"
CANCELLED = google_test.STATUS_CANCELLED


def pending_rows(app, rows) -> list:
    """아직 결과가 없거나 취소된 행만 고른다(같은 버튼으로 이어서 돌린다)."""
    out = []
    for row in rows:
        result = app.google.get(row.goods_no)
        if result is None or result.status in (CANCELLED, google_test.STATUS_SKIP):
            out.append(row)
    return out


def run(app, everything: bool) -> None:
    rows = app.rows if everything else app.selected_rows()
    if not rows:
        app.warn("구글 테스트", "표에 상품이 없습니다.")
        return
    ok, note = google_test.available()
    if not ok:
        app.warn("구글 테스트", note)
        app.log("구글 테스트를 할 수 없습니다", "error")
        return
    targets = pending_rows(app, rows)
    resumed = len(rows) - len(targets)
    if not targets:
        targets = list(rows)
        resumed = 0
    total = len(targets)
    app.google_stage = getattr(app, "google_stage", {})
    for index, row in enumerate(targets, 1):
        app.google_stage[row.goods_no] = f"{STAGE_WAIT} {index}/{total}"
    app.refresh_tree()
    started = time.time()

    def work():
        results = []
        for index, row in enumerate(targets, 1):
            if app.cancelled():
                break
            elapsed = time.time() - started
            eta = (elapsed / max(1, index - 1)) * (total - index + 1) if index > 1 else 0
            app.progress(
                index,
                total,
                f"구글 테스트 {row.name[:18] or row.goods_no}"
                + (f" / 남은 시간 약 {int(eta)}초" if eta else ""),
            )

            def stage(text: str, code=row.goods_no) -> None:
                app.jobs.put(lambda: _set_stage(app, code, text))

            result = google_test.run_one(
                row.goods_no, row.url, on_stage=stage, should_stop=app.cancelled
            )
            results.append(result)
        return results

    def done(results, exc):
        app.google_stage = {}
        if exc:
            app.warn("구글 테스트", f"실패했습니다.\n{exc}")
            app.log("구글 테스트가 실패했습니다", "error")
            app.refresh_tree()
            return
        lines = []
        for result in results or []:
            app.google[result.goods_no] = result
            row = app.find_row(result.goods_no)
            if row:
                row.google_status, row.google_at = result.status, result.at
            history.add_google(result.as_dict())
            lines.append(f"goodsNo={result.goods_no} {result.summary()} {result.note}".strip())
        finished = {r.goods_no for r in (results or [])}
        left = [r for r in targets if r.goods_no not in finished]
        for row in left:
            item = google_test.GoogleResult(
                goods_no=row.goods_no, url=row.url, status=CANCELLED,
                note="취소해서 돌리지 않았습니다. 같은 버튼을 다시 누르면 여기서 이어서 합니다.",
            )
            app.google[row.goods_no] = item
            row.google_status = CANCELLED
        app.refresh_tree()
        app.set_step(5, "구글 결과를 확인하세요")
        completed = [r for r in (results or []) if r.status != CANCELLED]
        head = f"구글 리치 결과 테스트 (최종 판정) - {len(completed)}건 완료"
        if resumed:
            head += f", 이미 끝난 {resumed}건은 건너뜀"
        if left:
            head += f", 취소로 남은 {len(left)}건"
        app.write_out(
            head
            + "\n\n"
            + "\n".join(lines)
            + "\n\n행을 두 번 누르면 원문 결과를 볼 수 있습니다."
        )
        ui_steps.reload_history_safe(app)
        valid = [r for r in (results or []) if r.status == google_test.STATUS_VALID]
        warned = [r for r in (results or []) if r.status == google_test.STATUS_WARN]
        stopped = len(left) + len([r for r in (results or []) if r.status == CANCELLED])
        app.log(
            f"구글 테스트 {len(completed)}건 완료 (유효 {len(valid)}, 경고 {len(warned)})"
            + (f", 취소 {stopped}건은 다음에 이어서" if stopped else ""),
            "warn" if stopped else "ok",
        )

    app.background(
        work,
        done,
        f"구글 테스트 {total}건 (한 건당 최대 90초)",
        total=total,
    )


def _set_stage(app, goods_no: str, text: str) -> None:
    app.google_stage = getattr(app, "google_stage", {})
    app.google_stage[goods_no] = text
    app.refresh_tree(keep=(list(app.tree.selection()) or [""])[0])
