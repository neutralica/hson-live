import { Hson } from "../../hson-authoring.js";
import { admit_canonical_hson_data_value } from "../../api/data/hson-data-hson.js";
import { admit_data_source } from "../../core/data-source-admission.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { assert_canonical_hson_data_value } from "../../core/projected-value-graph.js";
import type ts from "typescript";
import { hson_source_syntactic_eligibility, is_official_hson_package_binding } from "../embedded-hson/discover-hson-tagged-templates.js";
import type { StaticSchemaCandidate } from "./candidate-evaluation.js";
import { is_object_literal_prototype_setter, library_source_fields } from "./library-source.js";
import { immutable_source_declaration } from "./schema-identity.js";
import { admit_hson_tagged_template } from "../embedded-hson/hson-tagged-source-admission.js";

export type StaticSourceCandidate = StaticSchemaCandidate & Readonly<{ node: ts.Expression; bodyStart?: number }>;
/** Bounded source alternatives shared by Schema preflight and Part source evidence. */
export function static_source_candidates(typescript: typeof ts, checker: ts.TypeChecker, program?: ts.Program) {
  const eligible = hson_source_syntactic_eligibility(typescript, program);
  const declaration = (node: ts.Identifier) => immutable_source_declaration(typescript, checker, node, eligible)?.declaration;
  const unwrap = (node: ts.Expression): ts.Expression => typescript.isParenthesizedExpression(node) || typescript.isAsExpression(node) || typescript.isSatisfiesExpression(node)
    ? unwrap(node.expression) : node;
  const officialData = (node: ts.Expression): boolean => typescript.isPropertyAccessExpression(node)
    && node.name.text === "data" && typescript.isIdentifier(node.expression)
    && is_official_hson_package_binding(node.expression, "Hson", checker, true, typescript, eligible);
  const dataProducer = (input: ts.Expression): boolean => {
    const node = unwrap(input);
    return typescript.isTaggedTemplateExpression(node) && (officialData(node.tag)
      || typescript.isPropertyAccessExpression(node.tag) && node.tag.name.text === "parse" && officialData(node.tag.expression))
      || typescript.isCallExpression(node) && typescript.isPropertyAccessExpression(node.expression)
        && ["from", "fromSource", "parse"].includes(node.expression.name.text) && officialData(node.expression.expression);
  };
  type Alternatives = Readonly<{ nodes: readonly ts.Expression[]; complete: boolean; conditional: boolean }>;
  const alternatives = (input: ts.Expression, family: "certify" | "document" | "data" | "json",
    options: Readonly<{ reachableOnly?: true }> = {}, seen = new Set<ts.Declaration>(), depth = 0): Alternatives => {
    const unknown: Alternatives = { nodes: [input], complete: false, conditional: false };
    if (depth > 16) return unknown;
    const node = unwrap(input);
    const complete = eligible(input);
    if (typescript.isIdentifier(node)) {
      const binding = immutable_source_declaration(typescript, checker, node, eligible);
      const found = binding?.declaration;
      if (found === undefined || found.initializer === undefined || seen.has(found)) return unknown;
      // Nonprimitive native Data (including alternatives) is known only at its sole use.
      const initial = unwrap(found.initializer);
      const primitive = typescript.isStringLiteral(initial) || typescript.isNoSubstitutionTemplateLiteral(initial)
        || typescript.isNumericLiteral(initial) || typescript.isPrefixUnaryExpression(initial)
        || [typescript.SyntaxKind.TrueKeyword, typescript.SyntaxKind.FalseKeyword, typescript.SyntaxKind.NullKeyword].includes(initial.kind);
      if ((family === "json" || family === "certify") && !primitive && !dataProducer(initial)) {
        if (found.getSourceFile() !== node.getSourceFile() || found.getEnd() >= node.getStart()) return unknown;
        let uncertain = false;
        const references = (entry: ts.Node): void => {
          if (typescript.isIdentifier(entry) && entry !== found.name && entry !== node && declaration(entry) === found) uncertain = true;
          typescript.forEachChild(entry, references);
        };
        references(node.getSourceFile());
        if (uncertain) return unknown;
      }
      const next = new Set(seen); next.add(found);
      const result = alternatives(found.initializer, family, options, next, depth + 1);
      return { ...result, complete: complete && result.complete && binding?.eligible === true };
    }
    if (typescript.isConditionalExpression(node)) {
      if (options.reachableOnly && complete) {
        const condition = alternatives(node.condition, "document", {}, seen, depth + 1);
        const kind = condition.complete && condition.nodes.length === 1 ? condition.nodes[0]?.kind : undefined;
        if (kind === typescript.SyntaxKind.TrueKeyword || kind === typescript.SyntaxKind.FalseKeyword) {
          return alternatives(kind === typescript.SyntaxKind.TrueKeyword ? node.whenTrue : node.whenFalse, family, options, seen, depth + 1);
        }
      }
      const left = alternatives(node.whenTrue, family, options, seen, depth + 1);
      const right = alternatives(node.whenFalse, family, options, seen, depth + 1);
      const nodes = [...left.nodes, ...right.nodes];
      return { nodes: nodes.slice(0, 16), complete: complete && left.complete && right.complete && nodes.length <= 16, conditional: true };
    }
    return { nodes: [node], complete, conditional: false };
  };
  const candidate = (node: ts.Expression, family: "certify" | "document" | "data" | "json"): StaticSourceCandidate | undefined => {
    if ((family === "json" || family === "certify") && typescript.isTaggedTemplateExpression(node)
      && typescript.isPropertyAccessExpression(node.tag) && node.tag.name.text === "parse" && officialData(node.tag.expression)
      && typescript.isNoSubstitutionTemplateLiteral(node.template) && !node.template.isUnterminated) {
      try {
        admit_hson_tagged_template(typescript, node, "data");
        // Exact parsing changes the runtime representation, not the authored
        // source coordinates used for Schema issues and collision evidence.
        return { node, source: node.template.getText(node.getSourceFile()).slice(1, -1), family: "data", bodyStart: node.template.getStart() + 1 };
      }
      catch { return undefined; }
    }
    if (typescript.isTaggedTemplateExpression(node) && typescript.isPropertyAccessExpression(node.tag)
      && typescript.isIdentifier(node.tag.expression) && is_official_hson_package_binding(node.tag.expression, "Hson", checker, true, typescript, eligible)
      && ["document", "data", "canonical"].includes(node.tag.name.text)
      && typescript.isNoSubstitutionTemplateLiteral(node.template) && !node.template.isUnterminated) {
      if (family === "document" && node.tag.name.text === "data") return undefined;
      if ((family === "json" || family === "certify")) {
        const raw = node.template.getText(node.getSourceFile()).slice(1, -1);
        const strings = Object.freeze(Object.assign([node.template.text], { raw: Object.freeze([raw]) }));
        try { return { node, json: node.tag.name.text === "canonical" ? Hson.canonical(strings) : node.tag.name.text === "data" ? Hson.data(strings) : Hson.document(strings) }; }
        catch { return undefined; }
      }
      return { node, source: node.template.getText(node.getSourceFile()).slice(1, -1), family: node.tag.name.text === "document" ? "document" : node.tag.name.text === "canonical" ? "canonical" : "data", bodyStart: node.template.getStart() + 1 };
    }
    if ((family === "document" || family === "data") && (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node))) {
      // Escaped JS strings have no direct raw-Hson correspondence; anchor on the expression.
      return { node, source: node.text, family, bodyStart: -1 };
    }
    if ((family === "json" || family === "certify") && typescript.isCallExpression(node) && node.arguments.length === 1
      && typescript.isPropertyAccessExpression(node.expression) && ["fromSource", "from", "parse"].includes(node.expression.name.text)
      && typescript.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "data"
      && typescript.isIdentifier(node.expression.expression.expression)
      && is_official_hson_package_binding(node.expression.expression.expression, "Hson", checker, true, typescript, eligible)) {
      const inputs = alternatives(node.arguments[0]!, node.expression.name.text === "from" ? "json" : "data");
      const only = inputs.complete && inputs.nodes.length === 1 ? inputs.nodes[0] : undefined;
      if (only === undefined) return undefined;
      if (node.expression.name.text === "from" && dataProducer(only)) {
        const known = candidate(only, "json");
        return known === undefined ? undefined : { ...known, node };
      }
      if (node.expression.name.text === "parse") {
        const known = candidate(only, "data");
        if (known === undefined || !("source" in known) || known.family === "document") return undefined;
        try { admit_canonical_hson_data_value(known.source); return known; }
        catch { return undefined; }
      }
      const value = json_literal(unwrap(only), typescript, eligible);
      if (!value.known) return undefined;
      try {
        const data = node.expression.name.text === "fromSource"
          ? typeof value.value === "string" ? admit_data_source(value.value) : undefined
          : admit_projected_value(value.value);
        if (data === undefined) return undefined;
        assert_canonical_hson_data_value(data);
        return { node, data };
      } catch { return undefined; }
    }
    if (family === "json" || family === "certify") {
      const value = json_literal(node, typescript, eligible);
      return value.known ? { node, json: value.value } : undefined;
    }
    return undefined;
  };
  const candidates = (input: ts.Expression, family: "certify" | "document" | "data" | "json"): readonly StaticSourceCandidate[] | undefined => {
    const result = alternatives(input, family);
    if (!result.complete) return undefined;
    const found = result.nodes.map(node => candidate(node, family));
    return found.some(node => node === undefined) ? undefined : found.filter(node => node !== undefined);
  };
  return { declaration, unwrap, eligible, alternatives, candidates,
    jsonLiteral: (node: ts.Expression, authored?: (node: ts.Expression) => string | undefined) => json_literal(node, typescript, eligible, authored) };
}

type Literal = Readonly<{ known: true; value: unknown }> | Readonly<{ known: false }>;
/** JSON syntax only: no property reads, spreads, functions or application execution. */
function json_literal(node: ts.Expression, typescript: typeof ts, eligible: (node: ts.Node) => boolean, authored?: (node: ts.Expression) => string | undefined): Literal {
  if (!eligible(node)) return { known: false };
  if (authored !== undefined && (typescript.isTaggedTemplateExpression(node) || typescript.isIdentifier(node))) {
    const source = authored(node);
    return source === undefined ? { known: false } : { known: true, value: source };
  }
  if (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node)) return { known: true, value: node.text };
  if (typescript.isNumericLiteral(node)) return { known: true, value: Number(node.text) };
  if (typescript.isPrefixUnaryExpression(node) && node.operator === typescript.SyntaxKind.MinusToken && typescript.isNumericLiteral(node.operand)) return { known: true, value: -Number(node.operand.text) };
  if (node.kind === typescript.SyntaxKind.TrueKeyword) return { known: true, value: true };
  if (node.kind === typescript.SyntaxKind.FalseKeyword) return { known: true, value: false };
  if (node.kind === typescript.SyntaxKind.NullKeyword) return { known: true, value: null };
  if (typescript.isArrayLiteralExpression(node)) {
    const entries = node.elements.map(entry => json_literal(entry, typescript, eligible, authored));
    return entries.every(entry => entry.known) ? { known: true, value: entries.map(entry => entry.value) } : { known: false };
  }
  if (typescript.isObjectLiteralExpression(node)) {
    for (const property of node.properties) if (typescript.isPropertyAssignment(property) && is_object_literal_prototype_setter(property, typescript)) {
      const prototype = json_literal(property.initializer, typescript, eligible);
      // Projected data rejects custom prototypes; an ignored primitive or null is safe.
      if (!prototype.known || prototype.value !== null && typeof prototype.value === "object") return { known: false };
    }
    const fields = library_source_fields(node, typescript);
    if (fields === undefined) return { known: false };
    const value: Record<string, unknown> = Object.create(null);
    for (const [key, input] of fields) {
      const entry = json_literal(input, typescript, eligible, authored);
      if (!entry.known) return { known: false };
      value[key] = entry.value;
    }
    return { known: true, value };
  }
  return { known: false };
}
