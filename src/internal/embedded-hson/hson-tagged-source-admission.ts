import type ts from "typescript";
import { admit_hson, reconstruct_hson_interpolated_template } from "../../api/transform/hson-admission.js";
import { admit_canonical_hson_data_value } from "../../api/data/hson-data-hson.js";
import { qualify_hson_document_source } from "../../api/document/hson-document.js";
import { interpolation_site } from "../trusted-schema-diagnostics/interpolation-source.js";
import { create_hson_source_program, read_template_substitution_ranges, type HsonAuthoringKind, type HsonTaggedTemplateSource, type InterpolatedEmbeddedHsonTemplate } from "./discover-hson-tagged-templates.js";

/** Bind admission/provenance to this AST, without admitting optional-chain tags. */
export function hson_tagged_source(typescript: typeof ts, tagged: ts.TaggedTemplateExpression, authoringKind: HsonAuthoringKind): HsonTaggedTemplateSource | InterpolatedEmbeddedHsonTemplate | undefined {
  if ((tagged.flags & typescript.NodeFlags.OptionalChain) !== 0) return undefined;
  const file = tagged.getSourceFile();
  const template = tagged.template;
  const templateRange = { start: template.getStart(file), end: template.getEnd() };
  if (file.text[templateRange.end - 1] !== "`" || (typescript.isNoSubstitutionTemplateLiteral(template) ? template.isUnterminated : template.templateSpans.at(-1)?.literal.isUnterminated)) return undefined;
  const source: HsonTaggedTemplateSource = {
    fileName: file.fileName, hostText: file.text, authoringKind,
    tagRange: { start: tagged.tag.getStart(file), end: tagged.tag.getEnd() }, templateRange,
    bodyRange: { start: templateRange.start + 1, end: templateRange.end - 1 },
  };
  if (typescript.isNoSubstitutionTemplateLiteral(template)) return source;
  const substitutionRanges = read_template_substitution_ranges(template, file.text, file);
  return substitutionRanges === undefined ? undefined : { ...source, substitutionRanges,
    expressionRanges: template.templateSpans.map(span => ({ start: span.expression.getStart(file), end: span.expression.getEnd() })),
  };
}

/** Same admission as the real substitution-free tag; return its normalized raw source. */
export function admit_hson_tagged_source(source: HsonTaggedTemplateSource): string {
  const literal = interpolation_site({ ...source, substitutionRanges: [], expressionRanges: [] }, source.fileName).literals[0]!;
  // TypeScript determines cooked availability. Hson consumes raw text, but the
  // real template guard also requires every cooked segment to be defined.
  const program = create_hson_source_program(source.fileName, source.hostText.slice(source.templateRange.start, source.templateRange.end));
  const invalidEscape = program.getSyntacticDiagnostics().length > 0;
  const strings = Object.freeze(Object.assign([invalidEscape ? undefined : literal.raw], { raw: Object.freeze([literal.raw]) }));
  if (source.authoringKind === "document") {
    const raw = Reflect.apply(reconstruct_hson_interpolated_template, undefined, [strings, []]);
    qualify_hson_document_source(raw.source);
  } else {
    const canonical = Reflect.apply(admit_hson, undefined, [strings]);
    if (source.authoringKind === "data" || source.authoringKind === "schema") admit_canonical_hson_data_value(canonical);
  }
  return literal.raw;
}

/** Producer/assignment proof admission, separate from recognizing source for diagnostics. */
export function admit_hson_tagged_template(typescript: typeof ts, tagged: ts.TaggedTemplateExpression, kind: HsonAuthoringKind): string {
  const source = hson_tagged_source(typescript, tagged, kind);
  if (source === undefined || "substitutionRanges" in source) throw new TypeError(`Hson.${kind} proof requires a complete, non-optional, substitution-free tagged template.`);
  return admit_hson_tagged_source(source);
}
