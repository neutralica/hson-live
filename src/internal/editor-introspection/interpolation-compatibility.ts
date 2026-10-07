import type { HsonInterpolationRole } from "../../api/transform/parsers/tokenize-hson.js";

/** Static TypeScript evidence only. A plain string's Hson structure is unknown. */
export type StaticInterpolationFamily = "data" | "document" | "canonical" | "string" | "number" | "boolean" | "null" | "object" | "unknown";
export type InterpolationMismatch = Readonly<{ code: string; message: string }>;

export function interpolation_semantic_mismatch(role: HsonInterpolationRole | undefined, family: StaticInterpolationFamily): InterpolationMismatch | undefined {
  if (role === undefined || family === "unknown") return undefined;
  if (role === "quoted-string") return family === "object"
    ? { code: "HSON_QUOTED_INTERPOLATION_STATIC_TYPE", message: "Quoted Hson interpolation requires a string, finite number, boolean, or null." } : undefined;
  if (role === "document-content") {
    if (family === "number" || family === "boolean" || family === "null" || family === "object") return { code: "HSON_INTERPOLATION_DOCUMENT_STATIC_TYPE", message: "Element/document content requires Hson source containing strings or elements. Quote primitive values to insert text." };
    return undefined;
  }
  if (role === "canonical-value") return family === "object"
    ? { code: "HSON_INTERPOLATION_CANONICAL_STATIC_TYPE", message: "Canonical interpolation requires Hson source, a finite number, boolean, or null." } : undefined;
  if (family === "object") return { code: "HSON_INTERPOLATION_DATA_STATIC_TYPE", message: "Hson.data value interpolation requires data Hson, a primitive number, boolean, null, or runtime-admitted string source." };
  return undefined;
}
