import { admit_data_input, type HsonDataInput } from "../data/hson-data.js";
import { capture_execution_input, execution_input_error } from "../../internal/execution-input.js";
import type {
  InteractionLocalBehaviors,
  LocalBehaviorContext,
  LocalBehaviorResult,
} from "../../types/local-behavior.types.js";
import type { LiveMap } from "../../types/livemap.types.js";

type EventInvocation = Required<Pick<LocalBehaviorContext, "subject" | "event">> & Readonly<{
  onFailure: (cause: unknown) => void;
}>;
type InvokeBehavior = (input: HsonDataInput | undefined, source?: EventInvocation) => Promise<LocalBehaviorResult>;

// Internal lookup lets an activation bind an existing definition without
// exposing event or subject injection on the public trigger.
const behaviorResolvers = new WeakMap<InteractionLocalBehaviors, (name: string) => InvokeBehavior | undefined>();

export function resolve_livemap_behavior_internal(map: LiveMap, name: string): InvokeBehavior | undefined {
  return behaviorResolvers.get(map.behaviors)?.(name);
}

export function make_livemap_behaviors(map: LiveMap): InteractionLocalBehaviors {
  const definitions = new Map<string, InvokeBehavior>();
  let invocationId = 0n;
  const registry: InteractionLocalBehaviors = Object.freeze({
    define(name, handler, options) {
      if (!validName(name)) throw new TypeError("Local behavior name must be a nonempty string.");
      if (typeof handler !== "function") throw new TypeError(`Local behavior ${JSON.stringify(name)} requires an executable handler.`);
      const contract = capture_execution_input(options, "Local behavior", "local behavior");
      // Capturing options can call application getters that themselves register a definition.
      if (definitions.has(name)) throw new TypeError(`Local behavior ${JSON.stringify(name)} is already defined.`);
      definitions.set(name, async (input, source) => {
        try {
          const data = input === undefined ? undefined : admit_data_input(input);
          const error = execution_input_error(contract, data, "Local behavior");
          if (error !== undefined) throw new TypeError(error);
          const ctx = Object.freeze(source === undefined ? { map } : { map, subject: source.subject, event: source.event });
          const message = Object.freeze({ name, id: String(++invocationId) });
          const returned = handler(ctx, data, message);
          const pending = behavior_settlement(returned);
          // Snapshot synchronous Data in the invoking turn, before application microtasks can change it.
          const value = pending === undefined ? returned : await pending;
          if (value === undefined) return Object.freeze({ ok: true });
          return Object.freeze({ ok: true, result: admit_data_input(value) });
        } catch (cause) {
          // Keep the original diagnostic and report synchronous failures during native dispatch.
          source?.onFailure(cause);
          return behaviorFailure(cause);
        }
      });
    },
    async trigger(name, input) {
      if (!validName(name)) return behaviorFailure(new TypeError("Local behavior name must be a nonempty string."));
      const invoke = definitions.get(name);
      if (invoke === undefined) return behaviorFailure(new Error(`Unknown local behavior ${JSON.stringify(name)}.`));
      return invoke(input);
    },
  });
  behaviorResolvers.set(registry, name => definitions.get(name));
  return registry;
}

function validName(name: unknown): name is string {
  return typeof name === "string" && name.length > 0;
}

function behavior_settlement(value: unknown): Promise<unknown> | undefined {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return undefined;
  try {
    // Keep native await semantics for Promises, including their own settlement and rejection.
    if (value instanceof Promise) return value;
  } catch { /* A trapping prototype can still expose a valid thenable. */ }

  let then: unknown;
  try { then = Reflect.get(value, "then"); }
  catch (cause) { return Promise.reject(cause); }
  if (typeof then !== "function") return undefined;
  // Let Promise resolution schedule assimilation using the single captured getter result.
  return Promise.resolve({ then(resolve: (value: unknown) => void, reject: (cause: unknown) => void) {
    Reflect.apply(then, value, [resolve, reject]);
  } });
}

function behaviorFailure(cause: unknown): LocalBehaviorResult {
  let message = "Local behavior failed.";
  try {
    if (cause instanceof Error) {
      const detail = cause.message;
      if (typeof detail === "string") message = detail;
    }
  } catch { /* A thrown value may have a trapping prototype or message accessor. */ }
  return Object.freeze({ ok: false, error: Object.freeze({ message, cause }) });
}
