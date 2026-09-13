import type { IxAuthManagedUser } from "../../features/ix-auth/ix-auth-users-api.ts";

export type UserDetailDraftField = "name" | "role" | "departments";
type UserDetailDrafts = {
  displayNameDraft: string;
  selectedRole: string;
  selectedDepartments: string[];
};

function unchangedDepartments(left: readonly string[], right: readonly string[]): boolean {
  return left.toSorted().join("\n") === right.toSorted().join("\n");
}

export function hasUnsavedUserDetails(
  user: IxAuthManagedUser | undefined,
  draft: UserDetailDrafts,
): boolean {
  return Boolean(
    user &&
    (draft.displayNameDraft !== user.displayName ||
      draft.selectedRole !== (user.roles[0] ?? "MEMBER") ||
      !unchangedDepartments(draft.selectedDepartments, user.departments)),
  );
}

/** Refresh saved and untouched fields while retaining unsaved edits on the same account. */
export function reconcileUserDetailDrafts(params: {
  previous: IxAuthManagedUser | undefined;
  next: IxAuthManagedUser;
  draft: UserDetailDrafts;
  savedField?: UserDetailDraftField;
}): UserDetailDrafts {
  const { previous, next, draft, savedField } = params;
  const sameUser = previous?.id === next.id;
  return {
    displayNameDraft:
      !sameUser || savedField === "name" || draft.displayNameDraft === previous?.displayName
        ? next.displayName
        : draft.displayNameDraft,
    selectedRole:
      !sameUser || savedField === "role" || draft.selectedRole === (previous?.roles[0] ?? "MEMBER")
        ? (next.roles[0] ?? "MEMBER")
        : draft.selectedRole,
    selectedDepartments:
      !sameUser ||
      savedField === "departments" ||
      unchangedDepartments(draft.selectedDepartments, previous?.departments ?? [])
        ? [...next.departments]
        : draft.selectedDepartments,
  };
}
