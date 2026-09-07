// Renders the pre-connection screen when the Gateway delegates identity.
//
// Owns the lazy-load handling for the sign-in element so the application shell keeps a
// single call at its decision point.
import { html, type TemplateResult } from "lit";
import {
  IX_AUTH_LOGIN_ELEMENT,
  isOptionalElementDefined,
  type LazyCustomElementRequestController,
} from "../../app/lazy-custom-element.ts";
import { renderLazyViewError } from "../../components/lazy-view-error.ts";
import { buildIxAuthLoginProps, type IxAuthFormState } from "./ix-auth-form-state.ts";
import type { IxAuthSessionState } from "./ix-auth-session-api.ts";

/**
 * True when the identity-server screen owns this pre-connection render.
 *
 * `undefined` means the session probe has not answered yet, which also belongs here:
 * showing the shared-token form first would flash a screen the answer is about to
 * replace, and in this mode that form is a way around the login.
 */
export function shouldRenderIxAuthGate(session: IxAuthSessionState | undefined): boolean {
  return session === undefined || session.authMode === "ix-auth";
}

export type IxAuthGateViewParams = {
  /** Undefined while the session probe is still in flight. */
  session: IxAuthSessionState | undefined;
  loader: LazyCustomElementRequestController;
  resourceBasePath: string;
  state: IxAuthFormState;
  onChange: (next: IxAuthFormState) => void;
  onSubmit: () => void;
  /** Shown while the sign-in chunk is still loading. */
  renderPending: () => TemplateResult;
};

/**
 * Render the account sign-in screen, or a loading and retry surface while its chunk
 * is still arriving. Never falls back to the shared-token form: in this mode that form
 * would be a way around the login.
 */
export function renderIxAuthGate(params: IxAuthGateViewParams): TemplateResult {
  if (params.session === undefined) {
    return html`<openclaw-tooltip-provider>${params.renderPending()}</openclaw-tooltip-provider>`;
  }
  if (!isOptionalElementDefined(IX_AUTH_LOGIN_ELEMENT)) {
    const loadState = params.loader.visibleState;
    if (!loadState) {
      params.loader.preload(IX_AUTH_LOGIN_ELEMENT, { reportError: true });
    }
    return html`<openclaw-tooltip-provider>
      ${
        loadState?.status === "error"
          ? renderLazyViewError({
              error: loadState.error,
              stale: loadState.stale,
              onRetry: () => params.loader.retry(),
            })
          : params.renderPending()
      }
    </openclaw-tooltip-provider>`;
  }
  return html`
    <openclaw-tooltip-provider>
      <openclaw-ix-auth-login
        .props=${buildIxAuthLoginProps({
          resourceBasePath: params.resourceBasePath,
          state: params.state,
          handlers: { onChange: params.onChange, onSubmit: params.onSubmit },
        })}
      ></openclaw-ix-auth-login>
    </openclaw-tooltip-provider>
  `;
}
