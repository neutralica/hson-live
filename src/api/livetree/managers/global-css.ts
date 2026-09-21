// global-css.ts

import { canon_to_css_prop, normalize_css_value } from "../../transform/utils/attrs-utils/normalize-css.js";
import { CssGlobalsApi, CssMapBase, CssPseudoKey, CssRuleFacade, CssValue, GlobalRule, GlobalRuleHandle, GlobalVarFacade, MediaQueryInput, SupportsQueryInput } from "../../../types/css.types.js";
import { camel_to_kebab } from "../../transform/utils/attrs-utils/camel_to_kebab.js";
import { pseudo_to_suffix, type ManagedCssRule } from "./css-render.js";
import { make_style_setter } from "./style-setter.js";
import { normalize_css_var_name } from "./style-getter.js";

const GLOBAL_VARS_RULE_KEY = "global-vars::root";
const GLOBAL_VARS_SELECTOR = ":root";

type StoredGlobalRule = GlobalRule & { ruleKey: string; order: number; scopes: string[] };

/**
 * Render a StyleSetter value into CSS declaration text.
 *
 * @param v Value supplied through the StyleSetter surface.
 * @returns A trimmed CSS value, or `null` when the value represents removal.
 */
function renderCssValue(v: unknown): string | null {
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
function renderScopedRule(
  selector: string,
  decls: Record<string, string>,
  scopes: readonly string[],
): string {
  const base = render_rule(selector, decls).trim();
  if (!base) return "";

  let out = base;

  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    const scope = scopes[i] ?? "";
    out = `${scope} {\n${indentBlock(out)}\n}`;
  }

  return out;
}

/**
 * Indent a block of rendered CSS by one nesting level.
 *
 * @param src CSS text to indent.
 * @returns The same text with two spaces added to each line.
 */
function indentBlock(src: string): string {
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
function mediaToAtRule(input: MediaQueryInput): string {
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
function convertSupportsToAt(input: SupportsQueryInput): string {
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
/** Runtime operations kept behind the LiveTree package boundary. @internal */
export type GlobalCssRuntimeApi = CssGlobalsApi & Readonly<{
  dispose: () => void;
  dropByPrefix: (prefix: string) => void;
  dropBySelectorFragment: (fragment: string) => void;
  renderAll: () => string;
}>;

/** @internal */
export class GlobalCss {
  /**
    * Return the shared GlobalCss singleton.
  *
  * @returns The process-local `GlobalCss` instance.
  */
  private static _inst: GlobalCss | undefined;

  private readonly rules = new Map<string, StoredGlobalRule>();
  private fallbackOrder = 0;
  private readonly allocateOrder: () => number;
  private readonly rendered = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private pending = false;

  public constructor(nextOrder?: () => number) {
    this.allocateOrder = nextOrder ?? (() => this.fallbackOrder++);
  }

  public static invoke(): GlobalCss {
    if (!this._inst) this._inst = new GlobalCss();
    return this._inst;
  }

  private notifyChanged(): void {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      for (const fn of this.listeners) fn();
    });
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
  public static api(onChange: () => void): GlobalCssRuntimeApi {
    return GlobalCss.invoke().api(onChange);
  }

  /** Runtime-local facade factory. @internal */
  public api(onChange: () => void): GlobalCssRuntimeApi {
    this.listeners.add(onChange);

    const g = () => this;
    const root = g().facade([]);

    return {
      ...root,
      var: g().varsFacade(),
      dispose: () => { this.listeners.delete(onChange); },
      drop: (ruleKey: string) => g().remove(ruleKey),
      dropByPrefix: (prefix: string) => g().removeByPrefix(prefix),
      dropBySelectorFragment: (fragment: string) => g().removeBySelectorFragment(fragment),
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
  private facade(scopes: readonly string[] = []): CssRuleFacade {
    const g = () => this;

    return {
      rule: (ruleKey: string, selector: string) =>
        g().rule(ruleKey, selector, scopes),

      sel: (selector: string) =>
        g().rule(GlobalCss.id_for_selector(selector), selector, scopes),

      var: g().varsFacade(),

      scope: (scopeName: string, atRule: string) =>
        g().facade([...scopes, atRule.trim()]),

      media: (query: MediaQueryInput) =>
        g().facade([...scopes, mediaToAtRule(query)]),

      supports: (cond: SupportsQueryInput) =>
        g().facade([...scopes, convertSupportsToAt(cond)]),

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

    // The scope stack is part of rule identity; a selector may coexist at base,
    // media, supports, layer, and nested scopes. No DOM state participates.
    const identity = this.identity(ruleKey, scopes);
    const currentDecls = (): Record<string, string> => {
      const current = this.rules.get(identity);
      return current?.selector === selector ? { ...current.decls } : {};
    };
    const commit = (decls: Record<string, string>): void => {
      const cssText = render_rule(selector, decls).trim();
      const prior = this.rules.get(identity);
      if (!cssText) {
        if (this.rules.delete(identity)) {
          this.rendered.delete(identity);
          this.notifyChanged();
        }
        return;
      }
      if (prior?.selector === selector && this.rendered.get(identity) === cssText) return;
      this.rules.set(identity, {
        ruleKey, selector, decls: { ...decls }, scopes: [...scopes],
        order: prior?.order ?? this.allocateOrder(),
      });
      this.rendered.set(identity, cssText);
      this.notifyChanged();
    };

    const setter = make_style_setter<void>(undefined, {
      /**
       * Apply or remove one declaration from the rule.
       *
       * @param propCanon Canonical CSS property name.
       * @param value StyleSetter value to render.
       */
      apply: (propCanon, value) => {
        const rendered = renderCssValue(value);
        const decls = currentDecls();
        if (rendered == null || rendered.length === 0) {
          if (propCanon in decls) {
            delete decls[propCanon];
            commit(decls);
          }
          return;
        }
        if (decls[propCanon] === rendered) return;
        decls[propCanon] = rendered;
        commit(decls);
      },
      remove: (propCanon) => {
        const decls = currentDecls();
        if (!(propCanon in decls)) return;
        delete decls[propCanon];
        commit(decls);
      },
      clear: () => commit({}),

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

        const h = this.rule(pseudoKey, pseudoSelector, scopes);
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
        if (this.rules.delete(identity)) {
          this.rendered.delete(identity);
          this.notifyChanged();
        }
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

    const getRootRule = (): StoredGlobalRule | undefined => {
      const found = this.rules.get(this.identity(GLOBAL_VARS_RULE_KEY, []));
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
        // CHANGED: delete both maps explicitly; do not leave rendered CSS stale.
        const hadRule = this.rules.delete(this.identity(GLOBAL_VARS_RULE_KEY, []));
        const hadRendered = this.rendered.delete(this.identity(GLOBAL_VARS_RULE_KEY, []));

        if (hadRule || hadRendered) this.notifyChanged();
        return;
      }

      const cssText = render_rule(GLOBAL_VARS_SELECTOR, decls).trim();
      const prev = this.rendered.get(this.identity(GLOBAL_VARS_RULE_KEY, []));
      if (prev === cssText) return;

      this.rules.set(this.identity(GLOBAL_VARS_RULE_KEY, []), {
        ruleKey: GLOBAL_VARS_RULE_KEY,
        order: getRootRule()?.order ?? this.allocateOrder(),
        scopes: [],
        selector: GLOBAL_VARS_SELECTOR,
        decls: { ...decls },
      });

      this.rendered.set(this.identity(GLOBAL_VARS_RULE_KEY, []), cssText);
      this.notifyChanged();
    };

    return {
      name: (name: string) => canonical(name),

      key: (name: string) => {
        const canon = canonical(name);
        if (!canon) throw new Error(`GlobalCss.var.key: invalid CSS variable name: ${name}`);
        return `var(${canon})` as `var(--${string})`;
      },

      set: (name: string, value: CssValue) => {
        const canon = canonical(name);
        if (!canon) return;

        const rendered = renderCssValue(value);
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

      value: (name: string) => {
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
        const hadRule = this.rules.delete(this.identity(GLOBAL_VARS_RULE_KEY, []));
        const hadRendered = this.rendered.delete(this.identity(GLOBAL_VARS_RULE_KEY, []));

        if (hadRule || hadRendered) this.notifyChanged();
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

  private identity(ruleKey: string, scopes: readonly string[]): string {
    return JSON.stringify([scopes, ruleKey]);
  }

  /** Public drop addresses every scope bearing the supplied explicit key. */
  private remove(keyStr: string): void {
    const source = keyStr.trim();
    if (!source) return;
    let changed = false;
    for (const [identity, rule] of this.rules) {
      if (rule.ruleKey !== source) continue;
      this.rules.delete(identity);
      this.rendered.delete(identity);
      changed = true;
    }
    if (changed) this.notifyChanged();
  }

  private removeByPrefix(prefixRaw: string): void {
    const prefix = prefixRaw.trim();
    if (!prefix) return;
    let changed = false;
    for (const [identity, rule] of this.rules) {
      if (!rule.ruleKey.startsWith(prefix)) continue;
      this.rules.delete(identity);
      this.rendered.delete(identity);
      changed = true;
    }
    if (changed) this.notifyChanged();
  }

  private removeBySelectorFragment(fragmentRaw: string): void {
    const fragment = fragmentRaw.trim();
    if (!fragment) return;
    let changed = false;
    for (const [identity, rule] of this.rules) {
      if (!rule.selector.includes(fragment)) continue;
      this.rules.delete(identity);
      this.rendered.delete(identity);
      changed = true;
    }
    if (changed) this.notifyChanged();
  }

  /**
   * Remove all global rules.
   */
  private clear(): void {
    if (this.rules.size === 0 && this.rendered.size === 0) return;
    this.rules.clear();
    this.rendered.clear();
    this.notifyChanged();
  }

  private has(keyStr: string): boolean {
    return this.get(keyStr) !== undefined;
  }

  /** Public rule-key inventory remains sorted; rendering uses authored order. */
  private list(): readonly string[] {
    return [...new Set([...this.rules.values()].map((rule) => rule.ruleKey))].sort();
  }

  /** Prefer the base scope when one key names several scoped rules. */
  private get(sourceRaw: string): string | undefined {
    const source = sourceRaw.trim();
    if (!source) return undefined;
    const base = this.rendered.get(this.identity(source, []));
    if (base !== undefined) return base;
    for (const [identity, rule] of this.rules) {
      if (rule.ruleKey === source) return this.rendered.get(identity);
    }
    return undefined;
  }

  /** DOM-free authored-order entries for the complete stylesheet renderer. */
  public renderEntries(): readonly ManagedCssRule[] {
    return [...this.rules.values()]
      .sort((a, b) => a.order - b.order)
      .map((rule) => ({
        order: rule.order,
        text: renderScopedRule(rule.selector, rule.decls, rule.scopes),
      }));
  }

  private renderAll(): string {
    return this.renderEntries().map((entry) => entry.text).join("\n\n");
  }
}
