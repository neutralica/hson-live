import { normalize_css_key } from "../../api/transform/utils/attrs-utils/normalize-css.js";
import { canonical_keyframes_definition, render_keyframes_definition } from "../../api/livetree/managers/keyframes-manager.js";
import { canonical_property_registration, render_property_registration } from "../../api/livetree/managers/at-property-builder.js";
import type { CssValue } from "../../core/style.types.js";
import type { PropertyInput, PropertyRegistration, PropertySyntax } from "../../types/at-property.types.js";
import type { KeyframesInput, KeyframesDef, KeyframeSelector } from "../../types/keyframes.types.js";
import { render_complete_css, render_global_css_value, render_scoped_global_css_rule } from "./global-css-text.js";

/**
 * Canonical document-global CSS state. The rule array is authored first-write
 * order; declarations and the two global registries are canonical name order.
 * There is no render cache, order counter, DOM host, QUID, or owner ledger.
 */
export type PortableDocumentStylesheet = Readonly<{
  rules: readonly PortableDocumentRule[];
  properties: readonly PropertyRegistration[];
  keyframes: readonly KeyframesDef[];
}>;

export type PortableDocumentRule = Readonly<{
  ruleKey: string;
  selector: string;
  scopes: readonly string[];
  declarations: Readonly<Record<string, string>>;
}>;

/** Structured transport form; pairs make declaration order explicit on the wire. */
export type PortableDocumentStylesheetRecord = Readonly<{
  rules: readonly Readonly<{
    ruleKey: string;
    selector: string;
    scopes: readonly string[];
    declarations: readonly (readonly [string, string])[];
  }>[];
  properties: readonly PropertyRegistration[];
  keyframes: readonly Readonly<{
    name: string;
    steps: readonly Readonly<{
      at: KeyframeSelector;
      declarations: readonly (readonly [string, string])[];
    }>[];
  }>[];
}>;

const PROPERTY_SYNTAX: ReadonlySet<string> = new Set<PropertySyntax>([
  "<number>", "<length>", "<angle>", "<time>", "<percentage>", "<color>",
  "<length-percentage>", "<angle-percentage>", "<number-percentage>", "<ident>", "*",
]);

function compare_names(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function is_property_syntax(value: string): value is PropertySyntax { return PROPERTY_SYNTAX.has(value); }
function is_custom_property_name(name: string): name is `--${string}` { return name.startsWith("--") && name.length > 2; }
function is_keyframe_selector(at: string): at is KeyframeSelector {
  return at === "from" || at === "to" || /^(?:100|\d{1,2})(?:\.\d+)?%$/.test(at);
}

function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid stylesheet record.");
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) throw new TypeError("Invalid stylesheet prototype.");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const actual = Reflect.ownKeys(input);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key))) {
    throw new TypeError("Invalid stylesheet fields.");
  }
  for (const key of keys) if (!descriptors[key] || !("value" in descriptors[key])) throw new TypeError("Invalid stylesheet field.");
  return input as Record<string, unknown>;
}

function nonempty(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) throw new TypeError("Expected nonempty stylesheet text.");
  return input.trim();
}

function declaration_pairs(input: unknown): Readonly<Record<string, string>> {
  if (!Array.isArray(input)) throw new TypeError("Expected stylesheet declarations.");
  const values = new Map<string, string>();
  for (const pair of input) {
    if (!Array.isArray(pair) || pair.length !== 2) throw new TypeError("Invalid declaration pair.");
    const property = normalize_css_key(nonempty(pair[0]));
    const value = nonempty(pair[1]);
    if (values.has(property)) throw new TypeError("Duplicate stylesheet declaration.");
    values.set(property, value);
  }
  return Object.freeze(Object.fromEntries([...values].sort(([a], [b]) => compare_names(a, b))));
}

function pairs(declarations: Readonly<Record<string, string>>): readonly (readonly [string, string])[] {
  return Object.entries(declarations).sort(([a], [b]) => compare_names(a, b)).map(([key, value]) => [key, value] as const);
}

function property_registration(input: unknown): PropertyRegistration {
  if (input === null || typeof input !== "object") throw new TypeError("Invalid @property registration.");
  const value = record(input, Object.hasOwn(input, "init") ? ["name", "syn", "inh", "init"] : ["name", "syn", "inh"]);
  const name = nonempty(value.name);
  if (!is_custom_property_name(name)) throw new TypeError("Invalid @property name.");
  if (typeof value.syn !== "string" || !is_property_syntax(value.syn)) throw new TypeError("Invalid @property syntax.");
  if (typeof value.inh !== "boolean") throw new TypeError("Invalid @property inheritance.");
  if (value.init !== undefined && typeof value.init !== "string") throw new TypeError("Invalid @property initial value.");
  const normalized = canonical_property_registration({ name, syn: value.syn, inh: value.inh, ...(value.init === undefined ? {} : { init: value.init }) });
  return Object.freeze({ name: normalized.name, syn: normalized.syn, inh: normalized.inh,
    ...(normalized.init === undefined ? {} : { init: normalized.init }) });
}

function keyframes_definition(input: unknown): KeyframesDef {
  const value = record(input, ["name", "steps"]);
  const name = nonempty(value.name);
  if (!Array.isArray(value.steps) || value.steps.length === 0) throw new TypeError("Invalid keyframe steps.");
  const steps: [KeyframeSelector, Readonly<Record<string, string>>][] = [];
  const seen = new Set<string>();
  for (const item of value.steps) {
    const step = record(item, ["at", "declarations"]);
    const at = nonempty(step.at);
    if (!is_keyframe_selector(at)) throw new TypeError("Invalid keyframe selector.");
    if (seen.has(at)) throw new TypeError("Duplicate keyframe selector.");
    seen.add(at);
    steps.push([at, declaration_pairs(step.declarations)]);
  }
  const normalized = canonical_keyframes_definition({ name, steps });
  return Object.freeze({ name: normalized.name, steps: Object.freeze(normalized.steps.map((step) => Object.freeze({ at: step.at, decls: Object.freeze({ ...step.decls }) }))) });
}

/** Admit a detached, frozen canonical value from a structured portable record. */
export function decode_portable_document_stylesheet(input: unknown): PortableDocumentStylesheet {
  const value = record(input, ["rules", "properties", "keyframes"]);
  if (!Array.isArray(value.rules) || !Array.isArray(value.properties) || !Array.isArray(value.keyframes)) {
    throw new TypeError("Invalid stylesheet collections.");
  }
  const ruleKeys = new Set<string>();
  const rules = value.rules.map((item: unknown): PortableDocumentRule => {
    const rule = record(item, ["ruleKey", "selector", "scopes", "declarations"]);
    const ruleKey = nonempty(rule.ruleKey);
    const selector = nonempty(rule.selector);
    if (!Array.isArray(rule.scopes)) throw new TypeError("Invalid rule scopes.");
    // GlobalCss.scope stores authored wrapper headers as trimmed text.
    const scopes = Object.freeze(rule.scopes.map((scope: unknown) => nonempty(scope)));
    const identity = JSON.stringify([scopes, ruleKey]);
    if (ruleKeys.has(identity)) throw new TypeError("Duplicate stylesheet rule.");
    ruleKeys.add(identity);
    const declarations = declaration_pairs(rule.declarations);
    if (Object.keys(declarations).length === 0) throw new TypeError("Empty stylesheet rule.");
    return Object.freeze({ ruleKey, selector, scopes, declarations });
  });
  const properties = value.properties.map(property_registration).sort((a, b) => compare_names(a.name, b.name));
  if (new Set(properties.map((item) => item.name)).size !== properties.length) throw new TypeError("Duplicate @property.");
  const keyframes = value.keyframes.map(keyframes_definition).sort((a, b) => compare_names(a.name, b.name));
  if (new Set(keyframes.map((item) => item.name)).size !== keyframes.length) throw new TypeError("Duplicate @keyframes.");
  return Object.freeze({ rules: Object.freeze(rules), properties: Object.freeze(properties), keyframes: Object.freeze(keyframes) });
}

/** The initial semantic state of every future document library. */
export function empty_portable_document_stylesheet(): PortableDocumentStylesheet {
  return decode_portable_document_stylesheet({ rules: [], properties: [], keyframes: [] });
}

export function encode_portable_document_stylesheet(value: PortableDocumentStylesheet): PortableDocumentStylesheetRecord {
  const canonical = decode_portable_document_stylesheet({
    rules: value.rules.map((rule) => ({ ...rule, scopes: [...rule.scopes], declarations: pairs(rule.declarations) })),
    properties: value.properties.map((property) => ({ ...property })),
    keyframes: value.keyframes.map((definition) => ({ name: definition.name, steps: definition.steps.map((step) => ({ at: step.at, declarations: pairs(step.decls) })) })),
  });
  return {
    rules: canonical.rules.map((rule) => ({ ruleKey: rule.ruleKey, selector: rule.selector, scopes: [...rule.scopes], declarations: pairs(rule.declarations) })),
    properties: canonical.properties.map((property) => ({ ...property })),
    keyframes: canonical.keyframes.map((definition) => ({ name: definition.name, steps: definition.steps.map((step) => ({ at: step.at, declarations: pairs(step.decls) })) })),
  };
}

export function clone_portable_document_stylesheet(value: PortableDocumentStylesheet): PortableDocumentStylesheet {
  return decode_portable_document_stylesheet(encode_portable_document_stylesheet(value));
}

export function portable_document_stylesheet_equal(a: PortableDocumentStylesheet, b: PortableDocumentStylesheet): boolean {
  return JSON.stringify(encode_portable_document_stylesheet(a)) === JSON.stringify(encode_portable_document_stylesheet(b));
}

export function render_portable_document_stylesheet(value: PortableDocumentStylesheet): string {
  const canonical = decode_portable_document_stylesheet(encode_portable_document_stylesheet(value));
  const propertyCss = canonical.properties.map(render_property_registration).join("\n\n");
  const keyframesCss = canonical.keyframes.map((definition) => render_keyframes_definition(definition)).join("\n\n");
  return render_complete_css(propertyCss, keyframesCss, canonical.rules.map((rule, order) => ({
    order, text: render_scoped_global_css_rule(rule.selector, rule.declarations, rule.scopes),
  })));
}

/** Set one declaration; existing rule position survives updates, removal/re-add appends. */
export function set_portable_document_declaration(
  value: PortableDocumentStylesheet,
  ruleKeyRaw: string,
  selectorRaw: string,
  propertyRaw: string,
  rawValue: CssValue,
  scopesRaw: readonly string[] = [],
): PortableDocumentStylesheet {
  const ruleKey = nonempty(ruleKeyRaw);
  const selector = nonempty(selectorRaw);
  const property = normalize_css_key(nonempty(propertyRaw));
  const scopes = scopesRaw.map(nonempty);
  const rendered = render_global_css_value(rawValue);
  const identity = JSON.stringify([scopes, ruleKey]);
  const index = value.rules.findIndex((rule) => JSON.stringify([rule.scopes, rule.ruleKey]) === identity);
  const prior = index < 0 ? undefined : value.rules[index];
  const declarations = prior?.selector === selector ? { ...prior.declarations } : {};
  if (rendered) declarations[property] = rendered;
  else delete declarations[property];
  const rules = [...value.rules];
  if (Object.keys(declarations).length === 0) {
    if (index < 0) return value;
    rules.splice(index, 1);
  } else {
    const next = { ruleKey, selector, scopes, declarations };
    if (index < 0) rules.push(next);
    else rules[index] = next;
  }
  const result = decode_portable_document_stylesheet({ ...encode_portable_document_stylesheet(value), rules: rules.map((rule) => ({ ...rule, declarations: pairs(rule.declarations) })) });
  return portable_document_stylesheet_equal(value, result) ? value : result;
}

export function drop_portable_document_rule(value: PortableDocumentStylesheet, ruleKey: string, scopes: readonly string[] = []): PortableDocumentStylesheet {
  const identity = JSON.stringify([scopes, ruleKey.trim()]);
  const rules = value.rules.filter((rule) => JSON.stringify([rule.scopes, rule.ruleKey]) !== identity);
  if (rules.length === value.rules.length) return value;
  return decode_portable_document_stylesheet({ ...encode_portable_document_stylesheet(value), rules: rules.map((rule) => ({ ...rule, declarations: pairs(rule.declarations) })) });
}

export function set_portable_document_property(value: PortableDocumentStylesheet, input: PropertyInput): PortableDocumentStylesheet {
  const registration = property_registration(canonical_property_registration(input));
  const properties = value.properties.filter((item) => item.name !== registration.name).map((item) => ({ ...item }));
  properties.push(registration);
  const result = decode_portable_document_stylesheet({ ...encode_portable_document_stylesheet(value), properties });
  return portable_document_stylesheet_equal(value, result) ? value : result;
}

export function drop_portable_document_property(value: PortableDocumentStylesheet, name: string): PortableDocumentStylesheet {
  const properties = value.properties.filter((item) => item.name !== name.trim());
  return properties.length === value.properties.length ? value
    : decode_portable_document_stylesheet({ ...encode_portable_document_stylesheet(value), properties });
}

export function set_portable_document_keyframes(value: PortableDocumentStylesheet, input: KeyframesInput): PortableDocumentStylesheet {
  const normalized = canonical_keyframes_definition(input);
  const keyframes = value.keyframes.filter((item) => item.name !== normalized.name)
    .map((definition) => ({ name: definition.name, steps: definition.steps.map((step) => ({ at: step.at, declarations: pairs(step.decls) })) }));
  keyframes.push({ name: normalized.name, steps: normalized.steps.map((step) => ({ at: step.at, declarations: pairs(step.decls) })) });
  const result = decode_portable_document_stylesheet({ ...encode_portable_document_stylesheet(value), keyframes });
  return portable_document_stylesheet_equal(value, result) ? value : result;
}

export function drop_portable_document_keyframes(value: PortableDocumentStylesheet, name: string): PortableDocumentStylesheet {
  const keyframes = encode_portable_document_stylesheet(value).keyframes.filter((item) => item.name !== name.trim());
  return keyframes.length === value.keyframes.length ? value
    : decode_portable_document_stylesheet({ ...encode_portable_document_stylesheet(value), keyframes });
}
