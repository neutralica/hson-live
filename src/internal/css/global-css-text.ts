import { managed_css_priority, trim_managed_css } from "./managed-css-lexical.js";
import { canon_to_css_prop } from "../../api/transform/utils/attrs-utils/normalize-css.js";

/** Order is assigned on first rule write by the owning stylesheet. */
export type ManagedCssRule = Readonly<{ order: number; text: string }>;

/** DOM-free value coercion shared by runtime global rules and portable document CSS. */
export function render_global_css_value(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return trim_managed_css(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object" && "value" in value) {
    const obj = value as Readonly<{ value?: unknown; unit?: unknown }>;
    const unit = typeof obj.unit === "string" ? obj.unit : "";
    const raw = obj.value;
    const text = typeof raw === "string" ? trim_managed_css(raw) : raw == null ? "" : String(raw);
    return trim_managed_css(`${text}${unit}`);
  }
  return trim_managed_css(String(value));
}

/** Project declaration names while optionally retaining authored insertion order. */
export function render_global_css_rule(selector: string, decls: Readonly<Record<string, string>>, sourceOrder = false): string {
  const keys = Object.keys(decls).filter(Boolean);
  if (!sourceOrder) keys.sort();
  const body = keys
    .map((key) => {
      const value = decls[key] === undefined ? undefined : trim_managed_css(decls[key]);
      if (value === undefined) return "";
      const property = canon_to_css_prop(key);
      const { important, value: plain } = managed_css_priority(value);
      // Declaration values are authored CSS, including content expressions.
      return `${property}:${plain}${important ? " !important" : ""};`;
    }).join("");
  return body ? `${selector}{${body}}` : "";
}

/** Scope headers are the at-rule strings already stored by GlobalCss. */
export function render_scoped_global_css_rule(
  selector: string,
  decls: Readonly<Record<string, string>>,
  scopes: readonly string[],
  sourceOrder = false,
): string {
  let text = trim_managed_css(render_global_css_rule(selector, decls, sourceOrder));
  if (!text) return "";
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    text = `${scopes[index]} {\n${text}\n}`;
  }
  return text;
}

/** The shared complete CSS composition path; QUID rules can be supplied by a runtime. */
export function render_complete_css(
  propertyCss: string,
  keyframesCss: string,
  rules: readonly ManagedCssRule[],
): string {
  const parts = [trim_managed_css(propertyCss), trim_managed_css(keyframesCss)];
  const ordered = [...rules].sort((a, b) => a.order - b.order);
  parts.push(...ordered.map((rule) => trim_managed_css(rule.text)));
  return parts.filter(Boolean).join("\n\n");
}
