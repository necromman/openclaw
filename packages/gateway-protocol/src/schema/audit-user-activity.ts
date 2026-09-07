// Gateway Protocol schema module defines person-attributed activity query payloads.
//
// Separate from `audit.ts` because the two ledgers answer different questions and keep
// different promises: `audit.list` is content-free run and tool metadata attributed to an
// agent, while this one names an account and stores the paths a read revealed.
import type { Static } from "typebox";
import { Type } from "typebox";
import { closedObject } from "./closed-object.js";
import { NonEmptyString } from "./primitives.js";

const UserActivityKindSchema = Type.Union([
  Type.Literal("login"),
  Type.Literal("logout"),
  Type.Literal("login_failed"),
  Type.Literal("prompt"),
  Type.Literal("tool_read"),
  Type.Literal("session_view"),
  Type.Literal("file_download"),
  Type.Literal("admin_action"),
  Type.Literal("access_denied"),
]);

const UserActivityActorSourceSchema = Type.Union([
  Type.Literal("profile"),
  Type.Literal("channel"),
  Type.Literal("operator"),
]);

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

// Wire types derive directly from local schema consts so public d.ts graphs never
// pull in the ProtocolSchemas registry.
export type AuditUserActivityEvent = Static<typeof AuditUserActivityEventSchema>;
export type AuditUserActivityListParams = Static<typeof AuditUserActivityListParamsSchema>;
export type AuditUserActivityListResult = Static<typeof AuditUserActivityListResultSchema>;
