// css.types.ts

import { LiveTree } from "../api/livetree/livetree.js";
import { CssAnimHandle } from "./animate.types.js";
import { KeyframesManager } from "./keyframes.types.js";
import { StyleSetter } from "../api/livetree/managers/style-setter.js";
import { PropertyManager } from "./at-property.types.js";
import { StyleGetMany, StyleGetter } from "../api/livetree/managers/style-getter.js";
import { CssManager } from "../api/livetree/managers/css-manager.js";



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

  // remove rule from CssManager
  remove(): void;
}
/**
 * Keys used to express pseudo-classes and pseudo-elements in `CssMap`.
 *
 * These keys are *not* emitted as CSS properties. Instead, they represent
 * nested declaration maps that should be applied to selector variants:
 * - `_hover` → `:hover`
 * - `_focusVisible` → `:focus-visible`
 * - `__before` → `::before`
 * - `__after` → `::after`
 */
export type CssPseudoKey =
  | "_hover"
  | "_active"
  | "_focus"
  | "_focusWithin"
  | "_focusVisible"
  | "_visited"
  | "_checked"
  | "_disabled"
  | "__before"
  | "__after";

// base map cannot contain pseudos (so pseudo blocks don’t recurse)
//  nested maps through the string index signature ok too


interface CssMapBase_ extends Partial<Record<AllowedStyleKey | "float", CssValue>> {
  // allow nested maps (for pseudos) *and* regular css values
  // NOTE: include undefined so `Partial<>` behaves sanely with the index signature.
  [k: string]: CssValue | CssMapBase_ | undefined;
}

/**
 * Base declaration map used by style setters.
 *
 * Notes:
 * - Values are `CssValue` or nested maps for grouping.
 * - Pseudo keys should be placed only at the top level (see `CssMap`).
 */
export type CssMapBase = Readonly<CssMapBase_>;

/**
 * Full declaration map accepted by `StyleSetter.setMany`.
 *
 * In addition to normal declarations, it may include pseudo blocks keyed
 * by `CssPseudoKey`, each of which is itself a `CssMapBase` of declarations.
 */
export type CssMap = Readonly<
  CssMapBase_ &
  Partial<Record<CssPseudoKey, CssMapBase_>>
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

/**
 * Read-only accessor for rendered CSS values from a style handle.
 *
 * This reads the *internal truth* (HSON attrs or CssManager state), not
 * computed styles from the browser.
 */
export type CssGetter = Readonly<{
  // get by canonical key (stored in rulesByQuid)
  prop: (propCanon: string) => string | undefined;

  // css var convenience
  var: (name: string) => string | undefined;

  // common convenience helpers (optional)
  opacity: () => string | undefined;
}>;


/**
 * Handle for a single global CSS rule returned by `CssGlobalsApi`.
 */
export type CssGlobalRuleHandle = Readonly<
  StyleSetter<void> & {
    readonly ruleKey: string;
    readonly selector: string;
    drop(): void;
  }
>;

/**
 * Media query input accepted by global CSS facades.
 *
 * String inputs may include or omit the `@media` prefix. Numeric dimensions
 * in object inputs are rendered as pixel values.
 */
export type CssGlobalMediaQueryInput =
  | string
  | {
    maxWidth?: string | number;
    minWidth?: string | number;
    maxHeight?: string | number;
    minHeight?: string | number;
    orientation?: "portrait" | "landscape";
    hover?: "hover" | "none";
    pointer?: "fine" | "coarse" | "none";
  };

/**
 * Supports query input accepted by global CSS facades.
 *
 * String inputs may include or omit the `@supports` prefix. Object inputs are
 * rendered as declaration tests joined with `and`.
 */
export type CssGlobalSupportsQueryInput =
  | string
  | Record<string, string | number | boolean>;

/**
 * Global stylesheet API used by `CssManager.globals.invoke()`.
 *
 * This surface is rule-based: callers obtain a `CssGlobalRuleHandle` and
 * then use the regular `StyleSetter` API to mutate that rule.
 *
 * `scope`, `media`, `supports`, and `layer` return scoped facades. Rules
 * created from those facades render inside the corresponding at-rule wrapper.
 */
export type CssGlobalsApi = Readonly<{
  dispose: () => void;
  rule: (ruleKey: string, selector: string) => CssGlobalRuleHandle;
  sel: (selector: string) => CssGlobalRuleHandle;
  drop: (ruleKey: string) => void;
  clearAll: () => void;
  scope: (scopeName: string, atRule: string) => CssGlobalsApi;
  media: (query: CssGlobalMediaQueryInput) => CssGlobalsApi;
  supports: (cond: CssGlobalSupportsQueryInput) => CssGlobalsApi;
  layer: (layerName: string) => CssGlobalsApi;

  has: (ruleKey: string) => boolean;
  list: () => readonly string[];
  get: (ruleKey: string) => string | undefined;
  renderAll: () => string;
}>;

export type StyleHandle<TOwner> = Readonly<
  StyleSetter<TOwner> & {
    get: StyleGetter;
    getMany: () => StyleGetMany;
    var: CssVarFacade<TOwner>;
  }
>;

export type CssHandleBase<TReturn> = Readonly<
  StyleSetter<TReturn> & {
    get: StyleGetter;
    getMany: () => StyleGetMany;
    var: CssVarFacade<TReturn>;
    atProperty: PropertyManager;
    keyframes: KeyframesManager;
    anim: CssAnimHandle;
    devSnapshot: () => string;

    selector: (pattern: string) => StyleHandle<TReturn>;

    // CHANGED: QUID-scoped CSS handles mirror the global at-rule facade.
    // These still render through CssManager, but the generated selectors remain
    // scoped to this handle's QUIDs.
    media: (query: MediaQueryInput) => CssHandleBase<TReturn>;
    supports: (cond: SupportsQueryInput) => CssHandleBase<TReturn>;
    layer: (layerName: string) => CssHandleBase<TReturn>;
  }
>;

export type CssTreeHandle<TOwner = LiveTree> = CssHandleBase<TOwner>;

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
 * CSS custom property name in canonical `--x` form.
 */
export type CssVarName = `--${string}`;


/**
 * Proxy-call surface used by `StyleSetter.set`.
 *
 * This is a *type-level* convenience that provides ergonomic calls like:
 *   `handle.set.backgroundColor("aquamarine")`
 * while still permitting:
 *   `handle.set["background-color"]("aquamarine")`
 *   `handle.set.var("--k", 1)`
 *   `handle.set.var("k", 1)`
 *
 * `Next` is typically the handle type itself (for chaining).
 */
export type SetSurface<Next> =
  {
    [K in AllowedStyleKey]: (v: CssValue) => Next;
  }
  & Record<CssVarName, (v: CssValue) => Next>
  & Record<`${string}-${string}`, (v: CssValue) => Next>
  & {
    /** Set a CSS custom property. Accepts `"--x"`, `"-x"`, or `"x"`. */
    var: (name: string, v: CssValue) => Next;
  };
  
/**
 * Unified CSS custom-property helper used by global CSS, QUID-scoped CSS,
 * and inline style handles.
 *
 * Semantics:
 * - `name("x")` returns the canonical declaration name: `--x`.
 * - `key("x")` returns a usable CSS reference: `var(--x)`.
 * - `set("x", value)` writes the custom property to this handle's own scope.
 * - `value("x")` reads only this handle's own stored value; it does not read
 *   inherited or computed browser values.
 */
export type CssVarFacade<TReturn> = Readonly<{
  name: (name: string) => CssVarName;
  key: (name: string) => `var(${CssVarName})`;
  set: (name: string, value: CssValue) => TReturn;
  value: (name: string) => string | undefined;
}>;
/**
 * Stored model for one global CSS rule.
 *
 * @property selector CSS selector for the rendered rule.
 * @property decls Canonical property map for the rule body.
 * @property scopes At-rule wrappers applied around the rule.
 */
export type GlobalRule = {
  selector: string;
  decls: Record<string, string>;
  scopes?: string[]; // CHANGED
};
/**
 * Media query input accepted by `GlobalCss.media()`.
 *
 * String inputs may include or omit the `@media` prefix. Object inputs
 * are joined with `and`; numeric dimensions are rendered as pixel values.
 */
export type MediaQueryInput = string |
{
  maxWidth?: string | number;
  minWidth?: string | number;
  maxHeight?: string | number;
  minHeight?: string | number;
  orientation?: "portrait" | "landscape";
  hover?: "hover" | "none";
  pointer?: "fine" | "coarse" | "none";
};/**
* Supports query input accepted by `GlobalCss.supports()`.
*
* String inputs may include or omit the `@supports` prefix. Object inputs
* are rendered as declaration tests joined with `and`.
*/
export type SupportsQueryInput = string |
  Record<string, string | number | boolean>;
/**
 * Fluent handle for one global CSS rule.
 *
 * The handle is a `StyleSetter` bound to a fixed selector. Writes update the
 * stored global rule and notify subscribers when rendered CSS changes.
 *
 * @property ruleKey Stable key used to replace, read, or drop the rule.
 * @property selector CSS selector targeted by the rule.
 * @property drop Remove the entire rule.
 */

export type GlobalRuleHandle = Readonly<
  StyleSetter<void> & {
    readonly ruleKey: string;
    readonly selector: string;
    drop(): void; // remove entire rule
  }
>;
/**
 * Global CSS custom-property facade.
 *
 * These variables are written to `:root`, not to QUID-scoped or node-local
 * styles. Use this for app/theme variables that should be consumed throughout
 * the document.
 */

export type GlobalVarFacade = Readonly<{
  /** Return a canonical CSS custom-property name, e.g. `"theme-ink"` -> `"--theme-ink"`. */
  name(name: string): `--${string}` | undefined;

  /** Return a CSS variable reference for use in declarations, e.g. `"theme-ink"` -> `"var(--theme-ink)"`. */
  key(name: string): `var(--${string})`;

  /** Set a global `:root` CSS custom property. */
  set(name: string, value: CssValue): void;

  /** Read a raw global `:root` CSS custom-property declaration value. */
  value(name: string): string | undefined;

  /** Remove one global `:root` CSS custom property. */
  remove(name: string): void;

  /** Remove all global variables managed through this facade. */
  clear(): void;

  /** List canonical global variable names currently managed through this facade. */
  list(): readonly `--${string}`[];
}>;

export type CssRuleFacade = Readonly<{
  rule: ReturnType<typeof CssManager.api>["rule"];
  media: (query: MediaQueryInput) => CssRuleFacade;
  supports: (cond: SupportsQueryInput) => CssRuleFacade;
  layer: (layerName: string) => CssRuleFacade;
}>;

