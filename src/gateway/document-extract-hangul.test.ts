// Tests for the built-in Hangul word processor reader (.hwp version 5, .hwpx).
import zlib from "node:zlib";
import JSZip from "jszip";
import { describe, expect, test } from "vitest";
import { readCompoundFile } from "./document-cfb.js";
import { extractHangulText, isHangulExtension } from "./document-extract-hangul.js";

const SECTOR_SIZE = 512;
const MINI_SECTOR_SIZE = 64;
const FREE_SECTOR = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;
const FAT_SECTOR = 0xfffffffd;

type BuiltStream = { name: string; data: Buffer };

/**
 * Writes a minimal compound file holding `FileHeader` and one `BodyText/Section0`.
 *
 * Real fixtures cannot be committed here (the only ones on hand are customer documents),
 * so the container is assembled by hand: 512-byte sectors, one FAT sector, one directory
 * sector, and both streams living in the mini stream the way a real document stores them.
 */
function buildCompoundFile(streams: readonly BuiltStream[]): Buffer {
  const miniChunks: Buffer[] = [];
  const placed = streams.map((stream) => {
    const start = miniChunks.length;
    const padded = Buffer.alloc(
      Math.ceil(stream.data.length / MINI_SECTOR_SIZE) * MINI_SECTOR_SIZE,
    );
    stream.data.copy(padded);
    for (let offset = 0; offset < padded.length; offset += MINI_SECTOR_SIZE) {
      miniChunks.push(padded.subarray(offset, offset + MINI_SECTOR_SIZE));
    }
    return { ...stream, size: stream.data.length, start };
  });
  const miniStream = Buffer.concat(miniChunks);

  const miniFat = Buffer.alloc(SECTOR_SIZE, 0xff);
  for (const stream of placed) {
    const last = stream.start + Math.ceil(stream.size / MINI_SECTOR_SIZE) - 1;
    for (let index = stream.start; index <= last; index += 1) {
      miniFat.writeUInt32LE(index === last ? END_OF_CHAIN : index + 1, index * 4);
    }
  }

  // Sector 0 FAT, sector 1 directory, sector 2 mini FAT, sectors 3+ the mini stream.
  const miniSectorCount = Math.max(1, Math.ceil(miniStream.length / SECTOR_SIZE));
  const fat = Buffer.alloc(SECTOR_SIZE, 0xff);
  fat.writeUInt32LE(FAT_SECTOR, 0);
  fat.writeUInt32LE(END_OF_CHAIN, 4);
  fat.writeUInt32LE(END_OF_CHAIN, 8);
  for (let index = 0; index < miniSectorCount; index += 1) {
    fat.writeUInt32LE(index === miniSectorCount - 1 ? END_OF_CHAIN : 4 + index, (3 + index) * 4);
  }

  // Root, then BodyText (storage) -> Section0, with FileHeader as BodyText's right sibling.
  const directory = Buffer.alloc(SECTOR_SIZE, 0);
  const writeEntry = (
    index: number,
    entry: {
      name: string;
      type: number;
      left: number;
      right: number;
      child: number;
      start: number;
      size: number;
    },
  ) => {
    const base = index * 128;
    const encoded = Buffer.from(`${entry.name}\0`, "utf16le");
    encoded.copy(directory, base);
    directory.writeUInt16LE(encoded.length, base + 64);
    directory.writeUInt8(entry.type, base + 66);
    directory.writeUInt32LE(entry.left, base + 68);
    directory.writeUInt32LE(entry.right, base + 72);
    directory.writeUInt32LE(entry.child, base + 76);
    directory.writeUInt32LE(entry.start, base + 116);
    directory.writeBigUInt64LE(BigInt(entry.size), base + 120);
  };
  const header = placed.find((stream) => stream.name === "FileHeader");
  const section = placed.find((stream) => stream.name === "Section0");
  writeEntry(0, {
    child: 1,
    left: FREE_SECTOR,
    name: "Root Entry",
    right: FREE_SECTOR,
    size: miniStream.length,
    start: 3,
    type: 5,
  });
  writeEntry(1, {
    child: 3,
    left: FREE_SECTOR,
    name: "BodyText",
    right: 2,
    size: 0,
    start: 0,
    type: 1,
  });
  writeEntry(2, {
    child: FREE_SECTOR,
    left: FREE_SECTOR,
    name: "FileHeader",
    right: FREE_SECTOR,
    size: header?.size ?? 0,
    start: header?.start ?? 0,
    type: 2,
  });
  writeEntry(3, {
    child: FREE_SECTOR,
    left: FREE_SECTOR,
    name: "Section0",
    right: FREE_SECTOR,
    size: section?.size ?? 0,
    start: section?.start ?? 0,
    type: 2,
  });

  const head = Buffer.alloc(SECTOR_SIZE, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(head);
  head.writeUInt16LE(9, 30);
  head.writeUInt16LE(6, 32);
  head.writeUInt32LE(1, 44);
  head.writeUInt32LE(1, 48);
  head.writeUInt32LE(4096, 56);
  head.writeUInt32LE(2, 60);
  head.writeUInt32LE(1, 64);
  head.writeUInt32LE(END_OF_CHAIN, 68);
  head.writeUInt32LE(0, 72);
  head.fill(0xff, 76, 512);
  head.writeUInt32LE(0, 76);

  const miniSectors = Buffer.alloc(miniSectorCount * SECTOR_SIZE, 0);
  miniStream.copy(miniSectors);
  return Buffer.concat([head, fat, directory, miniFat, miniSectors]);
}

/** Encodes one paragraph text record the way a section stream stores it. */
function paragraphRecord(text: string): Buffer {
  const body = Buffer.from(`${text}\r`, "utf16le");
  const head = Buffer.alloc(4);
  // tag 67 (paragraph text), level 0, size in the top 12 bits.
  head.writeUInt32LE(67 | (0 << 10) | (body.length << 20));
  return Buffer.concat([head, body]);
}

function buildHwp(params: { flags: number; paragraphs: readonly string[] }): Buffer {
  const fileHeader = Buffer.alloc(256, 0);
  fileHeader.write("HWP Document File", 0, "latin1");
  fileHeader.writeUInt32LE(0x05000300, 32);
  fileHeader.writeUInt32LE(params.flags, 36);
  const records = Buffer.concat(params.paragraphs.map(paragraphRecord));
  const section = (params.flags & 1) === 0 ? records : zlib.deflateRawSync(records);
  return buildCompoundFile([
    { data: fileHeader, name: "FileHeader" },
    { data: section, name: "Section0" },
  ]);
}

async function buildHwpx(paragraphs: readonly string[]): Promise<Buffer> {
  const zip = new JSZip();
  const body = paragraphs
    .map((text) => `<hp:p id="1"><hp:run><hp:t>${text}</hp:t></hp:run></hp:p>`)
    .join("");
  zip.file("mimetype", "application/hwp+zip");
  zip.file("Contents/section0.xml", `<?xml version="1.0"?><hs:sec>${body}</hs:sec>`);
  return await zip.generateAsync({ type: "nodebuffer" });
}

describe("isHangulExtension", () => {
  test("claims only the two Hangul containers", () => {
    expect(isHangulExtension("hwp")).toBe(true);
    expect(isHangulExtension(".HWPX")).toBe(true);
    expect(isHangulExtension("docx")).toBe(false);
  });
});

describe("compound file reader", () => {
  test("lists storages and streams by full path", () => {
    const container = readCompoundFile(buildHwp({ flags: 1, paragraphs: ["가"] }));
    expect(container.streamNames.toSorted()).toEqual(["BodyText/Section0", "FileHeader"]);
    expect(container.readStream("FileHeader")?.length).toBe(256);
    expect(container.readStream("BodyText/Missing")).toBeUndefined();
  });
});

describe("hwp", () => {
  test("reads compressed section text", async () => {
    const buffer = buildHwp({ flags: 1, paragraphs: ["시약 재고 현황", "에탄올 99.5%"] });
    expect(await extractHangulText({ buffer, sourceExtension: "hwp" })).toEqual({
      container: "hwp",
      ok: true,
      text: "시약 재고 현황\n\n에탄올 99.5%",
      truncated: false,
    });
  });

  test("reads an uncompressed section too", async () => {
    const buffer = buildHwp({ flags: 0, paragraphs: ["압축 없음"] });
    const result = await extractHangulText({ buffer, sourceExtension: "hwp" });
    expect(result).toMatchObject({ ok: true, text: "압축 없음" });
  });

  test("refuses a password protected document instead of guessing", async () => {
    const buffer = buildHwp({ flags: 0b11, paragraphs: ["비밀"] });
    expect(await extractHangulText({ buffer, sourceExtension: "hwp" })).toEqual({
      ok: false,
      reason: "encrypted",
    });
  });

  test("names a distribution copy as its own reason", async () => {
    const buffer = buildHwp({ flags: 0b101, paragraphs: ["배포용"] });
    expect(await extractHangulText({ buffer, sourceExtension: "hwp" })).toEqual({
      ok: false,
      reason: "distribution",
    });
  });

  test("names the pre-2005 format rather than reporting a parse failure", async () => {
    const buffer = Buffer.from("HWP Document File V3.00 ", "latin1");
    expect(await extractHangulText({ buffer, sourceExtension: "hwp" })).toEqual({
      ok: false,
      reason: "legacy-format",
    });
  });

  test("reports a file that is not a compound container", async () => {
    expect(
      await extractHangulText({ buffer: Buffer.from("not a document"), sourceExtension: "hwp" }),
    ).toEqual({ ok: false, reason: "parse-failed" });
  });

  test("reports an empty file", async () => {
    expect(await extractHangulText({ buffer: Buffer.alloc(0), sourceExtension: "hwp" })).toEqual({
      ok: false,
      reason: "empty",
    });
  });
});

describe("hwpx", () => {
  test("reads paragraph text out of the section parts", async () => {
    const buffer = await buildHwpx(["2025년 공고", "신청 기간 &lt;필수&gt;"]);
    expect(await extractHangulText({ buffer, sourceExtension: "hwpx" })).toEqual({
      container: "hwpx",
      ok: true,
      text: "2025년 공고\n\n신청 기간 <필수>",
      truncated: false,
    });
  });

  test("reports an archive with no section part", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/hwp+zip");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    expect(await extractHangulText({ buffer, sourceExtension: "hwpx" })).toEqual({
      ok: false,
      reason: "parse-failed",
    });
  });
});

describe("other extensions", () => {
  test("refuses anything this reader does not own", async () => {
    expect(await extractHangulText({ buffer: Buffer.from("x"), sourceExtension: "docx" })).toEqual({
      ok: false,
      reason: "unsupported-format",
    });
  });
});
