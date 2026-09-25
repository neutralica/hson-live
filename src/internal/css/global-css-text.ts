import { canon_to_css_prop, normalize_css_value } from "../../api/transform/utils/attrs-utils/normalize-css.js";

/** Order is assigned on first rule write by the owning stylesheet. */
export type ManagedCssRule = Readonly<{ order: number; text: string }>;

/** DOM-free value coercion shared by runtime global rules and portable document CSS. */
export function render_global_css_value(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object" && "value" in value) {
    const obj = value as Readonly<{ value?: unknown; unit?: unknown }>;
    const unit = typeof obj.unit === "string" ? obj.unit : "";
    const raw = obj.value;
    const text = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw);
    return `${text}${unit}`.trim();
  }
  return String(value).trim();
}

/** Existing global-rule spelling and sorted-declaration rendering. */
export function render_global_css_rule(selector: string, decls: Readonly<Record<string, string>>): string {
  const body = Object.keys(decls).map((key) => key.trim()).filter(Boolean).sort()
    .map((key) => {
      const value = decls[key]?.trim();
      if (!value) return "";
      const property = canon_to_css_prop(key);
      return `${property}:${normalize_css_value(property, value)};`;
    }).join("");
  return body ? `${selector}{${body}}` : "";
}

/** Scope headers are the at-rule strings already stored by GlobalCss. */
export function render_scoped_global_css_rule(
  selector: string,
  decls: Readonly<Record<string, string>>,
  scopes: readonly string[],
): string {
  let text = render_global_css_rule(selector, decls).trim();
  if (!text) return "";
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    text = `${scopes[index]} {\n${text.split("\n").map((line) => `  ${line}`).join("\n")}\n}`;
  }
  return text;
}

/** The shared complete CSS composition path; QUID rules can be supplied by a runtime. */
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
