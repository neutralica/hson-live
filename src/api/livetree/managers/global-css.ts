// global_css.ts

import { canon_to_css_prop, normalize_css_value } from "../../../_tests/test-exports.js";
import { CssMapBase, CssPseudoKey, CssValue } from "../../../types/css.types.js";
import { camel_to_kebab } from "../../../utils/attrs-utils/camel_to_kebab.js";
import { pseudo_to_suffix } from "./css-manager.js";
import { make_style_setter, StyleSetter } from "./style-setter.js";
import { normalize_css_var_name } from "./style-getter.js";

/**
 * Stored model for one global CSS rule.
 *
 * @property selector CSS selector for the rendered rule.
 * @property decls Canonical property map for the rule body.
 * @property scopes At-rule wrappers applied around the rule.
 */
type GlobalRule = {
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
type MediaQueryInput =
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
* Supports query input accepted by `GlobalCss.supports()`.
*
* String inputs may include or omit the `@supports` prefix. Object inputs
* are rendered as declaration tests joined with `and`.
*/
type SupportsQueryInput =
  | string
  | Record<string, string | number | boolean>;

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
    drop(): void;     // remove entire rule
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

  /** Return a CSS variable reference, e.g. `"theme-ink"` -> `"var(--theme-ink)"`. */
  ref(name: string): `var(--${string})`;

  /** Set a global `:root` CSS custom property. */
  set(name: string, value: CssValue): void;

  /** Read a raw global `:root` CSS custom-property value. */
  get(name: string): string | undefined;

  /** Remove one global `:root` CSS custom property. */
  remove(name: string): void;

  /** Remove all global variables managed through this facade. */
  clear(): void;

  /** List canonical global variable names currently managed through this facade. */
  list(): readonly `--${string}`[];
}>;

const GLOBAL_VARS_RULE_KEY = "global-vars::root";
const GLOBAL_VARS_SELECTOR = ":root";

/**
 * GlobalCss change subscribers.
 *
 * Subscribers are notified after rule state changes and are expected to
 * trigger stylesheet re-rendering.
 */
const _listeners = new Set<() => void>();

/**
 * Whether a subscriber notification is already queued.
 */
let _pending = false;

/**
 * Queue one batched notification for all GlobalCss subscribers.
 *
 * Multiple mutations in the same turn are coalesced into one microtask.
 */
function notifyChanged(): void {
  if (_pending) return;
  _pending = true;

  queueMicrotask(() => {
    _pending = false;
    for (const fn of _listeners) fn();
  });
}

/**
 * Render a StyleSetter value into CSS declaration text.
 *
 * @param v Value supplied through the StyleSetter surface.
 * @returns A trimmed CSS value, or `null` when the value represents removal.
 */
function render_css_value(v: unknown): string | null {
  if (v == null) return null;

  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";

  if (typeof v === "object") {
    const obj = v as { value?: unknown; unit?: unknown };
    if ("value" in obj) {
      const raw = obj.value;
      const unit = typeof obj.unit === "string" ? obj.unit : "";
      const val =
        typeof raw === "string" ? raw.trim() :
          typeof raw === "number" ? String(raw) :
            raw == null ? "" :
              String(raw);
      return `${val}${unit}`.trim();
    }
  }

  return String(v).trim();
}

/**
 * Render a selector and canonical declaration map into CSS text.
 *
 * Declaration keys are normalized to CSS property names, values are normalized
 * through the shared CSS value path, and empty declarations are skipped.
 *
 * @param selector CSS selector for the rule.
 * @param decls Canonical property map for the rule body.
 * @returns A compact CSS rule, or `""` when no declarations remain.
 */
export function render_rule(selector: string, decls: Record<string, string>): string {
  const keys = Object.keys(decls)
    .map(k => k.trim())
    .filter(Boolean)
    .sort();

  if (keys.length === 0) return "";

  const body = keys
    .map((canon) => {
      const raw = decls[canon];
      const trimmed = raw == null ? "" : String(raw).trim();
      if (trimmed.length === 0) return "";

      const prop = canon_to_css_prop(canon);
      const val = normalize_css_value(prop, trimmed);

      return `${prop}:${val};`;
    })
    .filter(Boolean)
    .join("");

  if (!body) return "";
  return `${selector}{${body}}`;
}

/**
 * Render a CSS rule inside nested at-rule scopes.
 *
 * @param selector CSS selector for the inner rule.
 * @param decls Canonical property map for the rule body.
 * @param scopes At-rule wrappers, ordered outermost to innermost.
 * @returns Scoped CSS text, or `""` when the inner rule is empty.
 */
function render_scoped_rule(
  selector: string,
  decls: Record<string, string>,
  scopes: readonly string[],
): string {
  const base = render_rule(selector, decls).trim();
  if (!base) return "";

  let out = base;

  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    const scope = scopes[i] ?? "";
    out = `${scope} {\n${indent_block(out)}\n}`;
  }

  return out;
}

/**
 * Indent a block of rendered CSS by one nesting level.
 *
 * @param src CSS text to indent.
 * @returns The same text with two spaces added to each line.
 */
function indent_block(src: string): string {
  return src
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

/**
 * Convert media input into an `@media` rule header.
 *
 * @param input Raw media query text or structured media query options.
 * @returns A normalized `@media ...` string.
 * @throws If the query is empty.
 */
function media_to_at_rule(input: MediaQueryInput): string {
  if (typeof input === "string") {
    const q = input.trim();
    if (!q) throw new Error("GlobalCss.media: empty query");
    return q.startsWith("@media ") ? q : `@media ${q}`;
  }

  const parts: string[] = [];

  const pushPx = (name: string, value?: string | number) => {
    if (value == null) return;
    parts.push(`(${name}: ${typeof value === "number" ? `${value}px` : value})`);
  };

  pushPx("max-width", input.maxWidth);
  pushPx("min-width", input.minWidth);
  pushPx("max-height", input.maxHeight);
  pushPx("min-height", input.minHeight);

  if (input.orientation) parts.push(`(orientation: ${input.orientation})`);
  if (input.hover) parts.push(`(hover: ${input.hover})`);
  if (input.pointer) parts.push(`(pointer: ${input.pointer})`);

  if (parts.length === 0) throw new Error("GlobalCss.media: empty object query");

  return `@media ${parts.join(" and ")}`;
}

/**
 * Convert supports input into an `@supports` rule header.
 *
 * @param input Raw supports condition text or declaration-test map.
 * @returns A normalized `@supports ...` string.
 * @throws If the condition is empty.
 */
function supports_to_at_rule(input: SupportsQueryInput): string {
  if (typeof input === "string") {
    const q = input.trim();
    if (!q) throw new Error("GlobalCss.supports: empty condition");
    return q.startsWith("@supports ") ? q : `@supports ${q}`;
  }

  const parts = Object.entries(input)
    .map(([k, v]) => {
      if (typeof v === "boolean") return v ? `(${k})` : `not (${k})`;
      return `(${k}: ${String(v)})`;
    });

  if (parts.length === 0) throw new Error("GlobalCss.supports: empty object condition");

  return `@supports ${parts.join(" and ")}`;
}

/**
 * Global stylesheet manager.
 *
 * `GlobalCss` stores selector-based rules that are not scoped to LiveTree QUIDs.
 * `CssManager` includes the rendered output in its managed stylesheet.
 */
export class GlobalCss {
  /**
    * Return the shared GlobalCss singleton.
  *
  * @returns The process-local `GlobalCss` instance.
  */
  private static _inst: GlobalCss | undefined;

  private readonly rules = new Map<string, GlobalRule>();
  private readonly rendered = new Map<string, string>();

  public static invoke(): GlobalCss {
    if (!this._inst) this._inst = new GlobalCss();
    return this._inst;
  }

  /**
 * Return the public API for managing global CSS rules.
 *
 * The supplied callback is subscribed to batched rule changes. Call
 * `dispose()` on the returned API to remove that subscription.
 *
 * @param onChange Callback invoked after rendered global CSS changes.
 * @returns A stable rule-management API.
 */
  public static api(onChange: () => void) {
    _listeners.add(onChange);

    const g = () => GlobalCss.invoke();
    const root = g().facade([]);

    return {
      ...root,
      var: g().varsFacade(),
      dispose: () => { _listeners.delete(onChange); },
      drop: (ruleKey: string) => g().remove(ruleKey),
      clearAll: () => g().clear(),
      has: (ruleKey: string) => g().has(ruleKey),
      list: () => g().list(),
      get: (ruleKey: string) => g().get(ruleKey),
      renderAll: () => g().renderAll(),
    } as const;
  }

  /**
 * Create a rule facade for a specific at-rule scope stack.
 *
 * @param scopes At-rule wrappers applied to rules created by this facade.
 * @returns A facade for creating rules and nested scoped facades.
 */
  private facade(scopes: readonly string[] = []) {
    const g = () => GlobalCss.invoke();

    return {
      rule: (ruleKey: string, selector: string) =>
        g().rule(ruleKey, selector, scopes),

      sel: (selector: string) =>
        g().rule(GlobalCss.id_for_selector(selector), selector, scopes),

      var: g().varsFacade(),

      scope: (scopeName: string, atRule: string) =>
        g().facade([...scopes, atRule.trim()]),

      media: (query: MediaQueryInput) =>
        g().facade([...scopes, media_to_at_rule(query)]),

      supports: (cond: SupportsQueryInput) =>
        g().facade([...scopes, supports_to_at_rule(cond)]),

      layer: (layerName: string) =>
        g().facade([...scopes, `@layer ${layerName.trim()}`]),
    } as const;
  }


  /**
   * Create or update a keyed global rule handle.
   *
   * If an existing rule uses the same key and selector, its declarations are
   * reused. If the selector changes, the rule starts with an empty declaration map.
   *
   * @param keyStr Stable rule key.
   * @param selStr CSS selector for the rule.
   * @param scopes At-rule wrappers applied when rendering.
   * @returns A StyleSetter-backed global rule handle.
   * @throws If the key or selector is empty.
   */
  private rule(
    keyStr: string,
    selStr: string,
    scopes: readonly string[] = [],
  ): GlobalRuleHandle {
    const ruleKey = keyStr.trim();
    const selector = selStr.trim();
    if (!ruleKey) throw new Error("GlobalCss.rule: empty source");
    if (!selector) throw new Error("GlobalCss.rule: empty selector");

    const prior = this.rules.get(ruleKey);
    const decls: Record<string, string> =
      prior && prior.selector === selector ? { ...prior.decls } : {};

    /**
     * Commit the current declaration map for this rule.
     *
     * Empty declaration maps remove the rule. Unchanged rendered output is ignored.
     */
    const applyNow = (): void => {
      const cssText = render_rule(selector, decls).trim();

      if (!cssText) {
        const had = this.rules.delete(ruleKey) || this.rendered.delete(ruleKey);
        if (had) notifyChanged();
        return;
      }

      const prev = this.rendered.get(ruleKey);
      if (prev === cssText) return;

      this.rules.set(ruleKey, { selector, decls: { ...decls }, scopes: [...scopes] });
      this.rendered.set(ruleKey, cssText);
      notifyChanged();
    };


    const setter = make_style_setter<void>(undefined, {
      /**
       * Apply or remove one declaration from the rule.
       *
       * @param propCanon Canonical CSS property name.
       * @param value StyleSetter value to render.
       */
      apply: (propCanon, value) => {
        const rendered = render_css_value(value);

        if (rendered == null || rendered.length === 0) {
          if (propCanon in decls) {
            delete decls[propCanon];
            applyNow();
          }
          return;
        }

        if (decls[propCanon] === rendered) return;

        decls[propCanon] = rendered;
        applyNow();
      },

      /**
       * Remove one declaration from the rule.
       *
       * @param propCanon Canonical CSS property name.
       */
      remove: (propCanon) => {
        if (propCanon in decls) {
          delete decls[propCanon];
          applyNow();
        }
      },

      /**
       * Remove all declarations from the rule.
       */
      clear: () => {
        const hadAny = Object.keys(decls).length > 0;
        if (!hadAny) return;
        for (const k of Object.keys(decls)) delete decls[k];
        applyNow();
      },


      /**
       * Apply a pseudo-class or pseudo-element declaration block.
       *
       * Pseudo declarations are stored as sibling global rules. `::before` and
       * `::after` receive an empty `content` declaration when none is provided.
       *
       * @param pseudo Pseudo selector key.
       * @param pseudoDecls Declaration map for the pseudo rule.
       */
      applyPseudo: (pseudo: CssPseudoKey, pseudoDecls: CssMapBase) => {
        const suf = pseudo_to_suffix(pseudo);
        const pseudoKey = `${ruleKey}${suf}`;
        const pseudoSelector = `${selector}${suf}`;

        const h = GlobalCss.invoke().rule(pseudoKey, pseudoSelector, scopes);
        h.setMany(pseudoDecls);

        if ((pseudo === "__before" || pseudo === "__after") && !("content" in pseudoDecls)) {
          h.setProp("content", `""`);
        }
      },
    });


    return {
      ...setter,
      ruleKey,
      selector,
      drop: () => {
        const had = this.rules.delete(ruleKey) || this.rendered.delete(ruleKey);
        if (had) notifyChanged();
      },
    };
  }

  /**
   * Return the global CSS custom-property facade.
   *
   * Values are stored in the shared `:root` rule, so this facade is suitable
   * for theme tokens and app-wide variables. It intentionally does not depend
   * on any LiveTree node or QUID selector.
   */
  private varsFacade(): GlobalVarFacade {
    const canonical = (name: string): `--${string}` | undefined => {
      return normalize_css_var_name(name);
    };

    const getRootRule = (): GlobalRule | undefined => {
      const found = this.rules.get(GLOBAL_VARS_RULE_KEY);
      if (!found || found.selector !== GLOBAL_VARS_SELECTOR) return undefined;
      return found;
    };

    const getRootDecls = (): Record<string, string> => {
      const prior = getRootRule();
      return prior ? { ...prior.decls } : {};
    };

    const commitRootDecls = (decls: Record<string, string>): void => {
      const keys = Object.keys(decls).filter(Boolean);

      if (keys.length === 0) {
        const had = this.rules.delete(GLOBAL_VARS_RULE_KEY) || this.rendered.delete(GLOBAL_VARS_RULE_KEY);
        if (had) notifyChanged();
        return;
      }

      const cssText = render_rule(GLOBAL_VARS_SELECTOR, decls).trim();
      const prev = this.rendered.get(GLOBAL_VARS_RULE_KEY);
      if (prev === cssText) return;

      this.rules.set(GLOBAL_VARS_RULE_KEY, {
        selector: GLOBAL_VARS_SELECTOR,
        decls: { ...decls },
      });

      this.rendered.set(GLOBAL_VARS_RULE_KEY, cssText);
      notifyChanged();
    };

    return {
      name: (name: string) => canonical(name),

      ref: (name: string) => {
        const canon = canonical(name);
        if (!canon) throw new Error(`GlobalCss.var.ref: invalid CSS variable name: ${name}`);
        return `var(${canon})` as `var(--${string})`;
      },

      set: (name: string, value: CssValue) => {
        const canon = canonical(name);
        if (!canon) return;

        const rendered = render_css_value(value);
        const decls = getRootDecls();

        if (rendered == null || rendered.length === 0) {
          delete decls[canon];
          commitRootDecls(decls);
          return;
        }

        if (decls[canon] === rendered) return;
        decls[canon] = rendered;
        commitRootDecls(decls);
      },

      get: (name: string) => {
        const canon = canonical(name);
        if (!canon) return undefined;
        return getRootRule()?.decls[canon];
      },

      remove: (name: string) => {
        const canon = canonical(name);
        if (!canon) return;

        const decls = getRootDecls();
        if (!(canon in decls)) return;

        delete decls[canon];
        commitRootDecls(decls);
      },

      clear: () => {
        const had = this.rules.delete(GLOBAL_VARS_RULE_KEY) || this.rendered.delete(GLOBAL_VARS_RULE_KEY);
        if (had) notifyChanged();
      },

      list: () => {
        const decls = getRootRule()?.decls ?? {};
        return Object.keys(decls)
          .filter((k): k is `--${string}` => k.startsWith("--"))
          .sort();
      },
    };
  }

  /**
   * Build the internal key used for selector-keyed rules.
   *
   * @param selStr CSS selector.
   * @returns Stable `sel:<selector>` key.
   */
  private static id_for_selector(selStr: string): string {
    return `sel:${selStr.trim()}`;
  }


  /**
   * Return a selector-keyed rule handle.
   *
   * @param selStr CSS selector for the rule.
   * @returns A global rule handle keyed by selector.
   * @throws If the selector is empty.
   */
  private sel(selStr: string): GlobalRuleHandle {
    const selector = selStr.trim();
    if (!selector) throw new Error("GlobalCss.sel: empty selector");
    return this.rule(GlobalCss.id_for_selector(selector), selector);
  }

  /**
   * Remove a global rule by key.
   *
   * @param keyStr Rule key to remove.
   */
  private remove(keyStr: string): void {
    const source = keyStr.trim();
    if (!source) return;
    const had = this.rules.delete(source) || this.rendered.delete(source);
    if (had) notifyChanged();
  }

  /**
   * Remove all global rules.
   */
  private clear(): void {
    if (this.rules.size === 0 && this.rendered.size === 0) return;
    this.rules.clear();
    this.rendered.clear();
    notifyChanged();
  }

  /**
   * Test whether a rule currently has rendered CSS.
   *
   * @param keyStr Rule key to check.
   * @returns `true` when a rendered rule exists for the key.
   */
  private has(keyStr: string): boolean {
    const source = keyStr.trim();
    if (!source) return false;
    return this.rendered.has(source);
  }

  /**
   * List rendered rule keys in stable order.
   *
   * @returns Sorted rule keys.
   */
  private list(): readonly string[] {
    return Array.from(this.rendered.keys()).sort();
  }

  /**
   * Read rendered CSS for one rule.
   *
   * @param sourceRaw Rule key to read.
   * @returns Rendered CSS for the rule, or `undefined` when absent.
   */
  private get(sourceRaw: string): string | undefined {
    const source = sourceRaw.trim();
    if (!source) return undefined;
    return this.rendered.get(source);
  }

  /**
   * Render all global rules.
   *
   * @returns All rendered global CSS, separated by blank lines.
   */
  private renderAll(): string {
    return this.list()
      .map((k) => this.rules.get(k))
      .filter((r): r is GlobalRule => !!r)
      .map((r) => render_scoped_rule(r.selector, r.decls, r.scopes ?? []))
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n\n");
  }
}