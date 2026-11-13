import { is_Node } from "../../core/node-guards.js";
import { ROOT_TAG } from "../../core/constants.js";
import { validate_document_path, resolve_document_path } from "../livemap/livemap.document.path.js";
import { wrap_in_tree } from "../livetree/creation/create-livetree.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { resolve_livemap_action_internal } from "../livemap/livemap.actions.js";
import { kind_live_path, project_live_path } from "../livemap/livemap.editor.js";
import {
  is_ordered_projected_object,
  ordered_projected_array,
  ordered_projected_object,
  type OrderedProjectedObject,
  type OrderedProjectedValue,
} from "../../core/ordered-projected-value.js";
import {
  encode_hson_data_internal,
  hson_data_from_value,
} from "../data/hson-data.js";
import type { LiveMap, LiveMapStagedWriter } from "../../types/livemap.types.js";
import type { LiveTree } from "../livetree/livetree.js";
import type { ListenerSub } from "../../types/listen.types.js";
import { install_livetree_listener, resolve_livetree_listener_targets_internal } from "../livetree/managers/listener-builder.js";
import type {
  InteractionActivationOptions,
  InteractionDescriptor,
  InteractionFailure,
  InteractionListener,
} from "../../types/interaction.types.js";
import {
  commit_interaction_edit_internal,
  interaction_draft_capability_internal,
  require_interaction_system_internal,
} from "../../internal/interaction-storage.js";
import {
  observe_livetree_realizations_internal,
  active_subject_for_tree,
  runtime_for_tree,
} from "../livetree/runtime/livetree-runtime.js";

import { descriptor_array, descriptor_id, descriptor_to_value, interaction_addition, interaction_descriptor } from "./interactions.descriptor.js";

type Storage = Readonly<{
  update: (edit: (current: OrderedProjectedValue) => OrderedProjectedValue) => void;
}>;

type RuntimeRecord = Readonly<{
  fingerprint: string;
  node: object;
  subject: LiveTree;
  sub: ListenerSub;
  state: { consumed: boolean };
}>;

type UnresolvedBehavior = Readonly<{
  fingerprint: string;
  node: object | undefined;
}>;
type RuntimeDescriptor = ReturnType<typeof interaction_descriptor>;

type ActivationSnapshot = Readonly<{
  map: LiveMap;
  tree: LiveTree;
  document: string;
  dispatch: InteractionActivationOptions["dispatch"];
  onFailure: InteractionActivationOptions["onFailure"];
}>;

let activationInitializationHook: (() => void) | undefined;
let activationInitializationMaterializationHook: (() => void) | undefined;

/** @internal Deterministic acceptance-test seam; never exported by a package entrypoint. */
export function set_interaction_activation_initialization_hook_for_tests(
  hook: (() => void) | undefined,
): void {
  activationInitializationHook = hook;
}

/** @internal Deterministic post-materialization acceptance-test seam; never exported by a package entrypoint. */
export function set_interaction_activation_initialization_materialization_hook_for_tests(
  hook: (() => void) | undefined,
): void {
  activationInitializationMaterializationHook = hook;
}

/** Confirm the canonical interaction storage already provisioned by LiveMap. */
export function enable_interactions(map: LiveMap): void {
  require_interaction_system_internal(internal_livemap_aggregate_authority(map));
}

export function add_interaction(target: LiveMap | LiveMapStagedWriter<LiveMap, void>, descriptor: InteractionDescriptor): void {
  const storage = interaction_storage(target);
  storage.update(interaction_addition(descriptor));
}

export function replace_interaction(target: LiveMap | LiveMapStagedWriter<LiveMap, void>, descriptor: InteractionDescriptor): void {
  const storage = interaction_storage(target);
  const value = descriptor_to_value(descriptor);
  const id = descriptor.id;
  storage.update((descriptors) => {
    const current = descriptor_array(descriptors);
    const index = current.findIndex((entry) => descriptor_id(entry) === id);
    if (index < 0) throw new Error(`Canonical interaction ${JSON.stringify(id)} does not exist.`);
    const next = [...current];
    next[index] = value;
    return ordered_projected_array(next);
  });
}

export function remove_interaction(target: LiveMap | LiveMapStagedWriter<LiveMap, void>, descriptorId: string): void {
  if (typeof descriptorId !== "string") throw new TypeError("Canonical interaction ID must be a string.");
  const storage = interaction_storage(target);
  storage.update((descriptors) => {
    const current = descriptor_array(descriptors);
    const index = current.findIndex((entry) => descriptor_id(entry) === descriptorId);
    if (index < 0) throw new Error(`Canonical interaction ${JSON.stringify(descriptorId)} does not exist.`);
    return ordered_projected_array(current.filter((_, candidate) => candidate !== index));
  });
}

/** Materialize current canonical interaction intent against one fixed active LiveTree. */
export function activate_interactions(options: InteractionActivationOptions): () => void {
  return activate_with_tree_provider(options);
}

/** Document lifecycle owns this provider; public activation retains fixed-tree semantics. @internal */
export function activate_document_interactions_internal(
  options: InteractionActivationOptions, currentTree: () => LiveTree,
): () => void {
  return activate_with_tree_provider(options, currentTree);
}

function activate_with_tree_provider(options: InteractionActivationOptions, currentTree?: () => LiveTree): () => void {
  const activation = snapshot_activation(options, currentTree);
  const aggregate = internal_livemap_aggregate_authority(activation.map);
  const system = require_interaction_system_internal(aggregate);
  const records = new Map<string, RuntimeRecord>();
  let unresolvedBehaviors = new Map<string, UnresolvedBehavior>();
  let disposed = false;
  let reconciling = false;
  let pending = false;
  let initializing = true;
  let stopCommit: (() => void) | undefined;
  let stopRestore: (() => void) | undefined;
  let stopRealizations: (() => void) | undefined;

  const report = (descriptor: InteractionDescriptor, phase: InteractionFailure["phase"], cause: unknown): void => {
    try { activation.onFailure?.(Object.freeze({ descriptor, phase, cause })); } catch { /* observer isolation */ }
  };

  const reconcile = (): void => {
    if (disposed) return;
    if (reconciling) { pending = true; return; }
    reconciling = true;
    try {
      do {
        pending = false;
        const desired = read_descriptors(installed_descriptors(aggregate.systemRoot(system)));
        const desiredById = new Map(desired.map((descriptor) => [descriptor.id, descriptor] as const));

        for (const [id, record] of [...records]) {
          const descriptor = desiredById.get(id);
          let subject: LiveTree | undefined;
          try { subject = descriptor === undefined ? undefined : resolve_local_subject(activation, descriptor); }
          catch { subject = undefined; }
          const fingerprint = descriptor === undefined ? undefined : descriptor_fingerprint(descriptor);
          if (descriptor === undefined || subject === undefined
            || active_subject_for_tree(subject) !== record.node || fingerprint !== record.fingerprint) {
            record.sub.off();
            records.delete(id);
          }
        }

        // Native listeners can only be appended after those we retain. Keep
        // the longest desired active prefix already in installation order,
        // then move only the remaining active records. A consumed once record
        // has no installed listener and keeps its state across a reorder.
        const nextUnresolved = new Map<string, UnresolvedBehavior>();
        const installable = desired.filter((descriptor) => {
          if (descriptor.subject.library !== activation.document) return false;
          if (records.has(descriptor.id)) return true;
          let subject: LiveTree | undefined;
          let node: object | undefined;
          try {
            subject = resolve_local_subject(activation, descriptor);
            if (subject !== undefined) node = active_subject_for_tree(subject);
          } catch { subject = undefined; }
          if (descriptor.kind === "browser") {
            const previous = unresolvedBehaviors.get(descriptor.id);
            const defined = resolve_livemap_action_internal(activation.map, descriptor.key) !== undefined;
            if (previous !== undefined || !defined) {
              const fingerprint = descriptor_fingerprint(descriptor);
              const sameIntent = previous?.fingerprint === fingerprint ? previous : undefined;
              // Follow the exact subject through path rewrites and temporary loss of
              // realization. A different resolved subject gets a new binding attempt.
              if (!defined || (sameIntent !== undefined && (node === undefined || sameIntent.node === node))) {
                nextUnresolved.set(descriptor.id, { fingerprint, node: node ?? sameIntent?.node });
                return false;
              }
            }
          }
          try {
            return subject !== undefined
              && (descriptor.kind !== "locus" || activation.dispatch !== undefined)
              && resolve_livetree_listener_targets_internal(subject, descriptor.listener.target).length > 0;
          } catch { return false; }
        }).map(({ id }) => id);
        unresolvedBehaviors = nextUnresolved;
        const desiredActive = installable.filter((id) => !records.get(id)?.state.consumed);
        const installedActive = [...records].filter(([, record]) => !record.state.consumed)
          .map(([id]) => id);
        const retained = new Set<string>();
        let nextInstalledIndex = 0;
        for (const id of desiredActive) {
          const index = installedActive.indexOf(id, nextInstalledIndex);
          if (index < 0) break;
          retained.add(id);
          nextInstalledIndex = index + 1;
        }
        for (const [id, record] of [...records]) {
          if (record.state.consumed || retained.has(id)) continue;
          record.sub.off();
          records.delete(id);
        }

        for (const descriptor of desired) {
          if (records.has(descriptor.id)) continue;
          let subject: LiveTree | undefined;
          try { subject = resolve_local_subject(activation, descriptor); } catch (cause) {
            report(descriptor, "subject-resolution", cause);
            continue;
          }
          if (subject === undefined) {
            report(descriptor, "subject-resolution", new Error("Canonical interaction subject is not currently realized."));
            continue;
          }
          const invoke = descriptor.kind === "browser" && !unresolvedBehaviors.has(descriptor.id)
            ? resolve_livemap_action_internal(activation.map, descriptor.key) : undefined;
          if (descriptor.kind === "browser" && invoke === undefined) {
            report(descriptor, "browser-capability-resolution", new Error(
              `Unknown local interaction action ${JSON.stringify(descriptor.key)} at resolution. Define it on map.actions before activating this descriptor.`,
            ));
            continue;
          }
          if (descriptor.kind === "locus" && activation.dispatch === undefined) {
            report(descriptor, "locus-capability-resolution", new Error("No authoritative interaction dispatcher is configured."));
            continue;
          }
          const state = { consumed: false };
          const data = descriptor.kind === "browser" ? descriptor.args : descriptor.payload;
          let materialized = false;
          try {
            const fingerprint = descriptor_fingerprint(descriptor);
            const handler = (event: Event): void => {
              if (disposed) return;
              if (currentTree !== undefined) {
                // Resolve current canonical intent, including maintained paths after
                // movement. A transition must never fall back to an obsolete handle.
                try {
                  const currentDescriptor = read_descriptors(installed_descriptors(aggregate.systemRoot(system)))
                    .find(candidate => candidate.id === descriptor.id);
                  const current = currentDescriptor === undefined
                    || descriptor_fingerprint(currentDescriptor) !== fingerprint
                    ? undefined : resolve_local_subject(activation, currentDescriptor);
                  if (current === undefined || active_subject_for_tree(current) !== active_subject_for_tree(subject)) return;
                } catch (cause) { report(descriptor, "subject-resolution", cause); return; }
              }
              if (descriptor.listener.once) state.consumed = true;
              if (invoke !== undefined) {
                void invoke(data, { subject, event, onFailure: cause => report(descriptor, "browser-invocation", cause) });
                return;
              }
              const dispatch = activation.dispatch;
              if (dispatch === undefined) return;
              try {
                Promise.resolve(dispatch(descriptor.key, data)).catch((cause) => {
                  report(descriptor, "locus-invocation", cause);
                });
              } catch (cause) { report(descriptor, "locus-invocation", cause); }
            };
            const sub = install_livetree_listener(subject, descriptor.listener, handler);
            if (resolve_livetree_listener_targets_internal(subject, descriptor.listener.target).length === 0) {
              sub.off();
              continue;
            }
            records.set(descriptor.id, Object.freeze({
              fingerprint,
              node: active_subject_for_tree(subject),
              subject,
              sub,
              state,
            }));
            materialized = true;
          } catch (cause) { report(descriptor, "listener-installation", cause); }
          if (materialized && initializing) activationInitializationMaterializationHook?.();
        }
      } while (pending);
    } finally { reconciling = false; }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    pending = false;
    const failures: unknown[] = [];
    const release = (operation: (() => void) | undefined): void => {
      try { operation?.(); } catch (cause) { failures.push(cause); }
    };
    release(stopCommit);
    release(stopRestore);
    release(stopRealizations);
    stopCommit = undefined;
    stopRestore = undefined;
    stopRealizations = undefined;
    for (const record of records.values()) release(() => record.sub.off());
    records.clear();
    unresolvedBehaviors.clear();
    if (failures.length > 0) throw failures[0];
  };

  try {
    stopCommit = aggregate.observe(() => reconcile());
    stopRestore = aggregate.observeRestore(() => reconcile());
    stopRealizations = observe_livetree_realizations_internal(activation.tree, reconcile);
    activationInitializationHook?.();
    reconcile();
    initializing = false;
  } catch (cause) {
    try { dispose(); } catch { /* Preserve the initialization failure after complete rollback attempts. */ }
    throw cause;
  }

  return dispose;
}

function snapshot_activation(options: InteractionActivationOptions, currentTree?: () => LiveTree): ActivationSnapshot {
  const map = options.map;
  const tree = options.tree;
  const documentNames = internal_livemap_aggregate_authority(map).hostedRegistry().libraries
    .filter((entry) => entry.scope === undefined && entry.mode === "document").map((entry) => entry.name);
  const document = options.document ?? (documentNames.length === 1 ? documentNames[0] : undefined);
  if (document === undefined || !documentNames.includes(document)) {
    throw new TypeError("Canonical interaction activation requires a selected document Library.");
  }
  const dispatch = options.dispatch;
  const onFailure = options.onFailure;
  if (dispatch !== undefined && typeof dispatch !== "function") {
    throw new TypeError("Canonical interaction dispatcher must be a function.");
  }
  if (onFailure !== undefined && typeof onFailure !== "function") {
    throw new TypeError("Canonical interaction failure observer must be a function.");
  }
  const runtime = runtime_for_tree(tree);
  return Object.freeze({ map, get tree() {
    const current = currentTree === undefined ? tree : currentTree();
    if (runtime_for_tree(current) !== runtime) throw new Error("Document interaction provider changed its owning runtime.");
    return current;
  }, document, dispatch, onFailure });
}

function resolve_local_subject(activation: ActivationSnapshot, descriptor: InteractionDescriptor): LiveTree | undefined {
  if (descriptor.subject.library !== activation.document) return undefined;
  const path = validate_document_path(descriptor.subject.path);
  let node;
  const tree = activation.tree, subject = active_subject_for_tree(tree);
  const root = subject.$_tag === ROOT_TAG ? subject : { $_tag: ROOT_TAG, $_content: [subject] };
  try { node = resolve_document_path(root, "document", path); }
  catch { return undefined; }
  return is_Node(node) ? wrap_in_tree(tree, node) : undefined;
}

/** Read only the selected installed system member; drafts keep their ordered authority. */
function installed_descriptors(root: import("../../core/types.js").HsonNode): OrderedProjectedValue {
  if (kind_live_path(root, []) !== "object") throw new Error("Canonical interaction object is malformed.");
  const descriptors = project_live_path(root, ["descriptors"]);
  if (descriptors === undefined) throw new Error("Canonical interaction member descriptors is missing.");
  return descriptors;
}

function interaction_storage(target: object): Storage {
  const draft = interaction_draft_capability_internal(target);
  if (draft !== undefined) return Object.freeze({ update: draft.update });
  const aggregate = internal_livemap_aggregate_authority(target);
  return Object.freeze({
    update: (edit) => commit_interaction_edit_internal(aggregate, edit),
  });
}

function read_descriptors(value: OrderedProjectedValue): readonly RuntimeDescriptor[] {
  return Object.freeze(descriptor_array(value).map((entry) => {
    const kind = member(entry, "kind");
    const base = {
      id: require_string(member(entry, "id")),
      subject: read_subject(require_object(member(entry, "subject"))),
      listener: read_listener(require_object(member(entry, "listener"))),
      key: require_string(member(entry, "key")),
    };
    if (kind !== "browser" && kind !== "locus") throw new Error("Canonical interaction descriptor discriminant is malformed.");
    const input = member(entry, kind === "browser" ? "args" : "payload");
    const data = input === undefined ? undefined : hson_data_from_value(input);
    return Object.freeze(interaction_descriptor(base.id, base.subject, base.listener, kind, base.key, data));
  }));
}

function read_subject(value: OrderedProjectedObject): Readonly<{ library: string; path: readonly number[] }> {
  const library = require_string(member(value, "library"));
  const path = validate_document_path(member(value, "path"));
  return Object.freeze({ library, path });
}

function read_listener(value: OrderedProjectedObject): InteractionListener {
  return Object.freeze({
    event: require_string(member(value, "event")),
    target: require_listener_target(member(value, "target")),
    capture: require_boolean(member(value, "capture")),
    once: require_boolean(member(value, "once")),
    passive: require_boolean(member(value, "passive")),
    missingTarget: require_missing_policy(member(value, "missingTarget")),
    preventDefault: require_boolean(member(value, "preventDefault")),
    stopPropagation: require_boolean(member(value, "stopPropagation")),
    stopImmediatePropagation: require_boolean(member(value, "stopImmediatePropagation")),
  });
}

function member(value: OrderedProjectedObject, name: string): OrderedProjectedValue | undefined {
  return value.entries.find(([key]) => key === name)?.[1];
}
function require_object(value: OrderedProjectedValue | undefined): OrderedProjectedObject {
  if (!is_ordered_projected_object(value)) throw new Error("Canonical interaction object is malformed.");
  return value;
}
function require_string(value: OrderedProjectedValue | undefined): string {
  if (typeof value !== "string") throw new Error("Canonical interaction string is malformed.");
  return value;
}
function require_boolean(value: OrderedProjectedValue | undefined): boolean {
  if (typeof value !== "boolean") throw new Error("Canonical interaction boolean is malformed.");
  return value;
}

function require_listener_target(value: OrderedProjectedValue | undefined): InteractionListener["target"] {
  if (value === "element" || value === "document" || value === "window") return value;
  throw new Error("Canonical interaction listener target is malformed.");
}

function require_missing_policy(value: OrderedProjectedValue | undefined): InteractionListener["missingTarget"] {
  if (value === "ignore" || value === "warn" || value === "throw") return value;
  throw new Error("Canonical interaction missing-target policy is malformed.");
}

function descriptor_fingerprint(descriptor: InteractionDescriptor): string {
  const value = descriptor_to_value(descriptor);
  // A canonical path rewrite follows the same local subject. It must not
  // replace that subject's listener or reset once/resource ownership.
  return encode_hson_data_internal(hson_data_from_value(ordered_projected_object(
    value.entries.filter(([name]) => name !== "subject"),
  )));
}
