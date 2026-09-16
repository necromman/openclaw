import type { BigIntStats } from "node:fs";

export type FileMutationFingerprint = Pick<
  BigIntStats,
  "birthtimeNs" | "ctimeNs" | "dev" | "ino" | "mtimeNs" | "size"
>;

/** Strict field equality; callers own any platform-specific identity tolerance. */
export function sameFileMutationFingerprint(
  left: FileMutationFingerprint,
  right: FileMutationFingerprint,
): boolean {
  return (
    left.birthtimeNs === right.birthtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mtimeNs === right.mtimeNs &&
    left.size === right.size
  );
}
