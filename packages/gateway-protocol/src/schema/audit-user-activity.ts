// Gateway Protocol schema module defines person-attributed activity query payloads.
//
// Separate from `audit.ts` because the two ledgers answer different questions and keep
// different promises: `audit.list` is content-free run and tool metadata attributed to an
// agent, while this one names an account and stores the paths a read revealed.
import type { TSchema } from "typebox";
import { Type } from "typebox";
import { closedObject } from "./closed-object.js";
import { NonEmptyString } from "./primitives.js";

/**
 * What the person-attributed ledger can record.
 *
 * The closed list lives here because the wire contract and the stored contract are the
 * same list: a kind the protocol cannot carry is a kind nothing should write.
 */
export const AUDIT_USER_ACTIVITY_KINDS = [
  "login",
  "logout",
  "login_failed",
  "prompt",
  "tool_read",
  "session_view",
  "file_download",
  "admin_action",
  "access_denied",
] as const;

/** Where the actor identity came from. Channel senders have no account to attribute. */
export const AUDIT_USER_ACTIVITY_ACTOR_SOURCES = ["profile", "channel", "operator"] as const;

export type AuditUserActivityKind = (typeof AUDIT_USER_ACTIVITY_KINDS)[number];
export type AuditUserActivityActorSource = (typeof AUDIT_USER_ACTIVITY_ACTOR_SOURCES)[number];

// Built from the arrays above, the way audit-activity.ts builds its unions, so the
// enumeration and the validator cannot drift. The wire types below are written out
// because a schema typed as TSchema no longer carries its literals.
const UserActivityKindSchema: TSchema = Type.Union(
  AUDIT_USER_ACTIVITY_KINDS.map((kind) => Type.Literal(kind)),
);

const UserActivityActorSourceSchema: TSchema = Type.Union(
  AUDIT_USER_ACTIVITY_ACTOR_SOURCES.map((source) => Type.Literal(source)),
);

/** One person-attributed activity record. */
export const AuditUserActivityEventSchema = closedObject({
  sequence: Type.Integer({ minimum: 1 }),
  at: Type.Integer({ minimum: 0 }),
  kind: UserActivityKindSchema,
  actorSource: UserActivityActorSourceSchema,
  profileId: Type.Optional(NonEmptyString),
  email: Type.Optional(NonEmptyString),
  displayName: Type.Optional(NonEmptyString),
  gatewayRole: Type.Optional(NonEmptyString),
  departments: Type.Array(NonEmptyString),
  sessionKey: Type.Optional(NonEmptyString),
  agentId: Type.Optional(NonEmptyString),
  // Shape varies by kind; readers project the fields they know and ignore the rest.
  detail: Type.Record(Type.String(), Type.Unknown()),
  remoteIp: Type.Optional(NonEmptyString),
  userAgent: Type.Optional(NonEmptyString),
  requestId: Type.Optional(NonEmptyString),
});

/** Bounded newest-first activity query filters. */
export const AuditUserActivityListParamsSchema = closedObject({
  profileId: Type.Optional(NonEmptyString),
  email: Type.Optional(NonEmptyString),
  kind: Type.Optional(UserActivityKindSchema),
  agentId: Type.Optional(NonEmptyString),
  sessionKey: Type.Optional(NonEmptyString),
  from: Type.Optional(Type.Integer({ minimum: 0 })),
  to: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  cursor: Type.Optional(NonEmptyString),
});

/** Stable sequence-cursor page. */
export const AuditUserActivityListResultSchema = closedObject({
  events: Type.Array(AuditUserActivityEventSchema),
  nextCursor: Type.Optional(NonEmptyString),
});

// Wire types are written out rather than inferred: the kind and actor-source schemas are
// built from the arrays above, so their inferred form is a bare string.
export type AuditUserActivityEvent = {
  sequence: number;
  at: number;
  kind: AuditUserActivityKind;
  actorSource: AuditUserActivityActorSource;
  profileId?: string;
  email?: string;
  displayName?: string;
  gatewayRole?: string;
  departments: string[];
  sessionKey?: string;
  agentId?: string;
  detail: Record<string, unknown>;
  remoteIp?: string;
  userAgent?: string;
  requestId?: string;
};

export type AuditUserActivityListParams = {
  profileId?: string;
  email?: string;
  kind?: AuditUserActivityKind;
  agentId?: string;
  sessionKey?: string;
  from?: number;
  to?: number;
  limit?: number;
  cursor?: string;
};

export type AuditUserActivityListResult = {
  events: AuditUserActivityEvent[];
  nextCursor?: string;
};
