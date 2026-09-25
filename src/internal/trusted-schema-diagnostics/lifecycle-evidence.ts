import type { TrustedSchemaAssociationEvidence } from "./protocol.js";

/** Legacy attachment evidence is empty after Schema moved into library admission. */
export type TrustedSchemaAttachment = Readonly<{
  schema: object;
  origin: unknown;
  evidence: TrustedSchemaAssociationEvidence;
  error?: unknown;
  isCurrent?: () => boolean;
}>;

export function consume_trusted_schema_attachments(): readonly TrustedSchemaAttachment[] {
  return [];
}
