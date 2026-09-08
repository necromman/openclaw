// One Gateway RPC call over the same WebSocket the Control UI uses.
//
// Why this exists: in ix-auth mode the Gateway has no shared secret, so the bundled CLI
// cannot authenticate to its own RPC surface (see DEPLOY.md, "container CLI limits").
// A signed-in person can, though, and the credential is an ordinary session cookie. This
// script carries that cookie into one handshake and makes one call, which keeps the
// clean-up script on the supported lifecycle path instead of editing the state database.
//
// It runs inside the gateway container, where `ws` and the Gateway are both present:
//   docker compose exec -T gateway node - <args>   < chris-local/reset-seed-rpc.mjs
//
// Inputs (environment, so no credential ever reaches a process list):
//   RESET_SEED_URL     ws:// address of the Gateway, default ws://127.0.0.1:18789
//   RESET_SEED_ORIGIN  Origin header the Gateway allows, default http://127.0.0.1:18800
//   RESET_SEED_COOKIE  the whole Cookie header from a completed /auth/login
//
// Arguments: <method> [json-params]. With no method it prints the granted scopes, which
// is also the quickest way to see what a role actually receives.
import { WebSocket } from "ws";

const url = process.env.RESET_SEED_URL ?? "ws://127.0.0.1:18789";
const origin = process.env.RESET_SEED_ORIGIN ?? "http://127.0.0.1:18800";
const cookie = process.env.RESET_SEED_COOKIE ?? "";
const [method, rawParams] = process.argv.slice(2);

if (!cookie) {
  console.error("RESET_SEED_COOKIE is empty; sign in first.");
  process.exit(2);
}

const CONNECT_PARAMS = {
  minProtocol: 4,
  maxProtocol: 4,
  role: "operator",
  // Declared empty on purpose. An identity session takes its scopes from the role
  // definition, so asking for none proves the grant came from the role and not the page.
  scopes: [],
  client: {
    id: "openclaw-control-ui",
    version: "0.0.0",
    platform: "linux",
    mode: "cli",
    instanceId: "reset-seed",
  },
};

const socket = new WebSocket(url, { origin, headers: { cookie } });
const pending = new Map();
let nextId = 1;

function call(name, params) {
  const id = String(nextId++);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ type: "req", id, method: name, params }));
  });
}

const failed = (message) => {
  console.error(message);
  process.exit(1);
};

socket.on("message", (data) => {
  let frame;
  try {
    frame = JSON.parse(String(data));
  } catch {
    return;
  }
  if (frame.type !== "res" || !pending.has(frame.id)) {
    return;
  }
  const entry = pending.get(frame.id);
  pending.delete(frame.id);
  if (frame.ok) {
    entry.resolve(frame.payload ?? frame.result ?? null);
  } else {
    entry.reject(new Error(JSON.stringify(frame.error)));
  }
});
socket.on("error", (error) => failed(`socket: ${error.message}`));
socket.on("close", (code, reason) => {
  if (pending.size > 0) {
    failed(`closed before answering: ${code} ${String(reason)}`);
  }
});

socket.on("open", async () => {
  try {
    const hello = await call("connect", CONNECT_PARAMS);
    if (!method) {
      console.log(JSON.stringify({ auth: hello?.auth ?? null }, null, 1));
    } else {
      const result = await call(method, rawParams ? JSON.parse(rawParams) : undefined);
      console.log(JSON.stringify(result ?? null, null, 1));
    }
    socket.close(1000, "done");
    process.exit(0);
  } catch (error) {
    failed(String(error instanceof Error ? error.message : error));
  }
});
