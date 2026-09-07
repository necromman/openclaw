/**
 * Who a verified IX-Auth connection belongs to, for attribution only.
 *
 * Its own module, the way `operator-role-actor.ts` is, so the connection type can name it
 * without depending on the ledger plumbing that produces and consumes it.
 */
export type IxAuthAuditActor = {
  profileId: string;
  email: string;
  displayName?: string;
  gatewayRole?: string;
  departments: readonly string[];
  isSuperAdmin: boolean;
};
