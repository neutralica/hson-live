import type ts from "typescript";
import { is_official_hson_package_binding } from "../embedded-hson/discover-hson-tagged-templates.js";

export type HsonSchemaAnnotation = Readonly<{
  kind: "data" | "document" | "hson" | "projected";
  schema: ts.Identifier | undefined;
}>;
type Argument = Readonly<{ node: ts.TypeNode; parameters: ReadonlyMap<ts.Symbol, Argument> }>;

/** Transparent aliases only; the checker supplies lexical identity, not type evaluation. */
export function resolve_hson_schema_annotation(
  typescript: typeof ts,
  checker: ts.TypeChecker,
  annotation: ts.TypeNode,
): HsonSchemaAnnotation | undefined {
  const substitute = (input: Argument): Argument | undefined => {
    let current = input;
    for (let depth = 0; depth < 32; depth += 1) {
      if (typescript.isParenthesizedTypeNode(current.node)) {
        current = { ...current, node: current.node.type }; continue;
      }
      if (!typescript.isTypeReferenceNode(current.node) || current.node.typeArguments !== undefined) return current;
      const symbol = checker.getSymbolAtLocation(current.node.typeName);
      const next = symbol === undefined ? undefined : current.parameters.get(symbol);
      if (next === undefined) return current;
      current = next;
    }
    return undefined;
  };
  const visit = (input: Argument, seen: ReadonlySet<ts.Declaration>): HsonSchemaAnnotation | undefined => {
    const current = substitute(input);
    if (current === undefined || !typescript.isTypeReferenceNode(current.node)) return undefined;
    const { node, parameters } = current;
    if (typescript.isIdentifier(node.typeName)) {
      for (const [name, kind] of [["HsonData", "data"], ["HsonDocument", "document"], ["HsonFromSchema", "hson"], ["JsonFromSchema", "projected"]] as const) {
        if (!is_official_hson_package_binding(node.typeName, name, checker, true)) continue;
        // Bare HsonData/HsonDocument intentionally request no Schema proof.
        if (node.typeArguments?.length !== 1) return undefined;
        const argument = node.typeArguments[0];
        const query = argument === undefined ? undefined : substitute({ node: argument, parameters });
        return { kind, schema: query !== undefined && typescript.isTypeQueryNode(query.node)
          && typescript.isIdentifier(query.node.exprName) ? query.node.exprName : undefined };
      }
    }
    let symbol = checker.getSymbolAtLocation(node.typeName);
    if (symbol !== undefined && (symbol.flags & typescript.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
    if (symbol?.declarations?.length !== 1) return undefined;
    const declaration = symbol.declarations[0];
    if (declaration === undefined || !typescript.isTypeAliasDeclaration(declaration)
      || seen.has(declaration) || seen.size >= 16) return undefined;
    const formals = declaration.typeParameters ?? [];
    const actuals = node.typeArguments ?? [];
    if (formals.length !== actuals.length) return undefined;
    const nextParameters = new Map<ts.Symbol, Argument>();
    for (let index = 0; index < formals.length; index += 1) {
      const formal = formals[index], actual = actuals[index];
      const parameter = formal === undefined ? undefined : checker.getSymbolAtLocation(formal.name);
      if (parameter === undefined || actual === undefined) return undefined;
      nextParameters.set(parameter, { node: actual, parameters });
    }
    return visit({ node: declaration.type, parameters: nextParameters }, new Set([...seen, declaration]));
  };
  return visit({ node: annotation, parameters: new Map() }, new Set());
}
