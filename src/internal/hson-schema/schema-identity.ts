import type ts from "typescript";
import { hson_source_alias_target, hson_source_checker_lookup, hson_source_syntactic_eligibility, type SourceEligibility } from "../embedded-hson/discover-hson-tagged-templates.js";

/** These wrappers leave the value of their operand unchanged at runtime. */
export function source_expression_operand(typescript: typeof ts, input: ts.Expression) {
  return typescript.isParenthesizedExpression(input) || typescript.isAsExpression(input)
    || typescript.isTypeAssertionExpression(input) || typescript.isSatisfiesExpression(input)
    || typescript.isNonNullExpression(input) ? input.expression : undefined;
}

export function is_source_undefined(typescript: typeof ts, checker: ts.TypeChecker, input: ts.Expression): boolean {
  if (!typescript.isIdentifier(input) || input.text !== "undefined") return false;
  const symbol = source_value_symbol(typescript, checker, input);
  return symbol !== undefined && checker.isUndefinedSymbol(symbol);
}

export function source_value_symbol(typescript: typeof ts, checker: ts.TypeChecker, input: ts.Identifier): ts.Symbol | undefined {
  return hson_source_checker_lookup(() => typescript.isShorthandPropertyAssignment(input.parent)
    ? checker.getShorthandAssignmentValueSymbol(input.parent) : checker.getSymbolAtLocation(input));
}

/** Shared immutable value lookup; recovered aliases retain a separate eligibility result. */
export function immutable_source_declaration(typescript: typeof ts, checker: ts.TypeChecker, input: ts.Identifier,
  eligible: SourceEligibility, use: "value" | "type-query" = "value") {
  const symbol = source_value_symbol(typescript, checker, input);
  if (symbol === undefined) return undefined;
  const route = hson_source_alias_target(symbol, checker, eligible, typescript, { valueOnly: use === "value", selection: "resolved" });
  if (!route) return undefined;
  const declaration = route.target.valueDeclaration;
  if (declaration === undefined || !typescript.isVariableDeclaration(declaration) || !typescript.isIdentifier(declaration.name)
    || !typescript.isVariableDeclarationList(declaration.parent) || (declaration.parent.flags & typescript.NodeFlags.Const) === 0) return undefined;
  return { declaration, eligible: route.eligible && (use !== "value" || eligible.initializedRead?.(input, declaration, eligible.charge) !== false) };
}

/** Follow only immutable lexical aliases; imports preserve their declaration identity. */
export function resolve_immutable_schema<T>(
  typescript: typeof ts,
  checker: ts.TypeChecker,
  input: ts.Expression,
  fact: (declaration: ts.VariableDeclaration) => T | undefined,
  seen = new Set<ts.Declaration>(),
  eligible = hson_source_syntactic_eligibility(typescript),
  use: "value" | "type-query" = "value",
  inspect?: (depth: number) => boolean,
  depth = 0,
): T | undefined {
  if (inspect?.(depth) === false || !eligible(input)) return undefined;
  const operand = source_expression_operand(typescript, input);
  if (operand !== undefined) return resolve_immutable_schema(typescript, checker, operand, fact, seen, eligible, use, inspect, depth + 1);
  if (!typescript.isIdentifier(input)) return undefined;
  const found = immutable_source_declaration(typescript, checker, input, eligible, use);
  if (found === undefined || !found.eligible || seen.has(found.declaration) || seen.size >= 16) return undefined;
  const declaration = found.declaration;
  const precise = fact(declaration);
  if (precise !== undefined) return precise;
  seen.add(declaration);
  // A query can name a type-only import; an immutable alias initializer still reads a runtime value.
  return declaration.initializer === undefined ? undefined
    : resolve_immutable_schema(typescript, checker, declaration.initializer, fact, seen, eligible, "value", inspect, depth + 1);
}
