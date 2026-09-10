// The `/auth/admin/models` route: read the model policy, replace it.
//
// This is the one Gateway configuration surface an administrator reaches without holding
// `operator.admin`. It exists because choosing which model answers, and which models
// people may pick in chat, is running the company rather than reconfiguring the
// appliance, and the person who does that job should not have to ask a system
// administrator to edit a JSON file on the NAS.
//
// The narrowness is the safety. The route never accepts a configuration document: it
// accepts four named fields, checks each one against a model-reference pattern, and
// writes only the leaves `ix-auth-admin-model-policy.ts` owns. Everything else in the
// configuration is refused by never being read from the request at all, so there is no
// path from this route to identity, departments, tool policy or proxies.
//
// Two writes happen, and both are needed for one promise. The configuration file is what
// the running Gateway reads, so writing it is what makes the change take effect now. The
// overrides document beside it is what the delivery's start script merges back over the
// rendered template, so writing it is what makes the change survive the next restart
// (DEPLOY.md 3.4). Losing the second would give an administrator a setting that quietly
// reverts, which is worse than no setting.
import { writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import {
  createConfigIO,
  getRuntimeConfigSnapshot,
  transformConfigFileWithRetry,
  validateConfigObjectWithPlugins,
} from "../config/config.js";
import { logVerbose } from "../globals.js";
import { sendJson } from "./http-common.js";
import type { IxAuthAdminContext } from "./ix-auth-admin-context.js";
import { recordIxAuthAdminAction } from "./ix-auth-admin-ledger.js";
import {
  applyModelPolicyToConfig,
  buildModelPolicyOverridesDocument,
  IX_AUTH_ADMIN_MODELS_BODY_MAX_BYTES,
  parseSubmittedModelPolicy,
  policyHidesItsOwnModels,
  readModelPolicyFromConfig,
  type IxAuthAdminModelPolicy,
} from "./ix-auth-admin-model-policy.js";
import { readIxAuthJsonBody, type IxAuthHttpDependencies } from "./ix-auth-http-shared.js";

/** File name of the document the start script merges back over the rendered template. */
const IX_AUTH_ADMIN_MODEL_OVERRIDES_FILE = "admin-overrides.json";

/** Where that document lives: beside the configuration file, in the state volume. */
function resolveAdminModelOverridesPath(): string {
  return path.join(path.dirname(createConfigIO().configPath), IX_AUTH_ADMIN_MODEL_OVERRIDES_FILE);
}

type ModelsRouteParams = {
  req: IncomingMessage;
  res: ServerResponse;
  deps: IxAuthHttpDependencies;
  admin: IxAuthAdminContext;
};

function currentModelPolicy(): IxAuthAdminModelPolicy {
  return readModelPolicyFromConfig(getRuntimeConfigSnapshot());
}

/**
 * Persist the overrides document.
 *
 * Best effort by design. The configuration write above it has already succeeded, so the
 * change is live; failing the whole request here would tell the administrator nothing
 * took when something did. The answer carries `persisted: false` instead, and the screen
 * says the change will not survive a restart.
 */
async function writeOverridesDocument(params: {
  policy: IxAuthAdminModelPolicy;
  updatedBy?: string;
}): Promise<boolean> {
  const target = resolveAdminModelOverridesPath();
  try {
    const document = buildModelPolicyOverridesDocument({
      policy: params.policy,
      updatedAtMs: Date.now(),
      ...(params.updatedBy ? { updatedBy: params.updatedBy } : {}),
    });
    await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return true;
  } catch (error) {
    logVerbose(`[ix-auth] model overrides write failed path=${target} error=${String(error)}`);
    return false;
  }
}

async function handleReplacePolicy(params: ModelsRouteParams): Promise<void> {
  const body = await readIxAuthJsonBody(
    params.req,
    params.res,
    IX_AUTH_ADMIN_MODELS_BODY_MAX_BYTES,
  );
  if (!body) {
    return;
  }
  const submitted = parseSubmittedModelPolicy(body);
  if (!submitted.ok) {
    sendJson(params.res, 400, { error: "invalid_body" });
    return;
  }
  const { policy } = submitted;
  if (policyHidesItsOwnModels(policy)) {
    sendJson(params.res, 400, { error: "model_not_allowed" });
    return;
  }
  try {
    await transformConfigFileWithRetry({
      base: "source",
      afterWrite: { mode: "auto" },
      transform: (currentConfig) => {
        const next = structuredClone(currentConfig) as Record<string, unknown>;
        applyModelPolicyToConfig(next, policy);
        const validated = validateConfigObjectWithPlugins(next);
        if (!validated.ok) {
          throw new Error(
            `config invalid after model policy write: ${validated.issues[0]?.path ?? "?"}`,
          );
        }
        return { nextConfig: validated.config };
      },
    });
  } catch (error) {
    logVerbose(`[ix-auth] model policy write failed error=${String(error)}`);
    sendJson(params.res, 500, { error: "config_write_failed" });
    return;
  }
  const persisted = await writeOverridesDocument({
    policy,
    updatedBy: params.admin.principal.claims.email,
  });
  recordIxAuthAdminAction({
    deps: params.deps,
    admin: params.admin,
    action: "model-policy",
    detail: {
      primary: policy.primary,
      fallbacks: policy.fallbacks,
      allow: policy.allow,
      ...(policy.utilityModel ? { utilityModel: policy.utilityModel } : {}),
      persisted,
    },
  });
  sendJson(params.res, 200, { ...policy, persisted });
}

/** Dispatch one `/auth/admin/models` request. */
export async function handleIxAuthAdminModelsRequest(params: ModelsRouteParams): Promise<void> {
  if (params.req.method === "GET") {
    sendJson(params.res, 200, {
      ...currentModelPolicy(),
      overridesPath: resolveAdminModelOverridesPath(),
    });
    return;
  }
  await handleReplacePolicy(params);
}
