import { Hson } from "../../hson-authoring.js";
import { admit_canonical_hson_data_value } from "../../api/data/hson-data-hson.js";
import { admit_data_source } from "../../core/data-source-admission.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { assert_canonical_hson_data_value } from "../../core/projected-value-graph.js";
import type ts from "typescript";
import { selected_hson_value_declaration, hson_authoring_tag, hson_source_syntactic_eligibility, is_hson_typescript_source_file, is_official_hson_event_binding, is_official_hson_package_binding } from "../embedded-hson/discover-hson-tagged-templates.js";
import type { StaticSchemaCandidate } from "./candidate-evaluation.js";
import { is_object_literal_prototype_setter, library_source_fields } from "./library-source.js";
import { immutable_source_declaration, is_source_undefined, source_expression_operand, source_value_symbol } from "./schema-identity.js";
import { admit_hson_tagged_source, admit_hson_tagged_template, hson_tagged_source } from "../embedded-hson/hson-tagged-source-admission.js";
import { static_event_parser } from "./static-event-parser.js";
import { raw_hson_template_literal } from "../trusted-schema-diagnostics/interpolation-source.js";

export type StaticSourceCandidate = StaticSchemaCandidate & Readonly<{ node: ts.Expression; bodyStart?: number; bodyOffsets?: readonly number[] }>;

const part_work_limit = 16384;
const part_depth_limit = 128;
const initializer_limit = 16;

/** One unit per syntax, declaration, route, or diagnostic visit. The depth
 * limit applies along a source path, with each separately rooted census
 * starting at zero. The initializer limit independently counts resolution
 * edges. Forks inherit the coordinate prefix cost for each selected member. */
export class PartOwnershipWork {
  private inspected = 0;
  private deepest = 0;
  private stopped = false;
  private censuses = new Set<ts.Block | ts.SourceFile>();

  get used() { return this.inspected; }
  get maxDepth() { return this.deepest; }
  get exhausted() { return this.stopped; }

  charge(units = 1, depth = 0): boolean {
    if (this.stopped) return false;
    if (depth > part_depth_limit || units > part_work_limit - this.inspected) {
      this.stopped = true;
      return false;
    }
    this.inspected += units;
    this.deepest = Math.max(this.deepest, depth);
    return true;
  }

  useCensus(scope: ts.Block | ts.SourceFile, units: number, depth: number): boolean {
    if (this.censuses.has(scope)) return !this.stopped;
    if (!this.charge(units, depth)) return false;
    this.censuses.add(scope);
    return true;
  }

  fork(): PartOwnershipWork {
    const child = new PartOwnershipWork();
    child.inspected = this.inspected;
    child.deepest = this.deepest;
    child.stopped = this.stopped;
    if (child.charge(this.censuses.size)) child.censuses = new Set(this.censuses);
    return child;
  }
}

type AlternativeOptions = Readonly<{
  reachableOnly?: true;
  work?: PartOwnershipWork | undefined;
  recordContents?: "member" | "coordinate" | "expression";
  depth?: number;
}>;
/** Source links admit ordinary const declarations. AwaitUsing also carries the Const bit. */
export function is_event_const_declaration(typescript: typeof ts, declaration: ts.VariableDeclaration): boolean {
  return typescript.isVariableDeclarationList(declaration.parent)
    && (declaration.parent.flags & typescript.NodeFlags.BlockScoped) === typescript.NodeFlags.Const;
}

/** Bounded source alternatives shared by Schema preflight and Part source evidence. */
export function static_source_candidates(typescript: typeof ts, checker: ts.TypeChecker, program?: ts.Program,
  parseEvent = static_event_parser(),
) {
  const eligible = hson_source_syntactic_eligibility(typescript, program);
  const workEligibility = new WeakMap<PartOwnershipWork, typeof eligible>();
  const eligibility = (work?: PartOwnershipWork) => {
    if (!work) return eligible;
    const cached = workEligibility.get(work);
    if (cached) return cached;
    const charge = (units?: number) => work.charge(units);
    const bounded = Object.assign((node: ts.Node) => eligible(node, charge), eligible, { charge });
    workEligibility.set(work, bounded);
    return bounded;
  };
  const declaration = (node: ts.Identifier, work?: PartOwnershipWork) => {
    const binding = immutable_source_declaration(typescript, checker, node, eligibility(work));
    return binding?.eligible ? binding.declaration : undefined;
  };
  const unwrap = (node: ts.Expression): ts.Expression => {
    for (let operand = source_expression_operand(typescript, node); operand; operand = source_expression_operand(typescript, node)) {
      node = operand;
    }
    return node;
  };
  const inspectExpression = (node: ts.Expression, work: PartOwnershipWork | undefined, depth: number) => {
    if (!work) return { node: unwrap(node), depth };
    while (work.charge(1, depth)) {
      const operand = source_expression_operand(typescript, node);
      if (!operand) return { node, depth };
      node = operand;
      depth++;
    }
    return undefined;
  };
  const officialData = (node: ts.Expression, work?: PartOwnershipWork): boolean => typescript.isPropertyAccessExpression(node)
    && node.name.text === "data" && typescript.isIdentifier(node.expression)
    && is_official_hson_package_binding(node.expression, "Hson", checker, true, typescript, eligibility(work));
  const dataProducer = (input: ts.Expression, work?: PartOwnershipWork): boolean => {
    const node = inspectExpression(input, work, 0)?.node;
    return node !== undefined && (typescript.isTaggedTemplateExpression(node) && (officialData(node.tag, work)
      || typescript.isPropertyAccessExpression(node.tag) && node.tag.name.text === "parse" && officialData(node.tag.expression, work))
      || typescript.isCallExpression(node) && typescript.isPropertyAccessExpression(node.expression)
        && ["from", "fromSource", "parse"].includes(node.expression.name.text) && officialData(node.expression.expression, work));
  };
  // JSON and Schema candidates keep their existing same-file value-use check.
  const hasOtherUse = (file: ts.SourceFile, read: ts.Identifier, found: ts.VariableDeclaration, work?: PartOwnershipWork): boolean => {
    const visit = (entry: ts.Node, depth: number): boolean => {
      if (work?.charge(1, depth) === false) return true;
      if (typescript.isIdentifier(entry) && entry !== found.name && entry !== read) {
        const binding = immutable_source_declaration(typescript, checker, entry, eligibility(work));
        if (binding?.eligible && binding.declaration === found) return true;
      }
      return typescript.forEachChild(entry, child => visit(child, depth + 1)) === true;
    };
    return visit(file, 0);
  };

  // A private record has one lexical value read in its declaring block/module.
  // Collect by spelling, including unsupported syntax and unresolved identifiers:
  // checker recovery or a missing symbol cannot hide a use. Literal property
  // names and erased types do not read a value.
  // A complete census has the same budget cost on cold and warm proofs.
  // Exhaustion is local to the proof and never produces a cached census.
  const localNames = new WeakMap<ts.Block | ts.SourceFile, {
    names: Map<string, ts.Identifier[]>; units: number; depth: number;
  }>();
  const namesIn = (scope: ts.Block | ts.SourceFile, work: PartOwnershipWork) => {
    const cached = localNames.get(scope);
    if (cached) return work.useCensus(scope, cached.units, cached.depth) ? cached.names : undefined;
    const names = new Map<string, ts.Identifier[]>();
    const before = work.used;
    let deepest = 0;
    const incomplete = (node: ts.Node, depth: number): boolean => {
      if (!work.charge(1, depth)) return true;
      deepest = Math.max(depth, deepest);
      if (typescript.isTypeAliasDeclaration(node) || typescript.isInterfaceDeclaration(node)
        || typescript.isTypeNode(node) && (!typescript.isExpressionWithTypeArguments(node) || typescript.isPartOfTypeNode(node))
        || typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node) && (node.isTypeOnly || node.moduleSpecifier)
        || typescript.isExportSpecifier(node) && node.isTypeOnly) return false;
      // Classic JSX factories and fragment operands can read implicit lexical names.
      if (typescript.isJsxOpeningElement(node) || typescript.isJsxSelfClosingElement(node) || typescript.isJsxFragment(node)) return true;
      if (typescript.isIdentifier(node)) {
        const parent = node.parent;
        if ((typescript.isPropertyAccessExpression(parent) || typescript.isPropertyAssignment(parent)) && parent.name === node
          || typescript.isExportSpecifier(parent) && parent.propertyName && parent.name === node) return false;
        if (node.text === "eval") return true;
        const uses = names.get(node.text);
        if (uses) uses.push(node);
        else names.set(node.text, [node]);
      }
      return typescript.forEachChild(node, child => incomplete(child, depth + 1)) === true;
    };
    if (!eligibility(work)(scope) || incomplete(scope, 0)) return undefined;
    localNames.set(scope, { names, units: work.used - before, depth: deepest });
    work.useCensus(scope, 0, deepest);
    return names;
  };
  // Each link must be an initialized ordinary const in the same execution scope.
  // The alternatives walk limits a selected initializer path to 16 steps.
  const privateRecordRead = (read: ts.Identifier, found: ts.VariableDeclaration, work: PartOwnershipWork): boolean => {
    const file = read.getSourceFile(), statement = found.parent.parent;
    if (found.getSourceFile() !== file || file.isDeclarationFile || !typescript.isExternalModule(file)
      || !is_event_const_declaration(typescript, found) || !typescript.isIdentifier(found.name)
      || !typescript.isVariableStatement(statement) || !eligibility(work)(found) || found.end > read.getStart()
      || (typescript.getCombinedModifierFlags(found) & (typescript.ModifierFlags.Export | typescript.ModifierFlags.Ambient)) !== 0) return false;
    const scope = statement.parent;
    if (!typescript.isSourceFile(scope) && !typescript.isBlock(scope)) return false;
    let depth = 0;
    for (let parent = read.parent; parent !== scope; parent = parent.parent) {
      if (!work.charge(1, depth++) || typescript.isFunctionLike(parent) || typescript.isClassLike(parent) || typescript.isSourceFile(parent)) return false;
    }
    const name = found.name;
    const uses = namesIn(scope, work)?.get(name.text);
    let declared = false, selected = false;
    for (const site of uses ?? []) {
      if (!work.charge()) return false;
      if (site === found.name) { declared = true; continue; }
      if (site === read) { selected = true; continue; }
      // A distinct lexical variable/parameter can shadow the spelling. Never
      // chase aliases or interpret an unresolved occurrence as a different use.
      const symbol = source_value_symbol(typescript, checker, site);
      if (!symbol || symbol.flags & typescript.SymbolFlags.Alias || symbol.declarations?.length !== 1) return false;
      const shadow = symbol.valueDeclaration;
      if (!(shadow !== undefined && shadow !== found && shadow.getSourceFile() === file
        && (typescript.isVariableDeclaration(shadow) || typescript.isParameter(shadow) || typescript.isBindingElement(shadow))
        && (typescript.getCombinedModifierFlags(shadow) & typescript.ModifierFlags.Ambient) === 0
        && typescript.isIdentifier(shadow.name) && shadow.name.text === name.text)) return false;
    }
    return declared && selected;
  };
  type Family = "certify" | "document" | "data" | "json" | "part-record";
  type Alternatives = Readonly<{ nodes: readonly ts.Expression[]; complete: boolean; conditional: boolean; direct?: true | undefined;
    depth?: number; branchDepths?: readonly number[] }>;
  const walk = (input: ts.Expression, family: Family, options: AlternativeOptions, seen: Set<ts.Declaration>,
    steps: number, depth: number): Alternatives => {
    const unknown: Alternatives = { nodes: [input], complete: false, conditional: false };
    if (steps > initializer_limit) return unknown;
    const { work } = options;
    const inspected = inspectExpression(input, work, depth);
    if (!inspected) return unknown;
    const node = inspected.node, nextDepth = inspected.depth + 1;
    const checked = eligibility(work);
    const complete = checked(input);
    if (work?.exhausted) return unknown;
    if (typescript.isIdentifier(node) && !is_source_undefined(typescript, checker, node)) {
      if (work && steps === initializer_limit) return unknown;
      const binding = immutable_source_declaration(typescript, checker, node, checked);
      const found = binding?.declaration;
      if (found === undefined || found.initializer === undefined || seen.has(found)) return unknown;
      if (options.recordContents === "coordinate" && !binding?.eligible) return unknown;
      if (family === "json" || family === "certify") {
        const initial = inspectExpression(found.initializer, work, nextDepth)?.node;
        if (!initial) return unknown;
        const primitive = typescript.isStringLiteral(initial) || typescript.isNoSubstitutionTemplateLiteral(initial)
          || typescript.isNumericLiteral(initial) || typescript.isPrefixUnaryExpression(initial) || is_source_undefined(typescript, checker, initial)
          || [typescript.SyntaxKind.TrueKeyword, typescript.SyntaxKind.FalseKeyword, typescript.SyntaxKind.NullKeyword].includes(initial.kind);
        if (!primitive && !dataProducer(initial, work)) {
          const file = node.getSourceFile();
          if (found.getSourceFile() !== file || found.end >= node.getStart() || hasOtherUse(file, node, found, work)) return unknown;
        }
      }
      seen.add(found);
      const result = walk(found.initializer, family, options, seen, steps + 1, nextDepth);
      seen.delete(found);
      if (!result.complete || work?.exhausted) return { ...result, direct: undefined, complete: false };
      // Preserve authored locations even when an object lacks an ownership witness.
      const stable = family !== "part-record" || !result.nodes.some(value =>
        typescript.isObjectLiteralExpression(value) || typescript.isArrayLiteralExpression(value))
        || !!work && privateRecordRead(node, found, work);
      return { ...result, direct: undefined, complete: complete && stable && binding?.eligible === true };
    }
    if (typescript.isConditionalExpression(node)) {
      if (options.recordContents === "coordinate") return unknown;
      if (options.reachableOnly && complete) {
        const condition = walk(node.condition, "document", { work }, seen, steps + 1, nextDepth);
        const kind = condition.complete && condition.nodes.length === 1 ? condition.nodes[0]?.kind : undefined;
        if (kind === typescript.SyntaxKind.TrueKeyword || kind === typescript.SyntaxKind.FalseKeyword) {
          const branch = walk(kind === typescript.SyntaxKind.TrueKeyword ? node.whenTrue : node.whenFalse, family, options, seen, steps + 1, nextDepth);
          return { ...branch, direct: undefined };
        }
      }
      const left = walk(node.whenTrue, family, options, seen, steps + 1, nextDepth);
      if (work && (work.exhausted || left.nodes.length >= initializer_limit)) return { ...left, direct: undefined, complete: false, conditional: true };
      const right = walk(node.whenFalse, family, options, seen, steps + 1, nextDepth);
      const nodes = [...left.nodes, ...right.nodes];
      const depths = (branch: Alternatives) => branch.branchDepths ?? branch.nodes.map(() => branch.depth ?? nextDepth);
      return { nodes: nodes.slice(0, initializer_limit), complete: complete && left.complete && right.complete && nodes.length <= initializer_limit,
        conditional: true, ...(work === undefined ? {} : { branchDepths: [...depths(left), ...depths(right)].slice(0, initializer_limit) }) };
    }
    return { nodes: [node], complete, conditional: false, direct: true, depth: inspected.depth };
  };
  const alternatives = (input: ts.Expression, family: Family, options: AlternativeOptions = {}): Alternatives => {
    const work = options.work ?? (family === "part-record" ? new PartOwnershipWork() : undefined);
    const result = walk(input, family, { ...options, work }, new Set(), 0, options.depth ?? 0);
    if (!work) return result;
    const node = result.nodes[0];
    if (result.complete && node && result.depth !== undefined &&
      (typescript.isObjectLiteralExpression(node) || typescript.isArrayLiteralExpression(node)) &&
      (options.recordContents === "member" || family === "part-record" && options.recordContents === undefined)) {
      const inspect = (entry: ts.Node, depth: number): boolean => !work.charge(1, depth)
        || typescript.forEachChild(entry, child => inspect(child, depth + 1)) === true;
      // The root expression was charged by the resolver.
      const depth = result.depth + 1;
      typescript.forEachChild(node, child => inspect(child, depth));
    }
    return work.exhausted ? { ...result, complete: false } : result;
  };
  // Event-facing declarations have one path: parentheses, at most eight
  // unannotated top-level const bindings, and one direct relative named import.
  // Inspect the module's own export before asking for immutable value identity.
  const declarationSource = (input: ts.Expression, terminalImport?: (site: ts.ImportSpecifier, symbol: ts.Symbol) => boolean,
    work?: PartOwnershipWork, depth = 0): ts.Expression | undefined => {
    const seen = new Set<ts.VariableDeclaration>();
    let node = input, imported = false;
    const checked = eligibility(work);
    while (work?.charge(1, depth++) !== false && checked(node)) {
      if (typescript.isParenthesizedExpression(node)) { node = node.expression; continue; }
      if (!typescript.isIdentifier(node)) return node;
      const symbol = source_value_symbol(typescript, checker, node);
      const site = selected_hson_value_declaration(typescript, checker, symbol, checked);
      if (!symbol || !site) return undefined;
      if (typescript.isImportSpecifier(site) && terminalImport?.(site, symbol)) return node;
      if (seen.size >= 8) return undefined;
      let expected: ts.Declaration = site;
      if (typescript.isImportSpecifier(site)) {
        const clause = site.parent.parent, statement = clause.parent;
        if (imported || site.isTypeOnly || clause.isTypeOnly || !typescript.isImportDeclaration(statement)
          || !typescript.isStringLiteral(statement.moduleSpecifier) || !/^\.{1,2}\//.test(statement.moduleSpecifier.text)) return undefined;
        const module = checker.getSymbolAtLocation(statement.moduleSpecifier);
        const member = module?.exports?.get(typescript.escapeLeadingUnderscores((site.propertyName ?? site.name).text));
        const exported = selected_hson_value_declaration(typescript, checker, member, checked);
        if (!exported || !typescript.isVariableDeclaration(exported)
          || module?.declarations?.length !== 1 || exported.getSourceFile() !== module.declarations[0]
          || !typescript.isVariableStatement(exported.parent.parent)
          || !exported.parent.parent.modifiers?.some(token => token.kind === typescript.SyntaxKind.ExportKeyword)) return undefined;
        expected = exported;
        imported = true;
      }
      const found = declaration(node, work);
      if (!found?.initializer || found !== expected || !is_event_const_declaration(typescript, found) || found.type || seen.has(found) || !checked(found)
        || found.getSourceFile().isDeclarationFile || program?.isSourceFileFromExternalLibrary(found.getSourceFile())) return undefined;
      const statement = found.parent.parent;
      if (!typescript.isVariableStatement(statement) || !typescript.isSourceFile(statement.parent)
        || statement.modifiers?.some(token => token.kind === typescript.SyntaxKind.DeclareKeyword)
        || found.getSourceFile() === node.getSourceFile() && found.end > node.getStart()) return undefined;
      seen.add(found);
      node = found.initializer;
    }
    return undefined;
  };
  const candidate = (node: ts.Expression, family: "certify" | "document" | "data" | "json", work?: PartOwnershipWork, depth = 0): StaticSourceCandidate | undefined => {
    if (work?.charge(1, depth) === false) return undefined;
    const checked = eligibility(work);
    if ((family === "json" || family === "certify") && typescript.isTaggedTemplateExpression(node)
      && typescript.isPropertyAccessExpression(node.tag) && node.tag.name.text === "parse" && officialData(node.tag.expression, work)
      && typescript.isNoSubstitutionTemplateLiteral(node.template) && !node.template.isUnterminated) {
      try {
        admit_hson_tagged_template(typescript, node, "data");
        // Exact parsing changes the runtime representation, not the authored
        // source coordinates used for Schema issues and collision evidence.
        return { node, source: node.template.getText(node.getSourceFile()).slice(1, -1), family: "data", bodyStart: node.template.getStart() + 1 };
      }
      catch { return undefined; }
    }
    if (typescript.isTaggedTemplateExpression(node) && typescript.isPropertyAccessExpression(node.tag)
      && typescript.isIdentifier(node.tag.expression) && is_official_hson_package_binding(node.tag.expression, "Hson", checker, true, typescript, checked)
      && ["document", "data", "canonical"].includes(node.tag.name.text)
      && typescript.isNoSubstitutionTemplateLiteral(node.template) && !node.template.isUnterminated) {
      if (family === "document") {
        const kind = node.tag.name.text;
        if (kind !== "document" && kind !== "canonical") return undefined;
        const tagged = hson_tagged_source(typescript, node, kind);
        if (tagged === undefined || "substitutionRanges" in tagged) return undefined;
        try {
          const source = admit_hson_tagged_source(tagged);
          const { hostText, bodyRange } = tagged;
          const bodyStart = bodyRange.start;
          return bodyRange.end - bodyStart === source.length ? { node, source, family: kind, bodyStart }
            : { node, source, family: kind, bodyStart, bodyOffsets: raw_hson_template_literal(hostText, bodyRange).boundaries };
        } catch { return undefined; }
      }
      if ((family === "json" || family === "certify")) {
        const raw = node.template.getText(node.getSourceFile()).slice(1, -1);
        const strings = Object.freeze(Object.assign([node.template.text], { raw: Object.freeze([raw]) }));
        try { return { node, json: node.tag.name.text === "canonical" ? Hson.canonical(strings) : node.tag.name.text === "data" ? Hson.data(strings) : Hson.document(strings) }; }
        catch { return undefined; }
      }
      return { node, source: node.template.getText(node.getSourceFile()).slice(1, -1), family: node.tag.name.text === "document" ? "document" : node.tag.name.text === "canonical" ? "canonical" : "data", bodyStart: node.template.getStart() + 1 };
    }
    if ((family === "document" || family === "data") && (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node))) {
      // Escaped JS strings have no direct raw-Hson correspondence; anchor on the expression.
      return { node, source: node.text, family, bodyStart: -1 };
    }
    if ((family === "json" || family === "certify") && typescript.isCallExpression(node) && node.arguments.length === 1
      && typescript.isPropertyAccessExpression(node.expression) && ["fromSource", "from", "parse"].includes(node.expression.name.text)
      && typescript.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "data"
      && typescript.isIdentifier(node.expression.expression.expression)
      && is_official_hson_package_binding(node.expression.expression.expression, "Hson", checker, true, typescript, checked)) {
      const inputs = alternatives(node.arguments[0]!, node.expression.name.text === "from" ? "json" : "data", { work, depth: depth + 1 });
      const only = inputs.complete && inputs.nodes.length === 1 ? inputs.nodes[0] : undefined;
      if (only === undefined) return undefined;
      if (node.expression.name.text === "from" && dataProducer(only, work)) {
        const known = candidate(only, "json", work, inputs.depth ?? depth + 1);
        return known === undefined ? undefined : { ...known, node };
      }
      if (node.expression.name.text === "parse") {
        const known = candidate(only, "data", work, inputs.depth ?? depth + 1);
        if (known === undefined || !("source" in known) || known.family === "document") return undefined;
        try { admit_canonical_hson_data_value(known.source); return known; }
        catch { return undefined; }
      }
      const value = json_literal(only, typescript, checked, undefined, undefined, work, inputs.depth ?? depth + 1);
      if (!value.known) return undefined;
      try {
        const data = node.expression.name.text === "fromSource"
          ? typeof value.value === "string" ? admit_data_source(value.value) : undefined
          : admit_projected_value(value.value);
        if (data === undefined) return undefined;
        assert_canonical_hson_data_value(data);
        return { node, data };
      } catch { return undefined; }
    }
    if (family === "json" || family === "certify") {
      const value = json_literal(node, typescript, checked, undefined, undefined, work, depth);
      return value.known ? { node, json: value.value } : undefined;
    }
    return undefined;
  };
  const candidates = (input: ts.Expression, family: "certify" | "document" | "data" | "json", work?: PartOwnershipWork, depth = 0): readonly StaticSourceCandidate[] | undefined => {
    const result = alternatives(input, family, { work, depth });
    if (!result.complete) return undefined;
    const found = result.nodes.map((node, index) => candidate(node, family, work, result.branchDepths?.[index] ?? result.depth ?? depth));
    if (work?.exhausted) return undefined;
    return found.some(node => node === undefined) ? undefined : found.filter(node => node !== undefined);
  };
  const officialEvent = (receiver: ts.Identifier, purpose: "collection" | "attachment", work?: PartOwnershipWork): boolean => {
    const file = receiver.getSourceFile();
    if (program === undefined || !is_hson_typescript_source_file(file.fileName) || program.isSourceFileFromExternalLibrary(file)) return false;
    return is_official_hson_event_binding(typescript, receiver, program, eligibility(work), purpose === "collection" ? "named" : "package");
  };
  const eventSource = (node: ts.Expression, purpose: "collection" | "attachment", work?: PartOwnershipWork) => {
    // Only the actual tagged producer must have an immediate syntax owner.
    // A proven import or immutable alias can still lead to a TypeScript producer.
    if (!typescript.isTaggedTemplateExpression(node) || !eligibility(work)(node)) return undefined;
    const tag = hson_authoring_tag(typescript, node);
    if (tag?.kind !== "event" || !officialEvent(tag.receiver, purpose, work)) return undefined;
    const source = hson_tagged_source(typescript, node, "event");
    return source === undefined || "substitutionRanges" in source ? undefined : source;
  };
  const partStyleLiteral = (input: ts.Expression, work: PartOwnershipWork, depth = 0, styleDepth = 0): Literal => {
    if (styleDepth > 64) return { known: false };
    const possible = alternatives(input, "part-record", { reachableOnly: true, work, depth, recordContents: "expression" });
    const only = possible.complete && !possible.conditional && possible.nodes.length === 1 ? possible.nodes[0] : undefined;
    if (only === undefined) return { known: false };
    if (is_source_undefined(typescript, checker, only)) return { known: true, value: undefined };
    return json_literal(only, typescript, eligibility(work), undefined,
      (node, childDepth) => partStyleLiteral(node, work, childDepth, styleDepth + 1), work, possible.depth ?? depth);
  };
  const ownFields = (node: ts.ObjectLiteralExpression, work: PartOwnershipWork, depth: number) =>
    library_source_fields(node, typescript, relative => work.charge(1, depth + relative));
  const libraryFields = (node: ts.ObjectLiteralExpression, work: PartOwnershipWork, depth: number) =>
    work.charge(1, depth) && eligibility(work)(node) && projectable_prototype(node, typescript, eligibility(work), work, depth)
      ? ownFields(node, work, depth) : undefined;
  const libraryInventory = (input: ts.Expression, family: "part-record" | "json") => {
    const work = new PartOwnershipWork();
    const possible = alternatives(input, family, { work, recordContents: "coordinate" });
    const [node] = possible.nodes;
    if (!possible.complete || possible.nodes.length !== 1 || node === undefined || !typescript.isObjectLiteralExpression(node)) {
      return { completeness: "unavailable" } as const;
    }
    // The outer batch uses own keys. An unfinished key scan cannot establish
    // even a previously read key: an unread property may replace it.
    const depth = possible.depth ?? 0;
    const fields = ownFields(node, work, depth);
    return fields === undefined ? { completeness: "partial" } as const : { completeness: "complete", fields, work, depth } as const;
  };
  return { declaration, declarationSource, unwrap, eligible, eligibility, inspectExpression, alternatives, candidates, eventSource, parseEvent, partStyleLiteral,
    libraryFields, libraryInventory,
    projectablePrototype: (node: ts.ObjectLiteralExpression, work?: PartOwnershipWork, depth = 0) =>
      projectable_prototype(node, typescript, eligibility(work), work, depth),
    jsonLiteral: (node: ts.Expression, authored?: (node: ts.Expression, depth: number) => string | undefined, work?: PartOwnershipWork, depth = 0) =>
      json_literal(node, typescript, eligibility(work), authored, undefined, work, depth) };
}

type Literal = Readonly<{ known: true; value: unknown }> | Readonly<{ known: false }>;
function projectable_prototype(node: ts.ObjectLiteralExpression, typescript: typeof ts, eligible: (node: ts.Node) => boolean,
  work?: PartOwnershipWork, depth = 0): boolean {
  for (const property of node.properties) {
    if (work?.charge(1, depth + 1) === false) return false;
    if (!typescript.isPropertyAssignment(property)) continue;
    if (work?.charge(1, depth + 2) === false) return false;
    if (!is_object_literal_prototype_setter(property, typescript)) continue;
    const prototype = json_literal(property.initializer, typescript, eligible, undefined, undefined, work, depth + 2);
    // Projected data rejects custom prototypes; an ignored primitive or null is safe.
    if (!prototype.known || prototype.value !== null && typeof prototype.value === "object") return false;
  }
  return true;
}
/** JSON syntax only: no property reads, spreads, functions or application execution. */
function json_literal(node: ts.Expression, typescript: typeof ts, eligible: (node: ts.Node) => boolean,
  authored?: (node: ts.Expression, depth: number) => string | undefined,
  child?: (node: ts.Expression, depth: number) => Literal, work?: PartOwnershipWork, depth = 0): Literal {
  if (work?.charge(1, depth) === false || !eligible(node)) return { known: false };
  const readChild = child ?? ((entry, next) => json_literal(entry, typescript, eligible, authored, undefined, work, next));
  if (authored !== undefined && (typescript.isTaggedTemplateExpression(node) || typescript.isIdentifier(node))) {
    const source = authored(node, depth);
    return source === undefined ? { known: false } : { known: true, value: source };
  }
  if (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node)) return { known: true, value: node.text };
  if (typescript.isNumericLiteral(node)) return { known: true, value: Number(node.text) };
  if (typescript.isPrefixUnaryExpression(node) && node.operator === typescript.SyntaxKind.MinusToken
    && work?.charge(1, depth + 1) !== false && typescript.isNumericLiteral(node.operand)) return { known: true, value: -Number(node.operand.text) };
  if (node.kind === typescript.SyntaxKind.TrueKeyword) return { known: true, value: true };
  if (node.kind === typescript.SyntaxKind.FalseKeyword) return { known: true, value: false };
  if (node.kind === typescript.SyntaxKind.NullKeyword) return { known: true, value: null };
  if (typescript.isArrayLiteralExpression(node)) {
    const value = [];
    for (const element of node.elements) {
      const entry = readChild(element, depth + 1);
      if (!entry.known) return { known: false };
      value.push(entry.value);
    }
    return { known: true, value };
  }
  if (typescript.isObjectLiteralExpression(node)) {
    if (!projectable_prototype(node, typescript, eligible, work, depth)) return { known: false };
    const fields = library_source_fields(node, typescript, work && (relative => work.charge(1, depth + relative)));
    if (fields === undefined) return { known: false };
    const value: Record<string, unknown> = Object.create(null);
    for (const [key, input] of fields) {
      const entry = readChild(input, depth + 2);
      if (!entry.known) return { known: false };
      value[key] = entry.value;
    }
    return { known: true, value };
  }
  return { known: false };
}
