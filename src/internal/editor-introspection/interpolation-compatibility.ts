import type { HsonInterpolationRole } from "../../api/transform/parsers/tokenize-hson.js";

/** Static TypeScript evidence only. A plain string's Hson structure is unknown. */
export type StaticInterpolationFamily = "data" | "document" | "canonical" | "string" | "number" | "boolean" | "null" | "object" | "unknown";
export type InterpolationMismatch = Readonly<{ code: string; message: string }>;

export function interpolation_semantic_mismatch(role: HsonInterpolationRole | undefined, family: StaticInterpolationFamily): InterpolationMismatch | undefined {
  if (role === undefined || family === "unknown") return undefined;
  if (role === "quoted-string") return family === "number" || family === "boolean" || family === "null" || family === "object"
    ? { code: "HSON_QUOTED_INTERPOLATION_STATIC_TYPE", message: "Quoted Hson interpolation requires a string value." } : undefined;
  if (role === "document-content") {
    if (family === "data") return { code: "HSON_INTERPOLATION_DATA_IN_DOCUMENT", message: "HsonData cannot be interpolated into Hson.document content. Use HsonDocument or document source here, or quote the interpolation to insert its text." };
    if (family === "number" || family === "boolean" || family === "null" || family === "object") return { code: "HSON_INTERPOLATION_DOCUMENT_STATIC_TYPE", message: "Hson.document content requires document Hson or a runtime-admitted string source. Quote a string value to insert it as text." };
    return undefined;
  }
  if (family === "document") return { code: "HSON_INTERPOLATION_DOCUMENT_IN_DATA", message: "HsonDocument cannot be interpolated into an Hson.data value position. Use HsonData or data source here, or quote the interpolation to insert its text." };
  if (family === "object") return { code: "HSON_INTERPOLATION_DATA_STATIC_TYPE", message: "Hson.data value interpolation requires data Hson, a primitive number, boolean, null, or runtime-admitted string source." };
  return undefined;
}
