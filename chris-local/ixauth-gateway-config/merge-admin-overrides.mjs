// Merge the administrator-owned model settings back over the freshly rendered template.
//
// The template is still the source of truth for this deployment, and it is still copied
// over the state volume on every start. What changed (stage U) is that one small region
// is no longer the template's to dictate: which model answers, which model answers when
// the first cannot, and which models chat offers. An administrator sets those from
// Settings > Models, the Gateway writes them here as well as into the live config, and
// this script puts them back on top of the render so a restart does not undo the choice.
//
// Only the paths in ALLOWED_LEAVES are read out of the overrides file. Everything else
// in it is ignored, so a corrupted or hand-edited document cannot reach identity,
// departments, tool policy, proxies, or the top-level "meta" block the Gateway compares
// each config against (DEPLOY.md 3.4, HANDOFF 0-1 Q). The template wins for all of it.
//
// Failure is always "keep the render". A missing, unreadable, unparseable or wrongly
// shaped overrides file leaves the rendered config exactly as it was, which is the
// deployment's known-good state.
//
// Usage: node merge-admin-overrides.mjs <rendered-config> <overrides>
import { readFileSync, writeFileSync } from "node:fs";

/**
 * The administrator-editable region, as leaf paths under one agent scope.
 *
 * `model` carries both the primary and the fallbacks, so the two travel together and a
 * half-applied merge cannot leave a fallback pointing at a model that is no longer there.
 */
const ALLOWED_LEAVES = ["model", "modelPolicy", "utilityModel", "imageModel"];

const [, , renderedPath, overridesPath] = process.argv;
if (!renderedPath || !overridesPath) {
  process.stderr.write("usage: merge-admin-overrides.mjs <rendered-config> <overrides>\n");
  process.exit(64);
}

function readJsonObject(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

const overrides = readJsonObject(overridesPath);
if (!overrides) {
  process.stderr.write(`admin overrides ignored: ${overridesPath} is not a JSON object\n`);
  process.exit(0);
}
if (overrides.version !== 1) {
  process.stderr.write("admin overrides ignored: unknown version\n");
  process.exit(0);
}

const rendered = readJsonObject(renderedPath);
if (!rendered) {
  process.stderr.write(`admin overrides ignored: ${renderedPath} is not a JSON object\n`);
  process.exit(0);
}

function objectAt(root, keys) {
  let current = root;
  for (const key of keys) {
    const next = current?.[key];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      return undefined;
    }
    current = next;
  }
  return current;
}

function ensureObjectAt(root, keys) {
  let current = root;
  for (const key of keys) {
    const next = current[key];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key];
  }
  return current;
}

/** Copy the allowed leaves of one scope, and report which names moved. */
function mergeScope(sourceScope, targetKeys) {
  if (!sourceScope) {
    return [];
  }
  const applied = [];
  const target = ensureObjectAt(rendered, targetKeys);
  for (const leaf of ALLOWED_LEAVES) {
    if (!Object.hasOwn(sourceScope, leaf)) {
      continue;
    }
    const value = sourceScope[leaf];
    if (value === null) {
      delete target[leaf];
    } else {
      target[leaf] = value;
    }
    applied.push(`${targetKeys.join(".")}.${leaf}`);
  }
  return applied;
}

const applied = mergeScope(objectAt(overrides, ["agents", "defaults"]), ["agents", "defaults"]);

// Per-agent overrides are accepted for agents the template already declares. Creating an
// agent from this file is not an administrator's decision: an agent has a workspace, a
// department binding and tool policy behind it, and none of those live here.
const overrideEntries = objectAt(overrides, ["agents", "entries"]);
const templateEntries = objectAt(rendered, ["agents", "entries"]);
if (overrideEntries && templateEntries) {
  for (const agentId of Object.keys(overrideEntries)) {
    if (!Object.hasOwn(templateEntries, agentId)) {
      process.stderr.write(`admin overrides skipped unknown agent: ${agentId}\n`);
      continue;
    }
    applied.push(
      ...mergeScope(objectAt(overrideEntries, [agentId]), ["agents", "entries", agentId]),
    );
  }
}

if (applied.length === 0) {
  process.stderr.write("admin overrides carried nothing this start\n");
  process.exit(0);
}

writeFileSync(renderedPath, `${JSON.stringify(rendered, null, 2)}\n`, "utf8");
process.stderr.write(`admin overrides applied: ${applied.join(", ")}\n`);
