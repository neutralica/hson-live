import type { CssPseudoKey } from "../../types/css.types.js";
import type { DocumentCssHandle, DocumentCssMap, DocumentCssRuleFacade, DocumentCssRuleHandle, DocumentCssValue } from "../../types/document-css.types.js";
import type { LiveMapCssOp, LiveMapCssUnitOp } from "../../types/livemap.types.js";
import type { PropertyInput, PropertyRegistration, CssCustomPropName } from "../../types/at-property.types.js";
import type { KeyframesInput, KeyframesDef } from "../../types/keyframes.types.js";
import { is_css_declaration_value } from "../../core/inline-style.js";
import { normalize_css_var_name } from "../../internal/css/css-var-name.js";
import { pseudo_to_suffix } from "../../internal/css/pseudo-suffix.js";
import { mediaToAtRule, convertSupportsToAt as convertSupportsToAtRule } from "../../internal/css/global-css-scopes.js";
import { canonical_property_registration } from "../../internal/css/property-registration.js";
import { canonical_keyframes_definition } from "../../internal/css/keyframes-definition.js";
import { render_scoped_global_css_rule } from "../../internal/css/global-css-text.js";
import { DocumentStylesheetError, parse_document_stylesheet } from "../../internal/css/parse-document-stylesheet.js";
import {
  decode_portable_document_stylesheet,
  encode_portable_document_stylesheet,
  render_portable_document_stylesheet,
  set_portable_document_declaration,
  drop_portable_document_rule,
  type PortableDocumentStylesheet,
  type PortableDocumentStylesheetRecord,
} from "../../internal/css/portable-document-stylesheet.js";

const VAR_RULE_KEY = "global-vars::root";
const PSEUDOS = new Set(["_hover", "_active", "_focus", "_focusWithin", "_focusVisible", "_visited", "_checked", "_disabled", "__before", "__after"]);
type RuleRecord = PortableDocumentStylesheetRecord["rules"][number];

/** LiveMap owns the state and transition; this facade owns no revision or CSS cache. */
export function make_livemap_document_css(
  read: () => PortableDocumentStylesheet,
  commit: (operation: LiveMapCssOp) => void,
): DocumentCssHandle {
  const rule_identity = (rule: RuleRecord): string => JSON.stringify([rule.scopes, rule.ruleKey]);
  const changed_units = (before: PortableDocumentStylesheet, after: PortableDocumentStylesheet): LiveMapCssUnitOp[] => {
    const oldRules = encode_portable_document_stylesheet(before).rules;
    const newRules = encode_portable_document_stylesheet(after).rules;
    const oldByKey = new Map(oldRules.map((rule) => [rule_identity(rule), rule]));
    const newByKey = new Map(newRules.map((rule) => [rule_identity(rule), rule]));
    const units: LiveMapCssUnitOp[] = [];
    for (const prior of oldRules) if (!newByKey.has(rule_identity(prior))) {
      units.push({ domain: "css", kind: "rule", ruleKey: prior.ruleKey, scopes: prior.scopes });
    }
    for (const next of newRules) if (JSON.stringify(oldByKey.get(rule_identity(next))) !== JSON.stringify(next)) {
      units.push({ domain: "css", kind: "rule", ruleKey: next.ruleKey, scopes: next.scopes, rule: next });
    }
    return units;
  };
  const publish_rules = (before: PortableDocumentStylesheet, after: PortableDocumentStylesheet): void => {
    const units = changed_units(before, after);
    if (units.length === 1) commit(units[0]!);
    else if (units.length > 1) commit({ domain: "css", kind: "batch", operations: units });
  };
  const rule = (rawKey: string, rawSelector: string, scopes: readonly string[]): DocumentCssRuleHandle => {
    const ruleKey = rawKey.trim();
    const selector = rawSelector.trim();
    if (!ruleKey || !selector) throw new TypeError("Document CSS rule key and selector must be nonempty.");
    if (ruleKey.startsWith("stylesheet:")) throw new TypeError("The stylesheet: rule key prefix is reserved for parsed CSS rules.");
    const write = (property: string, value: DocumentCssValue): void => {
      const before = read();
      const after = set_portable_document_declaration(before, ruleKey, selector, property, value, scopes);
      publish_rules(before, after);
    };
    const api: DocumentCssRuleHandle = {
      ruleKey, selector,
      set: new Proxy({} as DocumentCssRuleHandle["set"], { get: (_target, key) => {
        if (key === "var") return (name: string, value: DocumentCssValue) => {
          const normalized = normalize_css_var_name(name);
          if (normalized) write(normalized, value);
        };
        return typeof key === "string" ? (value: DocumentCssValue) => write(key, value) : undefined;
      } }),
      setProp: (property, value) => { write(property, value); },
      remove: (property) => { write(property, null); },
      clear: () => { commit({ domain: "css", kind: "rule", ruleKey, scopes }); },
      drop: () => { commit({ domain: "css", kind: "rule", ruleKey, scopes }); },
      setMany: (map: DocumentCssMap) => {
        if (map === null || typeof map !== "object" || Array.isArray(map)) throw new TypeError("CSS declarations must be an object.");
        const before = read();
        let after = before;
        for (const [key, value] of Object.entries(map)) {
          if (PSEUDOS.has(key) && value !== null && typeof value === "object" && !Array.isArray(value)) {
            const suffix = pseudo_to_suffix(key as CssPseudoKey);
            for (const [property, nested] of Object.entries(value)) {
              if (!is_css_declaration_value(nested)) throw new TypeError("Invalid pseudo declaration value.");
              after = set_portable_document_declaration(after, `${ruleKey}${suffix}`, `${selector}${suffix}`, property, nested, scopes);
            }
            if ((key === "__before" || key === "__after") && !("content" in value)) {
              after = set_portable_document_declaration(after, `${ruleKey}${suffix}`, `${selector}${suffix}`, "content", '""', scopes);
            }
            continue;
          }
          if (!is_css_declaration_value(value)) throw new TypeError("Invalid CSS declaration value.");
          after = set_portable_document_declaration(after, ruleKey, selector, key, value, scopes);
        }
        publish_rules(before, after);
      },
    };
    return api;
  };
  const vars: DocumentCssHandle["var"] = {
    name: (name) => normalize_css_var_name(name),
    key: (name) => {
      const normalized = normalize_css_var_name(name);
      if (!normalized) throw new TypeError("Invalid CSS variable name.");
      return `var(${normalized})`;
    },
    set: (name, value) => {
      const normalized = normalize_css_var_name(name);
      if (normalized) rule(VAR_RULE_KEY, ":root", []).setProp(normalized, value);
    },
    value: (name) => {
      const normalized = normalize_css_var_name(name);
      return normalized === undefined ? undefined : read().rules.find((item) => item.ruleKey === VAR_RULE_KEY && item.scopes.length === 0)?.declarations[normalized];
    },
    remove: (name) => {
      const normalized = normalize_css_var_name(name);
      if (normalized) rule(VAR_RULE_KEY, ":root", []).remove(normalized);
    },
    clear: () => { commit({ domain: "css", kind: "rule", ruleKey: VAR_RULE_KEY, scopes: [] }); },
    list: () => Object.keys(read().rules.find((item) => item.ruleKey === VAR_RULE_KEY && item.scopes.length === 0)?.declarations ?? {}).sort() as `--${string}`[],
  };
  const scoped = (scopes: readonly string[]): DocumentCssRuleFacade => ({
    rule: (key, selector) => rule(key, selector, scopes),
    sel: (selector) => rule(`sel:${selector.trim()}`, selector, scopes),
    var: vars,
    scope: (_name, atRule) => scoped([...scopes, atRule.trim()]),
    media: (query) => scoped([...scopes, mediaToAtRule(query)]),
    supports: (condition) => scoped([...scopes, convertSupportsToAtRule(condition)]),
    layer: (name) => scoped([...scopes, `@layer ${name.trim()}`]),
  });
  const root = scoped([]);
  const atProperty: DocumentCssHandle["atProperty"] = {
    register: (input: PropertyInput) => {
      const definition = canonical_property_registration(input);
      commit({ domain: "css", kind: "property", name: definition.name, definition });
    },
    registerMany: (inputs: readonly PropertyInput[]) => {
      const definitions = inputs.map(canonical_property_registration);
      if (definitions.length) commit({ domain: "css", kind: "batch", operations: definitions.map((definition) =>
        ({ domain: "css", kind: "property", name: definition.name, definition })) });
    },
    unregister: (name: CssCustomPropName) => { commit({ domain: "css", kind: "property", name }); },
    has: (name: CssCustomPropName) => read().properties.some((item) => item.name === name),
    get: (name: CssCustomPropName): PropertyRegistration | undefined => read().properties.find((item) => item.name === name),
  };
  const keyframes: DocumentCssHandle["keyframes"] = {
    set: (input: KeyframesInput) => {
      const definition = canonical_keyframes_definition(input);
      const encoded = { name: definition.name, steps: definition.steps.map((step) => ({ at: step.at,
        declarations: Object.entries(step.decls).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]): readonly [string, string] => [key, value]) })) };
      commit({ domain: "css", kind: "keyframes", name: definition.name, definition: encoded });
    },
    setMany: (inputs: readonly KeyframesInput[]) => {
      const definitions = inputs.map(canonical_keyframes_definition);
      if (definitions.length) commit({ domain: "css", kind: "batch", operations: definitions.map((definition) => {
        const encoded = { name: definition.name, steps: definition.steps.map((step) => ({ at: step.at,
          declarations: Object.entries(step.decls).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]): readonly [string, string] => [key, value]) })) };
        return { domain: "css", kind: "keyframes", name: definition.name, definition: encoded };
      }) });
    },
    delete: (name: string) => { commit({ domain: "css", kind: "keyframes", name: name.trim() }); },
    has: (name: string) => read().keyframes.some((item) => item.name === name.trim()),
    get: (name: string): KeyframesDef | undefined => read().keyframes.find((item) => item.name === name.trim()),
  };
  return Object.freeze({ ...root, var: vars, atProperty, keyframes,
    stylesheet: (cssText: string): void => {
      const existing = read();
      const parsed = parse_document_stylesheet(cssText, existing.rules.map((item) => item.ruleKey));
      if (parsed.order.length === 0) return;
      const before = encode_portable_document_stylesheet(existing);
      try {
        decode_portable_document_stylesheet({
          rules: [...before.rules, ...parsed.rules],
          properties: [...before.properties, ...parsed.properties],
          keyframes: [...before.keyframes, ...parsed.keyframes],
          order: [...before.order, ...parsed.order],
        });
      } catch (error) {
        throw new DocumentStylesheetError("CSS_ADMISSION", error instanceof Error ? error.message : String(error), 1, 1, cssText, "stylesheet");
      }
      commit({ domain: "css", kind: "append", stylesheet: parsed });
    },
    drop: (ruleKey: string) => {
      const units = read().rules.filter((item) => item.ruleKey === ruleKey.trim()).map((item): LiveMapCssUnitOp =>
        ({ domain: "css", kind: "rule", ruleKey: item.ruleKey, scopes: item.scopes }));
      if (units.length === 1) commit(units[0]!);
      else if (units.length > 1) commit({ domain: "css", kind: "batch", operations: units });
    },
    clearAll: () => { commit({ domain: "css", kind: "clear-all" }); },
    has: (ruleKey: string) => read().rules.some((item) => item.ruleKey === ruleKey.trim()),
    list: () => [...new Set(read().rules.map((item) => item.ruleKey))].sort(),
    get: (ruleKey: string) => {
      const rules = read().rules;
      const item = rules.find((rule) => rule.ruleKey === ruleKey.trim() && rule.scopes.length === 0)
        ?? rules.find((rule) => rule.ruleKey === ruleKey.trim());
      return item === undefined ? undefined : render_scoped_global_css_rule(item.selector, item.declarations, item.scopes);
    },
    snapshot: () => render_portable_document_stylesheet(read()),
  });
}
