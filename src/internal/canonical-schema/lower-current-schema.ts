import type {
  CurrentDocumentSchemaCapabilities,
  DocumentAttrsNode,
  DocumentContentNode,
  DocumentItemNode,
  DocumentRootNode,
} from "../../api/livemap/livemap.document.schema.js";
import type { LiveMapSchemaNode } from "../../api/livemap/livemap.schema.js";
import {
  CANONICAL_SCHEMA_FORMAT,
  CANONICAL_SCHEMA_VERSION,
  type CanonicalDocumentAttrProperty,
  type CanonicalSchemaCapabilities,
  type CanonicalSchemaGraph,
  type CanonicalSchemaNode,
  type CanonicalSchemaNodeRef,
  type VerifiedCanonicalSchemaGraph,
} from "./graph.js";
import { verify_canonical_schema_graph } from "./verify.js";

export type CurrentSchemaNonLowerableReason = Readonly<{
  code:
    | "CONSTRAIN_CALLBACK"
    | "UNRESOLVED_RECURSE_THUNK"
    | "EXECUTABLE_SEMANTIC"
    | "UNSUPPORTED_CURRENT_NODE"
    | "NO_SCHEMA_CAPABILITY"
    | "INVALID_LOWERED_GRAPH"
    | "CAPABILITY_FAILURE";
  capability?: keyof CanonicalSchemaCapabilities;
  currentKind?: string;
  detail: string;
}>;

export type CurrentSchemaLoweringResult =
  | Readonly<{ ok: true; graph: VerifiedCanonicalSchemaGraph }>
  | Readonly<{ ok: false; reasons: readonly CurrentSchemaNonLowerableReason[] }>;

type CurrentSchemaLoweringReaders = Readonly<{
  projected: (schema: object) => LiveMapSchemaNode | undefined;
  document: (schema: unknown) => CurrentDocumentSchemaCapabilities;
  resolvedRecursion: (recurse: () => LiveMapSchemaNode) => LiveMapSchemaNode | undefined;
}>;

let CURRENT_SCHEMA_READERS: CurrentSchemaLoweringReaders | undefined;

/** Installed once by the current Schema implementation; not a package export. */
export function register_current_schema_lowering_readers(readers: CurrentSchemaLoweringReaders): void {
  if (CURRENT_SCHEMA_READERS !== undefined) return;
  CURRENT_SCHEMA_READERS = Object.freeze(readers);
}

export function lower_current_schema(schema: unknown): CurrentSchemaLoweringResult {
  if ((typeof schema !== "object" && typeof schema !== "function") || schema === null) {
    return failed([{ code: "NO_SCHEMA_CAPABILITY", detail: "Current Schema value is not an object." }]);
  }
  const readers = CURRENT_SCHEMA_READERS;
  if (readers === undefined) {
    return failed([{ code: "NO_SCHEMA_CAPABILITY", detail: "Current Schema lowering readers are not initialized." }]);
  }
  const nodes: CanonicalSchemaNode[] = [];
  const reasons: CurrentSchemaNonLowerableReason[] = [];
  const capabilities: Partial<Record<keyof CanonicalSchemaCapabilities, CanonicalSchemaNodeRef>> = {};
  const projectedRefs = new Map<LiveMapSchemaNode, CanonicalSchemaNodeRef>();
  const documentRefs = new Map<object, CanonicalSchemaNodeRef>();
  let broadContentRef: CanonicalSchemaNodeRef | undefined;
  let activeCapability: keyof CanonicalSchemaCapabilities | undefined;

  const reason = (entry: Omit<CurrentSchemaNonLowerableReason, "capability">): void => {
    reasons.push(Object.freeze({ ...entry, ...(activeCapability === undefined ? {} : { capability: activeCapability }) }));
  };
  const reserve = (): CanonicalSchemaNodeRef => {
    const ref = nodes.length;
    nodes.push(Object.freeze({ kind: "projected-any" }));
    return ref;
  };
  const put = (ref: CanonicalSchemaNodeRef, node: CanonicalSchemaNode): CanonicalSchemaNodeRef => {
    nodes[ref] = Object.freeze(node);
    return ref;
  };

  const projected = (source: LiveMapSchemaNode): CanonicalSchemaNodeRef => {
    const known = projectedRefs.get(source);
    if (known !== undefined) return known;
    const outer = reserve();
    projectedRefs.set(source, outer);
    if (source.kind === "constrain" || typeof source.validate === "function") {
      reason({ code: "CONSTRAIN_CALLBACK", currentKind: source.kind, detail: "Arbitrary constrain callback is executable and cannot be lowered." });
      return outer;
    }
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "function" && key !== "recurse") {
        reason({ code: "EXECUTABLE_SEMANTIC", currentKind: source.kind, detail: `Executable field ${JSON.stringify(key)} is not representable.` });
      }
    }
    const lowerCore = (): CanonicalSchemaNodeRef => {
      const core = source.optional || source.nullable ? reserve() : outer;
      const child = (node: LiveMapSchemaNode | undefined, field: string): CanonicalSchemaNodeRef => {
        if (node !== undefined) return projected(node);
        reason({ code: "UNSUPPORTED_CURRENT_NODE", currentKind: source.kind, detail: `Current node is missing ${field}.` });
        return core;
      };
      switch (source.kind) {
        case "unknown": return put(core, { kind: "projected-any" });
        case "string": return put(core, { kind: "projected-string" });
        case "number": return put(core, { kind: "projected-number" });
        case "boolean": return put(core, { kind: "projected-boolean" });
        case "null": return put(core, { kind: "projected-null" });
        case "literal": return put(core, { kind: "projected-literal", values: Object.freeze([...source.literals]) });
        case "object": return put(core, {
          kind: "projected-object",
          exact: source.exact,
          properties: Object.freeze((source.props ?? []).map(([name, node]) => Object.freeze([name, projected(node)] as const))),
        });
        case "array": return put(core, source.item === undefined ? { kind: "projected-array" } : { kind: "projected-array", item: projected(source.item) });
        case "tuple": return put(core, { kind: "projected-tuple", items: Object.freeze((source.items ?? []).map(projected)) });
        case "record": return put(core, { kind: "projected-record", value: child(source.record, "record value") });
        case "pick": return put(core, { kind: "projected-union", choices: Object.freeze((source.choices ?? []).map(projected)) });
        case "refinement": {
          if (source.base === undefined || source.refinement === undefined) {
            reason({ code: "UNSUPPORTED_CURRENT_NODE", currentKind: source.kind, detail: "Declarative refinement is missing its base or closed rule." });
            return put(core, { kind: "projected-any" });
          }
          return put(core, {
            kind: "projected-refinement",
            base: projected(source.base),
            rule: source.refinement,
            ...(source.label === undefined ? {} : { label: source.label }),
          });
        }
        case "recurse": {
          if (source.recurse === undefined) {
            reason({ code: "UNRESOLVED_RECURSE_THUNK", currentKind: source.kind, detail: "Current recurse node has no resolver." });
            return put(core, { kind: "projected-ref", target: core });
          }
          const resolved = readers.resolvedRecursion(source.recurse);
          if (resolved === undefined) {
            reason({ code: "UNRESOLVED_RECURSE_THUNK", currentKind: source.kind, detail: "Recurse thunk has not been memoized by current runtime use; lowering did not execute it." });
            return put(core, { kind: "projected-ref", target: core });
          }
          return put(core, { kind: "projected-ref", target: projected(resolved) });
        }
        case "reference": {
          if (source.referenceTarget === undefined) {
            reason({ code: "UNSUPPORTED_CURRENT_NODE", currentKind: source.kind, detail: `Symbolic reference ${JSON.stringify(source.referenceName)} is unresolved.` });
            return put(core, { kind: "projected-ref", target: core });
          }
          return put(core, { kind: "projected-ref", target: projected(source.referenceTarget) });
        }
        default:
          reason({ code: "UNSUPPORTED_CURRENT_NODE", currentKind: source.kind, detail: `Unsupported current projected node ${JSON.stringify(source.kind)}.` });
          return put(core, { kind: "projected-any" });
      }
    };
    if (source.optional) {
      const base = source.nullable ? reserve() : lowerCore();
      put(outer, { kind: "projected-optional", base });
      if (source.nullable) put(base, { kind: "projected-nullable", base: lowerCore() });
      return outer;
    }
    if (source.nullable) {
      put(outer, { kind: "projected-nullable", base: lowerCore() });
      return outer;
    }
    return lowerCore();
  };

  const attrs = (source: DocumentAttrsNode): CanonicalSchemaNodeRef => {
    const known = documentRefs.get(source);
    if (known !== undefined) return known;
    const ref = reserve(); documentRefs.set(source, ref);
    const properties: CanonicalDocumentAttrProperty[] = source.props.map(([name, rule]) => {
      if (rule.flag) return Object.freeze({ name, optional: rule.optional, flag: true });
      if (rule.valueSchema === undefined) {
        reason({ code: "EXECUTABLE_SEMANTIC", currentKind: "document-attrs", detail: `Attr ${JSON.stringify(name)} has closure validation without declarative valueSchema evidence.` });
        return Object.freeze({ name, optional: rule.optional, flag: true });
      }
      return Object.freeze({ name, optional: rule.optional, flag: false, value: projected(rule.valueSchema) });
    });
    return put(ref, { kind: "document-attrs", exact: source.exact, properties: Object.freeze(properties) });
  };
  const item = (source: DocumentItemNode): CanonicalSchemaNodeRef => {
    const known = documentRefs.get(source);
    if (known !== undefined) return known;
    const ref = reserve(); documentRefs.set(source, ref);
    if (source.kind === "text") return put(ref, { kind: "document-text" });
    if (source.kind === "unknown") return put(ref, { kind: "document-any-item" });
    if (source.kind === "pick") return put(ref, { kind: "document-item-union", choices: Object.freeze(source.choices.map(item)) });
    const broadContent = (): CanonicalSchemaNodeRef => {
      if (broadContentRef !== undefined) return broadContentRef;
      broadContentRef = reserve();
      return put(broadContentRef, { kind: "document-broad-content" });
    };
    return put(ref, {
      kind: "document-element",
      ...(source.tag === undefined ? {} : { tag: source.tag }),
      ...(source.attrs === undefined ? {} : { attrs: attrs(source.attrs) }),
      content: source.content === undefined ? broadContent() : content(source.content),
    });
  };
  const content = (source: DocumentContentNode): CanonicalSchemaNodeRef => {
    const known = documentRefs.get(source);
    if (known !== undefined) return known;
    const ref = reserve(); documentRefs.set(source, ref);
    if (source.kind === "sequence") return put(ref, { kind: "document-sequence", items: Object.freeze(source.items.map(item)) });
    if (source.kind === "pick") return put(ref, { kind: "document-content-union", choices: Object.freeze(source.choices.map(content)) });
    return put(ref, { kind: "document-repeat", item: item(source.item), ...(source.count === undefined ? {} : { count: source.count }) });
  };
  const root = (source: DocumentRootNode): CanonicalSchemaNodeRef => source.kind === "fragment"
    ? (() => {
      const known = documentRefs.get(source); if (known !== undefined) return known;
      const ref = reserve(); documentRefs.set(source, ref);
      return put(ref, { kind: "document-fragment-root", content: content(source.content) });
    })()
    : item(source);

  const projectedRoot = readers.projected(schema);
  const document = readers.document(schema);
  const add = (key: keyof CanonicalSchemaCapabilities, make: () => number): void => {
    activeCapability = key; capabilities[key] = make();
  };
  if (projectedRoot !== undefined) add("projectedRoot", () => projected(projectedRoot));
  if (document.item !== undefined) add("documentItem", () => item(document.item as DocumentItemNode));
  if (document.content !== undefined) add("documentContent", () => content(document.content as DocumentContentNode));
  if (document.root?.kind === "element") add("documentElementRoot", () => root(document.root as DocumentRootNode));
  if (document.root?.kind === "fragment") add("documentFragmentRoot", () => root(document.root as DocumentRootNode));
  if (document.attrs !== undefined) add("attrs", () => attrs(document.attrs as DocumentAttrsNode));
  activeCapability = undefined;
  if (Object.keys(capabilities).length === 0) reason({ code: "NO_SCHEMA_CAPABILITY", detail: "Value has no current Schema capability." });
  if (reasons.length > 0) return failed(reasons);

  const graph: CanonicalSchemaGraph = Object.freeze({
    format: CANONICAL_SCHEMA_FORMAT,
    version: CANONICAL_SCHEMA_VERSION,
    capabilities: Object.freeze(capabilities),
    nodes: Object.freeze(nodes),
  });
  const verified = verify_canonical_schema_graph(graph);
  if (!verified.ok) return failed([{
    code: "INVALID_LOWERED_GRAPH",
    detail: verified.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
  }]);
  return Object.freeze({ ok: true, graph: verified.graph });
}

function failed(reasons: readonly CurrentSchemaNonLowerableReason[]): CurrentSchemaLoweringResult {
  return Object.freeze({ ok: false, reasons: Object.freeze([...reasons]) });
}
