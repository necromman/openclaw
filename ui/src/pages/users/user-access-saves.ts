// What one department or title write means afterwards.
//
// Both routes answer 200 with the steps that did not take named in the body, so neither a
// success nor a failure is the whole story. These turn that answer into the sentence the
// screen shows and into whether the draft may be refreshed from the server: a partly
// applied change keeps the operator's boxes as they typed them, so the retry is one click
// rather than a re-tick of the whole list.
import { t } from "../../i18n/index.ts";
import type { UserDetailDraftField } from "./user-detail-drafts.ts";

type GroupOption = { code: string; name: string };

export type GroupSaveOutcome = { notice: string; savedField?: UserDetailDraftField };

/** Name the codes a partial save left behind, falling back to the raw code. */
export function describeGroupNames(
  codes: readonly string[],
  options: readonly GroupOption[],
): string {
  return codes.map((code) => options.find((item) => item.code === code)?.name ?? code).join(", ");
}

export function departmentSaveOutcome(
  result: { departmentFailed: boolean; failedDepartments: string[] },
  options: readonly GroupOption[],
): GroupSaveOutcome {
  if (!result.departmentFailed) {
    return { notice: t("ixAuth.users.departmentsSaved"), savedField: "departments" };
  }
  return {
    notice: t("ixAuth.users.departmentsPartiallyApplied", {
      codes: describeGroupNames(result.failedDepartments, options),
    }),
  };
}

export function titleSaveOutcome(
  result: { titleFailed: boolean; failedTitles: string[] },
  options: readonly GroupOption[],
): GroupSaveOutcome {
  if (!result.titleFailed) {
    return { notice: t("ixAuth.users.titlesSaved"), savedField: "titles" };
  }
  return {
    notice: t("ixAuth.users.titlesPartiallyApplied", {
      codes: describeGroupNames(result.failedTitles, options),
    }),
  };
}
