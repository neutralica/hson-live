import { ELEM_TAG, ROOT_TAG } from "../../core/constants.js";
import { is_Node } from "../../core/node-guards.js";
import type { HsonNode, NodeContent, Primitive } from "../../core/types.js";
import { ANY_DOCUMENT, HsonSchema } from "../schema/hson-schema.js";
import { materialize_owned_occurrences } from "../livetree/runtime/materialize-occurrences.js";
import { clone_hson_graph_without_quids } from "./livemap.document.capture.js";

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

type Frame = {
  source: readonly (HsonNode | Primitive)[];
  output: NodeContent;
  index: number;
  library?: string;
  owner: HsonNode;
  emptyClusterParent?: HsonNode;
};

/**
 * Expand already owned document roots into private occurrences. The receiver
 * supplies a callback-free, revision-fenced read and performs final admission.
 * No subscriptions, source identities, or composition provenance are retained.
 * @internal
 */
export function expand_document_composition(
  sourceName: string,
  read: (name: string) => HsonNode,
  limits: Readonly<{ maxDepth: number; maxNodes: number; maxCharacters: number }>,
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
  const active = new Set([sourceName]);
  const frames: Frame[] = [{ source: source(sourceName).$_content, output: root.$_content, index: 0, library: sourceName, owner: root }];
  const push = (frame: Frame): void => {
    // Bound both recursive references and canonical graph nesting before later qualification/copying.
    if (frames.length >= limits.maxDepth) throw new Error("Document composition depth limit exceeded.");
    frames.push(frame);
  };
  while (frames.length) {
    const frame = frames[frames.length - 1]!;
    if (frame.index === frame.source.length) {
      frames.pop();
      if (frame.library !== undefined) active.delete(frame.library);
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
      if (Object.keys(attrs).some(key => key !== "lib")) throw new TypeError("Unsupported hson-template attribute; only lib is supported.");
      const lib = Object.getOwnPropertyDescriptor(attrs, "lib")?.value;
      if (typeof lib !== "string" || lib.length === 0) throw new TypeError("hson-template requires a nonempty lib attribute.");
      if (item.$_content.length !== 0) throw new TypeError("hson-template content is not supported.");
      if (active.has(lib)) throw new Error(`Recursive document composition cycle: ${[...active, lib].join(" -> ")}.`);
      const selected = source(lib);
      push({ source: selected.$_content, output: frame.output, index: 0, library: lib, owner: frame.owner });
      active.add(lib);
      continue;
    }
    const header: HsonNode = { $_tag: item.$_tag, $_content: [] };
    if (item.$_attrs !== undefined) header.$_attrs = item.$_attrs;
    if (item.$_meta !== undefined) header.$_meta = item.$_meta;
    chargeHeader(header);
    const copy = materialize_owned_occurrences(header);
    frame.output.push(copy);
    if (item.$_content.length) push({
      source: item.$_content, output: copy.$_content, index: 0, owner: copy,
      ...(item.$_tag === ELEM_TAG ? { emptyClusterParent: frame.owner } : {}),
    });
  }
  // Temporary copied identity data never crosses admission; strip using the existing facility.
  return clone_hson_graph_without_quids(root);
}
