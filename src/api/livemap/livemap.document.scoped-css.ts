import type { LiveMapCssOp, LiveMapCssUnitOp } from "../../types/livemap.types.js";
import { canonical_portable_document_css_op } from "../../internal/css/portable-document-operations.js";
import type { PortableDocumentStylesheetRecord } from "../../internal/css/portable-document-stylesheet.js";

/** Visit only CSS reference coordinates through the existing stylesheet codec.
 * Rule deletion uses a temporary selector-free carrier for its group scopes;
 * the carrier never becomes an installed rule. Unit and batch order is retained. */
export function map_scoped_css_operation(input: LiveMapCssOp,
  map: (css: PortableDocumentStylesheetRecord) => PortableDocumentStylesheetRecord): LiveMapCssOp {
  const operation = canonical_portable_document_css_op(input);
  const unit = (value: LiveMapCssUnitOp): LiveMapCssUnitOp => {
    if (value.kind !== "rule") return value;
    const rule = value.rule ?? { ruleKey: value.ruleKey, selector: "*", scopes: value.scopes, declarations: [["--hson-carrier", "0"]] };
    const translated = map({ rules: [rule], properties: [], keyframes: [],
      order: [{ kind: "rule", ruleKey: value.ruleKey, scopes: value.scopes }] }).rules[0]!;
    return { ...value, scopes: translated.scopes, ...(value.rule === undefined ? {} : { rule: translated }) };
  };
  return canonical_portable_document_css_op(operation.kind === "append" || operation.kind === "replace"
    ? { ...operation, stylesheet: map(operation.stylesheet) }
    : operation.kind === "batch" ? { ...operation, operations: operation.operations.map(unit) } : unit(operation));
}
