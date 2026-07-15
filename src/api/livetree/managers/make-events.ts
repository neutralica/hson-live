// make-events.ts

import { TreeEventHandler, TreeEvents } from "../../../types/events.types.js";
import { own_disposable_for_owner } from "./lifecycle-registry.js";

export function make_tree_events(ownerQuid: string): TreeEvents {
  const listeners = new Map<string, Set<TreeEventHandler>>();

  const on = (type: string, handler: TreeEventHandler) => {
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(handler);

    return own_disposable_for_owner(ownerQuid, () => {
      set!.delete(handler);
      if (set!.size === 0) listeners.delete(type);
    }, "tree-event");
  };

  const once = (type: string, handler: TreeEventHandler) => {
    const off = on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  };

  const emit = (type: string, payload?: unknown) => {
    const set = listeners.get(type);
    if (!set) return;
    // clone to prevent mutation during iteration
    for (const fn of [...set]) fn(payload);
  };

  return { on, once, emit };
}
