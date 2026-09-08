// One place that turns a department code into the words a person reads.
//
// The names are not invented here. `GET /auth/admin/departments` already answers with
// `{ code, name }` for every department group the identity server holds
// (`src/gateway/ix-auth-admin-http.ts` `handleListDepartments`), and the user screen
// fetches that list for its filter and its checkboxes. Mapping `dept-qa` to a word in a
// front-end catalog instead would mean a second list of departments that nobody updates
// when a group is renamed, and this fork lets deployments choose their own slugs.
//
// The code stays worth showing: it is what a CSV import, a configuration file and an
// audit row all speak. Screens keep it in a `title`, so hovering a name answers "which
// code is that" without spending a column on it.
import type { IxAuthDepartmentOption } from "./ix-auth-admin-api.ts";

/** One department as a row draws it: what to read, and the code behind it. */
export type IxAuthDepartmentLabel = { code: string; name: string };

/**
 * The name for one department code.
 *
 * A code the server did not list keeps its own text. That happens for a real reason
 * rather than as an error case: a person's group membership survives the group being
 * renamed or removed, and printing a blank would hide that they are still in it.
 */
export function ixAuthDepartmentName(
  code: string,
  departments: readonly IxAuthDepartmentOption[],
): string {
  const match = departments.find((item) => item.code === code);
  const name = match?.name.trim();
  return name ? name : code;
}

/** The same, for the whole set a row shows, in the order the account holds them. */
export function ixAuthDepartmentLabels(
  codes: readonly string[],
  departments: readonly IxAuthDepartmentOption[],
): IxAuthDepartmentLabel[] {
  return codes.map((code) => ({ code, name: ixAuthDepartmentName(code, departments) }));
}
