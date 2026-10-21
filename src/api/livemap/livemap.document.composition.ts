import { part_placeholder_matches, part_placeholder_pattern } from "../../internal/part-placeholder.js";
import { ELEM_TAG, ROOT_TAG, STR_TAG } from "../../core/constants.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { decode_public_attrs, is_public_attr_name } from "../../core/public-attrs.js";
import { plan_public_attr_set } from "../../core/public-attr-transitions.js";
import type { HsonNode, NodeContent, Primitive } from "../../core/types.js";
import { ANY_DOCUMENT, HsonSchema } from "../schema/hson-schema.js";
import { materialize_owned_occurrences } from "../livetree/runtime/materialize-occurrences.js";
import { clone_hson_graph_without_quids } from "./livemap.document.capture.js";
import { is_document_quad_name, type DocumentQuadAdmission } from "./livemap.document.quad.js";
import { resolve_document_path, validate_document_path } from "./livemap.document.path.js";
import type { PortableDocumentQuads } from "../../types/livemap.types.js";
import type { HsonData } from "../transform/transform.types.js";
import { admit_hson_data_input } from "../data/hson-data.js";
import { document_css_subject_identities } from "../../internal/css/css-identity-translation.js";
import { scope_part_stylesheet } from "../../internal/css/part-stylesheet.js";
import type { DocumentScopedQuadRecord, ScopedQuadBindingRecord, ScopedQuadOccurrenceRecord } from "./livemap.document.scoped-quad-codec.js";
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
type Occurrence = Readonly<{
  evidence: { root: readonly number[] | null; bindings: ScopedQuadBindingRecord[]; byName: Map<string, ScopedQuadBindingRecord> };
  localNames: ReadonlyMap<HsonNode, readonly string[]>;
  landmarks: ReadonlyMap<string, Landmark>;
  shellNames: ReadonlyMap<HsonNode, string>;
  collection?: string;
  scopes: readonly ConfigurationScope[];
  style?: { css: DocumentCssRecord; demanded: ReadonlyMap<HsonNode, string>; subjects: Map<string, readonly number[]> };
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
  let nodes = 1; // Receiving ROOT; visited connectors also consume work, even when they insert nothing.
  let characters = 0;
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
  const label = (selection: Selection): string => JSON.stringify([selection.collection, selection.member]);
  const occurrence = (source: DocumentCompositionSource, collection?: string, coordinate: readonly number[] | null = null, parent: readonly number[] | null = null): Occurrence => {
    const evidence: Occurrence["evidence"] = { root: coordinate, bindings: [], byName: new Map() };
    if (coordinate !== null) occurrences.push({ root: validate_document_path(coordinate), parent: parent === null ? null : validate_document_path(parent), bindings: evidence.bindings });
    const localNames = new Map<HsonNode, string[]>();
    const landmarks = new Map<string, Landmark>(), shellNames = new Map<HsonNode, string>();
    for (const quad of source.quads ?? []) {
      const node = resolve_document_path(source.root, "document", quad.path);
      if (!is_ordinary_element_node(node) || landmarks.has(quad.name)) throw new Error("Invalid composition landmark.");
      landmarks.set(quad.name, { node, path: quad.path });
      localNames.set(node, [...(localNames.get(node) ?? []), quad.name]);
      if (collection === undefined) shellNames.set(node, quad.name);
    }
    let style: Occurrence["style"];
    if (collection !== undefined && source.css !== undefined) {
      charge(JSON.stringify(source.css));
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
        if (landmark === undefined) throw new Error(`Part CSS subject ${JSON.stringify(name)} requires an exact Part-local authored QUAD; anonymous source identity is unsupported.`);
        demanded.set(landmark.node, name);
      }
      style = { css, demanded, subjects: new Map() };
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
  while (frames.length) {
    const frame = frames[frames.length - 1]!;
    if (frame.index === frame.source.length) {
      if (frame.scope?.size) throw new Error("Composition configuration has inaccessible QUAD targets.");
      if (frame.receiving !== undefined) for (const name of frame.receiving.names) {
        receive(name, frame.output, frame.receiving.start, frame.outputPath);
      }
      if (frame.styledConnector !== undefined) {
        const { name, style, start } = frame.styledConnector;
        if (frame.output.length !== start + 1 || !is_ordinary_element_node(frame.output[start])) {
          throw new Error("Part CSS connector subject requires one ordinary resulting element.");
        }
        style.subjects.set(name, validate_document_path([...frame.outputPath, start]));
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
    if (++nodes > limits.maxNodes) throw new Error("Document composition node limit exceeded.");
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
      const parameterNames = Object.keys(attrs).filter(key => key !== "lib" && key !== "at");
      const libField = Object.getOwnPropertyDescriptor(attrs, "lib");
      let lib: unknown = libField === undefined ? frame.occurrence.collection : libField.value;
      if (typeof lib !== "string" || lib.length === 0) throw new TypeError("hson-part requires an unambiguous nonempty collection lib.");
      let member: unknown = Object.getOwnPropertyDescriptor(attrs, "at")?.value;
      if (typeof member !== "string") throw new TypeError("hson-part requires an exact Part member at.");
      const parameters = new Map<string, Primitive>();
      for (const name of parameterNames) {
        const value: unknown = Object.getOwnPropertyDescriptor(attrs, name)?.value;
        if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) || !parameter_scalar(value)) throw new TypeError(`Invalid hson-part parameter ${JSON.stringify(name)}: expected a scalar.`);
        parameters.set(name, value);
      }
      if (item.$_content.length !== 0) throw new TypeError("hson-part connectors must be empty; inputs are named scalar attributes.");
      if (configuration?.use !== undefined) {
        lib = configuration.use.lib ?? lib;
        member = configuration.use.at;
      }
      if (typeof lib !== "string" || typeof member !== "string") throw new TypeError("Composition Part coordinates must be strings.");
      const definition = part(lib, member);
      const selected = { ...definition, root: substitute_part_parameters(definition.root, parameters) };
      const content = selected.root.$_content;
      const selection: Selection = { collection: lib, member };
      if (active.get(lib)?.has(member)) {
        const chain = frames.flatMap(current => current.selection === undefined ? [] : [label(current.selection)]);
        throw new Error(`Recursive document composition cycle: ${[...chain, label(selection)].join(" -> ")}.`);
      }
      const coordinate = [...frame.outputPath, frame.output.length];
      const childOccurrence = occurrence(selected, lib, coordinate, frame.occurrence.evidence.root);
      const localNames = frame.occurrence.localNames.get(item) ?? [];
      for (const name of [...localNames, configuration?.q]) if (name !== undefined) bind(frame.occurrence, name, "part", coordinate);
      // A connector's at belongs to the newly selected component, never its source siblings.
      const childScope = scope(childOccurrence, [], configuration);
      const childCustomization: RootCustomization = { attrs: customization.attrs,
        text: customization.text };
      singleRoot(content, childCustomization);
      push({ source: content, output: frame.output, outputPath: frame.outputPath, index: 0, selection, owner: frame.owner,
        ...(style === undefined || styledName === undefined ? {} : { styledConnector: { name: styledName, style, start: frame.output.length } }),
        ...(receiving.length === 0 ? {} : { receiving: { names: receiving, start: frame.output.length } }),
        customization: childCustomization, scope: childScope,
        occurrence: { ...childOccurrence, scopes: [childScope] },
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
  const occurrenceStyles = styles.map(({ css, demanded, subjects }): DocumentCompositionStyle => {
    if (subjects.size !== demanded.size) throw new Error("Part CSS subject was lost during composition.");
    return Object.freeze({ css, subjects: Object.freeze([...subjects].map(([name, path]) => Object.freeze({ name, path }))) });
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

/** Only decoded text payloads and whole public attribute values participate. No source concatenation. */
function substitute_part_parameters(root: HsonNode, parameters: ReadonlyMap<string, Primitive>): HsonNode {
  const copy = clone_hson_graph_without_quids(root), used = new Set<string>();
  const substitute = (value: string): Primitive => {
    const pattern = part_placeholder_pattern();
    const matches = part_placeholder_matches(value);
    if (matches === undefined) throw new TypeError("Invalid Part placeholder; expected %{name}.");
    const read = (name: string): Primitive => {
      if (!parameters.has(name)) throw new TypeError(`Missing Part parameter ${JSON.stringify(name)}.`);
      used.add(name); return parameters.get(name)!;
    };
    if (matches.length === 1 && matches[0]![0] === value) return read(matches[0]![1]!);
    return value.replace(pattern, (_, name: string) => String(read(name)));
  };
  const stack = [copy];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.$_tag.includes("%{")) throw new TypeError("Part placeholders cannot occur in tags.");
    if (node.$_meta !== undefined && JSON.stringify(node.$_meta).includes("%{")) throw new TypeError("Part placeholders cannot occur in identity metadata.");
    if (node.$_attrs !== undefined) {
      const attrs: NonNullable<HsonNode["$_attrs"]> = Object.create(null);
      for (const [name, value] of Object.entries(node.$_attrs)) {
        if (name.includes("%{")) throw new TypeError("Part placeholders cannot occur in attribute names.");
        if (/^on/i.test(name) && typeof value === "string" && value.includes("%{")) throw new TypeError("Part placeholders in event-handler attributes are unsupported.");
        if (typeof value === "object" && value !== null && JSON.stringify(value).includes("%{")) throw new TypeError("Part placeholders in structured attributes are unsupported.");
        attrs[name] = typeof value === "string" ? substitute(value) : value;
      }
      node.$_attrs = attrs;
    }
    if (node.$_tag === STR_TAG && typeof node.$_content[0] === "string") {
      const value = substitute(node.$_content[0]);
      // Canonical document text is STR-only; strong scalar types apply to attributes.
      node.$_content = [String(value)];
    } else {
      if (["script", "style"].includes(node.$_tag.toLowerCase()) && JSON.stringify(node.$_content).includes("%{")) throw new TypeError("Part placeholders in script/style content are unsupported.");
      for (const child of node.$_content) if (is_Node(child)) stack.push(child);
    }
  }
  for (const name of parameters.keys()) if (!used.has(name)) throw new TypeError(`Unknown Part parameter ${JSON.stringify(name)}.`);
  return copy;
}

/** Presence check only, with no source lookup or identity issuance. @internal */
export function has_part_connector(root: HsonNode): boolean {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.$_tag.toLowerCase() === "hson-part") return true;
    for (const child of node.$_content) if (is_Node(child)) stack.push(child);
  }
  return false;
}
