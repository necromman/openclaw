// Gateway document module implements a read-only OLE2 compound file (CFB) reader.
//
// Hangul word processor files (.hwp, version 5) are CFB containers, and nothing in the
// dependency tree can open one. This reader is deliberately the smallest thing that can
// list the streams of such a container and hand back the bytes of one of them: no writes,
// no property sets, no encryption. Every offset it follows is bounds checked, because the
// input is an arbitrary file from a network share.

/** CFB header signature, as the two little-endian words at offset 0 and 4. */
const SIGNATURE_LOW = 0xe011cfd0;
const SIGNATURE_HIGH = 0xe11ab1a1;

const FREE_SECTOR = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;

/** Directory entry object types the reader distinguishes. */
const ENTRY_STORAGE = 1;
const ENTRY_STREAM = 2;

/** Sector chains are capped so a cyclic or corrupt FAT cannot spin forever. */
const MAX_CHAIN_SECTORS = 1_000_000;
/** A container with more directory entries than this is treated as malformed. */
const MAX_DIRECTORY_ENTRIES = 20_000;

type DirectoryEntry = {
  name: string;
  type: number;
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
};

/** A parsed container: the stream paths it holds, and a reader for one of them. */
export type CompoundFile = {
  /** Stream paths in `Storage/Stream` form, using `/` as the separator. */
  streamNames: readonly string[];
  /** Returns the bytes of one stream, or undefined when the path is not a stream. */
  readStream: (name: string) => Buffer | undefined;
};

/** True when the buffer starts with the compound file signature. */
export function isCompoundFile(buffer: Buffer): boolean {
  return (
    buffer.length >= 512 &&
    buffer.readUInt32LE(0) === SIGNATURE_LOW &&
    buffer.readUInt32LE(4) === SIGNATURE_HIGH
  );
}

function readChainIndexes(table: readonly number[], start: number): number[] {
  const chain: number[] = [];
  const seen = new Set<number>();
  let current = start;
  while (current !== END_OF_CHAIN && current !== FREE_SECTOR && current < table.length) {
    if (seen.has(current) || chain.length >= MAX_CHAIN_SECTORS) {
      break;
    }
    seen.add(current);
    chain.push(current);
    const next = table[current];
    if (next === undefined) {
      break;
    }
    current = next;
  }
  return chain;
}

/**
 * Parses the container structure of a compound file.
 *
 * Throws on anything it cannot make sense of; callers treat a throw as "this is not a
 * document we can read" rather than trying to salvage a partial parse.
 */
export function readCompoundFile(buffer: Buffer): CompoundFile {
  if (!isCompoundFile(buffer)) {
    throw new Error("not a compound file");
  }
  const sectorShift = buffer.readUInt16LE(30);
  const miniSectorShift = buffer.readUInt16LE(32);
  if (
    sectorShift < 7 ||
    sectorShift > 20 ||
    miniSectorShift < 4 ||
    miniSectorShift >= sectorShift
  ) {
    throw new Error("unsupported sector layout");
  }
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniSectorShift;
  const directoryStart = buffer.readUInt32LE(48);
  const miniStreamCutoff = buffer.readUInt32LE(56);
  const miniFatStart = buffer.readUInt32LE(60);
  const difatStart = buffer.readUInt32LE(68);
  const difatSectorCount = buffer.readUInt32LE(72);

  const readSector = (index: number): Buffer => {
    const offset = (index + 1) * sectorSize;
    if (offset < 0 || offset + sectorSize > buffer.length) {
      throw new Error("sector out of range");
    }
    return buffer.subarray(offset, offset + sectorSize);
  };

  // The first 109 FAT sector numbers live in the header; the rest hang off the DIFAT chain.
  const fatSectors: number[] = [];
  for (let index = 0; index < 109; index += 1) {
    const value = buffer.readUInt32LE(76 + index * 4);
    if (value === FREE_SECTOR || value === END_OF_CHAIN) {
      break;
    }
    fatSectors.push(value);
  }
  const entriesPerDifat = sectorSize / 4 - 1;
  let difatSector = difatStart;
  for (let step = 0; step < difatSectorCount; step += 1) {
    if (difatSector === END_OF_CHAIN || difatSector === FREE_SECTOR) {
      break;
    }
    const sector = readSector(difatSector);
    for (let index = 0; index < entriesPerDifat; index += 1) {
      const value = sector.readUInt32LE(index * 4);
      if (value === FREE_SECTOR || value === END_OF_CHAIN) {
        continue;
      }
      fatSectors.push(value);
    }
    difatSector = sector.readUInt32LE(entriesPerDifat * 4);
  }

  const fat: number[] = [];
  for (const sectorIndex of fatSectors) {
    const sector = readSector(sectorIndex);
    for (let index = 0; index < sectorSize / 4; index += 1) {
      fat.push(sector.readUInt32LE(index * 4));
    }
  }

  const readFatChain = (start: number, size?: number): Buffer => {
    const parts = readChainIndexes(fat, start).map(readSector);
    const joined = Buffer.concat(parts);
    return size === undefined ? joined : joined.subarray(0, size);
  };

  const directoryBytes = readFatChain(directoryStart);
  const entries: DirectoryEntry[] = [];
  const entryCount = Math.min(Math.floor(directoryBytes.length / 128), MAX_DIRECTORY_ENTRIES);
  for (let index = 0; index < entryCount; index += 1) {
    const offset = index * 128;
    const nameLength = directoryBytes.readUInt16LE(offset + 64);
    const usableLength = nameLength > 2 && nameLength <= 64 ? nameLength - 2 : 0;
    entries.push({
      child: directoryBytes.readUInt32LE(offset + 76),
      left: directoryBytes.readUInt32LE(offset + 68),
      name: directoryBytes.subarray(offset, offset + usableLength).toString("utf16le"),
      right: directoryBytes.readUInt32LE(offset + 72),
      size: Number(directoryBytes.readBigUInt64LE(offset + 120)),
      start: directoryBytes.readUInt32LE(offset + 116),
      type: directoryBytes.readUInt8(offset + 66),
    });
  }
  const root = entries[0];
  if (!root) {
    throw new Error("missing root entry");
  }

  const miniFat: number[] = [];
  {
    const miniFatBytes = readFatChain(miniFatStart);
    for (let offset = 0; offset + 4 <= miniFatBytes.length; offset += 4) {
      miniFat.push(miniFatBytes.readUInt32LE(offset));
    }
  }
  // The mini stream is one ordinary stream owned by the root entry; short streams are
  // slices of it rather than sectors of their own.
  const miniStream = readFatChain(root.start, root.size);
  const readMiniChain = (start: number, size: number): Buffer => {
    const parts = readChainIndexes(miniFat, start).map((index) =>
      miniStream.subarray(index * miniSectorSize, (index + 1) * miniSectorSize),
    );
    return Buffer.concat(parts).subarray(0, size);
  };

  const streams = new Map<string, DirectoryEntry>();
  const visited = new Set<number>();
  // Siblings form a red-black tree, so a full path needs the tree walk rather than a
  // linear scan: two storages may hold same-named streams.
  const walk = (index: number, prefix: string): void => {
    if (index === FREE_SECTOR || index >= entries.length || visited.has(index)) {
      return;
    }
    visited.add(index);
    const entry = entries[index];
    if (!entry) {
      return;
    }
    walk(entry.left, prefix);
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === ENTRY_STREAM) {
      streams.set(fullPath, entry);
    } else if (entry.type === ENTRY_STORAGE) {
      walk(entry.child, fullPath);
    }
    walk(entry.right, prefix);
  };
  walk(root.child, "");

  return {
    readStream: (name: string): Buffer | undefined => {
      const entry = streams.get(name);
      if (!entry) {
        return undefined;
      }
      if (entry.size === 0) {
        return Buffer.alloc(0);
      }
      return entry.size < miniStreamCutoff
        ? readMiniChain(entry.start, entry.size)
        : readFatChain(entry.start, entry.size);
    },
    streamNames: [...streams.keys()],
  };
}
