// global_css.ts

import { canon_to_css_prop, normalize_css_value } from "../../../_tests/test-exports.js";
import { CssMapBase, CssPseudoKey } from "../../../types/css.types.js";
import { camel_to_kebab } from "../../../utils/attrs-utils/camel_to_kebab.js";
import { pseudo_to_suffix } from "./css-manager.js";
import { make_style_setter, StyleSetter } from "./style-setter.js";


type GlobalRule = {
  selector: string;
  decls: Record<string, string>;
  scopes?: string[]; // CHANGED
};

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

type SupportsQueryInput =
  | string
  | Record<string, string | number | boolean>;
/**
 * Fluent handle for a single global CSS rule.
 *
 * This is a `StyleSetter` bound to a fixed selector, with extra
 * metadata and a `drop()` helper to delete the rule entirely.
 */
export type GlobalRuleHandle = Readonly<
  StyleSetter<void> & {
    readonly ruleKey: string;
    readonly selector: string;
    drop(): void;     // remove entire rule
  }
>;

const _listeners = new Set<() => void>();
let _pending = false;

function notifyChanged(): void {
  if (_pending) return;
  _pending = true;

  queueMicrotask(() => {
    _pending = false;
    for (const fn of _listeners) fn();
  });
}

//  keep render rules in ONE place (match make_style_setter semantics)
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
 * Render a selector + canonical declaration map into CSS text.
 *
 * - Keys are normalized to kebab-case (except custom properties).
 * - Empty/whitespace values are skipped.
 * - Returns `""` when no declarations remain.
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

function indent_block(src: string): string {
  return src
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

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
 * Global stylesheet manager (selector-based, not QUID-scoped).
 *
 * Stores a set of named rules and renders them into CSS text for
 * `CssManager` to include in its combined output.
 */
export class GlobalCss {
  private static _inst: GlobalCss | undefined;

  public static invoke(): GlobalCss {
    if (!this._inst) this._inst = new GlobalCss();
    return this._inst;
  }

  /**
   * Return a stable API for managing global CSS rules.
   *
   * - Subscribes `onChange` to internal updates (call `dispose()` to remove).
   * - Rules are keyed by `ruleKey` to allow updates and replacement.
   * - Use `sel(selector)` when you don't care about rule keys; the selector
   *   is used to derive a stable key internally.
   */
  public static api(onChange: () => void) {
    _listeners.add(onChange);

    const g = () => GlobalCss.invoke();
    const root = g().facade([]);

    return {
      ...root,
      dispose: () => { _listeners.delete(onChange); },
      drop: (ruleKey: string) => g().remove(ruleKey),
      clearAll: () => g().clear(),
      has: (ruleKey: string) => g().has(ruleKey),
      list: () => g().list(),
      get: (ruleKey: string) => g().get(ruleKey),
      renderAll: () => g().renderAll(),
    } as const;
  }

  private readonly rules = new Map<string, GlobalRule>();
  private readonly rendered = new Map<string, string>();
  private facade(scopes: readonly string[] = []) {
    const g = () => GlobalCss.invoke();

    return {
      rule: (ruleKey: string, selector: string) =>
        g().rule(ruleKey, selector, scopes),

      sel: (selector: string) =>
        g().rule(GlobalCss.id_for_selector(selector), selector, scopes),

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

      remove: (propCanon) => {
        if (propCanon in decls) {
          delete decls[propCanon];
          applyNow();
        }
      },

      clear: () => {
        const hadAny = Object.keys(decls).length > 0;
        if (!hadAny) return;
        for (const k of Object.keys(decls)) delete decls[k];
        applyNow();
      },

      // GlobalCss supports pseudos by emitting sibling rules
      applyPseudo: (pseudo: CssPseudoKey, pseudoDecls: CssMapBase) => {
        const suf = pseudo_to_suffix(pseudo);
        const pseudoKey = `${ruleKey}${suf}`;
        const pseudoSelector = `${selector}${suf}`;

        const h = GlobalCss.invoke().rule(pseudoKey, pseudoSelector, scopes);
        h.setMany(pseudoDecls);

        if ((pseudo === "__before" || pseudo === "__after") && !("content" in pseudoDecls)) {
          h.setProp("content", `""`); // NOTE: setProp, not h.set("content", ...) if that’s what your handle exposes
        }
      },
    });

    // you were missing this return entirely
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

  private static id_for_selector(selStr: string): string {
    return `sel:${selStr.trim()}`;
  }

  private sel(selStr: string): GlobalRuleHandle {
    const selector = selStr.trim();
    if (!selector) throw new Error("GlobalCss.sel: empty selector");
    return this.rule(GlobalCss.id_for_selector(selector), selector);
  }

  private remove(keyStr: string): void {
    const source = keyStr.trim();
    if (!source) return;
    const had = this.rules.delete(source) || this.rendered.delete(source);
    if (had) notifyChanged();
  }

  private clear(): void {
    if (this.rules.size === 0 && this.rendered.size === 0) return;
    this.rules.clear();
    this.rendered.clear();
    notifyChanged();
  }

  private has(keyStr: string): boolean {
    const source = keyStr.trim();
    if (!source) return false;
    return this.rendered.has(source);
  }

  private list(): readonly string[] {
    return Array.from(this.rendered.keys()).sort();
  }

  private get(sourceRaw: string): string | undefined {
    const source = sourceRaw.trim();
    if (!source) return undefined;
    return this.rendered.get(source);
  }

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