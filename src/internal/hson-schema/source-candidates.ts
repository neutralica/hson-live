import type ts from "typescript";
import { hson_source_syntactic_eligibility, is_official_hson_package_binding } from "../embedded-hson/discover-hson-tagged-templates.js";
import type { StaticSchemaCandidate } from "./candidate-evaluation.js";
import { is_object_literal_prototype_setter, library_source_fields } from "./library-source.js";
import { immutable_source_declaration } from "./schema-identity.js";

export type StaticSourceCandidate = StaticSchemaCandidate & Readonly<{ node: ts.Expression; bodyStart?: number }>;
/** Bounded source alternatives shared by Schema preflight and Part source evidence. */
export function static_source_candidates(typescript: typeof ts, checker: ts.TypeChecker, program?: ts.Program) {
  const eligible = hson_source_syntactic_eligibility(typescript, program);
  const declaration = (node: ts.Identifier) => immutable_source_declaration(typescript, checker, node, eligible)?.declaration;
  const unwrap = (node: ts.Expression): ts.Expression => typescript.isParenthesizedExpression(node) || typescript.isAsExpression(node) || typescript.isSatisfiesExpression(node)
    ? unwrap(node.expression) : node;
  type Alternatives = Readonly<{ nodes: readonly ts.Expression[]; complete: boolean; conditional: boolean }>;
  const alternatives = (input: ts.Expression, family: "certify" | "document" | "data", seen = new Set<ts.Declaration>(), depth = 0): Alternatives => {
    const unknown: Alternatives = { nodes: [input], complete: false, conditional: false };
    if (depth > 16) return unknown;
    const node = unwrap(input);
    const complete = eligible(input);
    if (typescript.isIdentifier(node)) {
      const binding = immutable_source_declaration(typescript, checker, node, eligible);
      const found = binding?.declaration;
      if (found === undefined || found.initializer === undefined || seen.has(found)) return unknown;
      // Nonprimitive JSON (including alternatives) is known only at its sole use.
      const initial = unwrap(found.initializer);
      const primitive = typescript.isStringLiteral(initial) || typescript.isNoSubstitutionTemplateLiteral(initial)
        || typescript.isNumericLiteral(initial) || typescript.isPrefixUnaryExpression(initial)
        || [typescript.SyntaxKind.TrueKeyword, typescript.SyntaxKind.FalseKeyword, typescript.SyntaxKind.NullKeyword].includes(initial.kind);
      if (family === "data" && !primitive) {
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
      const result = alternatives(found.initializer, family, next, depth + 1);
      return { ...result, complete: complete && result.complete && binding?.eligible === true };
    }
    if (typescript.isConditionalExpression(node)) {
      const left = alternatives(node.whenTrue, family, new Set(seen), depth + 1);
      const right = alternatives(node.whenFalse, family, new Set(seen), depth + 1);
      const nodes = [...left.nodes, ...right.nodes];
      return { nodes: nodes.slice(0, 16), complete: complete && left.complete && right.complete && nodes.length <= 16, conditional: true };
    }
    return { nodes: [node], complete, conditional: false };
  };
  const candidate = (node: ts.Expression, family: "certify" | "document" | "data"): StaticSourceCandidate | undefined => {
    if (family !== "data" && typescript.isTaggedTemplateExpression(node) && typescript.isPropertyAccessExpression(node.tag)
      && typescript.isIdentifier(node.tag.expression) && is_official_hson_package_binding(node.tag.expression, "Hson", checker, true, typescript, eligible)
      && ["document", "data", "canonical"].includes(node.tag.name.text)
      && typescript.isNoSubstitutionTemplateLiteral(node.template) && !node.template.isUnterminated) {
      return { node, source: node.template.getText(node.getSourceFile()).slice(1, -1), family: node.tag.name.text === "document" ? "document" : node.tag.name.text === "canonical" ? "canonical" : "data", bodyStart: node.template.getStart() + 1 };
    }
    if (family === "document" && (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node))) {
      // Escaped JS strings have no direct raw-Hson correspondence; anchor on the expression.
      return { node, source: node.text, family: "document", bodyStart: -1 };
    }
    if (family === "data") {
      const value = json_literal(node, typescript, eligible);
      if (!value.known) return undefined;
      if (typeof value.value === "string") {
        try { return { node, json: JSON.parse(value.value) }; } catch { return undefined; }
      }
      return { node, json: value.value };
    }
    return undefined;
  };
  const candidates = (input: ts.Expression, family: "certify" | "document" | "data"): readonly StaticSourceCandidate[] | undefined => {
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
