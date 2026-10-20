import { make_parts_facade } from "../../internal/parts-facade.js";
import { make_family_selectors } from "../../internal/library-selectors.js";
import { PART_COLLECTION_VALIDATION } from "./livemap.parts.js";
import { normalize_document_request_target } from "./livemap.document.target.js";
import { document_css_commands, capture_document_css_command } from "../../internal/document-css-commands.js";
import { collection_commands } from "./livemap.collection-command.js";
import type { LiveMap, LiveMapCssOp, LiveMapDocumentContent, LiveMapDocumentCommitTarget, LiveMapDocumentRequestTarget, LiveMapGraphOp, LivePath, LiveMapStagedWriter } from "../../types/livemap.types.js";
import type { JsonValue } from "../../core/types.js";
import { projected_value_from_hson_node } from "../../core/projected-value-graph.js";
import { is_ordered_projected_object, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { canonical_portable_document_css_op } from "../../internal/css/portable-document-operations.js";
import { INTERACTION_RESERVED_LIBRARY_KEY, register_interaction_draft_internal } from "../../internal/interaction-storage.js";
import { capture_document_attrs_command, type DocumentAttrsCommand, admit_public_document_graph_operation } from "./livemap.document.mutation.js";
import { validate_document_path } from "./livemap.document.path.js";
import { must_json_value, must_live_path } from "./livemap.guard.js";
import type { InternalLiveMapAggregateAuthority } from "./livemap.internal.js";
import type { LiveMapAggregateWrite, LiveMapLibraryIdentity } from "./livemap.library.js";

type StagedDataPath = Readonly<{
  at: (path: LivePath) => StagedDataPath;
  set: (value: JsonValue) => void;
  replace: (value: JsonValue) => void;
  delete: () => void;
  asArray: () => StagedDataPath;
  asObject: () => StagedDataPath;
}>;

export type StagedDocumentLocation = Readonly<{
  asElement: () => StagedDocumentLocation;
  asRoot: () => StagedDocumentLocation;
  asText: () => StagedDocumentLocation;
  at: (path: readonly number[]) => StagedDocumentLocation;
  replace: (value: LiveMapDocumentContent) => void;
  delete: () => void;
  insert: (index: number, value: LiveMapDocumentContent) => void;
  move: (from: number, to: number) => void;
  flags: Readonly<{ set: (...names: string[]) => void; clear: (...names: string[]) => void }>;
  attrs: Readonly<{
    set: (name: string, value: import("../../types/livemap.types.js").LiveMapDocumentAttributeValue) => void;
    drop: (name: string) => void;
    replace: (values: import("../../types/livemap.types.js").LiveMapDocumentAttrs) => void;
    setMany: (values: import("../../types/livemap.types.js").LiveMapDocumentAttrs) => void;
    dropMany: (names: readonly string[]) => void;
    clear: () => void;
  }>;
}>;

type StagedDocumentLibrary = Readonly<{
  mode: "document";
  at: (path: readonly number[]) => StagedDocumentLocation;
  graph: (operation: LiveMapGraphOp) => void;
  attrs: Readonly<{
    set: (target: LiveMapDocumentRequestTarget, name: string, value: import("../../types/livemap.types.js").LiveMapDocumentAttributeValue) => void;
    drop: (target: LiveMapDocumentRequestTarget, name: string) => void;
    replace: (target: LiveMapDocumentRequestTarget, values: import("../../types/livemap.types.js").LiveMapDocumentAttrs) => void;
    setMany: (target: LiveMapDocumentRequestTarget, values: import("../../types/livemap.types.js").LiveMapDocumentAttrs) => void;
    dropMany: (target: LiveMapDocumentRequestTarget, names: readonly string[]) => void;
    clear: (target: LiveMapDocumentRequestTarget) => void;
  }>;
  flags: Readonly<{ set: (target: LiveMapDocumentRequestTarget, ...names: string[]) => void; clear: (target: LiveMapDocumentRequestTarget, ...names: string[]) => void }>;
  content: Readonly<{
    replace: (target: LiveMapDocumentRequestTarget, index: number, replacement: LiveMapDocumentContent) => void;
    insert: (target: LiveMapDocumentRequestTarget, index: number, content: LiveMapDocumentContent) => void;
    remove: (target: LiveMapDocumentRequestTarget, index: number) => void;
    move: (target: LiveMapDocumentRequestTarget, from: number, to: number) => void;
  }>;
  css: ((operation: LiveMapCssOp) => void) & import("../../types/document-css.types.js").DocumentCssCommands<void>;
}>;

type StagedDataLibrary = Readonly<{
  mode: Exclude<import("../../types/livemap.types.js").LiveMapRootMode, "document">;
  at: (path: LivePath) => StagedDataPath;
}>;

/** One callback-local command list shared by LiveMap batch and Locus stage. */
export function make_livemap_staged_writer<TMap extends LiveMap>(
  aggregate: InternalLiveMapAggregateAuthority,
): Readonly<{
  writer: LiveMapStagedWriter<TMap, void>;
  writes: () => readonly LiveMapAggregateWrite[];
  close: () => void;
}> {
  const registry = aggregate.hostedRegistry();
  const identities = aggregate.libraries();
  const byName = new Map<string, Readonly<{ identity: LiveMapLibraryIdentity; mode: import("../../types/livemap.types.js").LiveMapRootMode }>>();
  let applicationIndex = 0;
  for (const library of registry.libraries) {
    if (library.scope === "hson-internal") continue;
    const identity = identities[applicationIndex++];
    if (identity === undefined) throw new Error("Staged LiveMap library identity binding is unavailable.");
    byName.set(library.name, Object.freeze({ identity, mode: library.mode }));
  }
  const writes: LiveMapAggregateWrite[] = [];
  let open = true;
  const assert_open = (): void => {
    if (!open) throw new Error("Expired staged authoring scope.");
  };
  const data_path = (identity: LiveMapLibraryIdentity, path: LivePath, checks: readonly LiveMapAggregateWrite[] = []): StagedDataPath => {
    const stablePath = must_live_path(path);
    const target = aggregate.target(identity, stablePath);
    const assert_current = () => { assert_open(); writes.push(...checks); };
    const require_shape = (collection: "array" | "object"): StagedDataPath => {
      assert_current();
      const assertion: LiveMapAggregateWrite = Object.freeze({ target, kind: "collection", command: Object.freeze({
        collection, method: "assert-shape", args: Object.freeze<[]>([]),
      }) });
      writes.push(assertion);
      return data_path(identity, stablePath, [...checks, assertion]);
    };
    return Object.freeze({
      asArray: () => require_shape("array"),
      asObject: () => require_shape("object"),
      ...collection_commands(command => {
        assert_current();
        writes.push(Object.freeze({ target, kind: "collection", command }));
      }),
      at(child: LivePath) {
        assert_open();
        return data_path(identity, [...stablePath, ...must_live_path(child)], checks);
      },
      set(value: JsonValue) {
        assert_current();
        writes.push(Object.freeze({ target, kind: "set", value: must_json_value(value, stablePath) }));
      },
      replace(value: JsonValue) {
        assert_current();
        writes.push(Object.freeze({ target, kind: "replace", value: must_json_value(value, stablePath) }));
      },
      delete() {
        assert_current();
        writes.push(Object.freeze({ target, kind: "delete" }));
      },
    });
  };
  const document_library = (identity: LiveMapLibraryIdentity): StagedDocumentLibrary => {
    const graph = (operation: LiveMapGraphOp, logicalLocation?: readonly number[]): void => {
      assert_open();
      const captured = admit_public_document_graph_operation(operation);
      const path = captured.op === "replace-root" ? [] : captured.target.path;
      writes.push(Object.freeze({ target: aggregate.target(identity, path), kind: "graph", operation: captured, publicStaged: true, ...(logicalLocation === undefined ? {} : { logicalLocation }) }));
    };
    const request_target = (input: LiveMapDocumentRequestTarget): LiveMapDocumentCommitTarget => {
      assert_open();
      const request = normalize_document_request_target(input, "replace-attrs");
      return Object.freeze({ kind: "path", path: validate_document_path(request.path) });
    };
    const bulk = (input: LiveMapDocumentRequestTarget, command: DocumentAttrsCommand, logicalLocation?: readonly number[]): void => {
      assert_open();
      const target = request_target(input);
      const attrsCommand = capture_document_attrs_command(command);
      const captured = admit_public_document_graph_operation({ domain: "graph", op: "replace-attrs", target, attrs: {} });
      writes.push(Object.freeze({ target: aggregate.target(identity, target.path), kind: "graph", operation: captured,
        publicStaged: true, attrsCommand, ...(logicalLocation === undefined ? {} : { logicalLocation }) }));
    };
    const location = (input: readonly number[]): StagedDocumentLocation => {
      assert_open();
      const path = validate_document_path(input);
      const target = Object.freeze({ kind: "path" as const, path });
      const content_slot = (): Readonly<{ target: typeof target; index: number }> => {
        assert_open();
        if (path.length === 0) throw new Error("Document root is not a replaceable content slot.");
        const index = path[path.length - 1];
        if (index === undefined) throw new Error("Document content index is unavailable.");
        return Object.freeze({ target: Object.freeze({ kind: "path" as const, path: validate_document_path(path.slice(0, -1)) }), index });
      };
      const logicalGraph = (operation: LiveMapGraphOp): void => graph(operation, path);
      const refine = (assertDocumentShape: "element" | "root" | "text"): StagedDocumentLocation => {
        assert_open();
        writes.push(Object.freeze({ target: aggregate.target(identity, path), kind: "graph",
          operation: Object.freeze({ domain: "graph", op: "replace-attrs", target, attrs: {} }),
          logicalLocation: path, assertDocumentShape }));
        return location(path);
      };
      const attrs: StagedDocumentLocation["attrs"] = Object.freeze({
        set: (name, value) => logicalGraph(Object.freeze({ domain: "graph", op: "set-attr", target, name, value })),
        drop: (name) => logicalGraph(Object.freeze({ domain: "graph", op: "remove-attr", target, name })),
        replace: (values) => logicalGraph(Object.freeze({ domain: "graph", op: "replace-attrs", target, attrs: values })),
        setMany: (values) => bulk(target, { kind: "setMany", values }, path),
        dropMany: (names) => bulk(target, { kind: "dropMany", names }, path),
        clear: () => logicalGraph({ domain: "graph", op: "replace-attrs", target, attrs: {} }),
      });
      return Object.freeze({
        asElement: () => refine("element"), asRoot: () => refine("root"), asText: () => refine("text"),
        at: (child) => location([...path, ...validate_document_path(child)]),
        replace: (replacement) => {
          const slot = content_slot();
          logicalGraph(Object.freeze({ domain: "graph", op: "replace-content", target: slot.target, index: slot.index, replacement }));
        },
        delete: () => {
          const slot = content_slot();
          logicalGraph(Object.freeze({ domain: "graph", op: "remove-content", target: slot.target, index: slot.index }));
        },
        insert: (index, content) => logicalGraph(Object.freeze({ domain: "graph", op: "insert-content", target, index, content })),
        move: (from, to) => logicalGraph(Object.freeze({ domain: "graph", op: "move-content", target, from, to })),
        attrs,
        flags: Object.freeze({
          set: (...names: string[]) => bulk(target, { kind: "setFlags", names }, path),
          clear: (...names: string[]) => bulk(target, { kind: "clearFlags", names }, path),
        }),
      });
    };
    const css = Object.assign((operation: LiveMapCssOp) => {
      assert_open();
      writes.push(Object.freeze({ target: aggregate.target(identity, []), kind: "css",
        operation: canonical_portable_document_css_op(operation) }));
    }, document_css_commands(command => {
      assert_open();
      writes.push(Object.freeze({ target: aggregate.target(identity, []), kind: "css",
        operation: Object.freeze({ domain: "css", kind: "clear-all" }), cssCommand: capture_document_css_command(command) }));
    }, assert_open));
    const staged: StagedDocumentLibrary = Object.freeze({
      mode: "document",
      at: location,
      graph,
      attrs: Object.freeze({
        set: (target: LiveMapDocumentRequestTarget, name: string, value: import("../../types/livemap.types.js").LiveMapDocumentAttributeValue) => graph(Object.freeze({ domain: "graph", op: "set-attr", target: request_target(target), name, value })),
        drop: (target: LiveMapDocumentRequestTarget, name: string) => graph(Object.freeze({ domain: "graph", op: "remove-attr", target: request_target(target), name })),
        setMany: (target: LiveMapDocumentRequestTarget, values: import("../../types/livemap.types.js").LiveMapDocumentAttrs) => bulk(target, { kind: "setMany", values }),
        dropMany: (target: LiveMapDocumentRequestTarget, names: readonly string[]) => bulk(target, { kind: "dropMany", names }),
        clear: (target: LiveMapDocumentRequestTarget) => graph({ domain: "graph", op: "replace-attrs", target: request_target(target), attrs: {} }),
        replace: (target: LiveMapDocumentRequestTarget, values: import("../../types/livemap.types.js").LiveMapDocumentAttrs) => graph(Object.freeze({ domain: "graph", op: "replace-attrs", target: request_target(target), attrs: values })),
      }),
      flags: Object.freeze({
        set: (target: LiveMapDocumentRequestTarget, ...names: string[]) => bulk(target, { kind: "setFlags", names }),
        clear: (target: LiveMapDocumentRequestTarget, ...names: string[]) => bulk(target, { kind: "clearFlags", names }),
      }),
      content: Object.freeze({
        replace(target: LiveMapDocumentRequestTarget, index: number, replacement: LiveMapDocumentContent) {
          if (arguments.length !== 3) throw new TypeError("Document content replacement requires exactly three arguments; caller-authored lineage is unsupported.");
          return graph(Object.freeze({ domain: "graph", op: "replace-content", target: request_target(target), index, replacement }));
        },
        insert: (target: LiveMapDocumentRequestTarget, index: number, content: LiveMapDocumentContent) => graph(Object.freeze({ domain: "graph", op: "insert-content", target: request_target(target), index, content })),
        remove: (target: LiveMapDocumentRequestTarget, index: number) => graph(Object.freeze({ domain: "graph", op: "remove-content", target: request_target(target), index })),
        move: (target: LiveMapDocumentRequestTarget, from: number, to: number) => graph(Object.freeze({ domain: "graph", op: "move-content", target: request_target(target), from, to })),
      }),
      css,
    });
    return staged;
  };
  const selectedFacades = new Map<LiveMapLibraryIdentity, StagedDataLibrary | StagedDocumentLibrary>();
  const selected = (name: string): StagedDataLibrary | StagedDocumentLibrary => {
    assert_open();
    const binding = byName.get(name);
    if (binding === undefined) throw new Error(`Unknown staged LiveMap Library ${JSON.stringify(name)}.`);
    const existing = selectedFacades.get(binding.identity);
    if (existing !== undefined) return existing;
    const facade = binding.mode === "document"
      ? document_library(binding.identity)
      : Object.freeze({ mode: binding.mode, at: (path: LivePath) => { assert_open(); return data_path(binding.identity, path); } });
    const contract = registry.libraries.find(entry => entry.name === name && entry.scope === undefined);
    const handle = facade.mode !== "document" && contract?.validation === PART_COLLECTION_VALIDATION
      ? make_parts_facade(facade, key => {
        assert_open();
        // Stages collect commands; membership reads the current committed binding.
        return aggregate.snap(binding.identity, [key]) !== undefined;
      }) : facade;
    selectedFacades.set(binding.identity, handle);
    return handle;
  };
  const writer = Object.freeze(make_family_selectors(name => {
    assert_open();
    const binding = byName.get(name);
    if (binding === undefined) return undefined;
    const contract = registry.libraries.find(entry => entry.name === name && entry.scope === undefined);
    if (contract === undefined) throw new Error("Staged Library contract is unavailable.");
    return { family: binding.mode === "document" ? "doc" : contract.validation === PART_COLLECTION_VALIDATION ? "parts" : "data",
      schema: aggregate.librarySchema(binding.identity), handle: selected(name) };
  }));
  const interactionSystem = aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY);
  if (interactionSystem !== undefined) {
    const interactionRoot = projected_value_from_hson_node(aggregate.systemRoot(interactionSystem));
    if (!is_ordered_projected_object(interactionRoot)) throw new Error("Canonical interaction Library root is malformed.");
    const initial = interactionRoot.entries.find(([name]) => name === "descriptors")?.[1];
    if (initial === undefined) throw new Error("Canonical interaction descriptor collection is missing.");
    let interactionValue: OrderedProjectedValue = initial;
    register_interaction_draft_internal(writer, interactionSystem, () => interactionValue, (value) => {
      assert_open();
      interactionValue = value;
      writes.push(Object.freeze({ target: aggregate.systemTarget(interactionSystem, ["descriptors"]), kind: "replace", value }));
    });
  }
  return Object.freeze({
    writer: writer as unknown as LiveMapStagedWriter<TMap, void>,
    writes: () => Object.freeze([...writes]),
    close: () => { open = false; },
  });
}

export function is_staged_thenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === "object" && value !== null || typeof value === "function")
    && typeof (value as PromiseLike<unknown>).then === "function";
}
