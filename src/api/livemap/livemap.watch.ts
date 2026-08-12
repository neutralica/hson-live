import type {
  LiveMapAnyOp,
  LiveMapCommit,
  LiveMapDisposer,
} from "../../types/livemap.types.js";
import type { HsonNode, Primitive } from "../../core/types.js";
import { is_Node } from "../../core/node-guards.js";
import { canonical_hson_graph_equal } from "../../core/canonical-hson-equal.js";
import { clone_live_root } from "./livemap.editor.js";

export type LiveMapDocumentEndpoint = HsonNode | Primitive | undefined;

export type LiveMapDocumentWatchRegistration = (
  path: readonly number[],
  listener: (next: LiveMapDocumentEndpoint) => void,
) => LiveMapDisposer;

/** Exact optional equality for one detached logical document endpoint. */
export function optional_livemap_document_endpoint_equal(
  left: LiveMapDocumentEndpoint,
  right: LiveMapDocumentEndpoint,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (is_Node(left) || is_Node(right)) {
    return is_Node(left) && is_Node(right) && canonical_hson_graph_equal(left, right);
  }
  return Object.is(left, right);
}

/** Clone a document endpoint before retaining or publishing it. */
export function detach_livemap_document_endpoint(
  value: LiveMapDocumentEndpoint,
): LiveMapDocumentEndpoint {
  return is_Node(value) ? clone_live_root(value) : value;
}

/** First isolated listener failure captured during one watch publication. */
export type LiveMapWatchPublicationFailure = Readonly<{
  error: unknown;
}>;

type LiveMapWatchEntry<TPath extends readonly unknown[], TValue, TPublicValue> = {
  readonly path: TPath;
  readonly listener: (next: TPublicValue) => void;
  previous: TValue;
};

type LiveMapWatchHubOptions<TPath extends readonly unknown[], TValue, TPublicValue> = Readonly<{
  clonePath: (path: TPath) => TPath;
  read: (path: TPath) => TValue;
  equal: (left: TValue, right: TValue) => boolean;
  detach: (value: TValue) => TPublicValue;
  relevant: (commit: LiveMapCommit<LiveMapAnyOp>, path: TPath) => boolean;
}>;

/** Dedicated map-owned value publication for passive logical locations. */
export function make_livemap_watch_hub<
  TPath extends readonly unknown[],
  TValue,
  TPublicValue,
>(
  options: LiveMapWatchHubOptions<TPath, TValue, TPublicValue>,
): LiveMapWatchHub<TPath, TPublicValue> {
  const entries: Array<LiveMapWatchEntry<TPath, TValue, TPublicValue>> = [];

  const add = (
    path: TPath,
    listener: (next: TPublicValue) => void,
  ): LiveMapDisposer => {
    if (typeof listener !== "function") {
      throw new TypeError("LiveMap watch listener must be a function.");
    }
    const entry: LiveMapWatchEntry<TPath, TValue, TPublicValue> = {
      path: options.clonePath(path),
      listener,
      previous: options.read(path),
    };
    entries.push(entry);
    return () => {
      const index = entries.indexOf(entry);
      if (index !== -1) entries.splice(index, 1);
    };
  };

  const emitCommit = (
    commit: LiveMapCommit<LiveMapAnyOp>,
  ): LiveMapWatchPublicationFailure | undefined => {
    if (!commit.changed) return undefined;
    return publish((entry) => {
      if (!options.relevant(commit, entry.path)) return;
      const next = options.read(entry.path);
      if (options.equal(next, entry.previous)) return;
      entry.previous = next;
      entry.listener(options.detach(next));
    });
  };

  const emitSnapshot = (): LiveMapWatchPublicationFailure | undefined => {
    return publish((entry) => {
      const next = options.read(entry.path);
      entry.previous = next;
      entry.listener(options.detach(next));
    });
  };

  const publish = (
    deliver: (entry: LiveMapWatchEntry<TPath, TValue, TPublicValue>) => void,
  ): LiveMapWatchPublicationFailure | undefined => {
    let firstFailure: LiveMapWatchPublicationFailure | undefined;
    for (const entry of [...entries]) {
      try {
        deliver(entry);
      } catch (error) {
        firstFailure ??= Object.freeze({ error });
      }
    }
    return firstFailure;
  };

  return Object.freeze({ add, emitCommit, emitSnapshot });
}

/** Preserve existing observer failure precedence over an isolated watch failure. */
export function publish_livemap_after_watch(
  watchFailure: LiveMapWatchPublicationFailure | undefined,
  publishExisting: () => void,
): void {
  publishExisting();
  if (watchFailure !== undefined) throw watchFailure.error;
}

export type LiveMapWatchHub<
  TPath extends readonly unknown[],
  TPublicValue,
> = Readonly<{
  add: (path: TPath, listener: (next: TPublicValue) => void) => LiveMapDisposer;
  emitCommit: (commit: LiveMapCommit<LiveMapAnyOp>) => LiveMapWatchPublicationFailure | undefined;
  emitSnapshot: () => LiveMapWatchPublicationFailure | undefined;
}>;
