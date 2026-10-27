import { assert_hson_identifier_name } from "../../core/hson-name.js";
import { analyze_part_definition, transform_part_parameter_strings, type PartDefinitionAnalysis } from "../../internal/part-definition.js";
import { qualify_hson_document_root } from "../document/hson-document.js";
import { PART_DECLARATION, PART_OPTIONAL, is_part_iterator_attribute, part_reference_text, part_structural_reference, type PartArgumentKind, is_part_argument_attribute, part_argument_name, part_placeholder_matches, whole_part_reference, type PartReference } from "../../internal/part-placeholder.js";
import { ELEM_TAG, ROOT_TAG, STR_TAG } from "../../core/constants.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { decode_public_attrs, is_public_attr_name } from "../../core/public-attrs.js";
import { plan_public_attr_set } from "../../core/public-attr-transitions.js";
import type { HsonNode, NodeContent, Primitive } from "../../core/types.js";
import { ANY_DOCUMENT, HsonSchema } from "../schema/hson-schema.js";
import { materialize_owned_occurrences } from "../livetree/runtime/materialize-occurrences.js";
import { clone_hson_graph_without_quids } from "./livemap.document.capture.js";
import { is_document_quad_name, type DocumentQuadAdmission, parse_authored_document_library } from "./livemap.document.quad.js";
import { lower_internal_document_content_remove } from "./livemap.document.logical.js";
import { resolve_document_path, validate_document_path } from "./livemap.document.path.js";
import type { PortableDocumentQuads, LiveMapGraphOp } from "../../types/livemap.types.js";
import type { HsonData } from "../transform/transform.types.js";
import { admit_canonical_hson_data_value } from "../data/hson-data-hson.js";
import { is_ordered_projected_object, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { ordered_projected_value_at } from "../../core/ordered-projected-value-mutation.js";
import { admit_hson_data_input } from "../data/hson-data.js";
import { document_css_subject_identities, omit_part_css_subjects } from "../../internal/css/css-identity-translation.js";
import { scope_part_stylesheet } from "../../internal/css/part-stylesheet.js";
import { DOCUMENT_SCOPED_QUAD_LIMITS, type DocumentScopedQuadRecord, type ScopedQuadBindingRecord, type ScopedQuadOccurrenceRecord } from "./livemap.document.scoped-quad-codec.js";
import type { DocumentCssRecord } from "../../types/document-css.types.js";

/** Private construction bounds; callers may lower, but cannot disable, the caps. @internal */
export type DocumentCompositionOptions = Readonly<{
  schema?: HsonSchema;
  /** Native HsonData or a private own-data record: attrs?: string record, text?: string,
   * use?: { at: string, lib?: string }, at?: QUAD-to-configuration record,
   * q?: explicit receiving QUAD name (private spelling).
   * use applies only to connectors; omitted lib retains the selected collection.
   */
  configuration?: HsonData | Readonly<Record<string, unknown>>;
  maxDepth?: number;
  maxNodes?: number;
  maxCharacters?: number;
}>;

const DEFAULT_LIMITS = Object.freeze({ maxDepth: 128, maxNodes: 100_000, maxCharacters: 4_000_000 });

/** Stable configuration selected before entering the coherent source read. @internal */
export function document_composition_options(input: DocumentCompositionOptions | undefined): Readonly<{
  configuration?: Configuration;
  schema: HsonSchema; maxDepth: number; maxNodes: number; maxCharacters: number;
}> {
  const values: Record<string, unknown> = Object.create(null);
  if (input !== undefined) {
    if (typeof input !== "object" || input === null || Array.isArray(input)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
      throw new TypeError("Document composition options must be a data record.");
    }
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string" || !["schema", "configuration", "maxDepth", "maxNodes", "maxCharacters"].includes(key)) {
        throw new TypeError("Unknown document composition option.");
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError("Document composition options require enumerable data fields.");
      }
      values[key] = descriptor.value;
    }
  }
  const limit = (key: keyof typeof DEFAULT_LIMITS): number => {
    const value = values[key] === undefined ? DEFAULT_LIMITS[key] : values[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key]) {
      throw new TypeError(`Document composition ${key} must be a positive integer no greater than ${DEFAULT_LIMITS[key]}.`);
    }
    return value;
  };
  const schema = values.schema === undefined ? ANY_DOCUMENT : values.schema;
  if (!(schema instanceof HsonSchema)) throw new TypeError("Document composition requires a HsonSchema.");
  // The static HsonData brand is erased. Strings must pass the established
  // strict data-only receiver; JS records retain their descriptor-only checks.
  // The caller's capture fence already encloses this admission and projection.
  const configuration = Object.hasOwn(values, "configuration") ? normalize_configuration(
    typeof values.configuration === "string" ? admit_hson_data_input(values.configuration).materialize() : values.configuration,
  ) : undefined;
  return Object.freeze({ configuration, schema, maxDepth: limit("maxDepth"), maxNodes: limit("maxNodes"), maxCharacters: limit("maxCharacters") });
}

/** Detached private data contract; never retained by the receiving Library. */
type Configuration = Readonly<{
  attrs: readonly (readonly [string, string])[];
  text?: string;
  q?: string;
  use?: Readonly<{ lib?: string; at: string }>;
  at: readonly (readonly [string, Configuration])[];
}>;

/**
 * Inspect descriptors, never property values/getters. Shared records are allowed;
 * cycles are not. Normalization has fixed caps as well as traversal output bounds.
 * Null-prototype detached records keep absent fields absent, including under
 * prototype pollution, while preserving JSON-compatible values.
 */
function normalize_configuration(input: unknown): Configuration {
  const active = new Set<object>();
  let fields = 0, characters = 0;
  const record = (value: unknown): Map<string, unknown> => {
    if (typeof value !== "object" || value === null || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      throw new TypeError("Composition configuration requires plain data records.");
    }
    const result = new Map<string, unknown>();
    for (const key of Reflect.ownKeys(value)) {
      const field = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== "string" || !field?.enumerable || !Object.hasOwn(field, "value")) {
        throw new TypeError("Composition configuration requires own enumerable data fields.");
      }
      characters += key.length + (typeof field.value === "string" ? field.value.length : 0);
      if (++fields > DEFAULT_LIMITS.maxNodes || characters > DEFAULT_LIMITS.maxCharacters) {
        throw new Error("Composition configuration resource limit exceeded.");
      }
      result.set(key, field.value);
    }
    return result;
  };
  const visit = (value: unknown, depth: number): Configuration => {
    if (depth > DEFAULT_LIMITS.maxDepth) throw new Error("Composition configuration depth limit exceeded.");
    const data = record(value);
    if (typeof value !== "object" || value === null) throw new TypeError("Invalid configuration.");
    if (active.has(value)) throw new TypeError("Cyclic composition configuration.");
    active.add(value);
    for (const key of data.keys()) if (!["attrs", "text", "use", "at", "q"].includes(key)) {
      throw new TypeError(`Unknown composition configuration field ${JSON.stringify(key)}.`);
    }
    const attrs: (readonly [string, string])[] = [];
    if (data.has("attrs")) for (const [name, attribute] of record(data.get("attrs"))) {
      if (!is_public_attr_name(name) || typeof attribute !== "string") {
        throw new TypeError("Composition configuration attributes require ordinary public string values.");
      }
      attrs.push(Object.freeze([name, attribute]));
    }
    const text = data.get("text");
    if (data.has("text") && typeof text !== "string") throw new TypeError("Composition configuration text requires a string.");
    const receiving = data.get("q");
    if (data.has("q") && !is_document_quad_name(receiving)) {
      throw new TypeError("Composition configuration q requires an explicit authored QUAD string.");
    }
    let use: Configuration["use"];
    if (data.has("use")) {
      const reference = record(data.get("use")), lib = reference.get("lib"), member = reference.get("at");
      if ([...reference.keys()].some(key => key !== "lib" && key !== "at") || typeof member !== "string"
        || (reference.has("lib") && (typeof lib !== "string" || lib.length === 0))) {
        throw new TypeError("Composition configuration use requires a Part member at and optional nonempty lib.");
      }
      use = Object.freeze(Object.assign(Object.create(null), {
        at: member, ...(typeof lib === "string" ? { lib } : {}),
      }));
    }
    const at: (readonly [string, Configuration])[] = [];
    if (data.has("at")) for (const [name, child] of record(data.get("at"))) {
      if (!is_document_quad_name(name)) throw new TypeError("Composition configuration at requires authored QUAD names.");
      at.push(Object.freeze([name, visit(child, depth + 1)]));
    }
    active.delete(value);
    const result: Configuration = Object.assign(Object.create(null), {
      attrs: Object.freeze(attrs), at: Object.freeze(at),
      ...(use === undefined ? {} : { use }), ...(typeof text === "string" ? { text } : {}),
      ...(typeof receiving === "string" ? { q: receiving } : {}),
    });
    return Object.freeze(result);
  };
  return visit(input, 1);
}

type ConfiguredTarget = Readonly<{ configuration: Configuration; path: readonly number[] }>;
// Pending targets belong to one expansion occurrence. Graph frames share these maps
// only within that occurrence; nested connectors start fresh maps. Frame completion
// proves every requested target was actually visited without a second graph walk.
type ConfigurationScope = Map<HsonNode, ConfiguredTarget>;
/** Detached shell or validated Part coordinates; never a source identity overlay. @internal */
export type DocumentCompositionSource = Readonly<{ root: HsonNode; quads?: PortableDocumentQuads; css?: DocumentCssRecord }>;
/** Detached occurrence coordinates, consumed only by ordinary destination preparation. @internal */
export type DocumentCompositionStyle = Readonly<{
  css: DocumentCssRecord;
  subjects: readonly Readonly<{ name: string; path: readonly number[] }>[];
}>;
type Landmark = Readonly<{ node: HsonNode; path: readonly number[] }>;
type PartBinding = Readonly<{ kind: "scalar"; value: Primitive }>
  | Readonly<{ kind: "data"; value: OrderedProjectedValue | undefined }>
  | Readonly<{ kind: "doc"; value: string; document: DocumentCompositionSource }>;
type PartLocalNames = Map<HsonNode, readonly string[]>;
type PartConnectorInspection = boolean | "literal";
type PartEnvironment = {
  readonly bindings: Map<string, PartBinding>;
  locals: ReadonlyMap<string, PartBinding>;
  nodeLocals?: ReadonlyMap<HsonNode, ReadonlyMap<string, PartBinding>>;
  names?: PartLocalNames;
  iterations?: ReadonlyMap<HsonNode, PartLocalNames>;
  readonly context: string;
  omitted?: (node: HsonNode) => boolean;
  authoredArguments?: ReadonlyMap<HsonNode, readonly string[]>;
  structures?: ReadonlyMap<HsonNode, Extract<PartBinding, { kind: "doc" }>>;
};
type Occurrence = Readonly<{
  parameters?: PartEnvironment;
  evidence: { root: readonly number[] | null; bindings: ScopedQuadBindingRecord[]; byName: Map<string, ScopedQuadBindingRecord> };
  localNames: ReadonlyMap<HsonNode, readonly string[]>;
  landmarks: ReadonlyMap<string, Landmark>;
  shellNames: ReadonlyMap<HsonNode, string>;
  collection?: string;
  scopes: readonly ConfigurationScope[];
  style?: { css: DocumentCssRecord; demanded: ReadonlyMap<HsonNode, string>; subjects: Map<string, readonly number[]>; absent: Set<string> };
}>;
type Selection = Readonly<{ collection: string; member: string }>;
type RootCustomization = Readonly<{ attrs: readonly (readonly [string, string])[]; text?: string }>;
type Frame = {
  source: readonly (HsonNode | Primitive)[];
  output: NodeContent;
  outputPath: readonly number[];
  index: number;
  receiving?: Readonly<{ names: readonly string[]; start: number }>;
  selection?: Selection;
  customization?: RootCustomization;
  occurrence: Occurrence;
  scope?: ConfigurationScope;
  owner: HsonNode;
  emptyClusterParent?: HsonNode;
  structural?: Readonly<{ parent: Occurrence; names: readonly string[]; start: number }>;
  rootAlias?: string;
  iterationRoot?: HsonNode;
  selectionConfiguration?: Configuration;
  styledConnector?: Readonly<{ name: string; style: NonNullable<Occurrence["style"]>; start: number }>;
};

/** Exact immediate logical string shape; undefined includes absence, never an empty string. */
function sole_immediate_string(node: HsonNode): string | undefined {
  if (node.$_content.length !== 1) return undefined;
  const relationship = node.$_content[0];
  if (!is_Node(relationship) || relationship.$_tag !== ELEM_TAG || relationship.$_content.length !== 1) return undefined;
  const leaf = relationship.$_content[0];
  if (!is_Node(leaf) || leaf.$_tag !== STR_TAG || leaf.$_content.length !== 1) return undefined;
  const value = leaf.$_content[0];
  return typeof value === "string" ? value : undefined;
}

/**
 * Expand already owned document roots into private occurrences. The receiver
 * supplies callback-free, identity-fenced source reads and performs final admission.
 * No subscriptions, source identities, or composition provenance are retained.
 * @internal
 */
export function expand_document_composition(
  sourceName: string,
  readShell: (name: string) => DocumentCompositionSource,
  limits: Readonly<{ maxDepth: number; maxNodes: number; maxCharacters: number; configuration?: Configuration }>,
  readPart: (collection: string, member: string) => DocumentCompositionSource,
): Readonly<{ root: HsonNode; quads?: PortableDocumentQuads; styles: readonly DocumentCompositionStyle[]; scoped: DocumentScopedQuadRecord; identityDemands: readonly (readonly number[])[] }> {
  const sources = new Map<string, Map<string, DocumentCompositionSource>>();
  const part = (collection: string, member: string): DocumentCompositionSource => {
    assert_hson_identifier_name(collection, "Library");
    assert_hson_identifier_name(member, "Part");
    const members = sources.get(collection) ?? new Map<string, DocumentCompositionSource>();
    let selected = members.get(member);
    if (selected === undefined) {
      selected = readPart(collection, member);
      if (selected.root.$_tag !== ROOT_TAG || selected.root.$_content.length !== 1
        || !is_ordinary_element_node(selected.root.$_content[0])
        || selected.root.$_content[0].$_tag.toLowerCase() === "hson-part") {
        throw new TypeError("Composition Part requires exactly one ordinary element root.");
      }
      members.set(member, selected);
      sources.set(collection, members);
    }
    return selected;
  };
  const preparedDocuments = new WeakMap<HsonNode, Map<string, DocumentCompositionSource>>();
  const documentInput = (node: HsonNode, name: string, value: string): DocumentCompositionSource => {
    const fields = preparedDocuments.get(node) ?? new Map<string, DocumentCompositionSource>();
    const existing = fields.get(name);
    if (existing !== undefined) return existing;
    const admitted = admitDocument(value); fields.set(name, admitted); preparedDocuments.set(node, fields); return admitted;
  };
  const analyses = new Map<HsonNode, PartDefinitionAnalysis>();
  const analysis = (definition: DocumentCompositionSource): PartDefinitionAnalysis => {
    let result = analyses.get(definition.root);
    if (result === undefined) { result = analyze_part_definition(definition.root); analyses.set(definition.root, result); }
    return result;
  };
  const validateArguments = (definition: DocumentCompositionSource, supplied: readonly string[]): void => {
    const parameters = analysis(definition).parameters;
    for (const raw of supplied) {
      const argument = part_argument_name(raw);
      if (argument === undefined) throw new TypeError(`Invalid hson-part parameter ${JSON.stringify(raw)}.`);
      const { name, kind } = argument;
      if (!parameters.has(name)) throw new TypeError(`Unknown Part parameter ${JSON.stringify(name)}.`);
      if (parameters.get(name) !== kind) throw new TypeError(`Part parameter ${JSON.stringify(name)} does not match the receiving interface.`);
    }
  };
  const validateConnector = (node: HsonNode, collection: unknown, environment: PartEnvironment, inspectInterface: PartConnectorInspection): void => {
    if (part_structural_reference(node) !== undefined) return;
    if (node.$_content.length) throw new TypeError("hson-part connectors must be empty; inputs are named argument attributes.");
    const attrs = node.$_attrs ?? {};
    const supplied = new Map<string, PartArgumentKind>();
    for (const [raw, value] of Object.entries(attrs)) {
      if (!is_part_argument_attribute(raw)) continue;
      const argument = part_argument_name(raw);
      if (argument === undefined) throw new TypeError(`Invalid hson-part parameter ${JSON.stringify(raw)}.`);
      if (supplied.has(argument.name)) throw new TypeError(`Conflicting Part parameter ${JSON.stringify(argument.name)}.`);
      supplied.set(argument.name, argument.kind);
      if (argument.kind !== "scalar") {
        if (typeof value !== "string") throw new TypeError("Typed Part parameters require serialized strings.");
        if (whole_part_reference(value) === undefined) {
          try { if (argument.kind === "data") admit_canonical_hson_data_value(value); else documentInput(node, raw, value); }
          catch (cause) { throw new TypeError(`Invalid Part ${argument.kind} parameter ${JSON.stringify(argument.name)}.`, { cause }); }
        }
      } else if (!parameter_scalar(value)) throw new TypeError("Part parameters require scalar values.");
    }
    if (!inspectInterface) return;
    if (inspectInterface === "literal" && [attrs.lib ?? collection, attrs.at].some(value =>
      typeof value === "string" && (part_placeholder_matches(value)?.length ?? 0) > 0)) return;
    // Coordinates are normally literal; their established scalar substitution remains available.
    const coordinate = (value: unknown): unknown => {
      if (typeof value !== "string") return value;
      const refs = part_placeholder_matches(value);
      if (refs === undefined) throw new TypeError("Invalid Part placeholder.");
      let output = "", at = 0;
      for (const reference of refs) {
        const binding = resolve_part_reference(reference, environment);
        if (!parameter_scalar(binding.value)) throw new TypeError("Part coordinates require scalar values.");
        output += value.slice(at, reference.start) + String(binding.value); at = reference.end;
      }
      return output + value.slice(at);
    };
    const lib = coordinate(attrs.lib ?? collection), member = coordinate(attrs.at);
    if (typeof lib !== "string" || !lib || typeof member !== "string") throw new TypeError("hson-part requires exact collection and member coordinates.");
    const definition = part(lib, member);
    validateArguments(definition, Object.keys(attrs).filter(is_part_argument_attribute));
  };
  const admitDocument = (source: string): DocumentCompositionSource => {
    charge(source);
    const authored = parse_authored_document_library(source);
    const root = qualify_hson_document_root(authored.root);
    if (root.$_content.length !== 1 || !is_ordinary_element_node(root.$_content[0])) throw new TypeError("Part Document input requires exactly one authored element or declarative invocation.");
    return { root, quads: authored.declarations };
  };
  let nodes = 1; // Receiving ROOT; visited connectors also consume work, even when they insert nothing.
  let characters = 0, preparedNodes = 0, preparedCharacters = 0;
  const preparation = {
    node(depth: number): void {
      if (depth > limits.maxDepth) throw new Error("Document composition depth limit exceeded.");
      if (++preparedNodes > limits.maxNodes) throw new Error("Document composition node limit exceeded.");
    },
    text(length: number): void {
      preparedCharacters += length;
      if (preparedCharacters > limits.maxCharacters) throw new Error("Document composition character limit exceeded.");
    },
  };
  const charge = (text: string): void => {
    characters += text.length;
    if (characters > limits.maxCharacters) throw new Error("Document composition character limit exceeded.");
  };
  const chargeHeader = (header: HsonNode): void => {
    charge(header.$_tag);
    const jobs: { value: unknown; depth: number }[] = [
      { value: header.$_attrs, depth: 1 }, { value: header.$_meta, depth: 1 },
    ];
    while (jobs.length) {
      const job = jobs.pop()!;
      if (typeof job.value === "string") { charge(job.value); continue; }
      if (job.value === null || typeof job.value !== "object") continue;
      if (job.depth > limits.maxDepth) throw new Error("Document composition depth limit exceeded.");
      for (const [key, value] of Object.entries(job.value)) {
        charge(key);
        jobs.push({ value, depth: job.depth + 1 });
      }
    }
  };
  const root: HsonNode = { $_tag: ROOT_TAG, $_content: [] };
  const associations: DocumentQuadAdmission[] = [];
  const occurrences: ScopedQuadOccurrenceRecord[] = [];
  const names = new Map<string, string>(), subjects = new Map<string, string>();
  const receive = (name: string, content: NodeContent, start: number, outputPath: readonly number[]): void => {
    if (content.length !== start + 1 || !is_ordinary_element_node(content[start])
      || content[start].$_tag.toLowerCase() === "hson-part") {
      throw new TypeError("Composition receiving QUAD requires exactly one ordinary resulting element.");
    }
    const path = validate_document_path([...outputPath, start]), key = JSON.stringify(path);
    if ((names.has(name) && names.get(name) !== key) || (subjects.has(key) && subjects.get(key) !== name)) {
      throw new TypeError("Composition receiving QUADs require one name per subject and one subject per name.");
    }
    if (!names.has(name)) associations.push(Object.freeze({ name, path }));
    names.set(name, key); subjects.set(key, name);
  };
  chargeHeader(root);
  const active = new Map<string, Set<string>>();
  // Preorder selection is the actual expansion order, independent of completion order.
  const styles: NonNullable<Occurrence["style"]>[] = [];
  let bindingCount = 0, pathSegments = 0;
  const scopedPath = (coordinate: readonly number[]) => {
    if (coordinate.length > DOCUMENT_SCOPED_QUAD_LIMITS.pathDepth
      || (pathSegments += coordinate.length) > DOCUMENT_SCOPED_QUAD_LIMITS.pathSegments) throw new Error("Document composition scoped path limit exceeded.");
    return validate_document_path(coordinate);
  };
  const label = (selection: Selection): string => JSON.stringify([selection.collection, selection.member]);
  const occurrence = (source: DocumentCompositionSource, collection?: string, coordinate: readonly number[] | null = null, parent: readonly number[] | null = null, preparedNames?: PartLocalNames): Occurrence => {
    const evidence: Occurrence["evidence"] = { root: coordinate, bindings: [], byName: new Map() };
    if (coordinate !== null && occurrences.length >= DOCUMENT_SCOPED_QUAD_LIMITS.occurrences) throw new Error("Document composition occurrence limit exceeded.");
    if (coordinate !== null) occurrences.push({ root: scopedPath(coordinate), parent: parent === null ? null : scopedPath(parent), bindings: evidence.bindings });
    const localNames = new Map<HsonNode, string[]>();
    const landmarks = new Map<string, Landmark>(), shellNames = new Map<HsonNode, string>();
    const landmarksAt: { node: HsonNode; name: string; path: readonly number[] }[] = [];
    if (preparedNames === undefined) {
      for (const quad of source.quads ?? []) {
        const node = resolve_document_path(source.root, "document", quad.path);
        if (!is_ordinary_element_node(node)) throw new Error("Invalid composition landmark.");
        landmarksAt.push({ node, name: quad.name, path: quad.path });
      }
    } else {
      const pending: { node: HsonNode; path: readonly number[] }[] = [{ node: source.root, path: [] }];
      while (pending.length) {
        const { node, path } = pending.pop()!;
        for (const name of preparedNames.get(node) ?? []) landmarksAt.push({ node, name, path });
        for (let index = node.$_content.length - 1; index >= 0; index--) {
          const child = node.$_content[index];
          if (is_Node(child)) pending.push({ node: child, path: [...path, index] });
        }
      }
    }
    for (const { node, name, path } of landmarksAt) {
      if (landmarks.has(name)) throw new Error("Invalid composition landmark.");
      landmarks.set(name, { node, path });
      localNames.set(node, [...(localNames.get(node) ?? []), name]);
      if (coordinate === null) shellNames.set(node, name);
    }
    let style: Occurrence["style"];
    if (coordinate !== null && source.css !== undefined) {
      charge(JSON.stringify(source.css));
      for (const name of document_css_subject_identities(source.css, "inbound")) {
        if (!landmarks.has(name)) throw new TypeError(`Enclosing exact-QUAD CSS cannot target an iterated subtree: ${JSON.stringify(name)}.`);
      }
      const demanded = new Map<HsonNode, string>();
      const rootElement = source.root.$_content[0];
      if (!is_ordinary_element_node(rootElement)) throw new Error("Part CSS requires one ordinary root.");
      let rootName = [...landmarks].find(([, landmark]) => landmark.node === rootElement)?.[0];
      if (rootName === undefined) {
        rootName = "part_root";
        while (landmarks.has(rootName)) rootName += "_";
        landmarks.set(rootName, { node: rootElement, path: [0] });
      }
      const css = scope_part_stylesheet(source.css, rootName);
      for (const name of document_css_subject_identities(css, "inbound")) {
        const landmark = landmarks.get(name);
        if (landmark === undefined) throw new Error(`Part CSS subject ${JSON.stringify(name)} requires an exact Part-local authored QUAD; enclosing exact-QUAD CSS cannot target an iterated subtree.`);
        demanded.set(landmark.node, name);
      }
      style = { css, demanded, subjects: new Map(), absent: new Set() };
      styles.push(style);
    }
    return { evidence, localNames, landmarks, shellNames, ...(collection === undefined ? {} : { collection }), scopes: [], ...(style === undefined ? {} : { style }) };
  };
  const bind = (occurrence: Occurrence, name: string, kind: "element" | "part", coordinate: readonly number[]): void => {
    const path = validate_document_path(coordinate);
    const previous = occurrence.evidence.byName.get(name);
    // Repeating the same configuration selection is idempotent. Distinct
    // declarations were rejected while building this occurrence's landmarks.
    if (previous !== undefined) {
      if (previous.kind === kind && JSON.stringify(previous.path) === JSON.stringify(path)) return;
      // Preserve conflicting evidence for private candidate admission. The
      // shared composer must not change committed receiving-name semantics.
    }
    if (++bindingCount > DOCUMENT_SCOPED_QUAD_LIMITS.bindings) throw new Error("Document composition binding limit exceeded.");
    scopedPath(path);
    const binding = Object.freeze({ name, kind, path });
    occurrence.evidence.bindings.push(binding);
    occurrence.evidence.byName.set(name, binding);
  };
  const scope = (occurrence: Occurrence, path: readonly number[], configuration?: Configuration): ConfigurationScope => {
    const targets: ConfigurationScope = new Map();
    for (const [quad, child] of configuration?.at ?? []) {
      const target = occurrence.landmarks.get(quad);
      if (target === undefined) throw new Error(`Unknown composition QUAD ${JSON.stringify(quad)} in this occurrence.`);
      if (path.length > target.path.length || path.some((part, index) => part !== target.path[index])) {
        throw new Error(`Composition configuration QUAD ${JSON.stringify(quad)} is outside the selected subtree.`);
      }
      if (targets.has(target.node)) throw new Error("Ambiguous composition configuration target.");
      targets.set(target.node, { configuration: child, path: target.path });
    }
    return targets;
  };
  const shell = readShell(sourceName), initialRoot = shell.root;
  if (initialRoot.$_tag !== ROOT_TAG) throw new TypeError("Composition shell requires an owned document ROOT.");
  const initial = occurrence(shell);
  if (limits.configuration?.use !== undefined) throw new TypeError("Composition configuration use requires a connector.");
  const initialScope = scope(initial, [], limits.configuration);
  const hasOverrides = (configuration?: RootCustomization): boolean => configuration !== undefined
    && (configuration.attrs.length !== 0 || configuration.text !== undefined);
  const singleRoot = (content: readonly (HsonNode | Primitive)[], configuration?: RootCustomization): void => {
    if (hasOverrides(configuration) && (content.length !== 1 || !is_ordinary_element_node(content[0]))) {
      throw new TypeError("Composition configuration overrides require one ordinary component root.");
    }
  };
  singleRoot(initialRoot.$_content, limits.configuration);
  const frames: Frame[] = [{ source: initialRoot.$_content, output: root.$_content, outputPath: [], index: 0,
    ...(limits.configuration?.q === undefined ? {} : { receiving: { names: [limits.configuration.q], start: 0 } }),
    owner: root, scope: initialScope,
    occurrence: { ...initial, scopes: [initialScope] },
    customization: limits.configuration,
  }];
  const push = (frame: Frame): void => {
    // Bound both recursive references and canonical graph nesting before later qualification/copying.
    if (frames.length >= limits.maxDepth) throw new Error("Document composition depth limit exceeded.");
    frames.push(frame);
  };
  const chargeOmitted = (root: HsonNode, alreadyCounted = false): void => {
    const pending = [{ node: root, depth: frames.length }];
    while (pending.length) {
      const { node, depth } = pending.pop()!;
      if (depth > limits.maxDepth) throw new Error("Document composition depth limit exceeded.");
      if (node !== root || !alreadyCounted) if (++nodes > limits.maxNodes) throw new Error("Document composition node limit exceeded.");
      chargeHeader(node);
      for (const child of node.$_content) {
        if (is_Node(child)) pending.push({ node: child, depth: depth + 1 });
        else if (typeof child === "string") charge(child);
      }
    }
  };
  while (frames.length) {
    const frame = frames[frames.length - 1]!;
    if (frame.index === frame.source.length) {
      if (frame.scope?.size) throw new Error("Composition configuration has inaccessible QUAD targets.");
      const structuralZero = frame.structural !== undefined && frame.output.length === frame.structural.start;
      if (frame.structural !== undefined) {
        if (frame.output.length > frame.structural.start + 1) throw new TypeError("Structural Part must realize zero or one element.");
        if (!structuralZero) for (const name of frame.structural.names) bind(frame.structural.parent, name, "part", [...frame.outputPath, frame.structural.start]);
      }
      if (structuralZero && frame.receiving !== undefined) throw new TypeError("Composition receiving QUAD requires exactly one ordinary resulting element.");
      if (frame.receiving !== undefined) for (const name of frame.receiving.names) {
        receive(name, frame.output, frame.receiving.start, frame.outputPath);
      }
      if (frame.styledConnector !== undefined) {
        const { name, style, start } = frame.styledConnector;
        if (structuralZero) style.absent.add(name);
        else if (frame.output.length !== start + 1 || !is_ordinary_element_node(frame.output[start])) {
          throw new Error("Part CSS connector subject requires one ordinary resulting element.");
        }
        if (!structuralZero) style.subjects.set(name, validate_document_path([...frame.outputPath, start]));
      }
      frames.pop();
      if (frame.selection !== undefined) {
        const selections = active.get(frame.selection.collection)!;
        selections.delete(frame.selection.member);
        if (selections.size === 0) active.delete(frame.selection.collection);
      }
      // Canonical empty elements have no ELEM carrier, including after an empty insertion.
      if (frame.emptyClusterParent !== undefined && frame.output.length === 0) frame.emptyClusterParent.$_content = [];
      continue;
    }
    const item = frame.source[frame.index++];
    if (!is_Node(item)) {
      if (typeof item === "string") charge(item);
      frame.output.push(item);
      continue;
    }
    const environment = frame.occurrence.parameters;
    if (environment?.omitted?.(item)) { chargeOmitted(item); continue; }
    const iterationNames = environment?.iterations?.get(item);
    // An iterated invocation is a lexical transit frame: the selected Part owns
    // its resulting root. Only an ordinary repeated element adds a rooted scope.
    if (iterationNames !== undefined && frame.iterationRoot !== item && item.$_tag.toLowerCase() !== "hson-part") {
      const coordinate = [...frame.outputPath, frame.output.length];
      const child = occurrence({ root: { $_tag: ROOT_TAG, $_content: [item] } }, frame.occurrence.collection,
        coordinate, frame.occurrence.evidence.root, iterationNames);
      push({ source: [item], output: frame.output, outputPath: frame.outputPath, index: 0, owner: frame.owner,
        occurrence: { ...child, parameters: environment }, iterationRoot: item });
      continue;
    }
    if (++nodes > limits.maxNodes) throw new Error("Document composition node limit exceeded.");
    if (Object.keys(item.$_attrs ?? {}).some(is_part_iterator_attribute)) throw new TypeError("Part iteration is only allowed within a governed Part definition.");
    if (Object.hasOwn(item.$_attrs ?? {}, PART_DECLARATION)) throw new TypeError("hson:part is only allowed on a governed Part definition root.");
    if (Object.hasOwn(item.$_attrs ?? {}, PART_OPTIONAL)) throw new TypeError("part:optional is only allowed within a governed Part definition.");
    let configuration: Configuration | undefined;
    let configuredPath: readonly number[] | undefined;
    for (const current of frame.occurrence.scopes) {
      const target = current.get(item);
      if (target === undefined) continue;
      if (configuration !== undefined || configuredPath !== undefined) throw new Error("Ambiguous composition configuration target.");
      configuration = target.configuration;
      configuredPath = target.path;
      current.delete(item);
    }
    const customization: RootCustomization = {
      attrs: [...(frame.customization?.attrs ?? []), ...(configuration?.attrs ?? [])],
      text: configuration?.text ?? frame.customization?.text,
    };
    const shellName = frame.occurrence.shellNames.get(item);
    const style = frame.occurrence.style, styledName = style?.demanded.get(item);
    const receiving = [...(shellName === undefined ? [] : [shellName]), ...(configuration?.q === undefined ? [] : [configuration.q])];
    if (item.$_tag.toLowerCase() === "hson-part") {
      const attrs = item.$_attrs ?? {};
      const structural = part_structural_reference(item);
      if (structural !== undefined) {
        if (configuration?.use !== undefined) throw new TypeError("Structural Part does not support selection overrides.");
        const binding = frame.occurrence.parameters?.structures?.get(item);
        if (binding === undefined) throw new TypeError("Structural Part reference requires a declared Document binding.");
        charge(binding.value);
        const supplied = binding.document;
        const suppliedRoot = supplied.root.$_content[0];
        if (!is_ordinary_element_node(suppliedRoot)) throw new TypeError("Invalid structural Document root.");
        const coordinate = [...frame.outputPath, frame.output.length];
        const invocation = suppliedRoot.$_tag.toLowerCase() === "hson-part";
        const child = invocation ? occurrence({ root: supplied.root }) : occurrence(supplied, undefined, coordinate, frame.occurrence.evidence.root);
        const childScope = invocation ? undefined : scope(child, [], configuration);
        push({ source: supplied.root.$_content, output: frame.output, outputPath: frame.outputPath, index: 0, owner: frame.owner,
          ...(invocation ? { selectionConfiguration: configuration } : { scope: childScope }),
          occurrence: { ...child, scopes: childScope === undefined ? [] : [childScope], evidence: invocation ? { ...child.evidence, root: frame.occurrence.evidence.root } : child.evidence },
          customization, structural: { parent: frame.occurrence, names: frame.occurrence.localNames.get(item) ?? [], start: frame.output.length },
          ...(invocation && supplied.quads?.[0] !== undefined ? { rootAlias: supplied.quads[0].name } : {}),
          ...(style === undefined || styledName === undefined ? {} : { styledConnector: { style, name: styledName, start: frame.output.length } }),
          ...(receiving.length ? { receiving: { names: receiving, start: frame.output.length } } : {}) });
        continue;
      }
      const parameterNames = Object.keys(attrs).filter(is_part_argument_attribute);
      const libField = Object.getOwnPropertyDescriptor(attrs, "lib");
      let lib: unknown = libField === undefined ? frame.occurrence.collection : libField.value;
      if (typeof lib !== "string" || lib.length === 0) throw new TypeError("hson-part requires an unambiguous nonempty collection lib.");
      let member: unknown = Object.getOwnPropertyDescriptor(attrs, "at")?.value;
      if (typeof member !== "string") throw new TypeError("hson-part requires an exact Part member at.");
      const parameters = new Map<string, PartBinding>();
      const context = `${JSON.stringify([configuration?.use?.lib ?? lib, configuration?.use?.at ?? member])} at ${JSON.stringify([...frame.outputPath, frame.output.length])}`;
      for (const raw of parameterNames) {
        const argument = part_argument_name(raw);
        const value: unknown = Object.getOwnPropertyDescriptor(attrs, raw)?.value;
        if (argument === undefined) throw new TypeError(`Invalid hson-part parameter ${JSON.stringify(raw)} in ${context}.`);
        if (parameters.has(argument.name)) throw new TypeError(`Conflicting Part parameter ${JSON.stringify(argument.name)} in ${context}.`);
        if (argument.kind === "scalar") {
          if (!parameter_scalar(value)) throw new TypeError(`Invalid hson-part parameter ${JSON.stringify(raw)}: expected a scalar.`);
          parameters.set(argument.name, { kind: "scalar", value });
        } else {
          if (typeof value !== "string") throw new TypeError(`Part data parameter ${JSON.stringify(raw)} requires serialized HsonData in ${context}.`);
          // Charge literal input or selector text; forwarded carriers are never walked or serialized.
          if (argument.kind === "data" || whole_part_reference(value) !== undefined) charge(value);
          const reference = whole_part_reference(value);
          if (reference !== undefined) {
            const binding = resolve_part_reference(reference, part_environment_at(frame.occurrence.parameters, item), true);
            if (binding.kind !== argument.kind) throw new TypeError("Typed Part forwarding requires the same declared representation.");
            parameters.set(argument.name, binding);
          } else if (argument.kind === "doc") {
            parameters.set(argument.name, { kind: "doc", value, document: documentInput(item, raw, value) });
          } else {
            try { parameters.set(argument.name, { kind: "data", value: admit_canonical_hson_data_value(value) }); }
            catch (cause) { throw new TypeError(`Invalid Part data parameter ${JSON.stringify(argument.name)} in ${context}.`, { cause }); }
          }
        }
      }
      if (item.$_content.length !== 0) throw new TypeError("hson-part connectors must be empty; inputs are named argument attributes.");
      if (configuration?.use !== undefined) {
        lib = configuration.use.lib ?? lib;
        member = configuration.use.at;
      }
      if (typeof lib !== "string" || typeof member !== "string") throw new TypeError("Composition Part coordinates must be strings.");
      const definition = part(lib, member);
      validateArguments(definition, parameterNames);
      const authoredArguments = frame.occurrence.parameters?.authoredArguments?.get(item);
      if (authoredArguments !== undefined) validateArguments(definition, authoredArguments);
      const environment: PartEnvironment = { bindings: parameters, locals: new Map(), context };
      const selected = { ...definition, root: substitute_part_parameters(definition, analysis(definition), environment, limits.maxCharacters - characters, preparation, (connector, inspectInterface, local) => validateConnector(connector, lib, local, inspectInterface)) };
      const content = selected.root.$_content;
      if (is_Node(content[0]) && environment.omitted?.(content[0])) {
        chargeOmitted(content[0]);
        if (style !== undefined && styledName !== undefined) style.absent.add(styledName);
        if (configuration?.q !== undefined) throw new TypeError("Composition receiving QUAD requires exactly one ordinary resulting element.");
        continue;
      }
      const selection: Selection = { collection: lib, member };
      if (active.get(lib)?.has(member)) {
        const chain = frames.flatMap(current => current.selection === undefined ? [] : [label(current.selection)]);
        throw new Error(`Recursive document composition cycle: ${[...chain, label(selection)].join(" -> ")}.`);
      }
      const coordinate = [...frame.outputPath, frame.output.length];
      const childOccurrence = occurrence(selected, lib, coordinate, frame.occurrence.evidence.root, environment.names);
      const rootAliases = [...(iterationNames?.get(item) ?? []), ...(frame.rootAlias === undefined ? [] : [frame.rootAlias])];
      for (const alias of rootAliases) {
        const previous = childOccurrence.landmarks.get(alias);
        if (previous !== undefined && previous.node !== selected.root.$_content[0]) throw new TypeError("Conflicting structural root QUAD alias.");
        bind(childOccurrence, alias, "element", coordinate);
      }
      if (childOccurrence.style !== undefined) for (const [node, name] of childOccurrence.style.demanded) {
        if (environment.omitted?.(node)) childOccurrence.style.absent.add(name);
      }
      const localNames = frame.occurrence.localNames.get(item) ?? [];
      for (const name of [...localNames, configuration?.q]) if (name !== undefined) bind(frame.occurrence, name, "part", coordinate);
      // A connector's at belongs to the newly selected component, never its source siblings.
      const childScope = scope(childOccurrence, [], configuration ?? frame.selectionConfiguration);
      const childCustomization: RootCustomization = { attrs: customization.attrs,
        text: customization.text };
      singleRoot(content, childCustomization);
      push({ source: content, output: frame.output, outputPath: frame.outputPath, index: 0, selection, owner: frame.owner,
        ...(style === undefined || styledName === undefined ? {} : { styledConnector: { name: styledName, style, start: frame.output.length } }),
        ...(receiving.length === 0 ? {} : { receiving: { names: receiving, start: frame.output.length } }),
        customization: childCustomization, scope: childScope,
        occurrence: { ...childOccurrence, parameters: environment, scopes: [childScope] },
      });
      const selections = active.get(lib) ?? new Set<string>();
      selections.add(member);
      active.set(lib, selections);
      continue;
    }
    if (configuration?.use !== undefined) throw new TypeError("Composition configuration use requires a connector.");
    const nestedScope = configuredPath === undefined ? undefined : scope(frame.occurrence, configuredPath, configuration);
    const nestedOccurrence: Occurrence = nestedScope === undefined ? frame.occurrence
      : { ...frame.occurrence, scopes: [...frame.occurrence.scopes, nestedScope] };
    // at may name the addressed element itself; two routes to one target are ambiguous.
    if (nestedScope?.has(item)) throw new Error("Ambiguous composition configuration target.");
    const header: HsonNode = { $_tag: item.$_tag, $_content: [] };
    if (item.$_attrs !== undefined) header.$_attrs = item.$_attrs;
    if (item.$_meta !== undefined) header.$_meta = item.$_meta;
    const copy = materialize_owned_occurrences(header);
    let content = item.$_content;
    if (hasOverrides(customization)) {
      if (customization.attrs.length) {
        let attrs = decode_public_attrs(copy.$_attrs ?? {});
        if (attrs === undefined) throw new TypeError("Selected root attributes are not canonical.");
        for (const [name, value] of customization.attrs) {
          if (!Object.hasOwn(attrs, name) || typeof attrs[name] !== "string") {
            throw new TypeError(`hson-part override ${JSON.stringify(name)} requires an existing string-valued root attribute.`);
          }
          attrs = plan_public_attr_set(attrs, name, value);
        }
        copy.$_attrs = attrs;
      }
      if (customization.text !== undefined) {
        if (sole_immediate_string(item) === undefined) {
          throw new TypeError("hson-part text replacement requires an existing sole immediate logical string.");
        }
        // Traverse only the replacement, charging its ELEM, STR and payload through the ordinary budgets.
        content = [{ $_tag: ELEM_TAG, $_content: [{ $_tag: STR_TAG, $_content: [customization.text] }] }];
      }
    }
    chargeHeader(copy);
    // Output is append-only. Connector frames share the actual receiver; child
    // frames extend its final path, never the selected source's coordinates.
    const outputPath = [...frame.outputPath, frame.output.length];
    frame.output.push(copy);
    const localNames = frame.occurrence.localNames.get(item) ?? [];
    for (const name of [...localNames, configuration?.q]) if (name !== undefined) bind(frame.occurrence, name, "element", outputPath);
    if (style !== undefined && styledName !== undefined) style.subjects.set(styledName, validate_document_path(outputPath));
    for (const name of receiving) receive(name, frame.output, frame.output.length - 1, frame.outputPath);
    if (content.length) push({
      source: content, output: copy.$_content, outputPath, index: 0, owner: copy, occurrence: nestedOccurrence, scope: nestedScope,
      ...(item.$_tag === ELEM_TAG ? { emptyClusterParent: frame.owner } : {}),
    });
    else if (nestedScope?.size) throw new Error("Composition configuration has inaccessible QUAD targets.");
  }
  // Temporary copied identity data never crosses admission; strip using the existing facility.
  // Empty ELEM cleanup can only remove an unoccupied carrier. Every addressed
  // element therefore keeps these exact final receiving coordinates. Admission
  // validates the complete qualified graph and the registry bijection before
  // ordinary sparse reconstruction allocates any receiving identities.
  associations.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const occurrenceStyles = styles.map(({ css, demanded, subjects, absent }): DocumentCompositionStyle => {
    if (subjects.size + absent.size !== demanded.size) throw new Error("Part CSS subject was lost during composition.");
    return Object.freeze({ css: omit_part_css_subjects(css, absent), subjects: Object.freeze([...subjects].map(([name, path]) => Object.freeze({ name, path }))) });
  });
  if (limits.configuration?.q !== undefined) bind(initial, limits.configuration.q,
    occurrences.some(occurrence => JSON.stringify(occurrence.root) === "[0]") ? "part" : "element", [0]);
  const sortBindings = (bindings: readonly ScopedQuadBindingRecord[]) => [...bindings].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const realizedRoot = clone_hson_graph_without_quids(root);
  // These are construction coordinates, not an admitted portable payload.
  // Scoped admission and its resource bounds belong to the private preparer;
  // public composition continues to use its committed receiving associations.
  const scoped: DocumentScopedQuadRecord = Object.freeze({ document: Object.freeze(sortBindings(initial.evidence.bindings)),
    occurrences: Object.freeze(occurrences.map(occurrence => Object.freeze({ ...occurrence,
      bindings: Object.freeze(sortBindings(occurrence.bindings)) }))), subjects: Object.freeze([]) });
  const demands = new Map<string, readonly number[]>();
  for (const path of [...scoped.document.map(binding => binding.path), ...scoped.occurrences.flatMap(occurrence =>
    [occurrence.root, ...occurrence.bindings.map(binding => binding.path)]), ...occurrenceStyles.flatMap(style => style.subjects.map(subject => subject.path))]) {
    demands.set(JSON.stringify(path), path);
  }
  return Object.freeze({ root: realizedRoot, scoped, identityDemands: Object.freeze([...demands.values()]),
    styles: Object.freeze(occurrenceStyles),
    ...(associations.length === 0 ? {} : { quads: Object.freeze(associations) }) });
}


function parameter_scalar(value: unknown): value is Primitive {
  return value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value);
}

/** Only a proven missing property/index (or forwarded absence) can be optional. */
function resolve_part_reference(reference: PartReference, environment: PartEnvironment | undefined, allowAbsent = false): PartBinding {
  const binding = (reference.namespace === "incoming" ? environment?.bindings : environment?.locals)?.get(reference.name);
  const context = environment?.context ?? "top-level invocation (no enclosing Part)";
  if (binding === undefined) throw new TypeError(`Missing Part parameter ${JSON.stringify(reference.name)} for ${part_reference_text(reference)} in ${context}.`);
  if (reference.namespace === "incoming" && (binding.kind !== "scalar" || reference.path.length)) throw new TypeError("Structured Part inputs require declared local #{} references.");
  if (reference.path.length && binding.kind !== "data") throw new TypeError(`Part reference ${part_reference_text(reference)} requires a data binding in ${context}.`);
  let value = binding.value;
  for (const key of reference.path) {
    if (value === undefined) break;
    if (typeof key === "number" ? !Array.isArray(value) : !is_ordered_projected_object(value)) {
      throw new TypeError(`Invalid Part path ${part_reference_text(reference)} in ${context}.`);
    }
    value = ordered_projected_value_at(value, [key]);
  }
  if (value === undefined && !allowAbsent) throw new TypeError(`Missing Part path ${part_reference_text(reference)} in ${context}.`);
  return binding.kind !== "data" ? binding : { kind: "data", value };
}

/** The body pass borrows the lexical environment captured for this exact instance. */
function part_environment_at(environment: PartEnvironment | undefined, node: HsonNode): PartEnvironment | undefined {
  if (environment === undefined) return undefined;
  const locals = environment.nodeLocals?.get(node);
  return locals === undefined ? environment : { ...environment, locals };
}

/** Prepare bounded body instances, inspect all their presence, then substitute.
 * Names follow authored nodes into instances, rather than reusing shifted paths.
 * Separately selected Parts remain the ordinary composer's responsibility. */
function substitute_part_parameters(source: DocumentCompositionSource, analysis: PartDefinitionAnalysis,
  environment: PartEnvironment, remainingCharacters: number,
  budget: Readonly<{ node: (depth: number) => void; text: (length: number) => void }>,
  validateConnector: (node: HsonNode, inspectInterface: PartConnectorInspection, local: PartEnvironment) => void): HsonNode {
  const rootLocals = new Map<string, PartBinding>();
  const missingDeclarations = new Set<string>();
  for (const local of analysis.receiving) {
    const declaration = local.receiving;
    const binding = environment.bindings.get(declaration.reference.name);
    if (binding === undefined) {
      if (declaration.kind === "doc") throw new TypeError(`Missing required Part Document input in ${environment.context}.`);
      missingDeclarations.add(declaration.name); continue;
    }
    if (binding.kind !== declaration.kind) throw new TypeError(`Part declaration ${JSON.stringify(declaration.name)} requires a ${declaration.kind} input.`);
    rootLocals.set(declaration.name, binding);
  }
  for (const [name, kind] of analysis.parameters) if (kind === "scalar" && !environment.bindings.has(name)) {
    throw new TypeError(`Missing Part parameter ${JSON.stringify(name)} in ${environment.context}.`);
  }
  environment.locals = rootLocals;
  const nodeLocals = new Map<HsonNode, ReadonlyMap<string, PartBinding>>();
  const names: PartLocalNames = new Map(), iterations = new Map<HsonNode, PartLocalNames>();
  environment.nodeLocals = nodeLocals; environment.names = names; environment.iterations = iterations;
  const authoredNames: PartLocalNames = new Map();
  for (const quad of source.quads ?? []) {
    const node = resolve_document_path(source.root, "document", quad.path);
    if (!is_ordinary_element_node(node)) throw new TypeError("Invalid Part landmark.");
    authoredNames.set(node, [...authoredNames.get(node) ?? [], quad.name]);
  }
  const emptyBody = (node: HsonNode, locals: ReadonlyMap<string, PartBinding>, depth: number): void => {
    budget.node(depth);
    budget.text(node.$_tag.length + JSON.stringify(node.$_attrs ?? {}).length + JSON.stringify(node.$_meta ?? {}).length);
    if (node.$_tag.toLowerCase() === "hson-part") validateConnector(node, "literal", { ...environment, locals });
    for (const child of node.$_content) {
      if (is_Node(child)) emptyBody(child, locals, depth + 1);
      else if (typeof child === "string") budget.text(child.length);
    }
  };
  const append = (node: HsonNode, output: NodeContent, locals: ReadonlyMap<string, PartBinding>,
    localNames: PartLocalNames, depth: number, repeated = false): void => {
    const iterator = repeated ? undefined : analysis.iterators.get(node);
    if (iterator !== undefined) {
      const binding = resolve_part_reference(iterator.source, { ...environment, locals });
      const collection = binding.kind === "data" ? binding.value : undefined;
      const array = iterator.kind === "array" && Array.isArray(collection) ? collection : undefined;
      const entries = iterator.kind === "object" && is_ordered_projected_object(collection) ? collection.entries : undefined;
      if (array === undefined && entries === undefined) throw new TypeError(`Part iteration source must resolve to ${iterator.kind} Data in ${environment.context}.`);
      const length = array?.length ?? entries!.length;
      if (length === 0) emptyBody(node, locals, depth);
      for (let index = 0; index < length; index++) {
        const inner = new Map(locals);
        if (iterator.value !== undefined) inner.set(iterator.value, { kind: "data", value: array === undefined ? entries![index]![1] : array[index] });
        if (iterator.index !== undefined) inner.set(iterator.index, { kind: "scalar", value: index });
        if (iterator.key !== undefined) inner.set(iterator.key, { kind: "scalar", value: entries![index]![0] });
        append(node, output, inner, new Map(), depth, true);
      }
      return;
    }
    // Reserve before copying the next header or allocating its descendants.
    budget.node(depth);
    const header: HsonNode = { $_tag: node.$_tag, $_content: [] };
    if (node.$_attrs !== undefined) header.$_attrs = Object.fromEntries(Object.entries(node.$_attrs).filter(([name]) => !is_part_iterator_attribute(name)));
    if (node.$_meta !== undefined) header.$_meta = node.$_meta;
    budget.text(JSON.stringify(header).length);
    const copy = clone_hson_graph_without_quids(header);
    output.push(copy); nodeLocals.set(copy, locals);
    const declared = authoredNames.get(node);
    if (declared !== undefined) localNames.set(copy, declared);
    if (repeated) iterations.set(copy, localNames);
    for (const child of node.$_content) {
      if (is_Node(child)) append(child, copy.$_content, locals, localNames, depth + 1);
      else { if (typeof child === "string") budget.text(child.length); copy.$_content.push(child); }
    }
    const cluster = copy.$_content[0];
    if (is_ordinary_element_node(copy) && copy.$_content.length === 1 && is_Node(cluster)
      && cluster.$_tag === ELEM_TAG && cluster.$_content.length === 0) copy.$_content = [];
  };
  const prepared: NodeContent = [];
  append(source.root, prepared, rootLocals, names, 0);
  const copy = prepared[0];
  if (!is_Node(copy)) throw new Error("Part preparation lost its root.");
  const optional = new Set<HsonNode>(), absent = new Set<HsonNode>(), present = new Set<HsonNode>();
  const parents = new Map<HsonNode, HsonNode>();
  const connectors: HsonNode[] = [];
  const structures = new Map<HsonNode, Extract<PartBinding, { kind: "doc" }>>();
  const bounded = (length: number): void => {
    if (length > remainingCharacters) throw new Error("Document composition character limit exceeded.");
  };
  const matches = (value: string) => {
    bounded(value.length);
    const found = part_placeholder_matches(value);
    if (found === undefined) throw new TypeError(`Invalid Part placeholder in ${environment.context}.`);
    return found;
  };
  const observe = (reference: PartReference, node: HsonNode): void => {
    if (resolve_part_reference(reference, part_environment_at(environment, node), true).value !== undefined) present.add(node);
  };
  transform_part_parameter_strings(copy, (value, node) => {
    for (const reference of matches(value)) observe(reference, node);
    return value;
  }, observe, undefined, {
    enter(node, parent) {
      if (parent !== undefined) parents.set(node, parent);
      if (Object.hasOwn(node.$_attrs ?? {}, PART_OPTIONAL)) optional.add(node);
      if (node.$_tag.toLowerCase() === "hson-part") { connectors.push(node); validateConnector(node, false, part_environment_at(environment, node)!); }
    },
    structure(reference, node) {
      const binding = resolve_part_reference(reference, part_environment_at(environment, node));
      if (binding.kind !== "doc") throw new TypeError("Structural Part requires a declared Document binding.");
      structures.set(node, binding);
      present.add(node);
    },
    leave(node, parent) {
      if (optional.has(node) && !present.has(node)) absent.add(node);
      if (parent !== undefined && present.has(node)) present.add(parent);
    },
  });
  const omitted = (node: HsonNode): boolean => {
    let current: HsonNode | undefined = node;
    while (current !== undefined) {
      if (absent.has(current)) return true;
      current = parents.get(current);
    }
    return false;
  };
  environment.omitted = omitted;
  environment.structures = structures;
  // The normal composer checks included connectors against the selected Part.
  // Hidden or optional inputs must also prove their names before being discarded.
  environment.authoredArguments = new Map(connectors.filter(connector => optional.has(connector))
    .map(connector => [connector, Object.keys(connector.$_attrs ?? {}).filter(is_part_argument_attribute)]));
  for (const connector of connectors) if (omitted(connector)) validateConnector(connector, true, part_environment_at(environment, connector)!);
  // Usage is authored, including absent optional branches; it is not a persistent dependency.
  const rootElement = copy.$_content[0];
  const rootAbsent = is_Node(rootElement) && omitted(rootElement);
  for (const name of environment.bindings.keys()) if (!analysis.parameters.has(name)) {
    throw new TypeError(`Unknown Part parameter ${JSON.stringify(name)} in ${environment.context}.`);
  }
  for (const local of analysis.receiving) if (!analysis.used.has(local) && !rootAbsent) {
    throw new TypeError(`Unused Part local binding ${JSON.stringify(local.name)} in ${environment.context}.`);
  }
  if (rootAbsent) return copy;
  if (missingDeclarations.size) throw new TypeError(`Missing required Part data input in ${environment.context}.`);
  for (const binding of environment.locals.values()) if (binding.value === undefined) {
    throw new TypeError(`Missing required Part data input in ${environment.context}.`);
  }
  transform_part_parameter_strings(copy, (value, node, owner) => {
    const found = matches(value);
    const whole = found.length === 1 && found[0]!.start === 0 && found[0]!.end === value.length;
    const read = (reference: PartReference): Primitive | undefined => {
      const binding = resolve_part_reference(reference, part_environment_at(environment, node), whole && optional.has(owner));
      if (binding.value === undefined) {
        if (node.$_tag === STR_TAG) absent.add(node);
        return undefined;
      }
      if (!parameter_scalar(binding.value)) throw new TypeError(`Part reference ${part_reference_text(reference)} requires a primitive output in ${environment.context}.`);
      const output = binding.kind === "data" || reference.namespace === "local" && node.$_tag.toLowerCase() !== "hson-part"
        ? String(binding.value) : binding.value;
      if (typeof output === "string") bounded(output.length);
      return output;
    };
    if (whole) { const value = read(found[0]!); if (typeof value === "string") budget.text(value.length); return value; }
    let at = 0, result = "";
    for (const match of found) {
      const replacement = String(read(match));
      bounded(result.length + match.start - at + replacement.length);
      result += value.slice(at, match.start) + replacement; at = match.end;
    }
    bounded(result.length + value.length - at);
    budget.text(result.length + value.length - at);
    return result + value.slice(at);
  }, undefined, undefined, { enter: node => !omitted(node) });
  return copy;
}

/** Construction marker check (connectors and optional flags), without source reads or identity issuance. @internal */
export function has_part_connector(root: HsonNode): boolean {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.$_tag.toLowerCase() === "hson-part" || Object.hasOwn(node.$_attrs ?? {}, PART_OPTIONAL) || Object.hasOwn(node.$_attrs ?? {}, PART_DECLARATION) || Object.keys(node.$_attrs ?? {}).some(is_part_iterator_attribute)) return true;
    for (const child of node.$_content) if (is_Node(child)) stack.push(child);
  }
  return false;
}

/** Lower zero-or-one Part content through existing graph operations. Undefined is
 * an insertion no-op; its caller still validates the original target and index. */
export function lower_part_content_operation(operation: LiveMapGraphOp, root: HsonNode, receivingRoot: HsonNode): LiveMapGraphOp | undefined {
  if (operation.op !== "insert-content" && operation.op !== "replace-content") throw new Error("Unsupported Part content operation.");
  if (root.$_content.length === 0) {
    if (operation.op === "insert-content") return undefined;
    const endpoint = resolve_document_path(receivingRoot, "document", operation.target.path);
    if (!is_Node(endpoint)) throw new Error("Part replacement requires a content target.");
    const removal = lower_internal_document_content_remove({ kind: "content",
      scope: endpoint.$_tag === ELEM_TAG ? "element" : "document", length: endpoint.$_content.length,
      physical: { kind: "direct", path: operation.target.path } }, operation.index);
    if (removal.kind !== "content-remove") throw new Error("Part omission requires a removable content slot.");
    return { domain: "graph", op: "remove-content", target: { kind: "path", path: validate_document_path(removal.target.path) }, index: removal.index };
  }
  const output = root.$_content[0];
  if (!is_Node(output) || root.$_content.length !== 1) throw new Error("Part content must realize zero or one content slot.");
  return operation.op === "insert-content" ? { ...operation, content: output } : { ...operation, replacement: output };
}
