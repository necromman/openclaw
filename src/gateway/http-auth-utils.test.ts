import { IncomingMessage, type ServerResponse } from "node:http";
import { Socket } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { setDisplayName } from "../state/user-profiles.js";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";
import type { GatewayAuthResult } from "./auth.js";
import {
  authorizeControlUiReadRequestOrReply,
  authorizeControlUiSessionOwnerReadRequestOrReply,
  checkGatewayHttpRequestAuth,
  resolveSharedSecretHttpOperatorScopes,
} from "./http-auth-utils.js";

const { authorize, ensureOwner } = vi.hoisted(() => ({ authorize: vi.fn(), ensureOwner: vi.fn() }));
vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth.js")>()),
  authorizeHttpGatewayConnect: authorize,
  authorizeControlUiReadHttpGatewayConnect: authorize,
}));
vi.mock("../infra/host-account-name.js", () => ({
  resolveHostAccountName: async () => "Gateway Person",
}));
vi.mock("../state/user-profiles.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/user-profiles.js")>();
  ensureOwner.mockImplementation(actual.ensureGatewayOwnerProfile);
  return { ...actual, ensureGatewayOwnerProfile: ensureOwner };
});

const roles: NonNullable<NonNullable<OpenClawConfig["gateway"]>["roles"]> = {
  default: "reader",
  definitions: { reader: { sessions: { others: "view" }, agents: "*", scopes: ["operator.read"] } },
};
const req = { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as IncomingMessage;

async function authenticate(
  method: GatewayAuthResult["method"],
  cfg: OpenClawConfig = {},
  user?: string,
) {
  authorize.mockResolvedValueOnce({ ok: true, method, ...(user ? { user } : {}) });
  return checkGatewayHttpRequestAuth({ req, auth: { mode: "none", allowTailscale: false }, cfg });
}

describe("HTTP gateway owner profiles", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["member", false, false],
    ["admin", false, false],
    ["superadmin", false, true],
    ["superadmin", true, false],
  ] as const)(
    "caps Control UI HTTP reads for %s (impersonating=%s)",
    async (role, impersonating, canManage) => {
      await withOpenClawTestState({ label: "http-control-ui-role" }, async (state) => {
        await state.writeConfig({
          gateway: {
            roles: {
              default: role,
              definitions: {
                member: {
                  agents: "*",
                  sessions: { others: "view" },
                  scopes: ["operator.read", "operator.write", "operator.questions"],
                },
                admin: {
                  agents: "*",
                  sessions: { others: "write" },
                  scopes: [
                    "operator.read",
                    "operator.write",
                    "operator.approvals",
                    "operator.questions",
                  ],
                },
                superadmin: {
                  agents: "*",
                  sessions: { others: "write" },
                  scopes: ["operator.admin"],
                },
              },
            },
          },
        });
        authorize.mockResolvedValue({
          ok: true,
          method: "ix-auth",
          user: "target@example.test",
          ...(impersonating ? { ixAuthImpersonating: true } : {}),
        });
        const res = {
          statusCode: 200,
          setHeader: vi.fn(),
          end: vi.fn(),
        } as unknown as ServerResponse;
        const options = { req, res, auth: { mode: "none" as const, allowTailscale: false } };
        const read = await authorizeControlUiReadRequestOrReply({
          ...options,
          requiredOperatorMethod: "models.list",
        });
        expect(read?.operatorScopes).toContain("operator.read");
        expect(read?.operatorScopes.includes("operator.admin")).toBe(canManage);
        const management = await authorizeControlUiSessionOwnerReadRequestOrReply(options);
        if (canManage) {
          expect(management?.operatorScopes).toContain("operator.admin");
          expect(res.statusCode).toBe(200);
        } else {
          expect(management).toBeNull();
          expect(res.statusCode).toBe(403);
        }
      });
    },
  );

  it("carries impersonation into HTTP scope resolution without granting management from headers", async () => {
    await withOpenClawTestState({ label: "http-impersonation" }, async () => {
      authorize.mockResolvedValueOnce({
        ok: true,
        method: "ix-auth",
        user: "target@example.test",
        ixAuthImpersonating: true,
      });
      const result = await checkGatewayHttpRequestAuth({
        req,
        auth: { mode: "none", allowTailscale: false },
        cfg: {},
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected authenticated target");
      }
      expect(result.requestAuth.user).toBe("target@example.test");
      expect(result.requestAuth.ixAuthImpersonating).toBe(true);
      expect(resolveSharedSecretHttpOperatorScopes(req, result.requestAuth)).toEqual([
        "operator.read",
        "operator.write",
        "operator.questions",
      ]);
      const declared = new IncomingMessage(new Socket());
      declared.headers["x-openclaw-scopes"] = "operator.admin,operator.pairing,operator.write";
      expect(resolveSharedSecretHttpOperatorScopes(declared, result.requestAuth)).toEqual([
        "operator.write",
      ]);
    });
  });

  it("shares the durable owner across auth methods and preserves an edited name", async () => {
    await withOpenClawTestState({ label: "http-owner-profile" }, async () => {
      let profileId: string | undefined;
      for (const method of ["token", "password", "device-token", "none"] as const) {
        const result = await authenticate(method);
        expect(result.ok).toBe(true);
        if (!result.ok) {
          throw new Error("expected authenticated request");
        }
        expect(result.requestAuth.user).toBeUndefined();
        expect(result.requestAuth.authenticatedUserProfile).toMatchObject({
          displayName: profileId ? "Saved Owner" : "Gateway Person",
        });
        const currentId = result.requestAuth.authenticatedUserProfile!.profileId;
        if (profileId) {
          expect(currentId).toBe(profileId);
        } else {
          profileId = currentId;
          setDisplayName(profileId, "Saved Owner");
        }
        expect(result.requestAuth.operatorRolePolicy).toBeUndefined();
      }
    });
  });

  it.each(["token", "password"] as const)(
    "keeps %s owner authority with configured roles",
    async (method) => {
      await withOpenClawTestState({ label: "http-owner-roles" }, async () => {
        const result = await authenticate(method, { gateway: { roles } });
        expect(result.ok).toBe(true);
        if (!result.ok) {
          throw new Error("expected authenticated request");
        }
        expect(result.requestAuth.authenticatedUserProfile).toBeDefined();
        expect(result.requestAuth.operatorRolePolicy).toBeUndefined();
        expect(result.requestAuth.trustDeclaredOperatorScopes).toBe(false);
        expect(resolveSharedSecretHttpOperatorScopes(req, result.requestAuth)).toContain(
          "operator.admin",
        );
      });
    },
  );

  it.each(["none", "device-token"] as const)(
    "keeps configured-role %s requests without identity denied",
    async (method) => {
      expect(await authenticate(method, { gateway: { roles } })).toEqual({
        ok: false,
        authResult: { ok: false, reason: "user_profile_unavailable" },
      });
      expect(ensureOwner).not.toHaveBeenCalled();
    },
  );

  it("preserves a verified user's profile and role ceiling", async () => {
    await withOpenClawTestState({ label: "http-identified-profile" }, async () => {
      const result = await authenticate(
        "trusted-proxy",
        { gateway: { roles } },
        "alice@example.test",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error("expected authenticated request");
      }
      expect(result.requestAuth.user).toBe("alice@example.test");
      expect(result.requestAuth.authenticatedUserProfile?.displayName).toBe("alice");
      expect(result.requestAuth.operatorRolePolicy?.scopes).toEqual(["operator.read"]);
      expect(ensureOwner).not.toHaveBeenCalled();
    });
  });

  it.each([false, true])(
    "continues unidentified after owner storage failure (roles=%s)",
    async (configured) => {
      ensureOwner.mockImplementationOnce(() => {
        throw new Error("profile storage unavailable");
      });
      const result = await authenticate("token", configured ? { gateway: { roles } } : {});
      expect(result).toMatchObject({ ok: true, requestAuth: { authMethod: "token" } });
      if (!result.ok) {
        throw new Error("expected authenticated request");
      }
      expect(result.requestAuth.authenticatedUserProfile).toBeUndefined();
      expect(result.requestAuth.operatorRolePolicy).toBeUndefined();
    },
  );
});
