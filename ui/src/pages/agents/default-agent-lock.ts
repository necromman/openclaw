// Agents screen facts about default-agent ownership plus gateway error humanization.
import { t } from "../../i18n/index.ts";

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** True when the deployment authors agent ownership explicitly. "Set Default"
    writes the legacy `default=true` marker, which that mode rejects outright,
    so the screen must not offer the action at all. */
export function isExplicitAgentOwnership(
  config: Record<string, unknown> | null | undefined,
): boolean {
  return readRecord(readRecord(config)?.agents)?.ownership === "explicit";
}

/** Known gateway error fragments mapped to a reader-facing sentence. Add a row
    per newly discovered raw error; the first matching fragment wins. */
const KNOWN_AGENT_CONFIG_ERRORS: ReadonlyArray<{
  readonly fragment: string;
  readonly message: () => string;
}> = [
  {
    fragment: "cannot be combined with a legacy default=true marker",
    message: () => t("agents.errors.explicitOwnershipDefault"),
  },
];

/** Replaces a known raw gateway error with its localized sentence; anything
    unrecognized passes through untouched so no diagnostic is lost. */
export function humanizeAgentConfigError(error: string | null | undefined): string | null {
  if (!error) {
    return null;
  }
  for (const known of KNOWN_AGENT_CONFIG_ERRORS) {
    if (error.includes(known.fragment)) {
      return known.message();
    }
  }
  return error;
}
