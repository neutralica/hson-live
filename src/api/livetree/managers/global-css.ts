// global_css.ts

import { CssMapBase, CssPseudoKey } from "../../../types/css.types";
import { camel_to_kebab } from "../../../utils/attrs-utils/camel_to_kebab";
import { pseudo_to_suffix } from "./css-manager";
import { make_style_setter, StyleSetter } from "./style-setter";


type GlobalRule = Readonly<{
  selector: string;
  decls: Record<string, string>; // canon prop -> rendered string
}>;

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


export function render_rule(selector: string, decls: Record<string, string>): string {
  const keys = Object.keys(decls)
    .map(k => k.trim())
    .filter(Boolean)
    .sort();

  if (keys.length === 0) return "";

  const lines: string[] = [];
  lines.push(`${selector} {`);

  let any = false;

  for (const canon of keys) {
    const raw = decls[canon];
    const v = raw == null ? "" : String(raw).trim();

    // NOTE: we assume empties have already been deleted upstream.
    // If you *want* to treat "" as delete, do it in the setter, not here.
    if (v.length === 0) continue;

    any = true;
    const prop = canon.startsWith("--") ? canon : camel_to_kebab(canon);
    lines.push(`  ${prop}: ${v};`);
  }

  if (!any) return "";
  lines.push(`}`);
  return lines.join("\n");
}


/**
 * GLOBALCSS CLASS 
 **/
export class GlobalCss {
  private static _inst: GlobalCss | undefined;

  public static invoke(): GlobalCss {
    if (!this._inst) this._inst = new GlobalCss();
    return this._inst;
  }

  //  returns disposer to unsubscribe
  public static api(onChange: () => void) {
    _listeners.add(onChange);

    const g = () => GlobalCss.invoke();

    return {
      dispose: () => { _listeners.delete(onChange); }, // ADDED
      rule: (ruleKey: string, selector: string) => g().rule(ruleKey, selector),
      sel: (selector: string) => g().sel(selector), // ADDED: selector-only convenience
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

  private rule(keyStr: string, selStr: string): GlobalRuleHandle {
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

      this.rules.set(ruleKey, { selector, decls: { ...decls } });
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

      // ADDED: GlobalCss supports pseudos by emitting sibling rules
      applyPseudo: (pseudo: CssPseudoKey, pseudoDecls: CssMapBase) => {
        const suf = pseudo_to_suffix(pseudo);
        const pseudoKey = `${ruleKey}${suf}`;
        const pseudoSelector = `${selector}${suf}`;

        const h = GlobalCss.invoke().rule(pseudoKey, pseudoSelector);
        h.setMany(pseudoDecls);

        if ((pseudo === "__before" || pseudo === "__after") && !("content" in pseudoDecls)) {
          h.setProp("content", `""`); // NOTE: setProp, not h.set("content", ...) if that’s what your handle exposes
        }
      },
    });

    // ADDED: you were missing this return entirely
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
      .map(k => this.rendered.get(k) ?? "")
      .map(s => s.trim())
      .filter(Boolean)
      .join("\n\n");
  }
}