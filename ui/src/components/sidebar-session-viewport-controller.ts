import type { ReactiveController, ReactiveControllerHost } from "lit";
import { SIDEBAR_SESSION_PAGE_SIZE } from "./app-sidebar-session-types.ts";

/** Size the local page from rendered rows; fetching another roster remains explicit. */
export class SidebarSessionViewportController implements ReactiveController {
  pageSize = SIDEBAR_SESSION_PAGE_SIZE;
  private observer: ResizeObserver | null = null;
  private observed: Element[] = [];

  constructor(
    private readonly host: ReactiveControllerHost & HTMLElement,
    private readonly onResize: () => void,
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    this.host.requestUpdate();
  }

  hostDisconnected(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.observed = [];
  }

  hostUpdated(): void {
    const scroller = this.host.querySelector<HTMLElement>(".sidebar-shell__body");
    const list = this.host.querySelector<HTMLElement>(".sidebar-recent-sessions__list");
    const row = list?.querySelector<HTMLElement>(".sidebar-recent-session");
    const elements = [scroller, row].filter((element): element is HTMLElement => !!element);
    if (
      elements.some((element, index) => element !== this.observed[index]) ||
      elements.length !== this.observed.length
    ) {
      this.observer?.disconnect();
      this.observed = elements;
      if (typeof ResizeObserver !== "undefined") {
        this.observer ??= new ResizeObserver(() => this.measure());
        for (const element of elements) {
          this.observer.observe(element);
        }
      }
    }
    this.measure();
  }

  private measure(): void {
    if (!this.host.isConnected) {
      return;
    }
    const scroller = this.host.querySelector<HTMLElement>(".sidebar-shell__body");
    const list = this.host.querySelector<HTMLElement>(".sidebar-recent-sessions__list");
    const row = list?.querySelector<HTMLElement>(".sidebar-recent-session");
    if (!scroller?.clientHeight || !list || !row) {
      return;
    }
    const rowHeight = row.getBoundingClientRect().height;
    if (rowHeight <= 0) {
      return;
    }
    const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
    const listTop =
      list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    // The extra half viewport puts Show more after a short scroll. Scroll position
    // is removed from the measurement, so scrolling never grows the page.
    const available = Math.max(0, scroller.clientHeight - Math.max(0, listTop));
    const pageSize = Math.max(
      SIDEBAR_SESSION_PAGE_SIZE,
      Math.ceil((available * 1.5) / (rowHeight + gap)),
    );
    if (pageSize !== this.pageSize) {
      this.pageSize = pageSize;
      this.onResize();
      this.host.requestUpdate();
    }
  }
}
