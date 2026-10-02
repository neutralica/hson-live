import type { LiveMap, LiveMapCssOp, LiveMapDocumentContent, LiveMapDocumentCommitTarget, LiveMapGraphOp, LivePath, LiveMapStagedWriter } from "../../types/livemap.types.js";
import type { JsonValue } from "../../core/types.js";
import { projected_value_from_hson_node } from "../../core/projected-value-graph.js";
import { clone_node } from "../../core/clone-node.js";
import { is_ordered_projected_object, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { canonical_portable_document_css_op } from "../../internal/css/portable-document-operations.js";
import { parse_document_stylesheet } from "../../internal/css/parse-document-stylesheet.js";
import { INTERACTION_RESERVED_LIBRARY_KEY, register_interaction_draft_internal } from "../../internal/interaction-storage.js";
import { admit_public_document_graph_operation } from "./livemap.document.mutation.js";
import { validate_document_path } from "./livemap.document.path.js";
import { must_json_value, must_live_path } from "./livemap.guard.js";
import type { InternalLiveMapAggregateAuthority } from "./livemap.internal.js";
import type { LiveMapAggregateWrite, LiveMapLibraryIdentity } from "./livemap.library.js";

type StagedDataPath = Readonly<{
  at: (path: LivePath) => StagedDataPath;
  set: (value: JsonValue) => void;
  replace: (value: JsonValue) => void;
  delete: () => void;
}>;

type StagedDocumentLocation = Readonly<{
  at: (path: readonly number[]) => StagedDocumentLocation;
  replace: (value: LiveMapDocumentContent) => void;
  delete: () => void;
  insert: (index: number, value: LiveMapDocumentContent) => void;
  move: (from: number, to: number) => void;
  attrs: Readonly<{
    set: (name: string, value: import("../../types/livemap.types.js").LiveMapDocumentAttributeValue) => void;
    drop: (name: string) => void;
    replace: (values: import("../../types/livemap.types.js").LiveMapDocumentAttrs) => void;
  }>;
}>;

type StagedDocumentLibrary = Readonly<{
  mode: "document";
  at: (path: readonly number[]) => StagedDocumentLocation;
  graph: (operation: LiveMapGraphOp) => void;
  attrs: Readonly<{
    set: (target: LiveMapDocumentCommitTarget, name: string, value: import("../../types/livemap.types.js").LiveMapDocumentAttributeValue) => void;
    drop: (target: LiveMapDocumentCommitTarget, name: string) => void;
    replace: (target: LiveMapDocumentCommitTarget, values: import("../../types/livemap.types.js").LiveMapDocumentAttrs) => void;
  }>;
  content: Readonly<{
    replace: (target: LiveMapDocumentCommitTarget, index: number, replacement: LiveMapDocumentContent) => void;
    insert: (target: LiveMapDocumentCommitTarget, index: number, content: LiveMapDocumentContent) => void;
    remove: (target: LiveMapDocumentCommitTarget, index: number) => void;
    move: (target: LiveMapDocumentCommitTarget, from: number, to: number) => void;
  }>;
  css: ((operation: LiveMapCssOp) => void) & Readonly<{ stylesheet: (text: string) => void }>;
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
  const data_path = (identity: LiveMapLibraryIdentity, path: LivePath): StagedDataPath => {
    const stablePath = must_live_path(path);
    const target = aggregate.target(identity, stablePath);
    return Object.freeze({
      at(child: LivePath) {
        assert_open();
        return data_path(identity, [...stablePath, ...must_live_path(child)]);
      },
      set(value: JsonValue) {
        assert_open();
        writes.push(Object.freeze({ target, kind: "set", value: must_json_value(value, stablePath) }));
      },
      replace(value: JsonValue) {
        assert_open();
        writes.push(Object.freeze({ target, kind: "replace", value: must_json_value(value, stablePath) }));
      },
      delete() {
        assert_open();
        writes.push(Object.freeze({ target, kind: "delete" }));
      },
    });
  };
  const document_library = (identity: LiveMapLibraryIdentity): StagedDocumentLibrary => {
    const graph = (operation: LiveMapGraphOp): void => {
      assert_open();
      const captured = clone_node(operation);
      admit_public_document_graph_operation(captured);
      const path = captured.op === "replace-root" ? [] : captured.target.path;
      writes.push(Object.freeze({ target: aggregate.target(identity, path), kind: "graph", operation: captured, publicStaged: true }));
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
      const attrs: StagedDocumentLocation["attrs"] = Object.freeze({
        set: (name, value) => graph(Object.freeze({ domain: "graph", op: "set-attr", target, name, value })),
        drop: (name) => graph(Object.freeze({ domain: "graph", op: "remove-attr", target, name })),
        replace: (values) => graph(Object.freeze({ domain: "graph", op: "replace-attrs", target, attrs: values })),
      });
      return Object.freeze({
        at: (child) => location([...path, ...validate_document_path(child)]),
        replace: (replacement) => {
          const slot = content_slot();
          graph(Object.freeze({ domain: "graph", op: "replace-content", target: slot.target, index: slot.index, replacement }));
        },
        delete: () => {
          const slot = content_slot();
          graph(Object.freeze({ domain: "graph", op: "remove-content", target: slot.target, index: slot.index }));
        },
        insert: (index, content) => graph(Object.freeze({ domain: "graph", op: "insert-content", target, index, content })),
        move: (from, to) => graph(Object.freeze({ domain: "graph", op: "move-content", target, from, to })),
        attrs,
      });
    };
    const css = Object.assign((operation: LiveMapCssOp) => {
      assert_open();
      writes.push(Object.freeze({ target: aggregate.target(identity, []), kind: "css",
        operation: canonical_portable_document_css_op(operation) }));
    }, { stylesheet: (text: string) => {
      css({ domain: "css", kind: "replace", stylesheet: parse_document_stylesheet(text, []) });
    } });
    const staged: StagedDocumentLibrary = Object.freeze({
      mode: "document",
      at: location,
      graph,
      attrs: Object.freeze({
        set: (target: LiveMapDocumentCommitTarget, name: string, value: import("../../types/livemap.types.js").LiveMapDocumentAttributeValue) => graph(Object.freeze({ domain: "graph", op: "set-attr", target, name, value })),
        drop: (target: LiveMapDocumentCommitTarget, name: string) => graph(Object.freeze({ domain: "graph", op: "remove-attr", target, name })),
        replace: (target: LiveMapDocumentCommitTarget, values: import("../../types/livemap.types.js").LiveMapDocumentAttrs) => graph(Object.freeze({ domain: "graph", op: "replace-attrs", target, attrs: values })),
      }),
      content: Object.freeze({
        replace: (target: LiveMapDocumentCommitTarget, index: number, replacement: LiveMapDocumentContent) => graph(Object.freeze({ domain: "graph", op: "replace-content", target, index, replacement })),
        insert: (target: LiveMapDocumentCommitTarget, index: number, content: LiveMapDocumentContent) => graph(Object.freeze({ domain: "graph", op: "insert-content", target, index, content })),
        remove: (target: LiveMapDocumentCommitTarget, index: number) => graph(Object.freeze({ domain: "graph", op: "remove-content", target, index })),
        move: (target: LiveMapDocumentCommitTarget, from: number, to: number) => graph(Object.freeze({ domain: "graph", op: "move-content", target, from, to })),
      }),
      css,
    });
    return staged;
  };
  const selected = (name: string): StagedDataLibrary | StagedDocumentLibrary => {
    assert_open();
    const binding = byName.get(name);
    if (binding === undefined) throw new Error(`Unknown staged LiveMap Library ${JSON.stringify(name)}.`);
    return binding.mode === "document"
      ? document_library(binding.identity)
      : Object.freeze({ mode: binding.mode, at: (path: LivePath) => data_path(binding.identity, path) });
  };
  const writer = Object.freeze({ lib: selected });
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
