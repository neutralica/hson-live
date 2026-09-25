import { camel_to_kebab } from "../../transform/utils/attrs-utils/camel_to_kebab.js";
import { is_persisted_quid } from "../../../core/hson-node-quid.js";
import { HSON_QUID_MARKUP_NAME } from "../quid/data-quid.js";
export { pseudo_to_suffix } from "../../../internal/css/pseudo-suffix.js";
export { render_complete_css } from "../../../internal/css/global-css-text.js";
export type { ManagedCssRule } from "../../../internal/css/global-css-text.js";

export function selector_for_quid(quid: string): string {
  if (!is_persisted_quid(quid)) {
    throw new Error(`Cannot construct a QUID selector for "${quid}".`);
  }
  return `[${HSON_QUID_MARKUP_NAME.replace(/:/g, "\\:")}="${quid}"]`;
}

function css_property(prop: string): string {
  if (prop.startsWith("--")) return prop;
  if (prop.includes("-")) return prop.toLowerCase();
  return camel_to_kebab(prop);
}

export function render_quid_rule(quid: string, props: ReadonlyMap<string, string>): string {
  if (props.size === 0) return "";
  const declarations = [...props].map(([prop, value]) => `${css_property(prop)}: ${value};`);
  return `${selector_for_quid(quid)} { ${declarations.join(" ")} }`;
}
