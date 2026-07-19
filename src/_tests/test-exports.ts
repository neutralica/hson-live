// test-exports.ts

import type { hson } from "../hson.js";
import type { HsonNode } from "../core/types.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;
type HsonSourceSurface = ReturnType<typeof hson.fromHson>;
type JsonSourceSurface = ReturnType<typeof hson.fromJson>;
type HtmlSourceSurface = ReturnType<typeof hson.fromTrustedHtml>;
type NodeSourceSurface = ReturnType<typeof hson.fromNode>;
type AnySourceSurface =
  | JsonSourceSurface
  | HsonSourceSurface
  | HtmlSourceSurface
  | NodeSourceSurface;

type HsonSourceReturnsCanonicalNode = Expect<
  Equal<ReturnType<HsonSourceSurface["toNode"]>, HsonNode>
>;
type EverySourceReturnsCanonicalNode = Expect<
  Equal<ReturnType<AnySourceSurface["toNode"]>, HsonNode>
>;
type HsonSourceRetainsToHson = Expect<
  Equal<"toHson" extends keyof HsonSourceSurface ? true : false, true>
>;
type HsonSerializerOmitsParse = Expect<
  Equal<
    "parse" extends keyof ReturnType<HsonSourceSurface["toHson"]> ? true : false,
    false
  >
>;

function read_node_from_any_source(source: AnySourceSurface): HsonNode {
  return source.toNode();
}

function assert_hson_serializer_has_no_parse(source: HsonSourceSurface): void {
  // @ts-expect-error HSON graph access belongs to the source-level toNode().
  source.toHson().parse();
}


export { pseudo_to_suffix } from "../api/livetree/managers/css-manager.js";
export  { normalize_css_value } from "../api/transform/utils/attrs-utils/normalize-css.js";
export { normalize_css_key } from "../api/transform/utils/attrs-utils/normalize-css.js";
export { canon_to_css_prop } from "../api/transform/utils/attrs-utils/normalize-css.js";
export { render_rule } from "../api/livetree/managers/global-css.js";
export  { normalize_decls } from "../api/livetree/managers/keyframes-manager.js";
