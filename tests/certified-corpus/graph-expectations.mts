import type { HsonNode, Primitive } from "../../src/core/types.ts";

export function node(tag: string, content: HsonNode["$_content"] = []): HsonNode {
  return { $_tag: tag, $_content: [...content] };
}

export function str(value: string): HsonNode {
  return node("_hson_str", [value]);
}

export function val(value: Exclude<Primitive, string>): HsonNode {
  return node("_hson_val", [value]);
}

export function obj(...properties: HsonNode[]): HsonNode {
  return node("_hson_obj", properties);
}

export function property(key: string, value: HsonNode): HsonNode {
  const relationship = value.$_tag === "_hson_obj" || value.$_tag === "_hson_arr"
    ? value
    : obj(value);
  return node(key, [relationship]);
}

export function item(index: number, value: HsonNode): HsonNode {
  return { $_tag: "_hson_ii", $_meta: { index: String(index) }, $_content: [value] };
}

export function arr(...values: HsonNode[]): HsonNode {
  return node("_hson_arr", values.map((value, index) => item(index, value)));
}

export function elem(...children: HsonNode[]): HsonNode {
  return node("_hson_elem", children);
}

export function element(
  name: string,
  content: readonly HsonNode[] = [],
  attrs?: Readonly<Record<string, Primitive | undefined>>,
  quid?: string,
): HsonNode {
  return {
    $_tag: name,
    ...(attrs === undefined ? {} : { $_attrs: { ...attrs } }),
    ...(quid === undefined ? {} : { $_meta: { quid } }),
    $_content: content.length === 0 ? [] : [elem(...content)],
  };
}

export function root(value: HsonNode): HsonNode {
  return node("_hson_root", [value]);
}

export function objectScalarCarrier(value: HsonNode): HsonNode {
  return obj(value);
}

export function elementScalarCarrier(value: HsonNode): HsonNode {
  return elem(value);
}
