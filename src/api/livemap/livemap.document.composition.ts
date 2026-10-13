import { ELEM_TAG, ROOT_TAG, STR_TAG } from "../../core/constants.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { decode_public_attrs, is_public_attr_name } from "../../core/public-attrs.js";
import { plan_public_attr_set } from "../../core/public-attr-transitions.js";
import type { HsonNode, NodeContent, Primitive } from "../../core/types.js";
import { ANY_DOCUMENT, HsonSchema } from "../schema/hson-schema.js";
import { materialize_owned_occurrences } from "../livetree/runtime/materialize-occurrences.js";
import { clone_hson_graph_without_quids } from "./livemap.document.capture.js";
import { is_document_quad_name, type DocumentQuadAdmission } from "./livemap.document.quad.js";
import { validate_document_path } from "./livemap.document.path.js";
import type { PortableDocumentQuads } from "../../types/livemap.types.js";
import type { HsonData } from "../transform/transform.types.js";
import { admit_hson_data_input } from "../data/hson-data.js";

/** Private construction bounds; callers may lower, but cannot disable, the caps. @internal */
export type DocumentCompositionOptions = Readonly<{
  schema?: HsonSchema;
  /** Native HsonData or a private own-data record: attrs?: string record, text?: string,
   * use?: { quad: string, lib?: string }, at?: QUAD-to-configuration record,
   * as?: explicit receiving QUAD name (private spelling).
   * use applies only to connectors; omitted lib retains the authored Library.
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
  as?: string;
  use?: Readonly<{ lib?: string; quad: string }>;
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
    for (const key of data.keys()) if (!["attrs", "text", "use", "at", "as"].includes(key)) {
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
    const receiving = data.get("as");
    if (data.has("as") && !is_document_quad_name(receiving)) {
      throw new TypeError("Composition configuration as requires an explicit authored QUAD string.");
    }
    let use: Configuration["use"];
    if (data.has("use")) {
      const reference = record(data.get("use")), lib = reference.get("lib"), quad = reference.get("quad");
      if ([...reference.keys()].some(key => key !== "lib" && key !== "quad") || !is_document_quad_name(quad)
        || (reference.has("lib") && (typeof lib !== "string" || lib.length === 0))) {
        throw new TypeError("Composition configuration use requires a QUAD and optional nonempty lib.");
      }
      use = Object.freeze(Object.assign(Object.create(null), {
        quad, ...(typeof lib === "string" ? { lib } : {}),
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
      ...(typeof receiving === "string" ? { as: receiving } : {}),
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
type Occurrence = Readonly<{ library: string; root: HsonNode; scopes: readonly ConfigurationScope[] }>;
type Selection = Readonly<{ library: string; quid?: string; quad?: string }>;
type RootCustomization = Readonly<{ attrs: readonly (readonly [string, string])[]; text?: string }>;
type Frame = {
  source: readonly (HsonNode | Primitive)[];
  output: NodeContent;
  outputPath: readonly number[];
  index: number;
  receiving?: Readonly<{ name: string; start: number }>;
  selection?: Selection;
  customization?: RootCustomization;
  occurrence: Occurrence;
  scope?: ConfigurationScope;
  owner: HsonNode;
  emptyClusterParent?: HsonNode;
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
  read: (name: string) => HsonNode,
  limits: Readonly<{ maxDepth: number; maxNodes: number; maxCharacters: number; configuration?: Configuration }>,
  selectQuad?: (name: string, quad: string, root: HsonNode) => Readonly<{ node: HsonNode; quid: string; path: readonly number[] }>,
): Readonly<{ root: HsonNode; quads?: PortableDocumentQuads }> {
  const sources = new Map<string, HsonNode>();
  const source = (name: string): HsonNode => {
    let root = sources.get(name);
    if (root === undefined) {
      root = read(name);
      if (root.$_tag !== ROOT_TAG) throw new TypeError("Composition source must have an owned document ROOT.");
      sources.set(name, root);
    }
    return root;
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
  const receive = (name: string, content: NodeContent, start: number, outputPath: readonly number[]): void => {
    if (content.length !== start + 1 || !is_ordinary_element_node(content[start])
      || content[start].$_tag.toLowerCase() === "hson-template") {
      throw new TypeError("Composition receiving QUAD requires exactly one ordinary resulting element.");
    }
    associations.push(Object.freeze({ name, path: validate_document_path([...outputPath, start]) }));
  };
  chargeHeader(root);
  // Undefined selects the whole Library; addressed expansion uses its genuine local subject QUID.
  const active = new Map<string, Set<string | undefined>>([[sourceName, new Set([undefined])]]);
  const label = (selection: Selection): string => selection.quad === undefined
    ? selection.library : `${selection.library}[${selection.quad}]`;
  const scope = (occurrence: Occurrence, path: readonly number[], configuration?: Configuration): ConfigurationScope => {
    const targets: ConfigurationScope = new Map();
    for (const [quad, child] of configuration?.at ?? []) {
      if (selectQuad === undefined) throw new Error("Document composition QUAD lookup is unavailable.");
      const target = selectQuad(occurrence.library, quad, occurrence.root);
      if (path.length > target.path.length || path.some((part, index) => part !== target.path[index])) {
        throw new Error(`Composition configuration QUAD ${JSON.stringify(quad)} is outside the selected subtree.`);
      }
      if (targets.has(target.node)) throw new Error("Ambiguous composition configuration target.");
      targets.set(target.node, { configuration: child, path: target.path });
    }
    return targets;
  };
  const initialRoot = source(sourceName);
  const initial: Occurrence = { library: sourceName, root: initialRoot, scopes: [] };
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
    ...(limits.configuration?.as === undefined ? {} : { receiving: { name: limits.configuration.as, start: 0 } }),
    selection: { library: sourceName }, owner: root, scope: initialScope,
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
      if (frame.receiving !== undefined) receive(frame.receiving.name, frame.output, frame.receiving.start, frame.outputPath);
      frames.pop();
      if (frame.selection !== undefined) {
        const selections = active.get(frame.selection.library)!;
        selections.delete(frame.selection.quid);
        if (selections.size === 0) active.delete(frame.selection.library);
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
    if (item.$_tag.toLowerCase() === "hson-template") {
      const attrs = item.$_attrs ?? {};
      const overrideNames = Object.keys(attrs).filter(key => key !== "lib" && key !== "quad");
      let lib = Object.getOwnPropertyDescriptor(attrs, "lib")?.value;
      if (typeof lib !== "string" || lib.length === 0) throw new TypeError("hson-template requires a nonempty lib attribute.");
      const quadField = Object.getOwnPropertyDescriptor(attrs, "quad");
      let quad: unknown = quadField?.value;
      if (quadField !== undefined && !is_document_quad_name(quad)) throw new TypeError("hson-template requires a valid nonempty QUAD name.");
      const customized = overrideNames.length !== 0 || item.$_content.length !== 0;
      if (customized && quadField === undefined) throw new TypeError("hson-template customization requires explicit QUAD selection.");
      const overrides: [string, string][] = [];
      for (const name of overrideNames) {
        const value: unknown = Object.getOwnPropertyDescriptor(attrs, name)?.value;
        if (!is_public_attr_name(name) || typeof value !== "string") {
          throw new TypeError("hson-template overrides require ordinary public attributes with string values.");
        }
        overrides.push([name, value]);
      }
      const text = sole_immediate_string(item);
      if (item.$_content.length !== 0 && text === undefined) {
        throw new TypeError("hson-template content requires exactly one immediate logical string.");
      }
      if (configuration?.use !== undefined) {
        lib = configuration.use.lib ?? lib;
        quad = configuration.use.quad;
      }
      const selectedRoot = source(lib);
      let content: readonly (HsonNode | Primitive)[] = selectedRoot.$_content;
      let selection: Selection = { library: lib };
      let selectedPath: readonly number[] = [];
      if (is_document_quad_name(quad)) {
        if (selectQuad === undefined) throw new Error("Document composition QUAD lookup is unavailable.");
        const selected = selectQuad(lib, quad, selectedRoot);
        if (customized && (!is_ordinary_element_node(selected.node) || selected.node.$_tag.toLowerCase() === "hson-template")) {
          throw new TypeError("hson-template customization requires an ordinary nonconnector selected element.");
        }
        content = [selected.node]; // Include the addressed element, not only its relationship content.
        selection = { library: lib, quad, quid: selected.quid };
        selectedPath = selected.path;
      }
      if (active.get(lib)?.has(selection.quid)) {
        const chain = frames.flatMap(current => current.selection === undefined ? [] : [label(current.selection)]);
        throw new Error(`Recursive document composition cycle: ${[...chain, label(selection)].join(" -> ")}.`);
      }
      const childOccurrence: Occurrence = { library: lib, root: selectedRoot, scopes: [] };
      // A connector's at belongs to the newly selected component, never its source siblings.
      const childScope = scope(childOccurrence, selectedPath, configuration);
      const childCustomization: RootCustomization = { attrs: [...overrides, ...customization.attrs],
        text: customization.text ?? text };
      singleRoot(content, childCustomization);
      push({ source: content, output: frame.output, outputPath: frame.outputPath, index: 0, selection, owner: frame.owner,
        ...(configuration?.as === undefined ? {} : { receiving: { name: configuration.as, start: frame.output.length } }),
        customization: childCustomization, scope: childScope,
        occurrence: { ...childOccurrence, scopes: [childScope] },
      });
      const selections = active.get(lib) ?? new Set<string | undefined>();
      selections.add(selection.quid);
      active.set(lib, selections);
      continue;
    }
    if (configuration?.use !== undefined) throw new TypeError("Composition configuration use requires a connector.");
    const nestedScope = configuredPath === undefined ? undefined : scope(frame.occurrence, configuredPath, configuration);
    const occurrence: Occurrence = nestedScope === undefined ? frame.occurrence
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
            throw new TypeError(`hson-template override ${JSON.stringify(name)} requires an existing string-valued root attribute.`);
          }
          attrs = plan_public_attr_set(attrs, name, value);
        }
        copy.$_attrs = attrs;
      }
      if (customization.text !== undefined) {
        if (sole_immediate_string(item) === undefined) {
          throw new TypeError("hson-template text replacement requires an existing sole immediate logical string.");
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
    if (configuration?.as !== undefined) receive(configuration.as, frame.output, frame.output.length - 1, frame.outputPath);
    if (content.length) push({
      source: content, output: copy.$_content, outputPath, index: 0, owner: copy, occurrence, scope: nestedScope,
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
  return Object.freeze({ root: clone_hson_graph_without_quids(root),
    ...(associations.length === 0 ? {} : { quads: Object.freeze(associations) }) });
}
