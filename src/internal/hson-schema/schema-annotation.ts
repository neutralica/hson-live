import type ts from "typescript";
import { hson_source_alias_eligible, hson_source_syntactic_eligibility, is_official_hson_package_binding } from "../embedded-hson/discover-hson-tagged-templates.js";
import { resolve_immutable_schema } from "./schema-identity.js";
import { discover_hson_schema_declarations, type DiscoveredHsonSchemaDeclaration } from "./schema-discovery.js";

/** Advisory Schema provenance shared by Data and Part completion. An annotation
 * supplies authoring context, not a runtime input contract or assignment proof.
 * Callers may reuse declaration discovery within this exact source program. */
export function annotated_data_schema_source(typescript: typeof ts, program: ts.Program, checker: ts.TypeChecker,
  type: ts.TypeNode, eligible = hson_source_syntactic_eligibility(typescript, program),
  declarations = new Map<ts.SourceFile, readonly DiscoveredHsonSchemaDeclaration[]>()): string | undefined {
  const annotation = resolve_hson_schema_annotation(typescript, checker, type, eligible);
  if (annotation?.schema === undefined || annotation.kind !== "data" && annotation.kind !== "hson") return undefined;
  return resolve_immutable_schema(typescript, checker, annotation.schema, producer => {
    const file = producer.getSourceFile();
    if (file.isDeclarationFile || program.isSourceFileFromExternalLibrary(file)
      || file.fileName.replaceAll("\\", "/").split("/").includes(".hson")) return undefined;
    let entries = declarations.get(file);
    if (entries === undefined) {
      entries = discover_hson_schema_declarations(typescript, file, checker, eligible);
      declarations.set(file, entries);
    }
    return entries.find(found => found.declaration === producer && found.eligible)?.source;
  }, new Set(), eligible, "type-query");
}

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
  eligible = hson_source_syntactic_eligibility(typescript),
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
    if (current === undefined || !eligible(current.node) || !typescript.isTypeReferenceNode(current.node)) return undefined;
    const { node, parameters } = current;
    if (typescript.isIdentifier(node.typeName)) {
      for (const [name, kind] of [["HsonData", "data"], ["HsonDocument", "document"], ["HsonFromSchema", "hson"], ["JsonFromSchema", "projected"]] as const) {
        if (!is_official_hson_package_binding(node.typeName, name, checker, true, typescript, eligible)) continue;
        // Bare HsonData/HsonDocument intentionally request no Schema proof.
        if (node.typeArguments?.length !== 1) return undefined;
        const argument = node.typeArguments[0];
        const query = argument === undefined ? undefined : substitute({ node: argument, parameters });
        return { kind, schema: query !== undefined && typescript.isTypeQueryNode(query.node)
          && typescript.isIdentifier(query.node.exprName) ? query.node.exprName : undefined };
      }
    }
    let symbol = checker.getSymbolAtLocation(node.typeName);
    if (symbol === undefined || !hson_source_alias_eligible(symbol, checker, eligible, typescript)) return undefined;
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
