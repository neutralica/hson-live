// LiveMap ↔ LiveTree bridge helpers.
//
// This module is the membrane between LiveMap state and LiveTree view/form
// surfaces. LiveMap remains the state authority; LiveTree targets are narrow
// structural contracts for the small APIs consumed here.
//
// Snap renderers perform one-time projection from LiveMap state into LiveTree.
// Bindings subscribe LiveTree targets to LiveMap paths and return explicit disposers.
// Control renderers build static LiveTree form views and bind generated primitive
// controls back to the LiveMap paths they represent.

import type { JsonValue } from "../../core/types.js";
import { bind_livetree_input_checked, bind_livetree_schema_enum_input, bind_livetree_schema_number_input, bind_livetree_input_value, value_to_text } from "./bridge-bindings.js";
import type { LiveMap, LivePath } from "./livemap.types.js";
import type { LiveTextBridgeTarget, LiveSnapViewBridgeTarget, LiveControlViewBridgeTarget, LiveMapBridgeBindingGroup, LiveMapBridgeBinding, LiveMapSchemaControlSpec, BridgePathParts, LiveMapSchemaControlNode, LiveAttrBridgeTarget } from "./bridge.types.js";

// PROPOSED FILE GROUP: bridge.ts
//
// Keep the public rendering entry points here. After extraction, this file can
// import private renderer helpers from bridge.snap.ts, bridge.controls.ts, and
// bridge.schema-controls.ts, then re-export the public types from bridge.types.ts.

// Static rendering entry points

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

/**
 * Render a static schema-aware LiveTree control view for the current LiveMap
 * snapshot. Schema nodes can add labels, descriptions, numeric constraints,
 * enum/select controls, and validation feedback for generated primitive inputs.
 */
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

// PROPOSED FILE GROUP: bridge.path.ts
//
// Shared path helpers used by snap views, generated controls, schema controls,
// and schema lookup. Keep these centralized so dotted debug attrs and internal
// LivePath conversion stay consistent.

function snap_path_parts(path: LivePath): BridgePathParts {
  return path.map((part) => String(part));
}

function bridge_path_attr(path: readonly string[]): string {
  return path.join(".");
}

function path_to_live_path(path: BridgePathParts): LivePath {
  return path;
}

// PROPOSED FILE GROUP: bridge.snap.ts
//
// Static read-only snap rendering. Depends on bridge.types.ts, bridge.path.ts,
// and bridge.value.ts.

// Snap-view internals
function render_snap_value(tree: LiveSnapViewBridgeTarget, value: JsonValue | undefined, path: readonly string[]): void {
  tree.attr.set("data-livemap-snap-path", bridge_path_attr(path));

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

// PROPOSED FILE GROUP: bridge.controls.ts
//
// Schema-blind generated controls. Depends on bridge.types.ts, bridge.path.ts,
// bridge.value.ts, and bridge.bindings.ts.

// Generated-control internals
function render_control_value(
  map: LiveMap,
  tree: LiveControlViewBridgeTarget,
  value: JsonValue | undefined,
  path: readonly string[],
  bindings: LiveMapBridgeBinding[],
): void {
  tree.attr.set("data-livemap-control-path", bridge_path_attr(path));

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

// PROPOSED FILE GROUP: bridge.schema-controls.ts
//
// Schema-aware generated controls. Depends on bridge.types.ts, bridge.path.ts,
// bridge.value.ts, bridge.controls.ts concepts, and bridge.bindings.ts. The
// current schema shape is deliberately small and UI-facing.

// Schema-generated-control internals
function render_schema_control_value(
  map: LiveMap,
  tree: LiveControlViewBridgeTarget,
  value: JsonValue | undefined,
  path: readonly string[],
  schema: LiveMapSchemaControlSpec,
  bindings: LiveMapBridgeBinding[],
): void {
  tree.attr.set("data-livemap-control-path", bridge_path_attr(path));

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
  control.attr.set("data-livemap-control-path", bridge_path_attr(path));
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
    bindings.push(bind_livetree_schema_number_input(control, map, path_to_live_path(path), schema));
    return;
  }

  control.attr.set("type", "text");
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
  select.attr.set("data-livemap-control-path", bridge_path_attr(path));
  select.attr.set("data-livemap-control-kind", "enum");
  apply_schema_control_meta(select, schema);

  for (const choice of schema.choices ?? []) {
    const option = select.create.tag("option");
    option.attr.set("value", choice);
    option.text.set(choice);
  }

  select.form.setValue(value_to_text(value), { silent: true });
  bindings.push(bind_livetree_schema_enum_input(select, map, path_to_live_path(path), schema));
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
  control.attr.set("data-livemap-control-path", bridge_path_attr(path));
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


// PROPOSED FILE GROUP: bridge.value.ts
//
// Shared primitive/value helpers used by renderers and bindings. These stay
// separate from LiveMap mutation semantics.

// Shared value helpers
function is_json_object(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function primitive_snap_kind(value: JsonValue | undefined): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  return typeof value;
}
