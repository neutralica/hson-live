// events-handler.ts

import { TreeEventHandler, TreeEvents } from "../../../types/events.types.js";

export function make_tree_events(): TreeEvents {
  const listeners = new Map<string, Set<TreeEventHandler>>();

  const on = (type: string, handler: TreeEventHandler) => {
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(handler);

    return () => {
      set!.delete(handler);
      if (set!.size === 0) listeners.delete(type);
    };
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