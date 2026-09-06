// Gateway document conversion module implements headless LibreOffice rendering for file previews.
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { logWarn } from "../logger.js";

/** Where a usable soffice binary was found, if any. */
export type DocumentConverterInfo = {
  available: boolean;
  binary?: string;
};

/** Hard wall-clock budget for one conversion; LibreOffice can hang on damaged input. */
export const DOCUMENT_CONVERT_TIMEOUT_MS = 60_000;

/** Result of rendering one workspace document to PDF. */
export type ConvertDocumentResult =
  | { ok: true; pdf: Buffer; converter: string }
  | { ok: false; reason: "converter-unavailable" | "conversion-failed" };

/** Office formats LibreOffice converts reliably; anything else is rejected before spawning. */
const CONVERTIBLE_EXTENSIONS = new Set([
  "doc",
  "docx",
  "odt",
  "rtf",
  "xls",
  "xlsx",
  "ods",
  "csv",
  "ppt",
  "pptx",
  "odp",
]);

// A converted deck can legitimately be a few MB; past this the payload is not
// something a preview pane should ship over the gateway connection.
const MAX_CONVERTED_BYTES = 40 * 1024 * 1024;
// LibreOffice forks a heavy process per conversion, so a burst of preview
// requests must not be allowed to fork one process per request.
const CONVERT_CONCURRENCY = 2;
const CACHE_MAX_ENTRIES = 8;
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
// A missing binary is re-probed after this cooldown so installing LibreOffice
// takes effect without a gateway restart, while a found binary stays cached.
const CONVERTER_PROBE_RETRY_MS = 60_000;

type ConverterProbe = {
  at: number;
  info: DocumentConverterInfo;
  /** Operator pin the probe was made against; a changed pin invalidates it. */
  pin: string;
};

let converterProbe: Promise<ConverterProbe> | undefined;

// Deliberately not an OPENCLAW_-prefixed name: this pins a third-party binary,
// the same way EDITOR or BROWSER name external tools, and the repository keeps a
// hard ratchet on how many OPENCLAW_* names production source may introduce.
function converterPin(): string {
  return process.env.SOFFICE_BIN?.trim() ?? "";
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
    // Windows has no executable bit, so presence is the only meaningful check there.
    await fs.access(candidate, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executableCandidateNames(name: string): string[] {
  if (process.platform !== "win32" || path.extname(name)) {
    return [name];
  }
  const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return [name, ...extensions.map((extension) => `${name}${extension.toLowerCase()}`)];
}

async function resolveExecutable(name: string): Promise<string | undefined> {
  if (name.includes("/") || name.includes("\\")) {
    return (await isExecutableFile(name)) ? name : undefined;
  }
  const directories = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter((entry) => entry.length > 0);
  for (const directory of directories) {
    for (const candidate of executableCandidateNames(name)) {
      const full = path.join(directory, candidate);
      if (await isExecutableFile(full)) {
        return full;
      }
    }
  }
  return undefined;
}

async function probeDocumentConverter(pin: string): Promise<DocumentConverterInfo> {
  // An explicit operator pin is authoritative: silently falling back to another
  // binary would hide a misconfigured path behind a working preview.
  const names = pin ? [pin] : ["soffice", "libreoffice"];
  for (const name of names) {
    const binary = await resolveExecutable(name);
    if (binary) {
      return { available: true, binary };
    }
  }
  return { available: false };
}

/** Finds the soffice binary the gateway should use, memoized with a negative-result cooldown. */
export async function resolveDocumentConverter(): Promise<DocumentConverterInfo> {
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
  const next = probeDocumentConverter(pin).then((info) => ({ at: Date.now(), info, pin }));
  converterProbe = next;
  return (await next).info;
}

let activeConversions = 0;
const conversionWaiters: (() => void)[] = [];

function releaseConversionSlot(): void {
  const next = conversionWaiters.shift();
  if (next) {
    // Hand the slot straight to the next waiter; decrementing first would let an
    // unrelated caller slip in and push concurrency past the cap.
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

type CacheEntry = { pdf: Buffer; converter: string };

const conversionCache = new Map<string, CacheEntry>();
let conversionCacheBytes = 0;
const conversionInFlight = new Map<string, Promise<ConvertDocumentResult>>();

function cacheConversion(key: string, entry: CacheEntry): void {
  const existing = conversionCache.get(key);
  if (existing) {
    conversionCacheBytes -= existing.pdf.byteLength;
    conversionCache.delete(key);
  }
  conversionCache.set(key, entry);
  conversionCacheBytes += entry.pdf.byteLength;
  // Map iteration is insertion ordered, so the first key is always the oldest.
  while (
    conversionCache.size > CACHE_MAX_ENTRIES ||
    (conversionCacheBytes > CACHE_MAX_BYTES && conversionCache.size > 1)
  ) {
    const oldestKey = conversionCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    const oldest = conversionCache.get(oldestKey);
    conversionCache.delete(oldestKey);
    conversionCacheBytes -= oldest?.pdf.byteLength ?? 0;
  }
}

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    // soffice.exe re-execs into soffice.bin, so killing only the direct child
    // leaves the real converter running and holding the temp profile.
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
      // The process already exited; nothing is left to reclaim.
    }
  }
}

type ConverterRun = { ok: boolean; timedOut: boolean };

async function runConverter(binary: string, args: string[]): Promise<ConverterRun> {
  return await new Promise<ConverterRun>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(binary, args, {
        // A detached child owns a process group, which is what lets the timeout
        // path reclaim the helper process LibreOffice re-execs into.
        detached: process.platform !== "win32",
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      resolve({ ok: false, timedOut: false });
      return;
    }
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, DOCUMENT_CONVERT_TIMEOUT_MS);
    timer.unref?.();
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ ok, timedOut });
    };
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0 && !timedOut));
  });
}

async function convertUncached(params: {
  buffer: Buffer;
  extension: string;
  binary: string;
}): Promise<ConvertDocumentResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-doc-"));
  try {
    const inputPath = path.join(tempDir, `input.${params.extension}`);
    await fs.writeFile(inputPath, params.buffer);
    const profileUrl = pathToFileURL(path.join(tempDir, "profile")).href;
    const run = await runConverter(params.binary, [
      "--headless",
      "--norestore",
      "--invisible",
      "--nolockcheck",
      "--nodefault",
      "--nofirststartwizard",
      `-env:UserInstallation=${profileUrl}`,
      "--convert-to",
      "pdf",
      "--outdir",
      tempDir,
      inputPath,
    ]);
    if (!run.ok) {
      logWarn(
        `document preview conversion failed for .${params.extension} (${run.timedOut ? "timeout" : "converter error"})`,
      );
      return { ok: false, reason: "conversion-failed" };
    }
    let pdf: Buffer;
    try {
      pdf = await fs.readFile(path.join(tempDir, "input.pdf"));
    } catch {
      logWarn(`document preview conversion produced no output for .${params.extension}`);
      return { ok: false, reason: "conversion-failed" };
    }
    if (pdf.byteLength === 0 || pdf.byteLength > MAX_CONVERTED_BYTES) {
      return { ok: false, reason: "conversion-failed" };
    }
    return { ok: true, pdf, converter: params.binary };
  } finally {
    // The temp directory holds both the source bytes and a throwaway LibreOffice
    // profile; leaving either behind leaks workspace content into os.tmpdir.
    await fs.rm(tempDir, { force: true, recursive: true }).catch(() => {});
  }
}

/** Renders one office document to PDF through headless LibreOffice. */
export async function convertDocumentToPdf(params: {
  buffer: Buffer;
  sourceExtension: string;
}): Promise<ConvertDocumentResult> {
  const extension = params.sourceExtension.trim().toLowerCase().replace(/^\./u, "");
  if (!CONVERTIBLE_EXTENSIONS.has(extension)) {
    return { ok: false, reason: "conversion-failed" };
  }
  const converter = await resolveDocumentConverter();
  if (!converter.available || !converter.binary) {
    return { ok: false, reason: "converter-unavailable" };
  }
  const binary = converter.binary;
  // The extension joins the digest because identical bytes render differently
  // depending on which import filter LibreOffice picks for them.
  const key = `${createHash("sha256").update(params.buffer).digest("hex")}:${extension}`;
  const cached = conversionCache.get(key);
  if (cached) {
    return { ok: true, pdf: cached.pdf, converter: cached.converter };
  }
  const inFlight = conversionInFlight.get(key);
  if (inFlight) {
    // Two viewers opening the same file share a single LibreOffice run.
    return await inFlight;
  }
  const pending = (async (): Promise<ConvertDocumentResult> => {
    const release = await acquireConversionSlot();
    try {
      const result = await convertUncached({ binary, buffer: params.buffer, extension });
      if (result.ok) {
        cacheConversion(key, { converter: result.converter, pdf: result.pdf });
      }
      return result;
    } catch {
      return { ok: false, reason: "conversion-failed" };
    } finally {
      release();
    }
  })();
  conversionInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    conversionInFlight.delete(key);
  }
}
