import type ts from "typescript";
import { admit_hson, reconstruct_hson_interpolated_template } from "../../api/transform/hson-admission.js";
import { admit_canonical_hson_data_value } from "../../api/data/hson-data-hson.js";
import { qualify_authored_document_source } from "../../api/document/hson-authored.js";
import { AUTHORED_EVENT_TAG } from "../../core/authored-event-names.js";
import { parse_authored_event } from "../authored-events.js";
import { dispatch_hson_declaration, recognize_hson_declaration } from "../hson-declarative.js";
import { interpolation_site } from "../trusted-schema-diagnostics/interpolation-source.js";
import { source_point_range_at, type HostSourceRange } from "./embedded-hson-source.js";
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

export function hson_tagged_literal(source: HsonTaggedTemplateSource) {
  return interpolation_site({ ...source, substitutionRanges: [], expressionRanges: [] }, source.fileName).literals[0]!;
}

/** Parse the complete literal without its tag so TypeScript reports invalid cooked escapes. */
export function hson_tagged_escape_ranges(source: HsonTaggedTemplateSource): readonly HostSourceRange[] {
  const template = source.hostText.slice(source.templateRange.start, source.templateRange.end);
  const program = create_hson_source_program(source.fileName, template);
  const ranges = program.getSyntacticDiagnostics().map(issue => {
    if (issue.start === undefined) return source.bodyRange;
    const start = source.templateRange.start + issue.start;
    if (issue.length) return { start, end: start + issue.length };
    // TypeScript points just after a short hexadecimal escape. Preserve its
    // location for invalid digits, and recover the prefix before a delimiter.
    if (issue.code === 1125 && !/[0-9a-z]/i.test(source.hostText[start] ?? "")) {
      const prefixStart = Math.max(source.bodyRange.start, start - 5);
      const prefix = source.hostText.slice(prefixStart, start);
      const escape = /\\(?:x[0-9a-f]?|u(?:[0-9a-f]{0,3}|\{))$/i.exec(prefix);
      if (escape !== null) return { start: prefixStart + escape.index, end: start };
    }
    // An unterminated braced Unicode escape ends at the parser's missing brace.
    if (issue.code === 1199) {
      let digits = start;
      while (digits > source.bodyRange.start && /[0-9a-f]/i.test(source.hostText[digits - 1]!)) digits--;
      const opening = digits - 3;
      if (opening >= source.bodyRange.start && source.hostText.startsWith("\\u{", opening)) return { start: opening, end: start };
    }
    return start < source.bodyRange.end ? source_point_range_at(source.hostText, start) ?? { start, end: start }
      : { start, end: start };
  });
  return ranges.filter((range, index) => {
    const previous = ranges[index - 1];
    return previous?.start !== range.start || previous.end !== range.end;
  });
}

function tagged_template_strings(raw: string, invalidEscape: boolean) {
  return Object.freeze(Object.assign([invalidEscape ? undefined : raw], { raw: Object.freeze([raw]) }));
}

/** Use the same template guard and HsonDeclarative beta dispatch as the public Event tag. */
export function parse_hson_event_tagged_source(source: HsonTaggedTemplateSource, raw: string,
  escapeRanges = hson_tagged_escape_ranges(source),
) {
  const template = Reflect.apply(reconstruct_hson_interpolated_template, undefined, [tagged_template_strings(raw, escapeRanges.length !== 0), []]);
  return dispatch_hson_declaration(recognize_hson_declaration(template.source), {
    [AUTHORED_EVENT_TAG]: text => parse_authored_event(text, "Hson.event"),
  }, AUTHORED_EVENT_TAG);
}

/** Match runtime tag admission; document and Event authoring confer no canonical brand. */
export function admit_hson_tagged_source(source: HsonTaggedTemplateSource): string {
  const { raw } = hson_tagged_literal(source);
  if (source.authoringKind === "event") {
    parse_hson_event_tagged_source(source, raw);
    return raw;
  }
  const strings = tagged_template_strings(raw, hson_tagged_escape_ranges(source).length !== 0);
  if (source.authoringKind === "document") {
    const template = Reflect.apply(reconstruct_hson_interpolated_template, undefined, [strings, []]);
    qualify_authored_document_source(template.source, new Map());
  } else {
    const canonical = Reflect.apply(admit_hson, undefined, [strings]);
    if (source.authoringKind === "data" || source.authoringKind === "schema") admit_canonical_hson_data_value(canonical);
  }
  return raw;
}

/** Producer/assignment proof admission, separate from recognizing source for diagnostics. */
export function admit_hson_tagged_template(typescript: typeof ts, tagged: ts.TaggedTemplateExpression, kind: Exclude<HsonAuthoringKind, "event">): string {
  if (kind === "document") throw new TypeError("Hson.document returns HsonAuthored; canonical document Schema evidence requires explicit canonical qualification and certification.");
  const source = hson_tagged_source(typescript, tagged, kind);
  if (source === undefined || "substitutionRanges" in source) throw new TypeError(`Hson.${kind} proof requires a complete, non-optional, substitution-free tagged template.`);
  return admit_hson_tagged_source(source);
}
