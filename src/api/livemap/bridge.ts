// LiveMap ↔ LiveTree bridge helpers.
//
// Snap renderers perform one-time projection from LiveMap state into LiveTree.
// Bindings subscribe LiveTree targets to LiveMap paths and return explicit disposers.
// Control renderers build a static LiveTree form view and bind generated primitive
// controls back to the LiveMap paths they represent.

import type { JsonValue } from "../../core/types.js";
import type { LiveMap, LivePath } from "./livemap.types.js";

type BridgePathParts = readonly string[];

export type LiveMapBridgeBinding = Readonly<{
  dispose: () => void;
}>;

export type LiveMapBridgeBindingGroup = Readonly<{
  dispose: () => void;
  bindings: readonly LiveMapBridgeBinding[];
}>;

export type LiveMapSchemaControlKind = "string" | "number" | "boolean" | "enum";

export type LiveMapSchemaControlNode = Readonly<{
  kind?: LiveMapSchemaControlKind;
  label?: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  choices?: readonly string[];
}>;

export type LiveMapSchemaControlSpec = Readonly<Record<string, LiveMapSchemaControlNode>>;

// LiveTree targets are narrow structural contracts. They name the small LiveTree
// surfaces the bridge consumes without requiring callers to pass a concrete
// LiveTree class.

export type LiveTextBridgeTarget = Readonly<{
  text: Readonly<{
    get: () => string;
    set: (value: string) => unknown;
    overwrite: (value: string) => unknown;
  }>;
}>;

export type LiveContentBridgeTarget = Readonly<{
  content: Readonly<{
    markup: Readonly<{
      innerHTML: string;
    }>;
  }>;
}>;

export type LiveCreateDivBridgeTarget = Readonly<{
  create: Readonly<{
    div: () => LiveSnapViewBridgeTarget;
  }>;
}>;

export type LiveSnapViewBridgeTarget = LiveContentBridgeTarget &
  LiveCreateDivBridgeTarget &
  LiveTextBridgeTarget &
  LiveAttrBridgeTarget;

export type LiveAttrBridgeTarget = Readonly<{
  attr: Readonly<{
    get: (name: string) => string | undefined;
    set: (name: string, value: string) => unknown;
    drop: (name: string) => unknown;
  }>;
}>;

export type LiveInputListenerResult = Readonly<{
  off: () => void;
  count: number;
  ok: boolean;
}>;

export type LiveInputBridgeTarget = Readonly<{
  form: Readonly<{
    getValue: () => JsonValue | undefined;
    setValue: (value: JsonValue, options?: { silent?: boolean }) => unknown;
    getChecked?: () => boolean | undefined;
    setChecked?: (value: boolean, options?: { silent?: boolean }) => unknown;
  }>;
  listen: Readonly<{
    onInput: (listener: () => void) => LiveInputListenerResult;
  }>;
}>;

export type LiveCreateControlBridgeTarget = Readonly<{
  create: Readonly<{
    div: () => LiveControlViewBridgeTarget;
    tag: (tag: string) => LiveControlViewBridgeTarget;
  }>;
}>;

export type LiveControlViewBridgeTarget = LiveContentBridgeTarget &
  LiveCreateControlBridgeTarget &
  LiveTextBridgeTarget &
  LiveAttrBridgeTarget &
  LiveInputBridgeTarget;

// Preserve the current LiveMap primitive kind when possible. Form APIs surface
// user input as display values, while LiveMap remains the state authority.
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

// Static snap rendering

export function render_livemap_snap(map: LiveMap, tree: LiveTextBridgeTarget, path: LivePath = []): void {
  tree.text.set(value_to_text(map.snap(path)));
}

export function render_livemap_snap_view(map: LiveMap, tree: LiveSnapViewBridgeTarget, path: LivePath = []): void {
  tree.text.overwrite("");
  render_snap_value(tree, map.snap(path), snap_path_parts(path));
}

export function render_livemap_controls_snap(
  map: LiveMap,
  tree: LiveControlViewBridgeTarget,
  path: LivePath = [],
): LiveMapBridgeBindingGroup {
  const bindings: LiveMapBridgeBinding[] = [];

  tree.text.overwrite("");
  render_control_value(map, tree, map.snap(path), snap_path_parts(path), bindings);

  return {
    bindings,
    dispose: () => {
      for (const binding of bindings) binding.dispose();
    },
  };
}

export function render_livemap_schema_controls_snap(
  map: LiveMap,
  tree: LiveControlViewBridgeTarget,
  schema: LiveMapSchemaControlSpec,
  path: LivePath = [],
): LiveMapBridgeBindingGroup {
  const bindings: LiveMapBridgeBinding[] = [];

  tree.text.overwrite("");
  render_schema_control_value(map, tree, map.snap(path), snap_path_parts(path), schema, bindings);

  return {
    bindings,
    dispose: () => {
      for (const binding of bindings) binding.dispose();
    },
  };
}

function snap_path_parts(path: LivePath): readonly string[] {
  return path.map((part) => String(part));
}

function render_snap_value(tree: LiveSnapViewBridgeTarget, value: JsonValue | undefined, path: readonly string[]): void {
  tree.attr.set("data-livemap-snap-path", path.join("."));

  if (Array.isArray(value)) {
    tree.attr.set("data-livemap-snap-kind", "array");
    render_snap_array(tree, value, path);
    return;
  }

  if (is_json_object(value)) {
    tree.attr.set("data-livemap-snap-kind", "object");
    render_snap_object(tree, value, path);
    return;
  }

  tree.attr.set("data-livemap-snap-kind", primitive_snap_kind(value));
  tree.text.set(value_to_text(value));
}

function render_snap_object(
  tree: LiveSnapViewBridgeTarget,
  value: Readonly<Record<string, JsonValue>>,
  path: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    const row = tree.create.div();
    row.attr.set("data-livemap-snap-key", key);

    const label = row.create.div();
    label.attr.set("data-livemap-snap-role", "key");
    label.text.set(key);

    const child = row.create.div();
    child.attr.set("data-livemap-snap-role", "value");
    render_snap_value(child, value[key], [...path, key]);
  }
}

function render_snap_array(tree: LiveSnapViewBridgeTarget, value: readonly JsonValue[], path: readonly string[]): void {
  value.forEach((item, index) => {
    const row = tree.create.div();
    row.attr.set("data-livemap-snap-index", String(index));

    const label = row.create.div();
    label.attr.set("data-livemap-snap-role", "index");
    label.text.set(String(index));

    const child = row.create.div();
    child.attr.set("data-livemap-snap-role", "value");
    render_snap_value(child, item, [...path, String(index)]);
  });
}

function render_control_value(
  map: LiveMap,
  tree: LiveControlViewBridgeTarget,
  value: JsonValue | undefined,
  path: readonly string[],
  bindings: LiveMapBridgeBinding[],
): void {
  tree.attr.set("data-livemap-control-path", path.join("."));

  if (Array.isArray(value)) {
    tree.attr.set("data-livemap-control-kind", "array");
    render_control_array(map, tree, value, path, bindings);
    return;
  }

  if (is_json_object(value)) {
    tree.attr.set("data-livemap-control-kind", "object");
    render_control_object(map, tree, value, path, bindings);
    return;
  }

  tree.attr.set("data-livemap-control-kind", primitive_snap_kind(value));
  render_control_primitive(map, tree, value, path, bindings);
}

function render_control_object(
  map: LiveMap,
  tree: LiveControlViewBridgeTarget,
  value: Readonly<Record<string, JsonValue>>,
  path: readonly string[],
  bindings: LiveMapBridgeBinding[],
): void {
  for (const key of Object.keys(value)) {
    const row = tree.create.div();
    row.attr.set("data-livemap-control-key", key);

    const label = row.create.div();
    label.attr.set("data-livemap-control-role", "key");
    label.text.set(key);

    const child = row.create.div();
    child.attr.set("data-livemap-control-role", "value");
    render_control_value(map, child, value[key], [...path, key], bindings);
  }
}

function render_control_array(
  map: LiveMap,
  tree: LiveControlViewBridgeTarget,
  value: readonly JsonValue[],
  path: readonly string[],
  bindings: LiveMapBridgeBinding[],
): void {
  value.forEach((item, index) => {
    const row = tree.create.div();
    row.attr.set("data-livemap-control-index", String(index));

    const label = row.create.div();
    label.attr.set("data-livemap-control-role", "index");
    label.text.set(String(index));

    const child = row.create.div();
    child.attr.set("data-livemap-control-role", "value");
    render_control_value(map, child, item, [...path, String(index)], bindings);
  });
}

function render_schema_control_value(
  map: LiveMap,
  tree: LiveControlViewBridgeTarget,
  value: JsonValue | undefined,
  path: readonly string[],
  schema: LiveMapSchemaControlSpec,
  bindings: LiveMapBridgeBinding[],
): void {
  tree.attr.set("data-livemap-control-path", path.join("."));

  if (Array.isArray(value)) {
    tree.attr.set("data-livemap-control-kind", "array");
    value.forEach((item, index) => {
      const row = tree.create.div();
      row.attr.set("data-livemap-control-index", String(index));

      const label = row.create.div();
      label.attr.set("data-livemap-control-role", "index");
      label.text.set(String(index));

      const child = row.create.div();
      child.attr.set("data-livemap-control-role", "value");
      render_schema_control_value(map, child, item, [...path, String(index)], schema, bindings);
    });
    return;
  }

  if (is_json_object(value)) {
    tree.attr.set("data-livemap-control-kind", "object");
    for (const key of Object.keys(value)) {
      const row = tree.create.div();
      row.attr.set("data-livemap-control-key", key);

      const label = row.create.div();
      label.attr.set("data-livemap-control-role", "key");
      label.text.set(key);

      const child = row.create.div();
      child.attr.set("data-livemap-control-role", "value");
      render_schema_control_value(map, child, value[key], [...path, key], schema, bindings);
    }
    return;
  }

  const node = schema_control_node_for_path(schema, path);
  tree.attr.set("data-livemap-control-kind", schema_control_kind(value, node));
  render_schema_control_primitive(map, tree, value, path, node, bindings);
}

function render_schema_control_primitive(
  map: LiveMap,
  tree: LiveControlViewBridgeTarget,
  value: JsonValue | undefined,
  path: readonly string[],
  schema: LiveMapSchemaControlNode | undefined,
  bindings: LiveMapBridgeBinding[],
): void {
  render_schema_control_meta(tree, schema);

  if (schema?.kind === "enum") {
    render_schema_enum_control(map, tree, value, path, schema, bindings);
    return;
  }

  const control = tree.create.tag("input");
  control.attr.set("data-livemap-control-role", "input");
  control.attr.set("data-livemap-control-path", path.join("."));
  control.attr.set("data-livemap-control-kind", schema_control_kind(value, schema));
  apply_schema_control_meta(control, schema);

  const kind = schema_control_kind(value, schema);

  if (kind === "boolean" && control.form.setChecked !== undefined && control.form.getChecked !== undefined) {
    control.attr.set("type", "checkbox");
    bindings.push(bind_livetree_input_checked(control, map, path_to_live_path(path)));
    return;
  }

  if (kind === "number") {
    control.attr.set("type", "number");
    apply_schema_number_attrs(control, schema);
  } else {
    control.attr.set("type", "text");
  }

  bindings.push(bind_livetree_input_value(control, map, path_to_live_path(path)));
}

function render_schema_enum_control(
  map: LiveMap,
  tree: LiveControlViewBridgeTarget,
  value: JsonValue | undefined,
  path: readonly string[],
  schema: LiveMapSchemaControlNode,
  bindings: LiveMapBridgeBinding[],
): void {
  const select = tree.create.tag("select");
  select.attr.set("data-livemap-control-role", "select");
  select.attr.set("data-livemap-control-path", path.join("."));
  select.attr.set("data-livemap-control-kind", "enum");
  apply_schema_control_meta(select, schema);

  for (const choice of schema.choices ?? []) {
    const option = select.create.tag("option");
    option.attr.set("value", choice);
    option.text.set(choice);
  }

  select.form.setValue(value_to_text(value), { silent: true });
  bindings.push(bind_livetree_input_value(select, map, path_to_live_path(path)));
}

function render_schema_control_meta(tree: LiveControlViewBridgeTarget, schema: LiveMapSchemaControlNode | undefined): void {
  if (schema?.label !== undefined) {
    const label = tree.create.div();
    label.attr.set("data-livemap-control-role", "label");
    label.text.set(schema.label);
  }

  if (schema?.description !== undefined) {
    const description = tree.create.div();
    description.attr.set("data-livemap-control-role", "description");
    description.text.set(schema.description);
  }
}

function apply_schema_control_meta(
  tree: LiveAttrBridgeTarget,
  schema: LiveMapSchemaControlNode | undefined,
): void {
  if (schema?.label !== undefined) tree.attr.set("data-livemap-control-label", schema.label);
  if (schema?.description !== undefined) tree.attr.set("data-livemap-control-description", schema.description);
}

function apply_schema_number_attrs(tree: LiveAttrBridgeTarget, schema: LiveMapSchemaControlNode | undefined): void {
  if (schema?.min !== undefined) tree.attr.set("min", String(schema.min));
  if (schema?.max !== undefined) tree.attr.set("max", String(schema.max));
  if (schema?.step !== undefined) tree.attr.set("step", String(schema.step));
}

function schema_control_kind(value: JsonValue | undefined, schema: LiveMapSchemaControlNode | undefined): string {
  if (schema?.kind !== undefined) return schema.kind;
  return primitive_snap_kind(value);
}

function schema_control_node_for_path(
  schema: LiveMapSchemaControlSpec,
  path: readonly string[],
): LiveMapSchemaControlNode | undefined {
  const fullPath = path.join(".");
  return schema[fullPath] ?? schema[path[path.length - 1] ?? ""];
}

function render_control_primitive(
  map: LiveMap,
  tree: LiveControlViewBridgeTarget,
  value: JsonValue | undefined,
  path: readonly string[],
  bindings: LiveMapBridgeBinding[],
): void {
  const control = tree.create.tag("input");
  control.attr.set("data-livemap-control-role", "input");
  control.attr.set("data-livemap-control-path", path.join("."));
  control.attr.set("data-livemap-control-kind", primitive_snap_kind(value));

  if (typeof value === "boolean" && control.form.setChecked !== undefined && control.form.getChecked !== undefined) {
    control.attr.set("type", "checkbox");
    bindings.push(bind_livetree_input_checked(control, map, path_to_live_path(path)));
    return;
  }

  if (typeof value === "number") control.attr.set("type", "number");
  else control.attr.set("type", "text");

  bindings.push(bind_livetree_input_value(control, map, path_to_live_path(path)));
}

function path_to_live_path(path: readonly string[]): LivePath {
  return path;
}

function is_json_object(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function primitive_snap_kind(value: JsonValue | undefined): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  return typeof value;
}

// Subscribed primitive bindings

export function bind_livetree_text(map: LiveMap, path: LivePath, tree: LiveTextBridgeTarget): LiveMapBridgeBinding {
  const sync = (value: JsonValue | undefined) => {
    tree.text.set(value_to_text(value));
  };

  sync(map.snap(path));
  const dispose = map.sub.path(path, sync);

  return { dispose };
}

export function bind_livetree_attr(
  map: LiveMap,
  path: LivePath,
  tree: LiveAttrBridgeTarget,
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
  tree: LiveInputBridgeTarget,
  map: LiveMap,
  path: LivePath,
): LiveMapBridgeBinding {
  let isSyncingFromMap = false;

  const syncFromMap = (value: JsonValue | undefined) => {
    isSyncingFromMap = true;
    tree.form.setValue(value_to_text(value), { silent: true });
    isSyncingFromMap = false;
  };

  const syncToMap = () => {
    if (isSyncingFromMap) return;
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

export function bind_livetree_input_checked(
  tree: LiveInputBridgeTarget,
  map: LiveMap,
  path: LivePath,
): LiveMapBridgeBinding {
  if (tree.form.getChecked === undefined || tree.form.setChecked === undefined) {
    return bind_livetree_input_value(tree, map, path);
  }

  let isSyncingFromMap = false;

  const syncFromMap = (value: JsonValue | undefined) => {
    isSyncingFromMap = true;
    tree.form.setChecked?.(value === true, { silent: true });
    isSyncingFromMap = false;
  };

  const syncToMap = () => {
    if (isSyncingFromMap) return;
    map.set(path, tree.form.getChecked?.() === true);
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
