// Gateway document module implements the optional `rhwp` bridge for Hangul documents.
//
// The built-in reader in document-extract-hangul.ts pulls every character out of a .hwp,
// but it flattens a table into one paragraph per cell: the row and column a cell sat in,
// and every merge, are gone. Most of the delivery share's Hangul documents are forms
// (purchase orders, daily reports, approval boxes), so that structure is most of their
// meaning.
//
// `rhwp` (github.com/edwardkim/rhwp, MIT, Rust) renders the same documents to Markdown
// with real tables, including merged cells, and splits the output one file per page.
// It is a single ~15 MB binary with no Hancom, LibreOffice or font dependency, so it is
// installed into the delivery image and treated exactly like LibreOffice is: probed at
// runtime, never required. When it is absent the built-in reader still answers.
import { type ChildProcess, spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { logWarn } from "../logger.js";

/** Where a usable rhwp binary was found, if any. */
export type HangulConverterInfo = {
  available: boolean;
  binary?: string;
};

/** Wall-clock budget for one document. A 200-page notice takes well under a second. */
const HANGUL_CONVERT_TIMEOUT_MS = 60_000;

/** Pages past this are dropped, matching the PDF lane's ceiling. */
const MAX_PAGES = 1000;
/** Whole-document character ceiling, the same budget the PDF lane uses. */
const MAX_TOTAL_CHARS = 400_000;

/**
 * Only two extensions reach the binary. Everything else must not be handed to a
 * subprocess just because a caller passed it along.
 */
const HANGUL_EXTENSIONS = new Set(["hwp", "hwpx"]);

/** rhwp forks per document, so a burst of previews must not fork one process each. */
const CONVERT_CONCURRENCY = 2;
/** A missing binary is re-probed after this cooldown, so installing it needs no restart. */
const CONVERTER_PROBE_RETRY_MS = 60_000;

export type HangulCliResult =
  | { ok: true; markdown: string; pages: number }
  | { ok: false; reason: "converter-unavailable" | "conversion-failed" };

type ConverterProbe = { at: number; info: HangulConverterInfo; pin: string };

let converterProbe: Promise<ConverterProbe> | undefined;

// Deliberately not an OPENCLAW_-prefixed name, for the same reason SOFFICE_BIN is not:
// it pins a third-party binary, and the repository ratchets how many OPENCLAW_* names
// production source may introduce.
function converterPin(): string {
  return process.env.RHWP_BIN?.trim() ?? "";
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) {
      return false;
    }
  } catch {
    return false;
  }
  try {
    await fs.access(candidate, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveOnPath(name: string): Promise<string | undefined> {
  if (name.includes("/") || name.includes("\\")) {
    return (await isExecutableFile(name)) ? name : undefined;
  }
  const suffixes = process.platform === "win32" ? [".exe", ""] : [""];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (directory.length === 0) {
      continue;
    }
    for (const suffix of suffixes) {
      const full = path.join(directory, `${name}${suffix}`);
      if (await isExecutableFile(full)) {
        return full;
      }
    }
  }
  return undefined;
}

async function probeHangulConverter(pin: string): Promise<HangulConverterInfo> {
  if (pin) {
    // An explicit operator pin is authoritative; falling back to PATH would hide a
    // misconfigured path behind a working conversion.
    const pinned = await resolveOnPath(pin);
    return pinned ? { available: true, binary: pinned } : { available: false };
  }
  const onPath = await resolveOnPath("rhwp");
  if (onPath) {
    return { available: true, binary: onPath };
  }
  // Where the delivery image's optional rhwp build argument installs it.
  const bundled = "/opt/rhwp/rhwp";
  return (await isExecutableFile(bundled))
    ? { available: true, binary: bundled }
    : { available: false };
}

/** Finds the rhwp binary, memoized with a negative-result cooldown. */
export async function resolveHangulConverter(): Promise<HangulConverterInfo> {
  const pin = converterPin();
  const pending = converterProbe;
  if (pending) {
    const probed = await pending.catch(() => undefined);
    if (
      probed &&
      probed.pin === pin &&
      (probed.info.available || Date.now() - probed.at < CONVERTER_PROBE_RETRY_MS)
    ) {
      return probed.info;
    }
  }
  const next = probeHangulConverter(pin).then((info) => ({ at: Date.now(), info, pin }));
  converterProbe = next;
  return (await next).info;
}

/** Test seam: drops the memoized probe so a test can change the pin. */
export function resetHangulConverterProbe(): void {
  converterProbe = undefined;
}

let activeConversions = 0;
const conversionWaiters: (() => void)[] = [];

function releaseConversionSlot(): void {
  const next = conversionWaiters.shift();
  if (next) {
    next();
    return;
  }
  activeConversions -= 1;
}

async function acquireConversionSlot(): Promise<() => void> {
  if (activeConversions < CONVERT_CONCURRENCY) {
    activeConversions += 1;
  } else {
    await new Promise<void>((resolve) => {
      conversionWaiters.push(resolve);
    });
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    releaseConversionSlot();
  };
}

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.on("error", () => {});
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

async function runConverter(binary: string, args: string[]): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(binary, args, {
        detached: process.platform !== "win32",
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, HANGUL_CONVERT_TIMEOUT_MS);
    timer.unref?.();
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0 && !timedOut));
  });
}

/**
 * Joins the per-page Markdown files rhwp writes into one document.
 *
 * The page heading is not decoration: a memory citation is a line range inside the
 * sidecar, so the nearest `## p.N` above the quoted line is what tells a reader which
 * page of the original to open. The PDF lane writes the same heading for the same reason.
 */
async function collectPages(directory: string): Promise<{ markdown: string; pages: number }> {
  const names = (await fs.readdir(directory))
    .filter((name) => name.toLowerCase().endsWith(".md"))
    .toSorted((left, right) => left.localeCompare(right, "en"))
    .slice(0, MAX_PAGES);
  const sections: string[] = [];
  let used = 0;
  let pages = 0;
  for (const name of names) {
    pages += 1;
    if (used >= MAX_TOTAL_CHARS) {
      sections.push(`## p.${pages}\n\n(이후 페이지는 길이 상한으로 생략)`);
      break;
    }
    const body = (await fs.readFile(path.join(directory, name), "utf8")).trim();
    if (body.length === 0) {
      continue;
    }
    used += body.length;
    sections.push(`## p.${pages}\n\n${body}`);
  }
  return { markdown: sections.join("\n\n").trim(), pages };
}

/** Renders one Hangul document to Markdown through rhwp, tables and all. */
export async function convertHangulToMarkdown(params: {
  buffer: Buffer;
  sourceExtension: string;
}): Promise<HangulCliResult> {
  const extension = params.sourceExtension.trim().toLowerCase().replace(/^\./u, "");
  if (!HANGUL_EXTENSIONS.has(extension)) {
    return { ok: false, reason: "conversion-failed" };
  }
  const converter = await resolveHangulConverter();
  if (!converter.available || !converter.binary) {
    return { ok: false, reason: "converter-unavailable" };
  }
  const binary = converter.binary;
  const release = await acquireConversionSlot();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-hwp-"));
  try {
    const inputPath = path.join(tempDir, `input.${extension}`);
    const outDir = path.join(tempDir, "out");
    await fs.writeFile(inputPath, params.buffer);
    await fs.mkdir(outDir);
    // Arguments go as an array, never through a shell, and the extension whitelist above
    // means no caller can steer this at another file type.
    const ok = await runConverter(binary, ["export-markdown", inputPath, "-o", outDir]);
    if (!ok) {
      logWarn(`hangul conversion failed for .${extension} (rhwp)`);
      return { ok: false, reason: "conversion-failed" };
    }
    const collected = await collectPages(outDir);
    if (collected.markdown.length === 0) {
      return { ok: false, reason: "conversion-failed" };
    }
    return { markdown: collected.markdown, ok: true, pages: collected.pages };
  } catch {
    return { ok: false, reason: "conversion-failed" };
  } finally {
    release();
    // The temp directory holds the source bytes and the rendered pages, plus any images
    // rhwp extracted; leaving it behind would leak customer documents into os.tmpdir.
    await fs.rm(tempDir, { force: true, recursive: true }).catch(() => {});
  }
}
