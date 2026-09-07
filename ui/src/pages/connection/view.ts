// Control UI view renders the gateway connection settings content.
import { html } from "lit";
import type { SystemInfoResult } from "../../../../packages/gateway-protocol/src/index.js";
import type { GatewayHelloOk } from "../../api/gateway.ts";
import type { UiSettings } from "../../app/settings.ts";
import {
  renderSettingsPage,
  renderSettingsRow,
  renderSettingsSecretInput,
  renderSettingsSection,
  renderSettingsStatus,
  renderSettingsValue,
} from "../../components/settings-ui.ts";
import type { IxAuthSessionState } from "../../features/ix-auth/ix-auth-session-api.ts";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../../lib/format.ts";
import { renderIxAuthAccountSection } from "./ix-auth-account-section.ts";
import { renderSystemSection } from "./system-section.ts";

type ConnectionProps = {
  connected: boolean;
  hello: GatewayHelloOk | null;
  settings: UiSettings;
  password: string;
  lastError: string | null;
  lastChannelsRefresh: number | null;
  systemInfo: SystemInfoResult | null;
  systemInfoUnavailable: boolean;
  showGatewayToken: boolean;
  showGatewayPassword: boolean;
  onConnectionChange: (patch: Partial<Pick<UiSettings, "gatewayUrl" | "token">>) => void;
  onPasswordChange: (next: string) => void;
  /** Identity-server session, when the Gateway delegates identity. */
  ixAuthSession?: IxAuthSessionState;
  onIxAuthSignOut?: () => void;
  /** Mount point the account block builds its user-management link from. */
  ixAuthBasePath?: string;
  onSessionKeyChange: (next: string) => void;
  onToggleGatewayTokenVisibility: () => void;
  onToggleGatewayPasswordVisibility: () => void;
  onConnect: () => void;
  onRefresh: () => void;
};

function renderSecretRow(params: {
  label: string;
  value: string;
  placeholder: string;
  visible: boolean;
  showLabel: string;
  hideLabel: string;
  toggleLabel: string;
  onInput: (next: string) => void;
  onToggle: () => void;
}) {
  const { label, ...secret } = params;
  return renderSettingsRow({
    title: label,
    control: renderSettingsSecretInput({ ...secret, ariaLabel: label }),
  });
}

export function renderConnection(props: ConnectionProps) {
  const snapshot = props.hello?.snapshot as
    | {
        authMode?: "none" | "token" | "password" | "trusted-proxy" | "ix-auth";
      }
    | undefined;
  const tickIntervalMs = props.hello?.policy?.tickIntervalMs;
  const tick = tickIntervalMs
    ? `${(tickIntervalMs / 1000).toFixed(tickIntervalMs % 1000 === 0 ? 0 : 1)}s`
    : t("common.na");
  const isTrustedProxy = snapshot?.authMode === "trusted-proxy";
  // In identity-server mode the shared token and password are not a person's to set:
  // the Gateway rejects them, so showing the fields would only invite confusion.
  const isIxAuth = snapshot?.authMode === "ix-auth" || props.ixAuthSession?.authMode === "ix-auth";
  const hidesSharedSecretFields = isTrustedProxy || isIxAuth;

  const accessRows = html`
    ${renderSettingsRow({
      title: t("connection.access.wsUrl"),
      control: html`
        <input
          class="settings-input"
          aria-label=${t("connection.access.wsUrl")}
          .value=${props.settings.gatewayUrl}
          @input=${(e: Event) => {
            const v = (e.target as HTMLInputElement).value;
            props.onConnectionChange({ gatewayUrl: v });
          }}
          placeholder="ws://100.x.y.z:18789"
        />
      `,
    })}
    ${
      hidesSharedSecretFields
        ? ""
        : html`
            ${renderSecretRow({
              label: t("connection.access.token"),
              value: props.settings.token,
              placeholder: t("connection.access.token"),
              visible: props.showGatewayToken,
              showLabel: t("connection.access.showToken"),
              hideLabel: t("connection.access.hideToken"),
              toggleLabel: t("connection.access.toggleTokenVisibility"),
              onInput: (next) => props.onConnectionChange({ token: next }),
              onToggle: props.onToggleGatewayTokenVisibility,
            })}
            ${renderSecretRow({
              label: t("connection.access.password"),
              value: props.password,
              placeholder: t("connection.access.passwordPlaceholder"),
              visible: props.showGatewayPassword,
              showLabel: t("connection.access.showPassword"),
              hideLabel: t("connection.access.hidePassword"),
              toggleLabel: t("connection.access.togglePasswordVisibility"),
              onInput: props.onPasswordChange,
              onToggle: props.onToggleGatewayPasswordVisibility,
            })}
          `
    }
    ${renderSettingsRow({
      title: t("connection.access.sessionKey"),
      control: html`
        <input
          class="settings-input"
          aria-label=${t("connection.access.sessionKey")}
          .value=${props.settings.sessionKey}
          @input=${(e: Event) => props.onSessionKeyChange((e.target as HTMLInputElement).value)}
        />
      `,
    })}
    <div class="settings-row">
      <div class="settings-row__text">
        <span class="settings-row__desc"
          >${
            isIxAuth
              ? t("ixAuth.subtitle")
              : isTrustedProxy
                ? t("connection.access.trustedProxy")
                : t("connection.access.connectHint")
          }</span
        >
      </div>
      <div class="settings-row__control">
        <button class="btn" @click=${() => props.onConnect()}>${t("common.connect")}</button>
        <button class="btn" @click=${() => props.onRefresh()}>${t("common.refresh")}</button>
      </div>
    </div>
  `;

  const snapshotRows = html`
    ${renderSettingsRow({
      title: t("connection.snapshot.status"),
      control: renderSettingsStatus({
        kind: props.connected ? "ok" : "warn",
        label: props.connected ? t("common.ok") : t("common.offline"),
      }),
    })}
    ${renderSettingsRow({
      title: t("connection.snapshot.tickInterval"),
      control: renderSettingsValue(tick),
    })}
    ${renderSettingsRow({
      title: t("connection.snapshot.lastChannelsRefresh"),
      control: renderSettingsValue(
        props.lastChannelsRefresh
          ? formatRelativeTimestamp(props.lastChannelsRefresh)
          : t("common.na"),
      ),
    })}
    ${
      props.lastError
        ? renderSettingsRow({
            title: renderSettingsStatus({
              kind: "danger",
              label: t("connection.snapshot.lastError"),
            }),
            description: props.lastError,
          })
        : ""
    }
  `;

  return renderSettingsPage([
    props.ixAuthSession
      ? renderIxAuthAccountSection({
          session: props.ixAuthSession,
          basePath: props.ixAuthBasePath ?? "",
          onSignOut: () => props.onIxAuthSignOut?.(),
        })
      : "",
    // The console link is present only for the roles the Gateway judged administrators,
    // so it doubles as the signal that these controls are worth mounting. The module is
    // fetched only then, which keeps it out of the bundle every other visitor loads.
    renderSettingsSection(
      { title: t("connection.access.title"), description: t("connection.access.subtitle") },
      accessRows,
    ),
    renderSystemSection(props),
    renderSettingsSection(
      { title: t("connection.snapshot.title"), description: t("connection.snapshot.subtitle") },
      snapshotRows,
    ),
  ]);
}
