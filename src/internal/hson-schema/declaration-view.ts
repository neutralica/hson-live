import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { apply_source_edits, type SchemaSourceEdit } from "./source-transformation.js";

type EvidenceOrigin = Readonly<{ source: string; name: string; evidence: string }>;

/** Name inferred public Schema types through their existing evidence origin, never a second brand. */
export function schema_declaration_views(program: ts.Program, origins: readonly EvidenceOrigin[]): ReadonlyMap<string, { text: string; edits: readonly SchemaSourceEdit[] }> {
  if (origins.length === 0) return new Map();
  const checker = program.getTypeChecker();
  const names = new Map<ts.Type, { evidence: string; field?: "value" | "identity" }>();
  for (const origin of origins) {
    const source = program.getSourceFile(origin.source);
    if (source === undefined) throw new Error(`Missing declaration producer: ${origin.source}`);
    for (const statement of source.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== origin.name || declaration.type === undefined || !ts.isTypeReferenceNode(declaration.type)) continue;
      names.set(checker.getTypeAtLocation(declaration), { evidence: origin.evidence });
      const value = declaration.type.typeArguments?.[0], identity = declaration.type.typeArguments?.[2];
      if (value !== undefined) {
        const type = checker.getTypeFromTypeNode(value);
        if (type.flags & ts.TypeFlags.Object) names.set(type, { evidence: origin.evidence, field: "value" });
      }
      if (identity !== undefined) names.set(checker.getTypeFromTypeNode(identity), { evidence: origin.evidence, field: "identity" });
    }
  }
  const printer = ts.createPrinter();
  const result = new Map<string, { text: string; edits: readonly SchemaSourceEdit[] }>();
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || source.fileName.includes(".hson-schema.generated.") || program.isSourceFileFromExternalLibrary(source)) continue;
    const edits: SchemaSourceEdit[] = [];
    const module = checker.getSymbolAtLocation(source);
    const exported = new Set<ts.Declaration>();
    if (module !== undefined) for (let symbol of checker.getExportsOfModule(module)) {
      if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      for (const declaration of symbol.declarations ?? []) exported.add(declaration);
    }
    const publicDeclaration = (node: ts.Node): boolean => {
      if (exported.has(node as ts.Declaration)) return true;
      return (ts.isPropertyDeclaration(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) && exported.has(node.parent as ts.Declaration);
    };
    const render = (type: ts.Type, context: ts.Node, seen = new Set<ts.Type>()): { node: ts.TypeNode; changed: boolean } => {
      const origin = names.get(type);
      if (origin !== undefined) {
        let specifier = relative(dirname(source.fileName), origin.evidence).split(sep).join("/").replace(/\.mts$/, ".mjs").replace(/\.cts$/, ".cjs").replace(/\.ts$/, ".js");
        if (!specifier.startsWith(".")) specifier = `./${specifier}`;
        const evidence = (): ts.TypeNode => ts.factory.createImportTypeNode(ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(specifier)), undefined, ts.factory.createIdentifier("Evidence"));
        const field = (key: string): ts.TypeNode => ts.factory.createIndexedAccessTypeNode(evidence(), ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(key)));
        return { changed: true, node: origin.field === undefined
          ? ts.factory.createImportTypeNode(ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral("hson-live")), undefined, ts.factory.createIdentifier("HsonSchema"), [field("value"), field("mode"), field("identity")])
          : field(origin.field) };
      }
      const fallback = (): { node: ts.TypeNode; changed: boolean } => {
        const node = checker.typeToTypeNode(type, context, ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope);
        if (node === undefined) throw new Error(`Cannot name inferred declaration type in ${source.fileName}.`);
        return { node, changed: false };
      };
      if (seen.has(type)) return fallback();
      const nested = new Set(seen).add(type);
      if (type.isUnionOrIntersection()) {
        const entries = type.types.map(entry => render(entry, context, nested));
        return { node: type.isUnion() ? ts.factory.createUnionTypeNode(entries.map(entry => entry.node)) : ts.factory.createIntersectionTypeNode(entries.map(entry => entry.node)), changed: entries.some(entry => entry.changed) };
      }
      const normal = fallback();
      // Preserve named classes, interfaces and aliases; substitute only their type arguments.
      const arguments_ = type.aliasTypeArguments ?? ((type.flags & ts.TypeFlags.Object) && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference ? checker.getTypeArguments(type as ts.TypeReference) : undefined);
      if (arguments_?.length) {
        const entries = arguments_.map(entry => render(entry, context, nested));
        if (!entries.some(entry => entry.changed)) return normal;
        if (ts.isTypeReferenceNode(normal.node)) return { changed: true, node: ts.factory.updateTypeReferenceNode(normal.node, normal.node.typeName, ts.factory.createNodeArray(entries.map(entry => entry.node))) };
        if (ts.isImportTypeNode(normal.node)) return { changed: true, node: ts.factory.updateImportTypeNode(normal.node, normal.node.argument, normal.node.attributes, normal.node.qualifier, ts.factory.createNodeArray(entries.map(entry => entry.node)), normal.node.isTypeOf) };
        if (ts.isArrayTypeNode(normal.node) && entries.length === 1) return { changed: true, node: ts.factory.createArrayTypeNode(entries[0]!.node) };
        return normal;
      }
      if (!(type.flags & ts.TypeFlags.Object) || type.aliasSymbol !== undefined) return normal;
      if (type.symbol?.declarations?.some(node => ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node))) return normal;
      if (!ts.isTypeLiteralNode(normal.node) && !ts.isFunctionTypeNode(normal.node)) return normal;
      let changed = false;
      const signatureParts = (signature: ts.Signature, node: ts.FunctionTypeNode | ts.MethodSignature) => {
        const returned = render(checker.getReturnTypeOfSignature(signature), context, nested);
        changed ||= returned.changed;
        // Keep TypeScript's syntax, modifiers, this/rest parameters and generic constraints.
        const parameters = node.parameters.map(parameter => {
          if (!ts.isParameter(parameter) || !ts.isIdentifier(parameter.name) || parameter.type === undefined) return parameter;
          const name = parameter.name.text;
          const symbol = signature.parameters.find(symbol => symbol.name === name);
          if (symbol === undefined) return parameter;
          const rendered = render(checker.getTypeOfSymbolAtLocation(symbol, context), context, nested);
          changed ||= rendered.changed;
          return ts.factory.updateParameterDeclaration(parameter, parameter.modifiers, parameter.dotDotDotToken, parameter.name, parameter.questionToken, rendered.node, parameter.initializer);
        });
        return { returned: returned.node, parameters };
      };
      if (ts.isFunctionTypeNode(normal.node)) {
        const signatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call);
        if (signatures.length !== 1) return normal;
        const parts = signatureParts(signatures[0]!, normal.node);
        return { changed, node: ts.factory.updateFunctionTypeNode(normal.node, normal.node.typeParameters, ts.factory.createNodeArray(parts.parameters), parts.returned) };
      }
      const methodIndices = new Map<string, number>();
      const members = normal.node.members.map(member => {
        if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) return member;
        const name = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) || ts.isNumericLiteral(member.name) ? member.name.text : undefined;
        if (name === undefined) return member;
        const property = checker.getPropertyOfType(type, name);
        if (property === undefined) return member;
        const propertyType = checker.getTypeOfSymbolAtLocation(property, context);
        if (ts.isPropertySignature(member)) {
          const rendered = render(propertyType, context, nested);
          changed ||= rendered.changed;
          return ts.factory.updatePropertySignature(member, member.modifiers, member.name, member.questionToken, rendered.node);
        }
        const index = methodIndices.get(name) ?? 0;
        methodIndices.set(name, index + 1);
        const signature = checker.getSignaturesOfType(propertyType, ts.SignatureKind.Call)[index];
        if (signature === undefined) return member;
        const parts = signatureParts(signature, member);
        return ts.factory.updateMethodSignature(member, member.modifiers, member.name, member.questionToken, member.typeParameters, ts.factory.createNodeArray(parts.parameters), parts.returned);
      });
      return { changed, node: ts.factory.updateTypeLiteralNode(normal.node, ts.factory.createNodeArray(members)) };
    };
    const annotate = (type: ts.Type, node: ts.Node, position: number): void => {
      const rendered = render(type, node);
      if (rendered.changed) edits.push({ start: position, end: position, text: `: ${printer.printNode(ts.EmitHint.Unspecified, rendered.node, source)}` });
    };
    const visit = (node: ts.Node): void => {
      if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && node.type === undefined && node.initializer !== undefined && publicDeclaration(node)) annotate(checker.getTypeAtLocation(node), node, ts.isPropertyDeclaration(node) ? (node.questionToken ?? node.exclamationToken ?? node.name).getEnd() : node.name.getEnd());
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) && node.body !== undefined && node.type === undefined && publicDeclaration(node)) {
        const signature = checker.getSignatureFromDeclaration(node);
        const closing = node.getChildren(source).find(child => child.kind === ts.SyntaxKind.CloseParenToken);
        if (signature !== undefined && closing !== undefined) annotate(checker.getReturnTypeOfSignature(signature), node, closing.getEnd());
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (edits.length) result.set(resolve(source.fileName), { text: apply_source_edits(source.text, edits), edits });
  }
  return result;
}
