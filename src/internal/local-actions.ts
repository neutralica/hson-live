import { admit_data_input, type HsonDataInput, type HsonDataValue } from "../api/data/hson-data.js";
import type { LocalActionRegistry, LocalActionResult } from "../types/local-action.types.js";
import { capture_action_args, action_args_error } from "./action-args.js";

type EventInvocation<Source> = Source & Readonly<{ onFailure: (cause: unknown) => void }>;
type LocalActionDefinition<Source> = Readonly<{
  invoke: (args: HsonDataInput | undefined, source?: EventInvocation<Source>) => Promise<LocalActionResult>;
  bindArgs: (args: HsonDataInput | undefined) => (source: EventInvocation<Source>) => Promise<LocalActionResult>;
}>;

/** One local executor for immediate calls and listener-bound capabilities. */
export function make_local_actions<Context extends object, Source>(
  makeContext: (source: Source | undefined) => Context,
  assertOwnerActive?: () => void,
) {
  const definitions = new Map<string, LocalActionDefinition<Source>>();
  const registry: LocalActionRegistry<Context> = Object.freeze({
    define(name, handler, options) {
      assertOwnerActive?.();
      if (!validName(name)) throw new TypeError("Local action name must be a nonempty string.");
      if (typeof handler !== "function") throw new TypeError(`Local action ${JSON.stringify(name)} requires an executable handler.`);
      const contract = capture_action_args(options, "Local action", "local action");
      // Options can call application getters that reenter registration or retire the owner.
      assertOwnerActive?.();
      if (definitions.has(name)) throw new TypeError(`Local action ${JSON.stringify(name)} is already defined.`);

      const admitArgs = (args: HsonDataInput | undefined): HsonDataValue | undefined => {
        const data = args === undefined ? undefined : admit_data_input(args);
        const error = action_args_error(contract, data, "Local action");
        if (error !== undefined) throw new TypeError(error);
        return data;
      };
      const execute = async (getArgs: () => HsonDataValue | undefined, source?: EventInvocation<Source>): Promise<LocalActionResult> => {
        try {
          const data = getArgs();
          assertOwnerActive?.();
          const context = Object.freeze(makeContext(source));
          const returned = handler(context, data);
          const pending = actionSettlement(returned);
          // Snapshot synchronous Data before application microtasks can change it.
          const value = pending === undefined ? returned : await pending;
          if (value === undefined) return Object.freeze({ ok: true });
          return Object.freeze({ ok: true, result: admit_data_input(value) });
        } catch (cause) {
          // Preserve the original cause and report synchronous failures during dispatch.
          source?.onFailure(cause);
          return actionFailure(cause);
        }
      };
      definitions.set(name, {
        invoke: (args, source) => execute(() => admitArgs(args), source),
        bindArgs(args) {
          // Authored listeners validate once, before touching a native target.
          const data = admitArgs(args);
          return source => execute(() => data, source);
        },
      });
    },
    async trigger(name, args) {
      try { assertOwnerActive?.(); }
      catch (cause) { return actionFailure(cause); }
      if (!validName(name)) return actionFailure(new TypeError("Local action name must be a nonempty string."));
      const definition = definitions.get(name);
      if (definition === undefined) return actionFailure(new Error(`Unknown local action ${JSON.stringify(name)}.`));
      return definition.invoke(args);
    },
  });
  return { registry, resolve: (name: string) => definitions.get(name) };
}

function validName(name: unknown): name is string {
  return typeof name === "string" && name.length > 0;
}

function actionSettlement(value: unknown): Promise<unknown> | undefined {
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

function actionFailure(cause: unknown): LocalActionResult {
  let message = "Local action failed.";
  try {
    if (cause instanceof Error) {
      const detail = cause.message;
      if (typeof detail === "string") message = detail;
    }
  } catch { /* A thrown value may have a trapping prototype or message accessor. */ }
  return Object.freeze({ ok: false, error: Object.freeze({ message, cause }) });
}
