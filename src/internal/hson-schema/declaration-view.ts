import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { apply_source_edits, library_schema_attachment_plan, type PreciseSchemaFact, type SchemaSourceEdit } from "./source-transformation.js";

type EvidenceOrigin = Readonly<{ source: string; name: string; evidence: string }>;

/** Name inferred public Schema types through their existing evidence origin, never a second brand. */
export function schema_declaration_views(program: ts.Program, origins: readonly EvidenceOrigin[]): ReadonlyMap<string, { text: string; edits: readonly SchemaSourceEdit[] }> {
  if (origins.length === 0) return new Map();
  const checker = program.getTypeChecker();
  const names = new Map<ts.Type, { evidence: string; field?: "value" | "identity" }>();
  const preciseSchemas: PreciseSchemaFact[] = [];
  for (const origin of origins) {
    const source = program.getSourceFile(origin.source);
    if (source === undefined) throw new Error(`Missing declaration producer: ${origin.source}`);
    for (const statement of source.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== origin.name || declaration.type === undefined || !ts.isTypeReferenceNode(declaration.type)) continue;
      const mode = declaration.type.typeArguments?.[1];
      if (mode !== undefined && ts.isLiteralTypeNode(mode) && ts.isStringLiteral(mode.literal)
        && (mode.literal.text === "data" || mode.literal.text === "document")) {
        preciseSchemas.push({ declaration, mode: mode.literal.text });
      }
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
    const attachments = library_schema_attachment_plan(source, checker, preciseSchemas).attachments;
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
        let node: ts.TypeNode | undefined;
        try {
          node = checker.typeToTypeNode(type, context, ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope);
        } catch (cause) {
          throw new Error(`Cannot name inferred declaration type near ${context.getText(source)} in ${source.fileName}.`, { cause });
        }
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
    const refinedLibraryReturn = (node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.GetAccessorDeclaration): string | undefined => {
      const body = node.body;
      if (body === undefined || !ts.isBlock(body)) return undefined;
      const returns = body.statements.filter(ts.isReturnStatement);
      if (returns.length !== 1) return undefined;
      const returned = returns[0];
      const expression = returned?.expression;
      if (returned === undefined || expression === undefined || !ts.isCallExpression(expression)
        || !ts.isPropertyAccessExpression(expression.expression) || expression.expression.name.text !== "lib"
        || !ts.isIdentifier(expression.expression.expression) || expression.arguments.length !== 1
        || !ts.isStringLiteral(expression.arguments[0])) return undefined;
      const map = expression.expression.expression;
      const library = expression.arguments[0];
      const attachment = attachments.find(fact => fact.statement.parent === body && fact.statement.getEnd() < returned.getStart(source)
        && checker.getSymbolAtLocation(fact.map) === checker.getSymbolAtLocation(map)
        && fact.library.text === library.text);
      const proof = body.statements.find((statement): statement is ts.ExpressionStatement => {
        if (!ts.isExpressionStatement(statement) || statement.getEnd() >= returned.getStart(source)
          || !ts.isCallExpression(statement.expression) || !ts.isIdentifier(statement.expression.expression)
          || !statement.expression.expression.text.startsWith("__hson_assert_library_schema")
          || statement.expression.arguments.length !== 3) return false;
        const [provedMap, provedLibrary, provedSchema] = statement.expression.arguments;
        return provedMap !== undefined && ts.isIdentifier(provedMap)
          && checker.getSymbolAtLocation(provedMap) === checker.getSymbolAtLocation(map)
          && provedLibrary !== undefined && ts.isStringLiteral(provedLibrary) && provedLibrary.text === library.text
          && provedSchema !== undefined && ts.isIdentifier(provedSchema);
      });
      const schemaNode = attachment?.schema ?? (proof !== undefined && ts.isCallExpression(proof.expression)
        ? proof.expression.arguments[2] : undefined);
      if (schemaNode === undefined || !ts.isIdentifier(schemaNode)) return undefined;
      const modeProperty = checker.getPropertyOfType(checker.getTypeAtLocation(expression), "mode");
      const mode = attachment?.mode ?? (modeProperty === undefined ? undefined
        : checker.getTypeOfSymbolAtLocation(modeProperty, expression));
      const modeName = typeof mode === "string" ? mode
        : mode !== undefined && (mode.flags & ts.TypeFlags.StringLiteral) !== 0
          ? (mode as ts.StringLiteralType).value : undefined;
      if (modeName !== "document" && modeName !== "data") return undefined;
      const facade = modeName === "document" ? "LiveMapDocumentLibrary" : "LiveMapDataLibrary";
      const schema = schemaNode.getText(source);
      return `import("hson-live").${facade}<import("hson-live").SchemaType<typeof ${schema}>, ${JSON.stringify(library.text)}, typeof ${schema}>`;
    };
    const visit = (node: ts.Node): void => {
      if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && node.type === undefined && node.initializer !== undefined && publicDeclaration(node)) annotate(checker.getTypeAtLocation(node), node, ts.isPropertyDeclaration(node) ? (node.questionToken ?? node.exclamationToken ?? node.name).getEnd() : node.name.getEnd());
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) && node.body !== undefined && node.type === undefined && publicDeclaration(node)) {
        const signature = checker.getSignatureFromDeclaration(node);
        const closing = node.getChildren(source).find(child => child.kind === ts.SyntaxKind.CloseParenToken);
        if (signature !== undefined && closing !== undefined) {
          const targeted = refinedLibraryReturn(node);
          if (targeted !== undefined) edits.push({ start: closing.getEnd(), end: closing.getEnd(), text: `: ${targeted}` });
          else annotate(checker.getReturnTypeOfSignature(signature), node, closing.getEnd());
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (edits.length) result.set(resolve(source.fileName), { text: apply_source_edits(source.text, edits), edits });
  }
  return result;
}
