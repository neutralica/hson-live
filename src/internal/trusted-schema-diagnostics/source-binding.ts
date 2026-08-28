import type { TrustedSchemaSourceBinding, TrustedSchemaDirectSource } from "./protocol.js";

export function same_schema_source_binding(a: TrustedSchemaSourceBinding, b: TrustedSchemaSourceBinding): boolean {
  return a.moduleUrl === b.moduleUrl && a.exportName === b.exportName
    && a.localName === b.localName && a.declarationStart === b.declarationStart;
}
export function same_direct_source(a: TrustedSchemaDirectSource, b: TrustedSchemaDirectSource): boolean {
  return a.templateId === b.templateId && a.callId === b.callId
    && a.documentRevision === b.documentRevision && a.templateRevision === b.templateRevision
    && a.associationRevision === b.associationRevision && same_schema_source_binding(a.binding, b.binding);
}
export function valid_schema_source_binding(value: unknown): value is TrustedSchemaSourceBinding {
  if (typeof value !== "object" || value === null || !("moduleUrl" in value) || typeof value.moduleUrl !== "string") return false;
  try { if (new URL(value.moduleUrl).protocol !== "file:") return false; } catch { return false; }
  if ("exportName" in value) return typeof value.exportName === "string" && value.exportName.length > 0 && !("localName" in value) && !("declarationStart" in value);
  return "localName" in value && typeof value.localName === "string" && value.localName.length > 0
    && "declarationStart" in value && typeof value.declarationStart === "number" && Number.isSafeInteger(value.declarationStart) && value.declarationStart >= 0;
}
