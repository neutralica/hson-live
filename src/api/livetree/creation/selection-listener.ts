import { listener_conveniences } from "../../../internal/listener-conveniences.js";
import type { ListenerBuilder, ListenerSub } from "../../../types/listen.types.js";
import { parse_livetree_authored_event } from "../livetree.actions.js";
import type { LiveTree } from "../livetree.js";
import { install_livetree_listener } from "../managers/listener-builder.js";

function registerGroup<T>(subjects: readonly T[], attach: (subject: T) => ListenerSub): ListenerSub {
  const subscriptions: ListenerSub[] = [];
  const group: ListenerSub = {
    off(): void {
      // Take a snapshot so reentrant cleanup cannot repeat the same work.
      const pending = subscriptions.splice(0);
      const retry: ListenerSub[] = [];
      let failed = false;
      let firstError: unknown;
      for (const sub of pending) {
        try { sub.off(); }
        catch (error) {
          retry.push(sub);
          if (!failed) { failed = true; firstError = error; }
        }
      }
      subscriptions.push(...retry);
      if (failed) throw firstError;
    },
  };
  try {
    for (const subject of subjects) subscriptions.push(attach(subject));
  } catch (error) {
    try { group.off(); }
    catch { /* Exhaustive cleanup must preserve the registration failure. */ }
    throw error;
  }
  return group;
}

/** Forward one selection operation through the ordinary per-subject builders. @internal */
export function build_selection_listener(trees: readonly LiveTree[]): ListenerBuilder {
  type Configure = (builder: ListenerBuilder) => ListenerBuilder;
  let configuration: Configure[] = [];
  const configure = (apply: Configure): ListenerBuilder => {
    configuration.push(apply);
    return api;
  };
  const register = (attach: (builder: ListenerBuilder) => ListenerSub): ListenerSub => {
    // Consume configuration even if a later subject rejects registration.
    const pending = configuration;
    configuration = [];
    return registerGroup(trees, tree => attach(pending.reduce((builder, apply) => apply(builder), tree.listen)));
  };

  const api: ListenerBuilder = {
    on: (type, handler) => register(builder => builder.on(type, handler)),
    event(source) {
      if (configuration.length !== 0) {
        configuration = [];
        throw new TypeError("listen.event() cannot combine fluent listener options with an authored declaration.");
      }
      // Resolve every selected action before the first native registration.
      const { listener, bind } = parse_livetree_authored_event(source);
      const prepared = trees.map(tree => ({ tree, ...bind(tree) }));
      return registerGroup(prepared, ({ tree, handler, actionOwner }) =>
        install_livetree_listener(tree, listener, handler, { actionOwner }));
    },
    onCustom: (type, handler) => register(builder => builder.onCustom(type, handler)),
    onCustomDetail: (type, handler) => register(builder => builder.onCustomDetail(type, handler)),
    ...listener_conveniences((event, handler) => register(builder => builder.onCustom(event, handler))),
    get document() { return configure(builder => builder.document); },
    get window() { return configure(builder => builder.window); },
    get element() { return configure(builder => builder.element); },
    once: () => configure(builder => builder.once()),
    passive: () => configure(builder => builder.passive()),
    capture: () => configure(builder => builder.capture()),
    toWindow: () => configure(builder => builder.toWindow()),
    toDocument: () => configure(builder => builder.toDocument()),
    strict: policy => configure(builder => builder.strict(policy)),
    preventDefault: () => configure(builder => builder.preventDefault()),
    stopProp: () => configure(builder => builder.stopProp()),
    stopImmediateProp: () => configure(builder => builder.stopImmediateProp()),
    stopAll: () => configure(builder => builder.stopAll()),
    clearStops: () => configure(builder => builder.clearStops()),
  };
  return api;
}
