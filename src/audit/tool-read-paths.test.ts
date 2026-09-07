import { describe, expect, it } from "vitest";
import {
  isFileRevealingToolName,
  projectToolReadPaths,
  projectToolReadPathsFact,
} from "./tool-read-paths.js";

describe("tool read paths", () => {
  it("recognizes only the tools whose purpose is to surface a file", () => {
    expect(isFileRevealingToolName("read")).toBe(true);
    expect(isFileRevealingToolName("memory_get")).toBe(true);
    expect(isFileRevealingToolName("sessions_files")).toBe(true);
    expect(isFileRevealingToolName("write")).toBe(false);
    expect(isFileRevealingToolName("bash")).toBe(false);
  });

  it("reads the path from either spelling of the parameter", () => {
    expect(projectToolReadPaths("read", { path: "/mnt/nas/rnd/spec.pdf" })).toEqual([
      "/mnt/nas/rnd/spec.pdf",
    ]);
    expect(projectToolReadPaths("read", { file_path: "/mnt/nas/qa/plan.md" })).toEqual([
      "/mnt/nas/qa/plan.md",
    ]);
    expect(projectToolReadPaths("sessions_files", { paths: ["a.md", "b.md"] })).toEqual([
      "a.md",
      "b.md",
    ]);
  });

  it("never reads any other argument", () => {
    expect(
      projectToolReadPaths("read", { path: "/a.md", token: "secret", body: "content" }),
    ).toEqual(["/a.md"]);
  });

  it("returns nothing for a tool outside the allowlist", () => {
    expect(projectToolReadPaths("write", { path: "/a.md" })).toEqual([]);
    expect(projectToolReadPaths("read", "not-an-object")).toEqual([]);
    expect(projectToolReadPaths("read", { path: "   " })).toEqual([]);
  });

  it("bounds how many paths and how long each one is", () => {
    const many = Array.from({ length: 20 }, (_, index) => `file-${index}.md`);
    expect(projectToolReadPaths("sessions_files", { paths: many })).toHaveLength(8);
    const long = `/${"a".repeat(1_000)}`;
    expect(projectToolReadPaths("read", { path: long })[0]).toHaveLength(512);
  });

  it("omits the field entirely when a call names no file", () => {
    expect(projectToolReadPathsFact("bash", { command: "ls" })).toEqual({});
    expect(projectToolReadPathsFact("read", { path: "/a.md" })).toEqual({ readPaths: ["/a.md"] });
  });
});
