// Gateway document module implements dependency-free text extraction for Hangul word
// processor files (.hwp version 5, and .hwpx).
//
// Why this exists rather than another LibreOffice hop: the delivery image ships
// LibreOffice 7.4, whose `libhwplo` filter only understands the pre-2005 HWP 3.0 format.
// Feeding it a modern .hwp exits with status 0 and writes no output at all, so every one
// of the customer share's Hangul documents silently produced nothing. Measured on real
// files from that share, this reader also keeps table cell text that pyhwp's `hwp5txt`
// drops, and the business forms in the share are almost entirely tables.
//
// The two containers:
//   .hwp   OLE2 compound file. `BodyText/SectionN` streams hold raw-deflate record
//          streams; paragraph text is one record tag inside them, encoded UTF-16LE.
//   .hwpx  Zip of XML. Section text sits in `<hp:t>` elements, one `<hp:p>` per paragraph.
import zlib from "node:zlib";
import type JSZipArchive from "jszip";
import { isCompoundFile, readCompoundFile } from "./document-cfb.js";

/** Extensions this module claims. Everything else must go to another extractor. */
const HANGUL_EXTENSIONS = new Set(["hwp", "hwpx"]);

/** Ceiling on one decompressed section stream; a crafted file must not exhaust memory. */
const MAX_SECTION_BYTES = 64 * 1024 * 1024;
/** Ceiling on the extracted text handed back to any caller. */
const MAX_TEXT_CHARS = 1_000_000;
/** Sections are numbered from zero and a document with more than this is malformed. */
const MAX_SECTIONS = 256;

const TRUNCATION_NOTE = "[본문이 상한을 넘어 잘렸습니다]";

/** Why a Hangul document produced no text. */
export type HangulExtractFailure =
  | "unsupported-format"
  | "legacy-format"
  | "encrypted"
  | "distribution"
  | "parse-failed"
  | "empty";

export type HangulExtraction =
  | { ok: true; text: string; truncated: boolean; container: "hwp" | "hwpx" }
  | { ok: false; reason: HangulExtractFailure };

/** True when this module owns the extension. */
export function isHangulExtension(extension: string): boolean {
  return HANGUL_EXTENSIONS.has(extension.trim().toLowerCase().replace(/^\./u, ""));
}

// ── .hwp (OLE2 compound file) ────────────────────────────────────

/** Record tag carrying paragraph text: HWPTAG_BEGIN (0x010) + 51. */
const HWPTAG_PARA_TEXT = 0x010 + 51;

/**
 * Control characters that occupy eight UTF-16 units rather than one.
 *
 * The paragraph text stream mixes real characters with control markers for tables,
 * pictures, footnotes and field starts. The wide ones carry their payload inline, so a
 * reader that advanced by one unit would emit the payload bytes as mojibake.
 */
const WIDE_CONTROL_CODES = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
]);
const WIDE_CONTROL_UNITS = 8;

function paragraphText(data: Buffer): string {
  const parts: string[] = [];
  for (let offset = 0; offset + 1 < data.length;) {
    const code = data.readUInt16LE(offset);
    if (code >= 32) {
      parts.push(String.fromCharCode(code));
      offset += 2;
      continue;
    }
    if (code === 9) {
      // Tab is a wide control whose payload is layout only.
      parts.push("\t");
      offset += WIDE_CONTROL_UNITS * 2;
      continue;
    }
    if (code === 10 || code === 13) {
      parts.push("\n");
      offset += 2;
      continue;
    }
    offset += WIDE_CONTROL_CODES.has(code) ? WIDE_CONTROL_UNITS * 2 : 2;
  }
  return parts.join("");
}

/**
 * Walks one decompressed section stream and collects its paragraph text.
 *
 * Record header is a single little-endian word: tag in bits 0-9, nesting level in bits
 * 10-19, size in bits 20-31. The size field saturates at 0xfff, and a saturated value
 * means the real size follows as its own word.
 */
function sectionParagraphs(stream: Buffer): string[] {
  const paragraphs: string[] = [];
  let offset = 0;
  while (offset + 4 <= stream.length) {
    const header = stream.readUInt32LE(offset);
    offset += 4;
    const tag = header & 0x3ff;
    let size = (header >>> 20) & 0xfff;
    if (size === 0xfff) {
      if (offset + 4 > stream.length) {
        break;
      }
      size = stream.readUInt32LE(offset);
      offset += 4;
    }
    if (offset + size > stream.length) {
      break;
    }
    if (tag === HWPTAG_PARA_TEXT) {
      paragraphs.push(paragraphText(stream.subarray(offset, offset + size)));
    }
    offset += size;
  }
  return paragraphs;
}

function inflateSection(raw: Buffer, compressed: boolean): Buffer | undefined {
  if (!compressed) {
    return raw;
  }
  try {
    // Sections carry a bare deflate payload, without the two-byte zlib wrapper.
    return zlib.inflateRawSync(raw, { maxOutputLength: MAX_SECTION_BYTES });
  } catch {
    return undefined;
  }
}

function extractHwp(buffer: Buffer): HangulExtraction {
  let container: ReturnType<typeof readCompoundFile>;
  try {
    container = readCompoundFile(buffer);
  } catch {
    return { ok: false, reason: "parse-failed" };
  }
  const header = container.readStream("FileHeader");
  if (!header || header.length < 40) {
    return { ok: false, reason: "parse-failed" };
  }
  if (!header.subarray(0, 17).toString("latin1").startsWith("HWP Document File")) {
    return { ok: false, reason: "parse-failed" };
  }
  const flags = header.readUInt32LE(36);
  // Bit 1 is a password, bit 2 is a "distribution" document whose body records are
  // encrypted with a per-document key. Neither can be read without the secret, and
  // guessing would produce plausible-looking garbage, so both stop here.
  if ((flags & 0b10) !== 0) {
    return { ok: false, reason: "encrypted" };
  }
  if ((flags & 0b100) !== 0) {
    return { ok: false, reason: "distribution" };
  }
  const compressed = (flags & 0b1) !== 0;
  const sections = container.streamNames
    .filter((name) => /^BodyText\/Section\d+$/u.test(name))
    .sort((left, right) => sectionIndex(left) - sectionIndex(right))
    .slice(0, MAX_SECTIONS);
  const paragraphs: string[] = [];
  for (const name of sections) {
    const raw = container.readStream(name);
    if (!raw || raw.length === 0) {
      continue;
    }
    const stream = inflateSection(raw, compressed);
    if (!stream) {
      continue;
    }
    paragraphs.push(...sectionParagraphs(stream));
  }
  return finish(paragraphs, "hwp");
}

function stripXml(name: string): string {
  return name.replace(/\.xml$/u, "");
}

function sectionIndex(name: string): number {
  const digits = /(\d+)$/u.exec(name)?.[1];
  return digits === undefined ? 0 : Number.parseInt(digits, 10);
}

// ── .hwpx (zip of XML) ───────────────────────────────────────────

function decodeXmlText(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/gu, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named: Record<string, string> = {
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      quot: '"',
    };
    return named[entity] ?? match;
  });
}

function hwpxSectionParagraphs(xml: string): string[] {
  const paragraphs: string[] = [];
  // Splitting on the paragraph element keeps line structure without a full XML parse;
  // the first chunk is everything before the first paragraph, so it is dropped.
  const chunks = xml.split(/<hp:p[\s>]/u).slice(1);
  for (const chunk of chunks) {
    let text = "";
    for (const match of chunk.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/gu)) {
      // Runs can carry inline markers (highlight starts, field marks); strip the tags and
      // keep the characters between them.
      text += decodeXmlText((match[1] ?? "").replace(/<[^>]*>/gu, ""));
    }
    paragraphs.push(text);
  }
  return paragraphs;
}

async function extractHwpx(buffer: Buffer): Promise<HangulExtraction> {
  let zip: JSZipArchive;
  try {
    const { default: JSZip } = await import("jszip");
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return { ok: false, reason: "parse-failed" };
  }
  const names = Object.keys(zip.files)
    .filter((name) => /^Contents\/section\d+\.xml$/u.test(name))
    .sort((left, right) => sectionIndex(stripXml(left)) - sectionIndex(stripXml(right)))
    .slice(0, MAX_SECTIONS);
  if (names.length === 0) {
    return { ok: false, reason: "parse-failed" };
  }
  const paragraphs: string[] = [];
  for (const name of names) {
    const file = zip.file(name);
    if (!file) {
      continue;
    }
    paragraphs.push(...hwpxSectionParagraphs(await file.async("string")));
  }
  return finish(paragraphs, "hwpx");
}

// ── shared ───────────────────────────────────────────────────────

function finish(paragraphs: readonly string[], container: "hwp" | "hwpx"): HangulExtraction {
  const joined = paragraphs
    .map((paragraph) =>
      paragraph
        .replace(/\r/gu, "")
        .replace(/[ \t]+$/gmu, "")
        .trim(),
    )
    .filter((paragraph) => paragraph.length > 0)
    .join("\n\n");
  const text = joined.replace(/\n{3,}/gu, "\n\n").trim();
  if (text.length === 0) {
    return { ok: false, reason: "empty" };
  }
  const truncated = text.length > MAX_TEXT_CHARS;
  return {
    container,
    ok: true,
    text: truncated ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n${TRUNCATION_NOTE}` : text,
    truncated,
  };
}

/** Extracts plain text from a Hangul word processor document. */
export async function extractHangulText(params: {
  buffer: Buffer;
  sourceExtension: string;
}): Promise<HangulExtraction> {
  const extension = params.sourceExtension.trim().toLowerCase().replace(/^\./u, "");
  if (!HANGUL_EXTENSIONS.has(extension)) {
    return { ok: false, reason: "unsupported-format" };
  }
  if (params.buffer.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (extension === "hwpx") {
    return await extractHwpx(params.buffer);
  }
  if (!isCompoundFile(params.buffer)) {
    // HWP 3.0 files are a flat format with their own signature. They predate 2005 and
    // this reader does not decode them, but naming the reason keeps the sync report
    // honest instead of reporting a generic parse failure.
    if (params.buffer.subarray(0, 30).toString("latin1").startsWith("HWP Document File V3")) {
      return { ok: false, reason: "legacy-format" };
    }
    return { ok: false, reason: "parse-failed" };
  }
  return extractHwp(params.buffer);
}
