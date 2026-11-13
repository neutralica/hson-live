import { make_local_actions } from "../../internal/local-actions.js";
import type { InteractionLocalBehaviors, LocalBehaviorContext } from "../../types/local-behavior.types.js";
import type { LiveMap } from "../../types/livemap.types.js";

type EventSource = Required<Pick<LocalBehaviorContext, "subject" | "event">>;
type ResolveAction = ReturnType<typeof make_local_actions<LocalBehaviorContext, EventSource>>["resolve"];

// Canonical activation binds a definition without exposing native context injection on trigger().
const actionResolvers = new WeakMap<InteractionLocalBehaviors, ResolveAction>();

export function resolve_livemap_action_internal(map: LiveMap, name: string) {
  return actionResolvers.get(map.actions)?.(name)?.invoke;
}

export function make_livemap_actions(map: LiveMap): InteractionLocalBehaviors {
  const { registry, resolve } = make_local_actions<LocalBehaviorContext, EventSource>(source =>
    source === undefined ? { map } : { map, subject: source.subject, event: source.event });
  actionResolvers.set(registry, resolve);
  return registry;
}
