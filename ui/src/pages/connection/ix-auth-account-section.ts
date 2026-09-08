// Account controls for identity-server mode: who is signed in, how to sign out, and
// where administrators manage users.
//
// This lives on the connection page because in this mode the connection is the account:
// there is no Gateway URL or shared token for a person to configure.
import { html, nothing, type TemplateResult } from "lit";
import { pathForRoute } from "../../app-route-paths.ts";
import {
  renderSettingsRow,
  renderSettingsSection,
  renderSettingsValue,
} from "../../components/settings-ui.ts";
import { canManageIxAuthUsers } from "../../features/ix-auth/ix-auth-admin-access.ts";
import { ixAuthRoleLabel } from "../../features/ix-auth/ix-auth-role-labels.ts";
import type { IxAuthSessionState } from "../../features/ix-auth/ix-auth-session-api.ts";
import { t } from "../../i18n/index.ts";
import { registerIxAuthEnglish } from "../../i18n/locales/en-ix-auth.ts";

// The connection page can be the first view to need these strings, so it registers the
// catalog itself rather than relying on the lazy sign-in screen having been shown.
registerIxAuthEnglish();

export type IxAuthAccountSectionProps = {
  session: IxAuthSessionState;
  /** Where the Control UI is mounted, so the management link survives a base path. */
  basePath: string;
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
  // The Gateway resolved one rank out of however many identity roles the account holds,
  // so that is the one worth showing; the codes behind it are an implementation detail.
  const roleLabel = user.gatewayRole
    ? ixAuthRoleLabel(user.gatewayRole)
    : user.roles.map((role) => ixAuthRoleLabel(role)).join(", ");
  return renderSettingsSection({ title: t("ixAuth.title") }, [
    renderSettingsRow({
      title: t("ixAuth.signedInAs", { email: user.email }),
      description: user.displayName,
      control: renderSettingsValue(roleLabel),
    }),
    user.impersonatedBy
      ? renderSettingsRow({
          title: t("ixAuth.impersonating", { admin: user.impersonatedBy }),
        })
      : nothing,
    // Drawn for anyone the Gateway lets call the admin routes, which is the same test the
    // screen behind this link makes. The console URL used to stand in for it and was
    // wrong: it is withheld from everyone but a superadmin, so an ordinary administrator
    // never saw the way in. The console itself is a second sign-in and stays an advanced
    // escape hatch, offered on that screen rather than here.
    canManageIxAuthUsers()
      ? renderSettingsRow({
          title: t("ixAuth.manageUsers"),
          control: html`
            <a class="btn" href=${pathForRoute("users", props.basePath)}
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
