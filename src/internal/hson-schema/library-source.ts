import defaultTs from "typescript";
import type ts from "typescript";
import { hson_package_declaration_path } from "../embedded-hson/discover-hson-tagged-templates.js";

/** Literal source coordinates only; runtime membership and Schema checks remain runtime work. */
export function literal_member(expression: ts.Expression, ts: typeof defaultTs = defaultTs): Readonly<{ owner: ts.Expression; name: string }> | undefined {
  if ((expression.flags & ts.NodeFlags.OptionalChain) !== 0) return undefined;
  if (ts.isPropertyAccessExpression(expression)) return { owner: expression.expression, name: expression.name.text };
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression)) {
    return { owner: expression.expression, name: expression.argumentExpression.text };
  }
  return undefined;
}

export type LibrarySourceSelection = Readonly<{
  map: ts.Identifier;
  library: ts.StringLiteral | undefined;
  facade: ts.Expression;
  selector: ts.Expression;
  family: "doc" | "data" | "parts";
  required: boolean;
  checked: boolean;
}>;

/** Require the official selector signature, not merely a property with a familiar name. */
export function library_source_selection(expression: ts.Expression, checker: ts.TypeChecker, ts: typeof defaultTs = defaultTs): LibrarySourceSelection | undefined {
  let namespace: ts.Expression;
  let library: ts.StringLiteral | undefined;
  let required = true;
  let checked = false;
  if (ts.isCallExpression(expression)) {
    if ((expression.flags & ts.NodeFlags.OptionalChain) !== 0
      || expression.arguments.length < 1 || expression.arguments.length > 2) return undefined;
    const member = literal_member(expression.expression, ts);
    required = member?.name === "must";
    namespace = required && member !== undefined ? member.owner : expression.expression;
    const name = expression.arguments[0];
    library = name !== undefined && ts.isStringLiteral(name) ? name : undefined;
    checked = expression.arguments.length === 2;
  } else {
    const member = literal_member(expression, ts);
    if (member === undefined || reserved.has(member.name)) return undefined;
    namespace = member.owner;
    library = ts.factory.createStringLiteral(member.name);
  }
  const family = literal_member(namespace, ts);
  if (family === undefined || !ts.isIdentifier(family.owner)
    || (family.name !== "doc" && family.name !== "data" && family.name !== "parts")) return undefined;
  const signatures = checker.getSignaturesOfType(checker.getTypeAtLocation(namespace), ts.SignatureKind.Call);
  if (!signatures.some(signature => {
    const declaration = signature.getDeclaration();
    return declaration !== undefined && official_library_source(declaration, "library-selectors.types");
  })) return undefined;
  return { map: family.owner, library, facade: expression, selector: namespace, family: family.name, required, checked };
}

const reserved = new Set([
  "must", "name", "length", "then", "toJSON", "call", "apply", "bind", "prototype", "constructor",
  "__proto__", "arguments", "caller", "toString", "toLocaleString", "valueOf", "hasOwnProperty",
  "isPrototypeOf", "propertyIsEnumerable", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
]);

export function official_library_source(declaration: ts.Declaration, file: string): boolean {
  const path = hson_package_declaration_path(declaration.getSourceFile().fileName);
  return path === `src/types/${file}.ts` || path === `dist/types/${file}.d.ts`;
}

/** Shared construction/admission recognition for static candidates. No evaluation or alias guessing. */
export function library_source_definitions(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  mapSymbols: ReadonlySet<ts.Symbol>,
  localConstructionOnly = false,
  ts: typeof defaultTs = defaultTs,
): ts.ObjectLiteralExpression | undefined {
  if (!ts.isCallExpression(expression) || (expression.flags & ts.NodeFlags.OptionalChain) !== 0) return undefined;
  const member = literal_member(expression.expression, ts);
  const definitions = expression.arguments[0];
  if (member === undefined || definitions === undefined || !ts.isObjectLiteralExpression(definitions)) return undefined;
  const officialMap = (owner: ts.Expression, operation: "locus" | "fromLibraries"): boolean => {
    if (!ts.isIdentifier(owner)) return false;
    const symbol = checker.getSymbolAtLocation(owner);
    if (symbol === undefined || !mapSymbols.has(symbol) || symbol.declarations?.length !== 1) return false;
    const imported = symbol.declarations[0];
    if (imported === undefined) return false;
    const unalias = (value: ts.Symbol): ts.Symbol => (value.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(value) : value;
    let target = unalias(symbol);
    let name = "hsonLiveMap";
    let files = ["livemap/livemap.public", "livemap/livemap.facade"];
    if (ts.isNamespaceImport(imported)) {
      const exported = checker.getExportsOfModule(target).find(value => value.name === operation);
      if (exported === undefined) return false;
      target = unalias(exported);
      name = operation;
      files = [operation === "locus" ? "locus/locus.facade" : "livemap/livemap.facade"];
    }
    // Import/export aliases preserve values. A consumer variable annotated with
    // an official type does not: require the exported value's own declaration.
    const declaration = target.valueDeclaration;
    const path = declaration === undefined ? undefined : hson_package_declaration_path(declaration.getSourceFile().fileName);
    return target.name === name && files.some(file => path === `src/api/${file}.ts` || path === `dist/api/${file}.d.ts`);
  };
  // Constructors need declaration ownership, not instantiated argument/return
  // types. The callable type's symbol follows barrel aliases and readonly
  // facade properties to the function, without inferring this call's generics.
  // This type origin is usable only with the official exported value above.
  // Admission still requires its actual resolved signature.
  const constructor = member.name === "fromLibraries" || member.name === "create" || member.name === "resume";
  const declaration = constructor ? checker.getTypeAtLocation(expression.expression).getSymbol()?.valueDeclaration
    : checker.getResolvedSignature(expression)?.getDeclaration();
  const origin = declaration === undefined ? undefined : hson_package_declaration_path(declaration.getSourceFile().fileName);
  if (member.name === "fromLibraries" && expression.arguments.length === 1 && officialMap(member.owner, "fromLibraries")
    && (origin === "src/api/livemap/livemap.facade.ts" || origin === "dist/api/livemap/livemap.facade.d.ts")) return definitions;
  if (localConstructionOnly) return undefined;
  const locus = literal_member(member.owner, ts);
  if ((member.name === "create" || member.name === "resume") && expression.arguments.length <= 2
    && locus?.name === "locus" && officialMap(locus.owner, "locus")
    && (origin === "src/api/locus/locus.public.ts" || origin === "dist/api/locus/locus.public.d.ts")) return definitions;
  // Resolve the actual signature so unrelated admit/addLibraries methods cannot
  // establish candidate diagnostics, even when their receiver has familiar names.
  if (expression.arguments.length === 1 && declaration !== undefined
    && (member.name === "admit" && official_library_source(declaration, "locus.core.types")
      || member.name === "addLibraries" && official_library_source(declaration, "livemap.types"))) return definitions;
  return undefined;
}

/** Spreads, computed names, duplicate fields and accessors withdraw static evidence. */
export function library_source_fields(node: ts.ObjectLiteralExpression, ts: typeof defaultTs = defaultTs): ReadonlyMap<string, ts.Expression> | undefined {
  const fields = new Map<string, ts.Expression>();
  for (const property of node.properties) {
    if ((!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property))
      || (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
      || ts.isShorthandPropertyAssignment(property) && property.objectAssignmentInitializer !== undefined
      || fields.has(property.name.text)) return undefined;
    fields.set(property.name.text, ts.isPropertyAssignment(property) ? property.initializer : property.name);
  }
  return fields;
}
