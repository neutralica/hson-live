import type ts from "typescript";

/** Follow only immutable lexical aliases; imports preserve their declaration identity. */
export function resolve_immutable_schema<T>(
  typescript: typeof ts,
  checker: ts.TypeChecker,
  input: ts.Expression,
  fact: (declaration: ts.VariableDeclaration) => T | undefined,
  seen = new Set<ts.Declaration>(),
): T | undefined {
  if (typescript.isParenthesizedExpression(input) || typescript.isAsExpression(input) || typescript.isSatisfiesExpression(input)) {
    return resolve_immutable_schema(typescript, checker, input.expression, fact, seen);
  }
  if (!typescript.isIdentifier(input)) return undefined;
  let symbol = typescript.isShorthandPropertyAssignment(input.parent)
    ? checker.getShorthandAssignmentValueSymbol(input.parent) : checker.getSymbolAtLocation(input);
  if (symbol !== undefined && (symbol.flags & typescript.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
  if (symbol?.declarations?.length !== 1) return undefined;
  const declaration = symbol.declarations[0];
  if (declaration === undefined || !typescript.isVariableDeclaration(declaration) || !typescript.isIdentifier(declaration.name)
    || !typescript.isVariableDeclarationList(declaration.parent) || (declaration.parent.flags & typescript.NodeFlags.Const) === 0
    || seen.has(declaration) || seen.size >= 16) return undefined;
  const precise = fact(declaration);
  if (precise !== undefined) return precise;
  seen.add(declaration);
  return declaration.initializer === undefined ? undefined : resolve_immutable_schema(typescript, checker, declaration.initializer, fact, seen);
}
