import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { hson_package_declaration_path } from "../embedded-hson/discover-hson-tagged-templates.js";
import { apply_source_edits, direct_family_selection, library_schema_attachment_plan, type PreciseSchemaFact, type SchemaSourceEdit } from "./source-transformation.js";
import { library_source_selection, literal_member, official_library_source } from "./library-source.js";

type EvidenceOrigin = Readonly<{ source: string; name: string; evidence: string }>;

/** Name inferred public types through existing Schema origins and Library inventory. */
export function schema_declaration_views(program: ts.Program, origins: readonly EvidenceOrigin[], host: ts.ModuleResolutionHost): ReadonlyMap<string, { text: string; edits: readonly SchemaSourceEdit[] }> {
  // Parts inventory is independent of authored Schema origins. Empty Schema
  // maps still allow the ordinary owner-based declaration path below.
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
      } else {
        const declarationType = checker.getTypeAtLocation(declaration);
        const arguments_ = declarationType.aliasTypeArguments
          ?? ((declarationType.flags & ts.TypeFlags.Object) && (declarationType as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
            ? checker.getTypeArguments(declarationType as ts.TypeReference) : undefined);
        const resolvedMode = arguments_?.[1];
        if (resolvedMode !== undefined && (resolvedMode.flags & ts.TypeFlags.StringLiteral) !== 0) {
          const value = (resolvedMode as ts.StringLiteralType).value;
          if (value === "data" || value === "document") preciseSchemas.push({ declaration, mode: value });
        }
      }
      names.set(checker.getTypeAtLocation(declaration), { evidence: origin.evidence });
      const value = declaration.type.typeArguments?.[0], identity = declaration.type.typeArguments?.[2];
      const resolvedMode = mode === undefined ? undefined : checker.getTypeFromTypeNode(mode);
      // JSON roots can be named structurally. Only document graph evidence needs
      // an origin-based value name; Schema handles still retain their identity.
      if (value !== undefined && !(resolvedMode?.isStringLiteral() && resolvedMode.value === "data")) {
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
    // Reuse symbols actually exported by the narrow entrypoints; bare checker names
    // need not be in scope in the producer being annotated.
    const publicNames = new Map<ts.Symbol, { specifier: string; name: string }>();
    for (const specifier of ["hson-live/hson", "hson-live/livemap", "hson-live/locus", "hson-live/echo"]) {
      const resolved = ts.resolveModuleName(specifier, source.fileName, program.getCompilerOptions(), host, undefined, undefined, source.impliedNodeFormat).resolvedModule;
      const entrypoint = resolved === undefined ? undefined : program.getSourceFile(resolved.resolvedFileName);
      const module = entrypoint === undefined ? undefined : checker.getSymbolAtLocation(entrypoint);
      if (module === undefined) continue;
      for (const exported of checker.getExportsOfModule(module)) {
        const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
        publicNames.set(symbol, { specifier, name: exported.name });
      }
    }
    // A root-only import need not load the narrow LiveMap barrel. Its LiveMap
    // export is the same interface, and is published through the narrow path.
    const rootModule = ts.resolveModuleName("hson-live", source.fileName, program.getCompilerOptions(), host, undefined, undefined, source.impliedNodeFormat).resolvedModule;
    const rootSource = rootModule === undefined ? undefined : program.getSourceFile(rootModule.resolvedFileName);
    const rootSymbol = rootSource === undefined ? undefined : checker.getSymbolAtLocation(rootSource);
    const rootMap = rootSymbol === undefined ? undefined : checker.getExportsOfModule(rootSymbol).find(symbol => symbol.name === "LiveMap");
    if (rootMap !== undefined) publicNames.set(rootMap.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(rootMap) : rootMap,
      { specifier: "hson-live/livemap", name: "LiveMap" });
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
          ? ts.factory.createImportTypeNode(ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral("hson-live/hson")), undefined, ts.factory.createIdentifier("HsonSchema"), [field("value"), field("mode"), field("identity")])
          : field(origin.field) };
      }
      const fallback = (flags = ts.NodeBuilderFlags.None): { node: ts.TypeNode; changed: boolean } => {
        let node: ts.TypeNode | undefined;
        try {
          const formatting = ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.AllowEmptyTuple | flags;
          node = checker.typeToTypeNode(type, context, formatting)
            ?? checker.typeToTypeNode(type, context, formatting | ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope);
        } catch (cause) {
          throw new Error(`Cannot name inferred declaration type near ${context.getText(source)} in ${source.fileName}.`, { cause });
        }
        if (node === undefined) throw new Error(`Cannot name inferred declaration type in ${source.fileName}.`);
        return { node, changed: false };
      };
      if (seen.has(type)) return fallback();
      const nested = new Set(seen).add(type);
      // Retain public aliases before expanding intersections. HsonData and
      // HsonDocument encapsulate private proof keys that must stay private.
      const symbol = type.aliasSymbol ?? type.getSymbol();
      const publicName = symbol === undefined ? undefined : publicNames.get(symbol);
      const arguments_ = type.aliasTypeArguments ?? ((type.flags & ts.TypeFlags.Object) && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference ? checker.getTypeArguments(type as ts.TypeReference) : undefined);
      if (publicName !== undefined) {
        const entries = arguments_?.map(entry => render(entry, context, nested));
        // A public name alone does not require an annotation. Rewrite only
        // declarations whose nested Schema evidence needs publication repair.
        return { changed: entries?.some(entry => entry.changed) ?? false, node: ts.factory.createImportTypeNode(
          ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(publicName.specifier)), undefined,
          ts.factory.createIdentifier(publicName.name), entries?.map(entry => entry.node),
        ) };
      }
      if (type.isUnionOrIntersection()) {
        const entries = type.types.map(entry => render(entry, context, nested));
        return { node: type.isUnion() ? ts.factory.createUnionTypeNode(entries.map(entry => entry.node)) : ts.factory.createIntersectionTypeNode(entries.map(entry => entry.node)), changed: entries.some(entry => entry.changed) };
      }
      // Internal mapped aliases (notably LiveMapKnownDefinitions) have no public
      // name. Let TypeScript resolve their keys/modifiers, then replace evidence
      // within their properties using the same structural rendering below.
      const expandMapped = type.aliasSymbol?.declarations?.some(declaration => !program.isSourceFileDefaultLibrary(declaration.getSourceFile())) === true
        && (type.flags & ts.TypeFlags.Object) !== 0
        && ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped) !== 0;
      const normal = fallback(expandMapped ? ts.NodeBuilderFlags.InTypeAlias : ts.NodeBuilderFlags.None);
      // Preserve named classes, interfaces and aliases; substitute only their type arguments.
      if (!expandMapped && arguments_?.length) {
        const entries = arguments_.map(entry => render(entry, context, nested));
        if (!entries.some(entry => entry.changed)) return normal;
        if (ts.isTypeReferenceNode(normal.node)) return { changed: true, node: ts.factory.updateTypeReferenceNode(normal.node, normal.node.typeName, ts.factory.createNodeArray(entries.map(entry => entry.node))) };
        if (ts.isImportTypeNode(normal.node)) return { changed: true, node: ts.factory.updateImportTypeNode(normal.node, normal.node.argument, normal.node.attributes, normal.node.qualifier, ts.factory.createNodeArray(entries.map(entry => entry.node)), normal.node.isTypeOf) };
        if (ts.isArrayTypeNode(normal.node) && entries.length === 1) return { changed: true, node: ts.factory.createArrayTypeNode(entries[0]!.node) };
        return normal;
      }
      if (!(type.flags & ts.TypeFlags.Object) || (type.aliasSymbol !== undefined && !expandMapped)) return normal;
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
    const selectedLibrary = (expression: ts.Expression) => direct_family_selection(expression, checker);
    const matchingAttachment = (
      selected: Readonly<{ map: ts.Identifier; library: ts.StringLiteral; facade: ts.Expression }>,
      container: ts.Node,
      before: number,
    ): Readonly<{ schema: ts.Identifier; mode?: "data" | "document" }> | undefined => {
      for (let index = attachments.length - 1; index >= 0; index -= 1) {
        const fact = attachments[index];
        if (fact !== undefined && fact.statement.parent === container && fact.statement.getEnd() < before
          && checker.getSymbolAtLocation(fact.map) === checker.getSymbolAtLocation(selected.map)
          && fact.library.text === selected.library.text) return fact;
      }
      const statements = ts.isSourceFile(container) || ts.isBlock(container) ? container.statements : undefined;
      if (statements !== undefined) for (let index = statements.length - 1; index >= 0; index -= 1) {
        const statement = statements[index];
        if (statement === undefined || statement.getEnd() >= before || !ts.isExpressionStatement(statement)
          || !ts.isCallExpression(statement.expression) || !ts.isIdentifier(statement.expression.expression)
          || !statement.expression.expression.text.startsWith("__hson_assert_library_schema")
          || statement.expression.arguments.length !== 3) continue;
        const [map, library, schema] = statement.expression.arguments;
        if (map === undefined || !ts.isIdentifier(map)
          || checker.getSymbolAtLocation(map) !== checker.getSymbolAtLocation(selected.map)
          || library === undefined || !ts.isStringLiteral(library) || library.text !== selected.library.text
          || schema === undefined || !ts.isIdentifier(schema)) continue;
        return { schema };
      }
      return undefined;
    };
    const selectedMode = (selected: Readonly<{ facade: ts.Expression }>): "data" | "document" | undefined => {
      const property = checker.getPropertyOfType(checker.getTypeAtLocation(selected.facade), "mode");
      if (property === undefined) return undefined;
      const mode = checker.getTypeOfSymbolAtLocation(property, selected.facade);
      return (mode.flags & ts.TypeFlags.StringLiteral) !== 0
        && ((mode as ts.StringLiteralType).value === "data" || (mode as ts.StringLiteralType).value === "document")
        ? (mode as ts.StringLiteralType).value as "data" | "document" : undefined;
    };
    const selectedSchema = (selected: Readonly<{ facade: ts.Expression }>): ts.Type | undefined => {
      const facade = checker.getNonNullableType(checker.getTypeAtLocation(selected.facade));
      const schemaProperty = checker.getPropertyOfType(facade, "schema");
      if (schemaProperty === undefined) return undefined;
      const schemaFacade = checker.getTypeOfSymbolAtLocation(schemaProperty, selected.facade);
      const getProperty = checker.getPropertyOfType(schemaFacade, "get");
      if (getProperty === undefined) return undefined;
      const signature = checker.getSignaturesOfType(checker.getTypeOfSymbolAtLocation(getProperty, selected.facade), ts.SignatureKind.Call)[0];
      return signature === undefined ? undefined : checker.getReturnTypeOfSignature(signature);
    };
    const selectionCarriesSchema = (selected: Readonly<{ facade: ts.Expression }>, schema: ts.Identifier): boolean => {
      const current = selectedSchema(selected);
      if (current === undefined) return false;
      const requested = checker.getTypeAtLocation(schema);
      return checker.isTypeAssignableTo(current, requested) && checker.isTypeAssignableTo(requested, current);
    };
    const refinedLibraryType = (expression: ts.Expression, container: ts.Node, before: number): string | undefined => {
      const selected = library_source_selection(expression, checker);
      if (selected === undefined || selected.family === "parts") return undefined;
      const attachment = selected.checked || selected.library === undefined ? undefined
        : matchingAttachment({ ...selected, library: selected.library }, container, before);
      const current = selectedSchema(selected) ?? (selected.checked && ts.isCallExpression(expression)
        && expression.arguments[1] !== undefined ? checker.getTypeAtLocation(expression.arguments[1]) : undefined);
      const knownSchema = current === undefined || (current.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0 ? undefined : [...names].find(([type, origin]) => origin.field === undefined
        && checker.isTypeAssignableTo(current, type) && checker.isTypeAssignableTo(type, current))?.[0];
      if (attachment === undefined && knownSchema === undefined) return undefined;
      if (attachment !== undefined && !selectionCarriesSchema(selected, attachment.schema)) return undefined;
      const schemaMode = attachment?.mode ?? preciseSchemas.find(fact => checker.getTypeAtLocation(fact.declaration) === knownSchema)?.mode;
      const schema = attachment !== undefined ? `typeof ${attachment.schema.getText(source)}`
        : knownSchema === undefined ? undefined : printer.printNode(ts.EmitHint.Unspecified, render(knownSchema, expression).node, source);
      if (schema === undefined) return undefined;
      const projection = selected.family === "data" && schemaMode === "data" ? `import("hson-live/hson").JsonFromSchema<${schema}>`
        : `(${schema} extends import("hson-live/hson").HsonSchema<infer TGraph, "data" | "document"> ? TGraph : never)`;
      // The official selector's context parameter is the authority evidence.
      // Name existing public facades; never infer authority from method shape.
      const selectorType = checker.getTypeAtLocation(selected.selector);
      if (selectorType.aliasSymbol?.declarations?.some(declaration => official_library_source(declaration, "library-selectors.types")) !== true) return undefined;
      const selectorArguments = selectorType.aliasTypeArguments;
      const context = selectorArguments?.[1];
      if (context === undefined || !context.isStringLiteral()) return undefined;
      const family = selected.family === "doc" ? "Document" : "Data";
      const resultType = checker.getTypeAtLocation(expression);
      const optional = resultType.isUnion() && resultType.types.some(type => (type.flags & ts.TypeFlags.Undefined) !== 0) ? " | undefined" : "";
      const named = (entrypoint: string, name: string, args: string) => `import("hson-live/${entrypoint}").${name}<${args}>`;
      switch (context.value) {
        case "local": return named("livemap", `LiveMap${family}Library`, `${projection}, ${selected.library === undefined ? "string" : JSON.stringify(selected.library.text)}, ${schema}`) + optional;
        case "locus": return named("locus", `Locus${family}Library`, `${projection}, ${schema}`) + optional;
        case "read": return named("locus", `Read${family}Library`, `${projection}, ${schema}`) + optional;
        case "stage": {
          const result = selectorArguments?.[3];
          const resultText = result === undefined ? "void" : printer.printNode(ts.EmitHint.Unspecified, render(result, expression).node, source);
          return named("livemap", `LiveMapStaged${family}Library`, `${projection}, ${resultText}`) + optional;
        }
        case "echo": return named("echo", `EchoProjected${family}Library`, `${projection}, ${schema}`)
          + " | " + named("echo", `EchoLocal${family}Library`, `${projection}, ${schema}`) + optional;
        default: return undefined;
      }
    };
    const refinedEndpointType = (expression: ts.Expression, container: ts.Node, before: number): string | undefined => {
      if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)
        || expression.expression.name.text !== "at" || expression.arguments.length !== 1) return undefined;
      const selected = selectedLibrary(expression.expression.expression);
      if (selected === undefined) return undefined;
      const attachment = matchingAttachment(selected, container, before);
      const path = expression.arguments[0];
      if (attachment === undefined || !selectionCarriesSchema(selected, attachment.schema)
        || (attachment.mode ?? selectedMode(selected)) !== "document" || path === undefined) return undefined;
      const pathNode = checker.typeToTypeNode(checker.getTypeAtLocation(path), path,
        ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope);
      if (pathNode === undefined) return undefined;
      const schema = attachment.schema.getText(source);
      return `import("hson-live/livemap").LiveMapDocumentLocation<(typeof ${schema} extends import("hson-live/hson").HsonSchema<infer TGraph, "document"> ? TGraph : never), ${JSON.stringify(selected.library.text)}, ${printer.printNode(ts.EmitHint.Unspecified, pathNode, source)}>`;
    };
    const namedOwners = new Set<ts.VariableDeclaration>();
    const preserveOwner = (identifier: ts.Identifier, container: ts.Node, before: number): void => {
      const declarations = checker.getSymbolAtLocation(identifier)?.declarations;
      const owner = declarations?.length === 1 ? declarations[0] : undefined;
      if (owner === undefined || !ts.isVariableDeclaration(owner) || owner.getSourceFile() !== source
        || publicDeclaration(owner) || owner.type !== undefined || owner.initializer === undefined
        || !ts.isCallExpression(owner.initializer) || namedOwners.has(owner)) return;
      namedOwners.add(owner);
      const ownerType = targetedExpressionType(owner.initializer, container, before);
      if (ownerType !== undefined) edits.push({ start: owner.name.getEnd(), end: owner.name.getEnd(), text: `: ${ownerType}` });
    };
    const namedPartType = (expression: ts.Expression, container: ts.Node, before: number): string | undefined => {
      const member = literal_member(expression);
      // Named Part members are coordinates on their source Library. Preserve
      // that public type instead of expanding the recursive location facade.
      const parts = member === undefined ? undefined : library_source_selection(member.owner, checker);
      if (member !== undefined && parts?.family === "parts" && parts.library !== undefined && (!ts.isCallExpression(member.owner) || parts.required && !parts.checked
        && checker.getPropertyOfType(checker.getTypeAtLocation(parts.selector), parts.library.text) !== undefined)) {
        preserveOwner(parts.map, container, before);
        return `(typeof ${parts.map.getText(source)})["parts"][${JSON.stringify(parts.library.text)}][${JSON.stringify(member.name)}]`;
      }
      return undefined;
    };
    const targetedExpressionType = (expression: ts.Expression, container: ts.Node, before: number): string | undefined => {
      const refined = refinedLibraryType(expression, container, before) ?? refinedEndpointType(expression, container, before);
      if (refined !== undefined) return refined;
      if (ts.isIdentifier(expression)) {
        const declarations = checker.getSymbolAtLocation(expression)?.declarations;
        if (declarations?.length === 1 && ts.isVariableDeclaration(declarations[0]!)
          && publicDeclaration(declarations[0]!) && declarations[0]!.getSourceFile() === source) {
          return `typeof ${expression.text}`;
        }
      }
      // Readonly aliases can lose their public alias identity in the checker.
      // Preserve the actual source operation and its inferred generic arguments
      // instead of reconstructing an authority facade from structural members.
      if (ts.isCallExpression(expression)) {
        const signature = checker.getResolvedSignature(expression);
        const declaration = signature?.getDeclaration();
        const path = declaration === undefined ? undefined : hson_package_declaration_path(declaration.getSourceFile().fileName);
        if (declaration !== undefined && ts.isFunctionDeclaration(declaration)
          && (declaration.name?.text === "create" || declaration.name?.text === "resume")
          && (path === "src/api/locus/locus.public.ts" || path === "dist/api/locus/locus.public.d.ts")) {
          const arguments_ = signature === undefined ? undefined : checker.getTypeArgumentsForResolvedSignature(signature);
          if (arguments_?.length) {
            const explicit = [...arguments_];
            while (explicit.length > 0) {
              const last = explicit[explicit.length - 1]!;
              const defaultNode = declaration.typeParameters?.[explicit.length - 1]?.default;
              if (defaultNode === undefined) break;
              const defaultType = checker.getTypeFromTypeNode(defaultNode);
              if (!checker.isTypeAssignableTo(last, defaultType) || !checker.isTypeAssignableTo(defaultType, last)) break;
              explicit.pop();
            }
            const argumentsText = explicit.map(type => printer.printNode(ts.EmitHint.Unspecified, render(type, expression).node, source)).join(", ");
            return `ReturnType<typeof import("hson-live/livemap").locus.${declaration.name.text}<${argumentsText}>>`;
          }
        }
      }
      const selected = library_source_selection(expression, checker);
      if (selected === undefined) {
        return namedPartType(expression, container, before);
      }
      preserveOwner(selected.map, container, before);
      const owner = selected.map.getText(source);
      if (!ts.isCallExpression(expression)) return selected.library === undefined ? undefined
        : `(typeof ${owner})[${JSON.stringify(selected.family)}][${JSON.stringify(selected.library.text)}]`;
      return undefined;
    };
    const refinedReturnType = (node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.GetAccessorDeclaration): string | undefined => {
      if (!ts.isGetAccessorDeclaration(node) && node.asteriskToken !== undefined) return undefined;
      const body = node.body;
      if (body === undefined || !ts.isBlock(body)) return undefined;
      const returns = body.statements.filter(ts.isReturnStatement);
      if (returns.length !== 1) return undefined;
      const returned = returns[0];
      const expression = returned?.expression;
      if (returned === undefined || expression === undefined) return undefined;
      if (origins.length === 0) return namedPartType(expression, body, returned.getStart(source));
      const targeted = targetedExpressionType(expression, body, returned.getStart(source));
      if (targeted !== undefined) return targeted;
      const selected = selectedLibrary(expression);
      if (selected === undefined) return undefined;
      const { map, library } = selected;
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
      const projection = modeName === "data" ? `import("hson-live/hson").JsonFromSchema<typeof ${schema}>`
        : `(typeof ${schema} extends import("hson-live/hson").HsonSchema<infer TGraph, "document"> ? TGraph : never)`;
      return `import("hson-live/livemap").${facade}<${projection}, ${JSON.stringify(library.text)}, typeof ${schema}>`;
    };
    const flowRefinedExportedMap = (node: ts.VariableDeclaration): boolean => {
      if (!ts.isIdentifier(node.name) || node.parent.parent.parent !== source) return false;
      const symbol = checker.getSymbolAtLocation(node.name);
      if (attachments.some(fact => fact.statement.parent === source && fact.statement.getStart(source) > node.getEnd()
        && checker.getSymbolAtLocation(fact.map) === symbol)) return true;
      return source.statements.some(statement => statement.getStart(source) > node.getEnd()
        && ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
        && ts.isIdentifier(statement.expression.expression)
        && statement.expression.expression.text.startsWith("__hson_assert_library_schema")
        && statement.expression.arguments[0] !== undefined
        && ts.isIdentifier(statement.expression.arguments[0])
        && checker.getSymbolAtLocation(statement.expression.arguments[0]) === symbol);
    };
    const visit = (node: ts.Node): void => {
      if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && node.type === undefined && node.initializer !== undefined && publicDeclaration(node)) {
        if (ts.isVariableDeclaration(node) && flowRefinedExportedMap(node)) {
          throw new Error(`HSON_SCHEMA_FLOW_REFINED_EXPORTED_MAP_UNSUPPORTED: exported map ${node.name.getText(source)} is tightened after initialization; export a refined Library or endpoint facade instead.`);
        }
        const statement = ts.isVariableDeclaration(node) && ts.isVariableStatement(node.parent.parent) ? node.parent.parent : undefined;
        const targeted = statement === undefined ? undefined
          : (origins.length === 0 ? namedPartType : targetedExpressionType)(node.initializer, statement.parent, statement.getStart(source));
        const position = ts.isPropertyDeclaration(node) ? (node.questionToken ?? node.exclamationToken ?? node.name).getEnd() : node.name.getEnd();
        if (targeted !== undefined) edits.push({ start: position, end: position, text: `: ${targeted}` });
        else if (origins.length > 0) annotate(checker.getTypeAtLocation(node), node, position);
      }
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) && node.body !== undefined && node.type === undefined && publicDeclaration(node)) {
        const expressionType = refinedReturnType(node);
        const signature = origins.length > 0 || expressionType !== undefined ? checker.getSignatureFromDeclaration(node) : undefined;
        const closing = node.getChildren(source).find(child => child.kind === ts.SyntaxKind.CloseParenToken);
        if (signature !== undefined && closing !== undefined) {
          const targeted = expressionType === undefined ? undefined
            : node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
              ? `Promise<Awaited<${expressionType}>>` : expressionType;
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
