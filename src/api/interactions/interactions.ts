import { Hson } from "../../hson-authoring.js";
import type { HsonData, HsonSchema } from "../transform/transform.types.js";
import { hsonTransform } from "../transform/transform.facade.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { projected_value_from_hson_node } from "../../core/projected-value-graph.js";
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
  hson_data_value,
  ExactDataCarrier,
} from "../data/hson-data.js";
import type { LiveMapLibraries } from "../../types/livemap.types.js";
import type { LiveTree } from "../livetree/livetree.js";
import type { ListenerBuilder, ListenerSub } from "../../types/listen.types.js";
import { resolve_livetree_listener_targets_internal } from "../livetree/managers/listener-builder.js";
import type {
  AuthoritativeInteractionDescriptor,
  InteractionActivationOptions,
  InteractionDescriptor,
  InteractionFailure,
  InteractionListener,
  InteractionLocalBehavior,
  LocalInteractionDescriptor,
} from "../../types/interaction.types.js";
import {
  INTERACTION_RESERVED_LIBRARY_KEY,
  INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME,
  interaction_draft_capability_internal,
} from "../../internal/interaction-storage.js";
import {
  observe_livetree_realizations_internal,
} from "../livetree/runtime/livetree-runtime.js";

const INTERACTION_SCHEMA: HsonSchema = Hson.schema`<type "data" content <descriptors <array <union [
  <content <id "string" subjectQuid <string <len 9 alphabet "0123456789abcdefghjkmnpqrstvwxyz">> listener <content <event "string" target <union [<exact "element">, <union [<exact "document">, <exact "window">]>]> capture "boolean" once "boolean" passive "boolean" missingTarget <union [<exact "ignore">, <union [<exact "warn">, <exact "throw">]>]> preventDefault "boolean" stopPropagation "boolean" stopImmediatePropagation "boolean">> kind <exact "browser-local"> key "string" args "any">>,
  <content <id "string" subjectQuid <string <len 9 alphabet "0123456789abcdefghjkmnpqrstvwxyz">> listener <content <event "string" target <union [<exact "element">, <union [<exact "document">, <exact "window">]>]> capture "boolean" once "boolean" passive "boolean" missingTarget <union [<exact "ignore">, <union [<exact "warn">, <exact "throw">]>]> preventDefault "boolean" stopPropagation "boolean" stopImmediatePropagation "boolean">> kind <exact "locus-authoritative"> key "string" payload "any">>
]>>>>`;

type Storage = Readonly<{
  read: () => OrderedProjectedValue;
  replace: (value: OrderedProjectedValue) => void;
}>;

type RuntimeRecord = Readonly<{
  fingerprint: string;
  node: object;
  subject: LiveTree;
  sub: ListenerSub;
  state: { consumed: boolean };
}>;

type RuntimeLocalDescriptor = Omit<LocalInteractionDescriptor, "args"> & Readonly<{ args: HsonData }>;
type RuntimeAuthoritativeDescriptor = Omit<AuthoritativeInteractionDescriptor, "payload"> & Readonly<{ payload: HsonData }>;
type RuntimeDescriptor = RuntimeLocalDescriptor | RuntimeAuthoritativeDescriptor;

type ActivationSnapshot = Readonly<{
  map: LiveMapLibraries;
  tree: LiveTree;
  local: ReadonlyMap<string, InteractionLocalBehavior>;
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

/** Opt one fixed multi-library LiveMap into transactional Hson interaction state. */
export function enable_interactions(map: LiveMapLibraries): void {
  const aggregate = internal_livemap_aggregate_authority(map);
  if (aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY) !== undefined) return;
  aggregate.configureSystemState(
    INTERACTION_RESERVED_LIBRARY_KEY,
    INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME,
    hsonTransform.fromJson({ descriptors: [] }).toNode(),
    INTERACTION_SCHEMA,
  );
}

export function add_interaction(target: object, descriptor: InteractionDescriptor): void {
  const storage = interaction_storage(target);
  const current = descriptor_array(storage.read());
  if (current.some((entry) => descriptor_id(entry) === descriptor.id)) {
    throw new Error(`Canonical interaction ${JSON.stringify(descriptor.id)} already exists.`);
  }
  storage.replace(ordered_projected_array([...current, descriptor_to_value(descriptor)]));
}

export function replace_interaction(target: object, descriptor: InteractionDescriptor): void {
  const storage = interaction_storage(target);
  const current = descriptor_array(storage.read());
  const index = current.findIndex((entry) => descriptor_id(entry) === descriptor.id);
  if (index < 0) throw new Error(`Canonical interaction ${JSON.stringify(descriptor.id)} does not exist.`);
  const next = [...current];
  next[index] = descriptor_to_value(descriptor);
  storage.replace(ordered_projected_array(next));
}

export function remove_interaction(target: object, descriptorId: string): void {
  if (typeof descriptorId !== "string") throw new TypeError("Canonical interaction ID must be a string.");
  const storage = interaction_storage(target);
  const current = descriptor_array(storage.read());
  const index = current.findIndex((entry) => descriptor_id(entry) === descriptorId);
  if (index < 0) throw new Error(`Canonical interaction ${JSON.stringify(descriptorId)} does not exist.`);
  storage.replace(ordered_projected_array(current.filter((_, candidate) => candidate !== index)));
}

/** Materialize current canonical interaction intent against one fixed active LiveTree. */
export function activate_interactions(options: InteractionActivationOptions): () => void {
  const activation = snapshot_activation(options);
  const aggregate = internal_livemap_aggregate_authority(activation.map);
  const system = aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY);
  if (system === undefined) throw new Error("Canonical interactions are not enabled for this LiveMap.");
  const records = new Map<string, RuntimeRecord>();
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
        const interactionRoot = require_object(projected_value_from_hson_node(aggregate.systemRoot(system)));
        const desired = read_descriptors(require_member(interactionRoot, "descriptors"));
        const desiredById = new Map(desired.map((descriptor) => [descriptor.id, descriptor] as const));

        for (const [id, record] of [...records]) {
          const descriptor = desiredById.get(id);
          let subject: LiveTree | undefined;
          try { subject = descriptor === undefined ? undefined : activation.tree.find.byQuid(descriptor.subjectQuid); }
          catch { subject = undefined; }
          const fingerprint = descriptor === undefined ? undefined : descriptor_fingerprint(descriptor);
          if (descriptor === undefined || subject === undefined
            || subject.node !== record.node || fingerprint !== record.fingerprint) {
            record.sub.off();
            records.delete(id);
          }
        }

        for (const descriptor of desired) {
          if (records.has(descriptor.id)) continue;
          let subject: LiveTree | undefined;
          try { subject = activation.tree.find.byQuid(descriptor.subjectQuid); } catch (cause) {
            report(descriptor, "subject-resolution", cause);
            continue;
          }
          if (subject === undefined) {
            report(descriptor, "subject-resolution", new Error("Canonical interaction subject is not currently realized."));
            continue;
          }
          if (descriptor.kind === "browser-local" && !activation.local.has(descriptor.key)) {
            report(descriptor, "local-capability-resolution", new Error(`Unknown local interaction behavior ${JSON.stringify(descriptor.key)}.`));
            continue;
          }
          if (descriptor.kind === "locus-authoritative" && activation.dispatch === undefined) {
            report(descriptor, "authoritative-capability-resolution", new Error("No authoritative interaction dispatcher is configured."));
            continue;
          }
          const state = { consumed: false };
          let materialized = false;
          try {
            const handler = (event: Event): void => {
              if (descriptor.listener.once) state.consumed = true;
              if (descriptor.kind === "browser-local") {
                const behavior = activation.local.get(descriptor.key);
                if (behavior === undefined) return;
                try {
                  Promise.resolve(behavior(event, subject, descriptor.args)).catch((cause) => {
                    report(descriptor, "local-invocation", cause);
                  });
                } catch (cause) { report(descriptor, "local-invocation", cause); }
                return;
              }
              const dispatch = activation.dispatch;
              if (dispatch === undefined) return;
              try {
                Promise.resolve(dispatch(descriptor.key, descriptor.payload)).catch((cause) => {
                  report(descriptor, "authoritative-invocation", cause);
                });
              } catch (cause) { report(descriptor, "authoritative-invocation", cause); }
            };
            const sub = install_listener(subject, descriptor.listener, handler);
            if (resolve_livetree_listener_targets_internal(subject, descriptor.listener.target).length === 0) {
              sub.off();
              continue;
            }
            records.set(descriptor.id, Object.freeze({
              fingerprint: descriptor_fingerprint(descriptor),
              node: subject.node,
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

function snapshot_activation(options: InteractionActivationOptions): ActivationSnapshot {
  const map = options.map;
  const tree = options.tree;
  const local = snapshot_local_behaviors(options.local);
  const dispatch = options.dispatch;
  const onFailure = options.onFailure;
  if (dispatch !== undefined && typeof dispatch !== "function") {
    throw new TypeError("Canonical interaction dispatcher must be a function.");
  }
  if (onFailure !== undefined && typeof onFailure !== "function") {
    throw new TypeError("Canonical interaction failure observer must be a function.");
  }
  return Object.freeze({ map, tree, local, dispatch, onFailure });
}

function snapshot_local_behaviors(
  input: InteractionActivationOptions["local"],
): ReadonlyMap<string, InteractionLocalBehavior> {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("Canonical interaction local capabilities must be an object.");
  }
  const snapshot = new Map<string, InteractionLocalBehavior>();
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string") continue;
    const property = Object.getOwnPropertyDescriptor(input, key);
    if (property === undefined || !("value" in property)) {
      throw new TypeError(`Canonical interaction local capability ${JSON.stringify(key)} must be a data property.`);
    }
    if (typeof property.value !== "function") {
      throw new TypeError(`Canonical interaction local capability ${JSON.stringify(key)} must be a function.`);
    }
    snapshot.set(key, property.value);
  }
  return snapshot;
}

function interaction_storage(target: object): Storage {
  const draft = interaction_draft_capability_internal(target);
  if (draft !== undefined) return Object.freeze({ read: draft.read, replace: draft.replace });
  const aggregate = internal_livemap_aggregate_authority(target);
  const system = aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY);
  if (system === undefined) throw new Error("Canonical interactions are not enabled for this LiveMap.");
  return Object.freeze({
    read: () => {
      const root = projected_value_from_hson_node(aggregate.systemRoot(system));
      return require_member(require_object(root), "descriptors");
    },
    replace: (value) => { aggregate.commit([{
      target: aggregate.systemTarget(system, ["descriptors"]),
      kind: "replace",
      value,
    }]); },
  });
}

function descriptor_to_value(descriptor: InteractionDescriptor): OrderedProjectedObject {
  const kind = exact_record(descriptor, descriptor.kind === "browser-local"
    ? ["id", "subjectQuid", "listener", "kind", "key", "args"]
    : ["id", "subjectQuid", "listener", "kind", "key", "payload"], "interaction descriptor");
  const listener = listener_to_value(kind.listener);
  const common: Array<readonly [string, OrderedProjectedValue]> = [
    ["id", scalar(kind.id)],
    ["subjectQuid", scalar(kind.subjectQuid)],
    ["listener", listener],
    ["kind", scalar(kind.kind)],
    ["key", scalar(kind.key)],
  ];
  return ordered_projected_object(descriptor.kind === "browser-local"
    ? [...common, ["args", interaction_data_value(kind.args)]]
    : [...common, ["payload", interaction_data_value(kind.payload)]]);
}

function listener_to_value(input: unknown): OrderedProjectedObject {
  const value = exact_record(input, [
    "event", "target", "capture", "once", "passive", "missingTarget",
    "preventDefault", "stopPropagation", "stopImmediatePropagation",
  ], "interaction listener");
  return ordered_projected_object([
    ["event", scalar(value.event)], ["target", scalar(value.target)],
    ["capture", scalar(value.capture)], ["once", scalar(value.once)],
    ["passive", scalar(value.passive)], ["missingTarget", scalar(value.missingTarget)],
    ["preventDefault", scalar(value.preventDefault)],
    ["stopPropagation", scalar(value.stopPropagation)],
    ["stopImmediatePropagation", scalar(value.stopImmediatePropagation)],
  ]);
}

function exact_record(input: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new TypeError(`${label} must be an object.`);
  const actual = Reflect.ownKeys(input);
  if (actual.some((key) => typeof key !== "string") || actual.length !== keys.length
    || keys.some((key) => !actual.includes(key))) throw new TypeError(`${label} has unknown or missing fields.`);
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(input, key);
    if (property === undefined || !("value" in property) || !property.enumerable) {
      throw new TypeError(`${label} fields must be enumerable data properties.`);
    }
    output[key] = property.value;
  }
  return output;
}

function scalar(value: unknown): OrderedProjectedValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw new TypeError("Canonical interaction scalar field is malformed.");
}

function interaction_data_value(value: unknown): OrderedProjectedValue {
  return hson_data_value(typeof value === "string"
    ? ExactDataCarrier.fromHson(value as import("../transform/transform.types.js").HsonCanonical)
    : ExactDataCarrier.from(value));
}

function descriptor_array(value: OrderedProjectedValue): readonly OrderedProjectedObject[] {
  if (!Array.isArray(value) || value.some((entry) => !is_ordered_projected_object(entry))) {
    throw new Error("Canonical interaction Library state is malformed.");
  }
  return value;
}

function descriptor_id(value: OrderedProjectedObject): string {
  const id = member(value, "id");
  if (typeof id !== "string") throw new Error("Canonical interaction descriptor ID is malformed.");
  return id;
}

function read_descriptors(value: OrderedProjectedValue): readonly RuntimeDescriptor[] {
  return Object.freeze(descriptor_array(value).map((entry): RuntimeDescriptor => {
    const kind = member(entry, "kind");
    const base = {
      id: require_string(member(entry, "id")),
      subjectQuid: require_string(member(entry, "subjectQuid")),
      listener: read_listener(require_object(member(entry, "listener"))),
      key: require_string(member(entry, "key")),
    };
    if (kind === "browser-local") return Object.freeze({
      ...base,
      kind,
      args: hson_data_from_value(require_member(entry, "args")).toHson() as HsonData,
    }) satisfies LocalInteractionDescriptor;
    if (kind === "locus-authoritative") return Object.freeze({
      ...base,
      kind,
      payload: hson_data_from_value(require_member(entry, "payload")).toHson() as HsonData,
    }) satisfies AuthoritativeInteractionDescriptor;
    throw new Error("Canonical interaction descriptor discriminant is malformed.");
  }));
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
function require_member(value: OrderedProjectedObject, name: string): OrderedProjectedValue {
  const found = member(value, name);
  if (found === undefined) throw new Error(`Canonical interaction member ${name} is missing.`);
  return found;
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
  return encode_hson_data_internal(hson_data_from_value(descriptor_to_value(descriptor)));
}

function install_listener(subject: LiveTree, listener: InteractionListener, handler: (event: Event) => void): ListenerSub {
  let builder: ListenerBuilder = subject.listen;
  if (listener.target === "document") builder = builder.document;
  else if (listener.target === "window") builder = builder.window;
  else builder = builder.element;
  if (listener.capture) builder = builder.capture();
  if (listener.once) builder = builder.once();
  if (listener.passive) builder = builder.passive();
  builder = builder.strict(listener.missingTarget);
  if (listener.preventDefault) builder = builder.preventDefault();
  if (listener.stopPropagation) builder = builder.stopProp();
  if (listener.stopImmediatePropagation) builder = builder.stopImmediateProp();
  return builder.onCustom(listener.event, handler);
}
