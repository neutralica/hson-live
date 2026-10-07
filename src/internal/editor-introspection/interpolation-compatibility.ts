import type { HsonEditorMode, HsonInterpolationRole } from "../../api/transform/parsers/tokenize-hson.js";

/** Static TypeScript evidence only. A plain string's Hson structure is unknown. */
export type StaticInterpolationFamily = "data" | "document" | "canonical" | "string" | "number" | "boolean" | "null" | "undefined" | "bigint" | "symbol" | "object" | "unknown";
export type InterpolationMismatch = Readonly<{ code: string; message: string }>;

export function interpolation_semantic_mismatch(role: HsonInterpolationRole | undefined, family: StaticInterpolationFamily, mode?: HsonEditorMode): InterpolationMismatch | undefined {
  if (role === undefined || family === "unknown") return undefined;
  const unsupported = family === "object" || family === "bigint" || family === "symbol";
  if (role === "quoted-string") return unsupported || family === "undefined"
    ? { code: "HSON_QUOTED_INTERPOLATION_STATIC_TYPE", message: "Quoted Hson interpolation requires a string, finite number, boolean, or null." } : undefined;
  if (role === "document-content") {
    if (family === "number" || family === "boolean" || family === "null" || unsupported
      || family === "undefined" && (mode === "canonical" || mode === "data")) return { code: "HSON_INTERPOLATION_DOCUMENT_STATIC_TYPE", message: `Element/document content requires Hson source containing strings or elements${mode === "document" ? ", or undefined for structural omission" : ""}. Whole quoted slots accept strings, finite numbers, booleans, or null.` };
    return undefined;
  }
  if (role === "canonical-value") return unsupported || family === "undefined"
    ? { code: "HSON_INTERPOLATION_CANONICAL_STATIC_TYPE", message: "Canonical interpolation requires Hson source, a finite number, boolean, or null." } : undefined;
  if (unsupported || family === "undefined") return { code: "HSON_INTERPOLATION_DATA_STATIC_TYPE", message: "Hson.data value interpolation requires data Hson, a primitive number, boolean, null, or runtime-admitted string source." };
  return undefined;
}
