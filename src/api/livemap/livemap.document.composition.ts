import { ELEM_TAG, ROOT_TAG, STR_TAG } from "../../core/constants.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { decode_public_attrs, is_public_attr_name } from "../../core/public-attrs.js";
import { plan_public_attr_set } from "../../core/public-attr-transitions.js";
import type { HsonNode, NodeContent, Primitive } from "../../core/types.js";
import { ANY_DOCUMENT, HsonSchema } from "../schema/hson-schema.js";
import { materialize_owned_occurrences } from "../livetree/runtime/materialize-occurrences.js";
import { clone_hson_graph_without_quids } from "./livemap.document.capture.js";
import { is_document_quad_name } from "./livemap.document.quad.js";

/** Private construction bounds; callers may lower, but cannot disable, the caps. @internal */
export type DocumentCompositionOptions = Readonly<{
  schema?: HsonSchema;
  maxDepth?: number;
  maxNodes?: number;
  maxCharacters?: number;
}>;

const DEFAULT_LIMITS = Object.freeze({ maxDepth: 128, maxNodes: 100_000, maxCharacters: 4_000_000 });

/** Stable configuration selected before entering the coherent source read. @internal */
export function document_composition_options(input: DocumentCompositionOptions | undefined): Readonly<{
  schema: HsonSchema; maxDepth: number; maxNodes: number; maxCharacters: number;
}> {
  const values: Record<string, unknown> = Object.create(null);
  if (input !== undefined) {
    if (typeof input !== "object" || input === null || Array.isArray(input)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
      throw new TypeError("Document composition options must be a data record.");
    }
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string" || !["schema", "maxDepth", "maxNodes", "maxCharacters"].includes(key)) {
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
  return Object.freeze({ schema, maxDepth: limit("maxDepth"), maxNodes: limit("maxNodes"), maxCharacters: limit("maxCharacters") });
}

type Selection = Readonly<{ library: string; quid?: string; quad?: string }>;
type RootCustomization = Readonly<{ attrs: readonly (readonly [string, string])[]; text?: string }>;
type Frame = {
  source: readonly (HsonNode | Primitive)[];
  output: NodeContent;
  index: number;
  selection?: Selection;
  customization?: RootCustomization;
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
  limits: Readonly<{ maxDepth: number; maxNodes: number; maxCharacters: number }>,
  selectQuad?: (name: string, quad: string, root: HsonNode) => Readonly<{ node: HsonNode; quid: string }>,
): HsonNode {
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
  chargeHeader(root);
  // Undefined selects the whole Library; addressed expansion uses its genuine local subject QUID.
  const active = new Map<string, Set<string | undefined>>([[sourceName, new Set([undefined])]]);
  const label = (selection: Selection): string => selection.quad === undefined
    ? selection.library : `${selection.library}[${selection.quad}]`;
  const frames: Frame[] = [{ source: source(sourceName).$_content, output: root.$_content, index: 0,
    selection: { library: sourceName }, owner: root }];
  const push = (frame: Frame): void => {
    // Bound both recursive references and canonical graph nesting before later qualification/copying.
    if (frames.length >= limits.maxDepth) throw new Error("Document composition depth limit exceeded.");
    frames.push(frame);
  };
  while (frames.length) {
    const frame = frames[frames.length - 1]!;
    if (frame.index === frame.source.length) {
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
    if (item.$_tag.toLowerCase() === "hson-template") {
      const attrs = item.$_attrs ?? {};
      const overrideNames = Object.keys(attrs).filter(key => key !== "lib" && key !== "quad");
      const lib = Object.getOwnPropertyDescriptor(attrs, "lib")?.value;
      if (typeof lib !== "string" || lib.length === 0) throw new TypeError("hson-template requires a nonempty lib attribute.");
      const quadField = Object.getOwnPropertyDescriptor(attrs, "quad");
      const quad: unknown = quadField?.value;
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
      const selectedRoot = source(lib);
      let content: readonly (HsonNode | Primitive)[] = selectedRoot.$_content;
      let selection: Selection = { library: lib };
      if (is_document_quad_name(quad)) {
        if (selectQuad === undefined) throw new Error("Document composition QUAD lookup is unavailable.");
        const selected = selectQuad(lib, quad, selectedRoot);
        if (customized && (!is_ordinary_element_node(selected.node) || selected.node.$_tag.toLowerCase() === "hson-template")) {
          throw new TypeError("hson-template customization requires an ordinary nonconnector selected element.");
        }
        content = [selected.node]; // Include the addressed element, not only its relationship content.
        selection = { library: lib, quad, quid: selected.quid };
      }
      if (active.get(lib)?.has(selection.quid)) {
        const chain = frames.flatMap(current => current.selection === undefined ? [] : [label(current.selection)]);
        throw new Error(`Recursive document composition cycle: ${[...chain, label(selection)].join(" -> ")}.`);
      }
      push({ source: content, output: frame.output, index: 0, selection, owner: frame.owner,
        ...(customized ? { customization: { attrs: overrides, text } } : {}),
      });
      const selections = active.get(lib) ?? new Set<string | undefined>();
      selections.add(selection.quid);
      active.set(lib, selections);
      continue;
    }
    const header: HsonNode = { $_tag: item.$_tag, $_content: [] };
    if (item.$_attrs !== undefined) header.$_attrs = item.$_attrs;
    if (item.$_meta !== undefined) header.$_meta = item.$_meta;
    const copy = materialize_owned_occurrences(header);
    let content = item.$_content;
    if (frame.customization !== undefined) {
      if (frame.customization.attrs.length) {
        let attrs = decode_public_attrs(copy.$_attrs ?? {});
        if (attrs === undefined) throw new TypeError("Selected root attributes are not canonical.");
        for (const [name, value] of frame.customization.attrs) {
          if (!Object.hasOwn(attrs, name) || typeof attrs[name] !== "string") {
            throw new TypeError(`hson-template override ${JSON.stringify(name)} requires an existing string-valued root attribute.`);
          }
          attrs = plan_public_attr_set(attrs, name, value);
        }
        copy.$_attrs = attrs;
      }
      if (frame.customization.text !== undefined) {
        if (sole_immediate_string(item) === undefined) {
          throw new TypeError("hson-template text replacement requires an existing sole immediate logical string.");
        }
        // Traverse only the replacement, charging its ELEM, STR and payload through the ordinary budgets.
        content = [{ $_tag: ELEM_TAG, $_content: [{ $_tag: STR_TAG, $_content: [frame.customization.text] }] }];
      }
    }
    chargeHeader(copy);
    frame.output.push(copy);
    if (content.length) push({
      source: content, output: copy.$_content, index: 0, owner: copy,
      ...(item.$_tag === ELEM_TAG ? { emptyClusterParent: frame.owner } : {}),
    });
  }
  // Temporary copied identity data never crosses admission; strip using the existing facility.
  return clone_hson_graph_without_quids(root);
}
