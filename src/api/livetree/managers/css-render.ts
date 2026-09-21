import { camel_to_kebab } from "../../transform/utils/attrs-utils/camel_to_kebab.js";
import { is_persisted_quid } from "../../../core/hson-node-quid.js";
import type { CssPseudoKey } from "../../../core/style.types.js";
import { HSON_QUID_MARKUP_NAME } from "../quid/data-quid.js";

/** Portable, already-authored stylesheet rule. Order is assigned on first write. */
export type ManagedCssRule = Readonly<{ order: number; text: string }>;

export function pseudo_to_suffix(p: CssPseudoKey): string {
  switch (p) {
    case "_hover": return ":hover";
    case "_active": return ":active";
    case "_focus": return ":focus";
    case "_focusWithin": return ":focus-within";
    case "_focusVisible": return ":focus-visible";
    case "_visited": return ":visited";
    case "_disabled": return ":disabled";
    case "_checked": return ":checked";
    case "__before": return "::before";
    case "__after": return "::after";
  }
}

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

/**
 * The sole complete managed-stylesheet composition path. Registries retain
 * their stable prefix position; selector and QUID rules share authored order.
 * This renderer has no DOM, CSSOM, scheduling, or runtime dependency.
 */
export function render_complete_css(
  propertyCss: string,
  keyframesCss: string,
  rules: readonly ManagedCssRule[],
): string {
  const parts = [propertyCss.trim(), keyframesCss.trim()];
  const ordered = [...rules].sort((a, b) => a.order - b.order);
  parts.push(...ordered.map((rule) => rule.text.trim()));
  return parts.filter(Boolean).join("\n\n");
}
