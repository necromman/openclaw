// Gateway Protocol schema module defines the workspace document preview shapes.
//
// These live beside sessions.ts rather than inside it: that file is already at
// its max-lines ceiling, and the document preview payload is a self-contained
// contract that only SessionFileEntry needs to reference.
import type { Static } from "typebox";
import { Type } from "typebox";
import { closedObject } from "./closed-object.js";
import { NonEmptyString } from "./primitives.js";

/** Format of the bytes carried in a document preview payload. */
export const SessionFileDocumentFormatSchema = Type.Union([
  Type.Literal("pdf"),
  Type.Literal("html"),
]);

/** Why a document preview could not be produced. */
export const SessionFileDocumentErrorSchema = Type.Union([
  Type.Literal("too-large"),
  Type.Literal("converter-unavailable"),
  Type.Literal("conversion-failed"),
  Type.Literal("unsupported-format"),
]);

/** Describes a rendered document preview payload. */
export const SessionFileDocumentPreviewSchema = closedObject({
  format: SessionFileDocumentFormatSchema,
  /** Lowercase extension of the workspace file itself, without the dot. */
  sourceFormat: NonEmptyString,
  converted: Type.Boolean(),
  converter: Type.Optional(NonEmptyString),
  /** Page count when known (PDF only). */
  pageCount: Type.Optional(Type.Integer({ minimum: 1 })),
});

export type SessionFileDocumentFormat = Static<typeof SessionFileDocumentFormatSchema>;
export type SessionFileDocumentError = Static<typeof SessionFileDocumentErrorSchema>;
export type SessionFileDocumentPreview = Static<typeof SessionFileDocumentPreviewSchema>;
