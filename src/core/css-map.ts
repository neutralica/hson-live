import { assert_css_declaration_syntax } from "../internal/css/declaration-syntax.js";
import { is_known_css_property, css_property_identity } from "./css-properties.js";
import { is_typed_css_value, render_css_declaration_value } from "./inline-style.js";
import { normalize_css_key, canon_to_css_prop } from "../api/transform/utils/attrs-utils/normalize-css.js";
import { is_document_quad_name } from "../internal/document-quad-name.js";

export const CSS_PSEUDOS: Readonly<Record<string, string>> = Object.freeze({
  _hover: ':hover', _active: ':active', _focus: ':focus', _focusWithin: ':focus-within',
  _focusVisible: ':focus-visible', _visited: ':visited', _checked: ':checked',
  _disabled: ':disabled', __before: '::before', __after: '::after',
});
const CSS_UNITS: ReadonlySet<string> = new Set(('px cm mm q in pc pt em ex cap ch ic lh rlh rem rex rcap rch ric vw vh vi vb vmin vmax svw svh svi svb svmin svmax lvw lvh lvi lvb lvmin lvmax dvw dvh dvi dvb dvmin dvmax cqw cqh cqi cqb cqmin cqmax deg grad rad turn s ms hz khz dpi dpcm dppx x fr % _').split(' '));
/** Own string leaves set declarations; own undefined leaves delete; absent keys do nothing. */
export type NormalizedCssMap = { readonly [key: string]: string | undefined | NormalizedCssMap };

/** Inspect own data only, never evaluate author accessors. */
export function css_data_entries(value: unknown): readonly (readonly [string, unknown])[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('CSS requires plain data records.');
  return Reflect.ownKeys(value).map(key => {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || field === undefined || !field.enumerable || !Object.hasOwn(field, 'value')) {
      throw new TypeError('CSS requires enumerable own string data properties.');
    }
    return [key, field.value];
  });
}

export function css_property(key: string): string {
  if (!key.startsWith("--") && !/^[A-Za-z-][A-Za-z0-9-]*$/.test(key)) throw new TypeError(`Invalid CSS property: ${key}`);
  const property = canon_to_css_prop(normalize_css_key(key));
  if (!is_known_css_property(property)) throw new TypeError(`Unsupported CSS property: ${key}`);
  return property;
}

/** Defined declaration values exclude null and boolean coercion. */
export function css_declaration(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    const fields = css_data_entries(value);
    if (!is_typed_css_value(value) || fields.some(([key]) => key !== 'value' && key !== 'unit')) throw new TypeError('Invalid typed CSS value.');
    const unit = fields.find(([key]) => key === 'unit')?.[1];
    if (unit !== undefined && (typeof unit !== 'string' || unit !== "" && !CSS_UNITS.has(unit.toLowerCase()))) throw new TypeError('Invalid CSS unit.');
  } else if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
    throw new TypeError('CSS declarations require strings, finite numbers, or typed values.');
  }
  // Inspect authored strings before boundary trimming or typed-value rendering.
  if (typeof value === 'string') assert_css_declaration_syntax('', value);
  else if (is_typed_css_value(value) && typeof value.value === 'string') assert_css_declaration_syntax('', value.value);
  const rendered = render_css_declaration_value(value);
  if (typeof rendered !== 'string') throw new TypeError('Invalid CSS declaration.');
  assert_css_declaration_syntax('', rendered);
  return rendered;
}

/** Pure, detached shared grammar. Selector/media syntax is checked by the CSS lowerer. */
export function normalize_css_map(input: unknown, subjects = true): NormalizedCssMap {
  const active = new WeakSet<object>();
  let count = 0;
  const visit = (value: unknown, quad: boolean, media: boolean, depth: number): NormalizedCssMap => {
    if (depth > 64 || ++count > 100_000) throw new TypeError('CSS map resource limit exceeded.');
    if (typeof value !== 'object' || value === null || active.has(value)) throw new TypeError('Invalid or cyclic CSS map.');
    active.add(value);
    try {
      const output: Record<string, string | undefined | NormalizedCssMap> = Object.create(null);
      const identities = new Set<string>();
      for (const [key, item] of css_data_entries(value)) {
        if (item === undefined) {
          if (key === '$media') { if (!media) throw new TypeError('$media is supported only at the root.'); }
          else if (key.startsWith('@:')) {
            if (!quad || !is_document_quad_name(key.slice(2))) throw new TypeError(`Invalid local CSS QUAD reference: ${key}`);
          } else if (!Object.hasOwn(CSS_PSEUDOS, key) && !key.startsWith('&')) css_property(key);
          if (key === '$media' || key.startsWith('@:') || Object.hasOwn(CSS_PSEUDOS, key) || key.startsWith('&')) continue;
        }
        let result: string | undefined | NormalizedCssMap;
        let name = key;
        if (key === '$media') {
          if (!media) throw new TypeError('$media is supported only at the root.');
          const groups: Record<string, NormalizedCssMap> = Object.create(null);
          for (const [condition, body] of css_data_entries(item)) {
            if (body !== undefined) groups[condition] = visit(body, quad, false, depth + 1);
          }
          result = Object.freeze(groups);
        } else if (key.startsWith('@:')) {
          if (!quad || !is_document_quad_name(key.slice(2))) throw new TypeError(`Invalid local CSS QUAD reference: ${key}`);
          result = visit(item, false, false, depth + 1);
        } else if (Object.hasOwn(CSS_PSEUDOS, key) || key.startsWith('&')) {
          result = visit(item, false, false, depth + 1);
        } else {
          name = css_property(key);
          result = item === undefined ? undefined : css_declaration(item);
        }
        const identity = name.startsWith("--") ? css_property_identity(name) : name;
        if (identities.has(identity)) throw new TypeError(`CSS property normalization collision: ${key}`);
        identities.add(identity);
        Object.defineProperty(output, name, { value: result, enumerable: true });
      }
      return Object.freeze(output);
    } finally { active.delete(value); }
  };
  return visit(input, subjects, subjects, 0);
}
