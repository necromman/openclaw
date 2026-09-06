/** ACP protocol helpers and OpenClaw agent identity metadata. */
import { BRAND_NAME } from "../brand.js";
import { VERSION } from "../version.js";
export { normalizeAcpProvenanceMode } from "@openclaw/acp-core/types";

/** ACP agent identity advertised during protocol initialization. */
export const ACP_AGENT_INFO = {
  name: "openclaw-acp",
  title: `${BRAND_NAME} ACP Gateway`,
  version: VERSION,
};
