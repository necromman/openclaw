// Account controls for identity-server mode: who is signed in, how to sign out, and
// where administrators manage users.
//
// This lives on the connection page because in this mode the connection is the account:
// there is no Gateway URL or shared token for a person to configure.
import { html, nothing, type TemplateResult } from "lit";
import {
  renderSettingsRow,
  renderSettingsSection,
  renderSettingsValue,
} from "../../components/settings-ui.ts";
import type { IxAuthSessionState } from "../../features/ix-auth/ix-auth-session-api.ts";
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "../../lib/external-link.ts";

// The connection page can be the first view to need these strings, so it registers the
// catalog itself rather than relying on the lazy sign-in screen having been shown.
registerIxAuthEnglish();

export type IxAuthAccountSectionProps = {
  session: IxAuthSessionState;
  onSignOut: () => void;
};

/**
 * Render the signed-in account block, or nothing when the Gateway is not delegating
 * identity. The caller does not need to branch on the auth mode itself.
 */
export function renderIxAuthAccountSection(
  props: IxAuthAccountSectionProps,
): TemplateResult | typeof nothing {
  const { session } = props;
  if (session.authMode !== "ix-auth" || !session.authenticated || !session.user) {
    return nothing;
  }
  const user = session.user;
  return renderSettingsSection({ title: t("ixAuth.title") }, [
    renderSettingsRow({
      title: t("ixAuth.signedInAs", { email: user.email }),
      description: user.displayName,
      control: renderSettingsValue(user.gatewayRole ?? user.roles.join(", ")),
    }),
    user.impersonatedBy
      ? renderSettingsRow({
          title: t("ixAuth.impersonating", { admin: user.impersonatedBy }),
        })
      : nothing,
    // The console link is only present in the payload for users the Gateway judged
    // administrators, so no client-side role check gates it here.
    session.adminConsoleUrl
      ? renderSettingsRow({
          title: t("ixAuth.manageUsers"),
          control: html`
            <a
              class="btn"
              href=${session.adminConsoleUrl}
              target=${EXTERNAL_LINK_TARGET}
              rel=${buildExternalLinkRel()}
              >${t("ixAuth.manageUsers")}</a
            >
          `,
        })
      : nothing,
    renderSettingsRow({
      title: t("ixAuth.signOut"),
      control: html`
        <button
          class="btn"
          @click=${() => {
            props.onSignOut();
          }}
        >
          ${t("ixAuth.signOut")}
        </button>
      `,
    }),
  ]);
}
