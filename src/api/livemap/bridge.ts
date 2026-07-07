// bridge.ts

import type { JsonValue } from "../../core/types.js";
import type { LivePath } from "./livemap.types.js";

export type LiveMapBridgeBinding = Readonly<{
  dispose: () => void;
}>;

export type LiveMapBridgeMap = Readonly<{
  snap: (path?: LivePath) => JsonValue | undefined;
  set: (path: LivePath, value: JsonValue) => unknown;
  sub: Readonly<{
    path: (path: LivePath, listener: (next: JsonValue | undefined) => void) => () => void;
  }>;
}>;

export type LiveTreeTextBridgeTarget = Readonly<{
  text: Readonly<{
    get: () => string;
    set: (value: string) => unknown;
  }>;
}>;

export type LiveTreeAttrBridgeTarget = Readonly<{
  attr: Readonly<{
    get: (name: string) => string | undefined;
    set: (name: string, value: string) => unknown;
    drop: (name: string) => unknown;
  }>;
}>;

export type LiveTreeInputListenerResult = Readonly<{
  off: () => void;
  count: number;
  ok: boolean;
}>;

export type LiveTreeInputBridgeTarget = Readonly<{
  form: Readonly<{
    getValue: () => JsonValue | undefined;
    setValue: (value: JsonValue, options?: { silent?: boolean }) => unknown;
  }>;
  listen: Readonly<{
    onInput: (listener: () => void) => LiveTreeInputListenerResult;
  }>;
}>;

function coerce_input_value(value: JsonValue | undefined, current: JsonValue | undefined): JsonValue {
  if (typeof current === "number") {
    const next = Number(value);
    return Number.isFinite(next) ? next : value_to_text(value);
  }

  if (typeof current === "boolean") return value === true || value === "true";
  if (current === null && value === "null") return null;
  return value ?? "";
}


function value_to_text(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function render_livemap_snap(map: LiveMapBridgeMap, tree: LiveTreeTextBridgeTarget, path?: LivePath): void {
  tree.text.set(value_to_text(map.snap(path)));
}

export function bind_livetree_text(map: LiveMapBridgeMap, path: LivePath, tree: LiveTreeTextBridgeTarget): LiveMapBridgeBinding {
  const sync = (value: JsonValue | undefined) => {
    tree.text.set(value_to_text(value));
  };

  sync(map.snap(path));
  const dispose = map.sub.path(path, sync);

  return { dispose };
}

export function bind_livetree_attr(
  map: LiveMapBridgeMap,
  path: LivePath,
  tree: LiveTreeAttrBridgeTarget,
  name: string,
): LiveMapBridgeBinding {
  const sync = (value: JsonValue | undefined) => {
    if (value === false || value === null || value === undefined) {
      tree.attr.drop(name);
      return;
    }

    tree.attr.set(name, value_to_text(value));
  };

  sync(map.snap(path));
  const dispose = map.sub.path(path, sync);

  return { dispose };
}

export function bind_livetree_input_value(
  tree: LiveTreeInputBridgeTarget,
  map: LiveMapBridgeMap,
  path: LivePath,
): LiveMapBridgeBinding {
  let isSyncing = false;

  const syncFromMap = (value: JsonValue | undefined) => {
    isSyncing = true;
    tree.form.setValue(value_to_text(value), { silent: true });
    isSyncing = false;
  };

  const syncToMap = () => {
    if (isSyncing) return;
    map.set(path, coerce_input_value(tree.form.getValue(), map.snap(path)));
  };

  syncFromMap(map.snap(path));
  const disposePath = map.sub.path(path, syncFromMap);
  const inputListener = tree.listen.onInput(syncToMap);

  return {
    dispose: () => {
      inputListener.off();
      disposePath();
    },
  };
}
