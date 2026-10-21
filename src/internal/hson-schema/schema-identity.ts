import type ts from "typescript";
import { hson_source_alias_eligible, hson_source_syntactic_eligibility } from "../embedded-hson/discover-hson-tagged-templates.js";

/** Shared immutable value lookup; recovered aliases retain a separate eligibility result. */
export function immutable_source_declaration(typescript: typeof ts, checker: ts.TypeChecker, input: ts.Identifier,
  eligible: (node: ts.Node) => boolean, use: "value" | "type-query" = "value") {
  let symbol = typescript.isShorthandPropertyAssignment(input.parent)
    ? checker.getShorthandAssignmentValueSymbol(input.parent) : checker.getSymbolAtLocation(input);
  if (symbol === undefined) return undefined;
  const imported = symbol;
  if ((symbol.flags & typescript.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
  if (symbol.declarations?.length !== 1) return undefined;
  const declaration = symbol.declarations[0];
  if (declaration === undefined || !typescript.isVariableDeclaration(declaration) || !typescript.isIdentifier(declaration.name)
    || !typescript.isVariableDeclarationList(declaration.parent) || (declaration.parent.flags & typescript.NodeFlags.Const) === 0) return undefined;
  return { declaration, eligible: hson_source_alias_eligible(imported, checker, eligible, typescript, use === "value") };
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
): T | undefined {
  if (!eligible(input)) return undefined;
  if (typescript.isParenthesizedExpression(input) || typescript.isAsExpression(input) || typescript.isSatisfiesExpression(input)) {
    return resolve_immutable_schema(typescript, checker, input.expression, fact, seen, eligible, use);
  }
  if (!typescript.isIdentifier(input)) return undefined;
  const found = immutable_source_declaration(typescript, checker, input, eligible, use);
  if (found === undefined || !found.eligible || seen.has(found.declaration) || seen.size >= 16) return undefined;
  const declaration = found.declaration;
  const precise = fact(declaration);
  if (precise !== undefined) return precise;
  seen.add(declaration);
  // A query can name a type-only import; an immutable alias initializer still reads a runtime value.
  return declaration.initializer === undefined ? undefined : resolve_immutable_schema(typescript, checker, declaration.initializer, fact, seen, eligible);
}
