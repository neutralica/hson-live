import defaultTs from "typescript";
import type ts from "typescript";
import { immutable_source_declaration } from "./schema-identity.js";
import { hson_package_declaration_path, hson_source_alias_eligible, hson_source_syntactic_eligibility, read_supported_hson_import_symbols } from "../embedded-hson/discover-hson-tagged-templates.js";

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
  eligible = hson_source_syntactic_eligibility(ts),
): ts.ObjectLiteralExpression | undefined {
  // Schema preflight retains its fresh-literal boundary and lazy checker work.
  if (!ts.isCallExpression(expression) || expression.arguments[0] === undefined || !ts.isObjectLiteralExpression(expression.arguments[0])) return undefined;
  const source = library_source_admission(expression, checker, mapSymbols, localConstructionOnly, ts, eligible);
  return source?.eligible && ts.isObjectLiteralExpression(source.definitions) ? source.definitions : undefined;
}

/** Recognition is independent of whether the argument has a statically known inventory. */
export function library_source_admission(
  expression: ts.Expression, checker: ts.TypeChecker, mapSymbols: ReadonlySet<ts.Symbol>,
  localConstructionOnly = false, ts: typeof defaultTs = defaultTs,
  eligible = hson_source_syntactic_eligibility(ts),
): Readonly<{ call: ts.CallExpression; operation: "fromLibraries" | "create" | "resume" | "admit" | "addLibraries"; receiver: ts.Expression; definitions: ts.Expression; eligible: boolean }> | undefined {
  if (!ts.isCallExpression(expression) || (expression.flags & ts.NodeFlags.OptionalChain) !== 0) return undefined;
  const member = literal_member(expression.expression, ts);
  const definitions = expression.arguments[0];
  if (member === undefined || definitions === undefined) return undefined;
  if (!["fromLibraries", "create", "resume", "admit", "addLibraries"].includes(member.name)) return undefined;
  const result = (operation: "fromLibraries" | "create" | "resume" | "admit" | "addLibraries", provenanceEligible: boolean) =>
    ({ call: expression, operation, receiver: member.owner, definitions, eligible: eligible(expression) && provenanceEligible });
  const constructor = official_constructor(expression, checker, mapSymbols, ts, eligible);
  if (constructor !== undefined && (constructor.operation === "fromLibraries" || !localConstructionOnly)) return result(constructor.operation, constructor.eligible);
  if (localConstructionOnly || expression.arguments.length !== 1 || (member.name !== "admit" && member.name !== "addLibraries")) return undefined;
  const declaration = checker.getResolvedSignature(expression)?.getDeclaration();
  if (declaration !== undefined
    && (member.name === "admit" && official_library_source(declaration, "locus.core.types")
      || member.name === "addLibraries" && official_library_source(declaration, "livemap.types"))) {
    const receiver = official_receiving_value(member.owner, member.name === "admit" ? "locus" : "local", checker, ts, eligible);
    if (receiver !== undefined) return result(member.name, receiver.eligible && eligible(declaration));
  }
  return undefined;
}

function official_map_source(owner: ts.Expression, operation: "locus" | "fromLibraries" | "create", checker: ts.TypeChecker,
  mapSymbols: ReadonlySet<ts.Symbol>, ts: typeof defaultTs, eligible: (node: ts.Node) => boolean): Readonly<{ eligible: boolean }> | undefined {
  const umbrella = literal_member(owner, ts);
  const roots = read_supported_hson_import_symbols(owner.getSourceFile(), checker, [], "hson", ts);
  const rootSymbol = umbrella !== undefined && ts.isIdentifier(umbrella.owner) ? checker.getSymbolAtLocation(umbrella.owner) : undefined;
  if (umbrella?.name === "liveMap" && rootSymbol !== undefined && roots.has(rootSymbol)) {
    const target = checker.getAliasedSymbol(rootSymbol);
    const declaration = target.valueDeclaration;
    const path = declaration === undefined ? undefined : hson_package_declaration_path(declaration.getSourceFile().fileName);
    return target.name === "hson" && (path === "src/hson.ts" || path === "dist/hson.d.ts")
      ? { eligible: hson_source_alias_eligible(rootSymbol, checker, eligible, ts, true) } : undefined;
  }
  if (!ts.isIdentifier(owner)) return undefined;
  const symbol = checker.getSymbolAtLocation(owner);
  if (symbol === undefined || !mapSymbols.has(symbol) || symbol.declarations?.length !== 1) return undefined;
  const imported = symbol.declarations[0];
  if (imported === undefined) return undefined;
  let provenanceEligible = hson_source_alias_eligible(symbol, checker, eligible, ts, true, operation);
  const unalias = (value: ts.Symbol): ts.Symbol => (value.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(value) : value;
  let target = unalias(symbol);
  let name = "hsonLiveMap";
  let files = ["livemap/livemap.public", "livemap/livemap.facade"];
  if (ts.isNamespaceImport(imported)) {
    const exported = checker.getExportsOfModule(target).find(value => value.name === operation);
    if (exported === undefined) return undefined;
    provenanceEligible &&= hson_source_alias_eligible(exported, checker, eligible, ts, true);
    target = unalias(exported);
    name = operation;
    files = [operation === "locus" ? "locus/locus.facade" : "livemap/livemap.facade"];
  }
  // Import/export aliases preserve values. A consumer variable annotated with
  // an official type does not: require the exported value's own declaration.
  const declaration = target.valueDeclaration;
  const path = declaration === undefined ? undefined : hson_package_declaration_path(declaration.getSourceFile().fileName);
  return target.name === name && files.some(file => path === `src/api/${file}.ts` || path === `dist/api/${file}.d.ts`)
    ? { eligible: provenanceEligible } : undefined;
}

/** Called declarations and exported values jointly establish constructor ownership. */
function official_constructor(expression: ts.Expression, checker: ts.TypeChecker, mapSymbols: ReadonlySet<ts.Symbol>, ts: typeof defaultTs,
  eligible: (node: ts.Node) => boolean):
  Readonly<{ operation: "fromLibraries" | "create" | "resume"; family: "locus" | "local"; eligible: boolean }> | undefined {
  if (!ts.isCallExpression(expression) || (expression.flags & ts.NodeFlags.OptionalChain) !== 0) return undefined;
  const member = literal_member(expression.expression, ts);
  if (member === undefined || !["fromLibraries", "create", "resume"].includes(member.name)) return undefined;
  // Do not instantiate generic constructor signatures just to recognize their origin.
  const declaration = checker.getTypeAtLocation(expression.expression).getSymbol()?.valueDeclaration;
  const origin = declaration === undefined ? undefined : hson_package_declaration_path(declaration.getSourceFile().fileName);
  if ((member.name === "fromLibraries" && expression.arguments.length === 1 || member.name === "create" && expression.arguments.length === 0)
    && (origin === "src/api/livemap/livemap.facade.ts" || origin === "dist/api/livemap/livemap.facade.d.ts")) {
    const source = official_map_source(member.owner, member.name === "fromLibraries" ? "fromLibraries" : "create", checker, mapSymbols, ts, eligible);
    if (source !== undefined) return { operation: member.name === "create" ? "create" : "fromLibraries", family: "local",
      eligible: source.eligible && eligible(expression) && eligible(declaration!) };
  }
  const locus = literal_member(member.owner, ts);
  if ((member.name === "create" || member.name === "resume") && expression.arguments.length >= 1 && expression.arguments.length <= 2
    && locus?.name === "locus"
    && (origin === "src/api/locus/locus.public.ts" || origin === "dist/api/locus/locus.public.d.ts")) {
    const source = official_map_source(locus.owner, "locus", checker, mapSymbols, ts, eligible);
    if (source !== undefined) return { operation: member.name, family: "locus", eligible: source.eligible && eligible(expression) && eligible(declaration!) };
  }
  return undefined;
}

/** A compatible method type does not prove that its owner is an official receiving value. */
function official_receiving_value(input: ts.Expression, family: "locus" | "local", checker: ts.TypeChecker, ts: typeof defaultTs,
  eligible: (node: ts.Node) => boolean): Readonly<{ eligible: boolean }> | undefined {
  const seen = new Set<ts.Declaration>();
  const construction = (value: ts.Expression, awaited = false): Readonly<{ eligible: boolean }> | undefined => {
    const syntaxEligible = eligible(value);
    while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isAwaitExpression(value)) {
      if (ts.isAwaitExpression(value)) awaited = true;
      value = value.expression;
    }
    if (ts.isIdentifier(value)) {
      const found = immutable_source_declaration(ts, checker, value, eligible);
      if (found === undefined || found.declaration.initializer === undefined || seen.has(found.declaration) || seen.size >= 16) return undefined;
      seen.add(found.declaration);
      const next = construction(found.declaration.initializer, awaited);
      return next === undefined ? undefined : { eligible: syntaxEligible && found.eligible && next.eligible };
    }
    const symbols = read_supported_hson_import_symbols(value.getSourceFile(), checker, [], "hsonLiveMap", ts);
    const found = official_constructor(value, checker, symbols, ts, eligible);
    return found?.family === family && (found.operation !== "resume" || awaited) ? { eligible: syntaxEligible && found.eligible } : undefined;
  };
  return construction(input);
}

/** Spreads, computed names, duplicate fields and accessors withdraw static evidence. */
export function library_source_fields(node: ts.ObjectLiteralExpression, ts: typeof defaultTs = defaultTs): ReadonlyMap<string, ts.Expression> | undefined {
  const evidence = library_source_field_candidates(node, ts);
  return evidence.complete ? new Map(evidence.fields.flatMap(field => field.name === undefined || field.value === undefined ? [] : [[field.name, field.value]])) : undefined;
}

/** Partial fields are suggestion evidence only. Dynamic keys and overwrites retain uncertainty. */
export function library_source_field_candidates(node: ts.ObjectLiteralExpression, ts: typeof defaultTs = defaultTs) {
  const fields = new Map<string, ts.Expression>();
  const candidates: { name?: string; value?: ts.Expression; declaration: ts.ObjectLiteralElementLike }[] = [];
  let complete = true;
  for (const property of node.properties) {
    if ((!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property))
      || (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
      || ts.isShorthandPropertyAssignment(property) && property.objectAssignmentInitializer !== undefined
      || fields.has(property.name.text)) {
      complete = false;
      candidates.push({ declaration: property, ...(ts.isPropertyAssignment(property) ? { value: property.initializer } : {}) });
      continue;
    }
    fields.set(property.name.text, ts.isPropertyAssignment(property) ? property.initializer : property.name);
    candidates.push({ name: property.name.text, value: fields.get(property.name.text)!, declaration: property });
  }
  return { fields: candidates, complete };
}
