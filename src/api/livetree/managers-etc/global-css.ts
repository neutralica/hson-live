// global_css.ts

import { CssMap, CssRuleBuilder } from "../../../types/css.types";
import { camel_to_kebab } from "../../../utils/attrs-utils/camel_to_kebab";
import { nrmlz_cssom_prop_key } from "../../../utils/attrs-utils/normalize-css";

type GlobalRule = Readonly<{
  selector: string;
  decls: Record<string, string>; // canon prop -> rendered string
}>;

const _listeners = new Set<() => void>();

function notify_changed(): void {
  for (const fn of _listeners) fn();
}

// CHANGED: keep render rules in ONE place (match make_style_setter semantics)
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

  return String(v);
}

function render_rule(selector: string, decls: Record<string, string>): string {
  const keys = Object.keys(decls)
    .map(k => k.trim())
    .filter(Boolean)
    .sort();

  if (keys.length === 0) return "";

  const lines: string[] = [];
  lines.push(`${selector} {`);
  for (const canon of keys) {
    const raw = decls[canon];
    const v = raw == null ? "" : String(raw).trim();
    if (!v && v !== "") continue;

    const prop = canon.startsWith("--") ? canon : camel_to_kebab(canon);
    lines.push(`  ${prop}: ${v};`);
  }
  lines.push(`}`);
  return lines.join("\n");
}

export class GlobalCss {
  // ADDED: singleton instance
  private static _inst: GlobalCss | undefined;

  public static invoke(): GlobalCss {
    if (!this._inst) this._inst = new GlobalCss();
    return this._inst;
  }

  // ADDED: public “API surface” builder (so CssManager can expose it without
  // implementing these methods itself)
  public static api(onChange: () => void) {
    // CHANGED: subscribe once per caller (dedupe by identity)
    _listeners.add(onChange);

    const g = () => GlobalCss.invoke();

    return {
      rule: (source: string, selector: string) => g().rule(source, selector),
      remove: (source: string) => g().remove(source),
      clear: () => g().clear(),
      has: (source: string) => g().has(source),
      list: () => g().list(),
      get: (source: string) => g().get(source),
      renderAll: () => g().renderAll(),
    } as const;
  }

  // ---- instance state ----
  private readonly rules = new Map<string, GlobalRule>(); // source -> rule
  private readonly rendered = new Map<string, string>();  // source -> cssText

  // ADDED: builder API
  public rule(sourceRaw: string, selectorRaw: string): CssRuleBuilder {
    const source = sourceRaw.trim();
    const selector = selectorRaw.trim();
    if (!source) throw new Error("GlobalCss.rule: empty source");
    if (!selector) throw new Error("GlobalCss.rule: empty selector");

    const prior = this.rules.get(source);
    const decls: Record<string, string> =
      prior && prior.selector === selector ? { ...prior.decls } : {};

    // ADDED: single stateful builder object (as your docs expect)
    const builder: CssRuleBuilder = {
      id: source,
      selector,

      set: (prop, v) => {
        const canon = nrmlz_cssom_prop_key(prop);
        if (!canon) return builder;

        const rendered = render_css_value(v);
        if (rendered == null) delete decls[canon];
        else decls[canon] = rendered;

        return builder;
      },

      setMany: (map: CssMap) => {
        for (const [k, v] of Object.entries(map)) {
          const canon = nrmlz_cssom_prop_key(k);
          if (!canon) continue;

          const rendered = render_css_value(v);
          if (rendered == null) delete decls[canon];
          else decls[canon] = rendered;
        }
        return builder;
      },

      commit: () => {
        const cssText = render_rule(selector, decls).trim();

        if (!cssText) {
          const had = this.rules.delete(source) || this.rendered.delete(source);
          if (had) notify_changed();
          return;
        }

        const prev = this.rendered.get(source);
        if (prev === cssText) return; // CHANGED: no-op if identical

        this.rules.set(source, { selector, decls: { ...decls } });
        this.rendered.set(source, cssText);
        notify_changed();
      },

      remove: () => {
        const had = this.rules.delete(source) || this.rendered.delete(source);
        if (had) notify_changed();
      },
    };

    return builder;
  }

  public remove(sourceRaw: string): void {
    const source = sourceRaw.trim();
    if (!source) return;
    const had = this.rules.delete(source) || this.rendered.delete(source);
    if (had) notify_changed();
  }

  public clear(): void {
    if (this.rules.size === 0 && this.rendered.size === 0) return;
    this.rules.clear();
    this.rendered.clear();
    notify_changed();
  }

  public has(sourceRaw: string): boolean {
    const source = sourceRaw.trim();
    if (!source) return false;
    return this.rendered.has(source);
  }

  public list(): readonly string[] {
    return Array.from(this.rendered.keys()).sort();
  }

  public get(sourceRaw: string): string | undefined {
    const source = sourceRaw.trim();
    if (!source) return undefined;
    return this.rendered.get(source);
  }

  public renderAll(): string {
    // CHANGED: deterministic output
    return this.list()
      .map(k => this.rendered.get(k) ?? "")
      .map(s => s.trim())
      .filter(Boolean)
      .join("\n\n");
  }
}