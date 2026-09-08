// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ixAuthDepartmentLabels,
  ixAuthDepartmentName,
} from "./ix-auth-department-labels.ts";

// The directory the Gateway answers with, as `GET /auth/admin/departments` shapes it.
const DIRECTORY = [
  { code: "dept-qa", name: "품질보증" },
  { code: "dept-rnd", name: "연구개발" },
];

describe("ixAuthDepartmentName", () => {
  it("reads the name the identity server holds for a code", () => {
    expect(ixAuthDepartmentName("dept-qa", DIRECTORY)).toBe("품질보증");
    expect(ixAuthDepartmentName("dept-rnd", DIRECTORY)).toBe("연구개발");
  });

  it("keeps a code the directory does not list, so a stale membership stays visible", () => {
    expect(ixAuthDepartmentName("dept-legal", DIRECTORY)).toBe("dept-legal");
  });

  it("keeps the code when the directory never arrived", () => {
    // The screen renders before the fetch answers, and answers nothing when it fails.
    expect(ixAuthDepartmentName("dept-qa", [])).toBe("dept-qa");
  });

  it("keeps the code rather than drawing a blank cell for a nameless group", () => {
    expect(ixAuthDepartmentName("dept-qa", [{ code: "dept-qa", name: "   " }])).toBe("dept-qa");
  });
});

describe("ixAuthDepartmentLabels", () => {
  it("pairs every code with its name, in the order the account holds them", () => {
    expect(ixAuthDepartmentLabels(["dept-rnd", "dept-qa"], DIRECTORY)).toEqual([
      { code: "dept-rnd", name: "연구개발" },
      { code: "dept-qa", name: "품질보증" },
    ]);
  });

  it("answers with nothing for an account in no department", () => {
    expect(ixAuthDepartmentLabels([], DIRECTORY)).toEqual([]);
  });
});
