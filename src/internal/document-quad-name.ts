const NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}(?![\s\S])/;

/** Shared authored-address vocabulary; spelling never determines disposition. @internal */
export function is_document_quad_name(value: unknown): value is string {
  return typeof value === "string" && NAME.test(value);
}

/** Reserved derived browser carrier for a portable subject address. @internal */
export const PORTABLE_DOCUMENT_QUAD_ATTRIBUTE = "hson:quad";
