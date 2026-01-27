// css.types.ts

import { LiveTree } from "../api/livetree/livetree";
import { CssAnimHandle } from "./animate.types";
import { KeyframesManager } from "./keyframes.types";
import { StyleSetter } from "../api/livetree/managers-etc/style-setter";
import { PropertyManager } from "./at-property.types";
import { StyleGetter } from "../api/livetree/managers-etc/style-getter";


/* doc me */
type GetApi = {
  // get a canonical property, e.g. "maskPosition", "opacity", "WebkitMaskPosition"
  prop: (propCanon: string) => string | undefined;

  // get a css variable, e.g. "--cloud-phase-px"
  var: (name: string) => string | undefined;

  // convenience (optional)
  opacity: () => string | undefined;
};

/**
 * Normalized set of CSS units supported by the style utilities.
 *
 * Used to represent structured numeric values where the unit is explicit
 * and machine-readable, enabling later math or transformation.
 *
 * - `"_"` is reserved for unitless values (e.g. `line-height: 1.2`).
 */
export type CssUnit =
  | "px"
  | "em"
  | "rem"
  | "%"
  | "vh"
  | "vw"
  | "s"
  | "ms"
  | "deg"
  | "_"; // unitless

/** Values accepted by style setters and CSS manager helpers. */
export type CssValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Readonly<{ value: string | number; unit?: string }>;

/**
 * Canonical stored representation of a single CSS rule as text.
 *
 * Fields:
 * - `id`:
 *     - Stable identifier used by `CssManager` to track and update this
 *       rule over time.
 * - `css`:
 *     - Fully rendered CSS text for the rule, e.g.
 *       `"* { background-color: red; }"`.
 *
 * This format is optimized for injection into `<style>` elements and
 * diffing at the rule level.
 */
export interface CssText {
  // stable identifier for this rule within CssManager
  id: string;
  // fully rendered CSS text, e.g. `* { background-color: red; }`
  css: string;
}

/**
 * Structured input shape for text-based CSS rules.
 *
 * Fields:
 * - `id`:
 *     - Stable identifier for the rule within `CssManager`.
 * - `selector`:
 *     - Raw selector string, e.g. `"*"`, `"body"`, `"[data-quid]"`.
 * - `body`:
 *     - Style declaration block as text, e.g. `"background-color: red;"`.
 *
 * This is a higher-level, pre-render form that can be converted into a
 * `CssText` for actual stylesheet injection.
 */
export interface CssRule {
  id: string;
  selector: string; // e.g. "*", "body", "[_hson-flag]"
  body: string;     // e.g. "background-color: red;"
}

/**
 * Map from CSS property names to structured values.
 *
 * Keys:
 * - Raw CSS property names, typically in kebab-case or camelCase.
 *
 * Values:
 * - Either raw strings (e.g. `"240px"`) or structured `{ value, unit }`
 *   pairs that can later be rendered into text.
 *
 * Used for building rule bodies and bulk style updates.
 */
export type CssProp = Record<string, CssValue>;

/**
 * Structured representation of a CSS rule prior to text rendering.
 *
 * Fields:
 * - `selector`:
 *     - The CSS selector this block applies to.
 * - `declarations`:
 *     - A `CssProp` map of property names to `CssValue`s.
 *
 * This form is convenient for programmatically constructing and
 * transforming rules before they are serialized to CSS text.
 */
export type CssRuleBlock = {
  selector: string;
  declarations: CssProp;
};

/**
 * Fluent builder interface for constructing or updating a single CSS rule.
 *
 * Fields:
 * - `id`:
 *     - Stable identifier for the rule within `CssManager`.
 * - `selector`:
 *     - The selector string this builder is targeting.
 *
 * Methods:
 * - `set(property, value)`:
 *     - Set or overwrite a single declaration on the rule.
 * - `setMany(decls)`:
 *     - Apply multiple property/value pairs in one call.
 * - `commit()`:
 *     - Render and push the current declarations into `CssManager`,
 *       creating or updating the backing rule.
 * - `remove()`:
 *     - Remove the rule associated with this builder from `CssManager`.
 *
 * Implementations are expected to be stateful, reflecting the current
 * declaration set until `commit()` or `remove()` is called.
 */
export interface CssRuleBuilder {
  readonly id: string;
  readonly selector: string;

  set(property: string, value: CssValue): CssRuleBuilder;
  setMany(decls: Record<string, CssValue>): CssRuleBuilder;

  // TRASH // apply current declarations to CssManager
  // commit(): void;

  // convenience: remove rule from CssManager
  remove(): void;
}

/**
 * Plain-object representation of inline style declarations.
 *
 * Keys:
 * - `CsseKey` values, typically:
 *   - Known CSS properties derived from `CSSStyleDeclaration`.
 *   - Custom props / kebab-case names.
 *
 * Values:
 * - `string | number | null | undefined`:
 *   - `string` / `number` → applied as-is (with units provided by caller).
 *   - `null` → remove the property.
 *   - `undefined` → ignored (no-op).
 *
 * This shape is used by APIs like `StyleSetter.setMany` to perform
 * batch style updates on a node.
 */
export type CssMap = Readonly<
  Partial<Record<AllowedStyleKey | "float", CssValue>> &
  Record<string, CssValue>
>;

/**
 * Public-facing handle for working with QUID-scoped stylesheet rules.
 *
 * A `CssHandle` typically corresponds to one or more QUID selectors and
 * provides a small, declarative API for managing rules associated with
 * them.
 *
 * Methods:
 * - `set(property, value)`:
 *     - Add or update a single declaration for all bound QUIDs.
 * - `setMany(decls)`:
 *     - Add or update multiple declarations in one call.
 * - `unset(property)`:
 *     - Remove the given property from all rules under this handle.
 * - `clear()`:
 *     - Remove all declarations managed by this handle.
 *
 * Implementations are expected to reconcile these calls with an
 * underlying `<style>` element, keeping the CSS in sync with the
 * current state of the handle.
 */

export type CssGetter = Readonly<{
  // get by canonical key (what you store in rulesByQuid)
  prop: (propCanon: string) => string | undefined;

  // css var convenience
  var: (name: string) => string | undefined;

  // common convenience helpers (optional)
  opacity: () => string | undefined;
}>;

// css.types.ts (or wherever CssHandleBase lives)

// ADDED: globals API surface
export type CssGlobalsApi = Readonly<{
  set: (source: string, cssText: string) => void;
  remove: (source: string) => void;
  clear: () => void;
  list: () => readonly string[];
  get: (source: string) => string | undefined;
}>;

export type CssHandleBase<TReturn> = Readonly<
  StyleSetter<TReturn> & {
    get: StyleGetter;                
    atProperty: PropertyManager;
    keyframes: KeyframesManager;
    anim: CssAnimHandle;
  }
>;

export type CssHandle = CssHandleBase<LiveTree>;

export type StyleHandle = Readonly<
  StyleSetter<LiveTree> & {
    get: StyleGetter;
  }
>;

// hostless case for “before mount”
export type CssHandleVoid = CssHandleBase<void>;

/**
 * Union of style keys supported by the style system.
 *
 * We keep these **strongly typed** so `style.setMany({ ... })` gets
 * autocomplete for common keys like `zIndex`, while still allowing:
 * - CSS custom properties (`--foo`)
 * - kebab-case keys (`background-color`, `pointer-events`, etc.)
 * - `"float"` as a convenience alias (normalized to `cssFloat`)
 */

type StringKeys<T> = Extract<keyof T, string>;
type KeysWithStringValues<T> = {
  [K in StringKeys<T>]: T[K] extends string ? K : never
}[StringKeys<T>];

export type AllowedStyleKey = Exclude<KeysWithStringValues<CSSStyleDeclaration>, "cssText">;

/**
 * Property-name type for stringly-typed APIs like `setProp("...", ...)`.
 *
 * Keep this broad so callers can pass dynamic strings without fighting the type
 * system. For autocomplete, see `CssMap` (used by `setMany({ ... })`).
 */
export type CssKey = string;
/**
 * Proxy-call surface used by `StyleSetter.set`.
 *
 * This is a *type-level* convenience that provides ergonomic calls like:
 *   `handle.set.backgroundColor("aquamarine")`
 * while still permitting:
 *   `handle.set["background-color"]("aquamarine")`
 *   `handle.set.var("--k", 1)`
 *
 * `Next` is typically the handle type itself (for chaining).
 */

export type SetSurface<Next> =
  // enumerated known CSSStyleDeclaration keys → rich autocomplete
  {
    [K in AllowedStyleKey]: (v: CssValue) => Next;
  }
  // allow these via bracket access too
  &

  Record<`--${string}`, (v: CssValue) => Next> &
  Record<`${string}-${string}`, (v: CssValue) => Next>
  // convenience
  &

  { var: (name: `--${string}`, v: CssValue) => Next; };

