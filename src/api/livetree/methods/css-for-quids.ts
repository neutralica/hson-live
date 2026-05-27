// css_for_quids.ts


import { CssHandleVoid, CssTreeHandle, CssHandleBase, CssKey, CssValue, CssPseudoKey, CssMapBase } from "../../../types/css.types.js";
import { normalize_css_key } from "../../../utils/attrs-utils/normalize-css.js";
import { LiveTree } from "../livetree.js";
import { CssManager, isLiveTree, pseudo_to_suffix, render_css_value } from "../managers/css-manager.js";
import { GetSurface, make_style_getter, StyleGetter } from "../managers/style-getter.js";
import { make_style_setter, StyleSetter, StyleSetterAdapters } from "../managers/style-setter.js";

// one canonical adapter builder for CssManager-backed setters.
// This is the “make it impossible to forget applyPseudo” piece.
const mk_css_quids_adapters = (
  hostOrVoid: LiveTree | void,
  mgr: CssManager,
  ids: string[],
): StyleSetterAdapters & {
  applyPseudo: (pseudo: CssPseudoKey, pseudoDecls: CssMapBase) => void;
} => {
  return {
    apply: (propCanon, value) => {
      for (const quid of ids) mgr.setForQuid(quid, propCanon, value);
    },

    remove: (propCanon) => {
      for (const quid of ids) mgr.unsetForQuid(quid, propCanon);
    },

    clear: () => {
      for (const quid of ids) {
        mgr.clearQuid(quid);
        mgr.clearPseudoAllForQuid?.(quid);
      }
    },
    applySelector: (pattern, decls) => {
      const selector = resolve_selector_pattern(ids, pattern);
      // CHANGED: selector rules are keyed by their resolved selector, not the raw
      // pattern. This keeps set/get addressing identical for selector CSS.
      const ruleKey = selector_rule_key(hostOrVoid, ids, selector);
      const handle = CssManager.api().rule(ruleKey, selector);

      handle.setMany(decls);
    },
    // pseudo routing for quid-scoped rules
    applyPseudo: (pseudo: CssPseudoKey, pseudoDecls: CssMapBase) => {
      for (const quid of ids) {
        for (const [k, v] of Object.entries(pseudoDecls)) {
          if (v == null) continue;

          const propCanon = normalize_css_key(k as CssKey);
          const rendered = render_css_value(v as CssValue);

          if (rendered == null) {
            mgr.unsetPseudoForQuid(quid, pseudo, propCanon);
          } else {
            mgr.setPseudoForQuid(quid, pseudo, propCanon, rendered);
          }
        }

        // auto-content for ::before/::after if omitted
        if ((pseudo === "__before" || pseudo === "__after") && !("content" in pseudoDecls)) {
          mgr.setPseudoForQuid(quid, pseudo, "content", `""`);
        }
      }
    },
  };
};

function quid_selector(quid: string): string {
  const q = quid.trim();
  if (!q) throw new Error("quid_selector: empty quid");
  return `[data-_quid="${q}"]`;
}

function resolve_selector_pattern(
  ids: readonly string[],
  patternRaw: string,
): string {
  const pattern = patternRaw.trim();
  if (!pattern) throw new Error("css.selector: empty selector pattern");

  // CHANGED: selector blocks in setMany must be explicitly marked with `&`.
  // This prevents arbitrary unknown keys from being guessed as selectors.
  if (!pattern.includes("&")) {
    throw new Error(`css.selector: selector pattern must include "&": ${pattern}`);
  }

  return ids
    .map((quid) => quid_selector(quid))
    .map((selfSel) => pattern.replaceAll("&", selfSel))
    .join(", ");
}

// Removed resolveNestedSelector function entirely

function read_decl_from_rendered_rule(
  rendered: string | undefined,
  propCanon: string,
): string | undefined {
  if (!rendered) return undefined;

  const open = rendered.indexOf("{");
  const close = rendered.lastIndexOf("}");
  if (open < 0 || close <= open) return undefined;

  const body = rendered.slice(open + 1, close);
  const parts = body.split(";");

  for (const part of parts) {
    const ix = part.indexOf(":");
    if (ix < 0) continue;

    const key = part.slice(0, ix).trim();
    if (key !== propCanon) continue;

    return part.slice(ix + 1).trim();
  }

  return undefined;
}

function selector_rule_key(
  host: LiveTree | void,
  ids: readonly string[],
  selector: string,
): string {
  // CHANGED: selector keys use the resolved selector string. The raw pattern is
  // only user input; the resolved selector is the actual CSS rule identity.
  if (host) {
    return `${host.id} ${ids.join(" ")} ${selector}`;
  }
  return `${ids.join(" ")} ${selector}`;
}

export function make_selector_style_getter(
  host: LiveTree | void,
  ids: string[],
  pattern: string,
): StyleGetter {
  const gcss = CssManager.api();
  const selector = resolve_selector_pattern(ids, pattern);
  const ruleKey = selector_rule_key(host, ids, selector);

  return make_style_getter({
    read: (propCanon: string) => {
      // CHANGED: read from the same resolved selector key used by writes.
      return read_decl_from_rendered_rule(gcss.get(ruleKey), propCanon);
    },
  });
}

function make_selector_style_handle<TReturn extends LiveTree | void>(
  ret: TReturn,
  ids: string[],
  patternRaw: string,
): StyleSetter<TReturn> & { get: GetSurface } {
  const setter = make_selector_style_setter(ret, ids, patternRaw);
  const getter = make_selector_style_getter(ret, ids, patternRaw);

  return {
    ...setter,
    get: getter,
  };
}

export function make_style_getter_for_ids(
  host: LiveTree | undefined,
  ids: string[],
) {
  if (isLiveTree(host)) {
    return {
      selector: (pattern: string) =>
        make_selector_style_handle<LiveTree>(host, ids, pattern),
    };
  } else {
    return {
      selector: (pattern: string) =>
        make_selector_style_handle<void>(undefined, ids, pattern),
    };
  }
}


function make_selector_style_setter<TReturn extends LiveTree | void>(
  ret: TReturn,
  ids: string[],
  patternRaw: string,
): StyleSetter<TReturn> {
  const gcss = CssManager.api();

  const selector = resolve_selector_pattern(ids, patternRaw);
  // CHANGED: setter and getter must address the selector rule by the same
  // resolved selector key.
  const ruleKey = selector_rule_key(ret, ids, selector);

  const handle = gcss.rule(ruleKey, selector);

  return make_style_setter<TReturn>(ret, {
    apply: (propCanon, value) => {
      handle.setProp(propCanon as CssKey, value);
    },

    remove: (propCanon) => {
      handle.remove(propCanon as CssKey);
    },

    clear: () => {
      handle.clear();
    },

    // keep pseudo support working on selector-scoped rules too
    applyPseudo: (pseudo: CssPseudoKey, pseudoDecls: CssMapBase) => {
      const suf = pseudo_to_suffix(pseudo);
      const pseudoHandle = gcss.rule(`${ruleKey}${suf}`, `${selector}${suf}`);
      pseudoHandle.setMany(pseudoDecls);

      if ((pseudo === "__before" || pseudo === "__after") && !("content" in pseudoDecls)) {
        pseudoHandle.setProp("content", `""`);
      }
    },
  });
}

export function css_for_quids(quids: readonly string[]): CssHandleVoid;
export function css_for_quids(host: LiveTree, quids: readonly string[]): CssTreeHandle;
/**
 * Create a multi-QUID CSS handle.
 *
 * This is the main entrypoint for “stylesheet-backed” styling. It produces a
 * `CssHandle` whose mutation surface is a `StyleSetter` wired to `CssManager`.
 *
 * Behavior:
 * - Writes (`setProp`, `setMany`, `remove`, `clear`) are broadcast to all QUIDs.
 * - `setMany` accepts pseudo blocks keyed by `CssPseudoKey` (e.g. `_hover`,
 *   `__before`) and routes them to pseudo selector rules.
 * - For `__before` / `__after`, `content: ""` is auto-injected when omitted.
 *
 * Read surface:
 * - `get.prop` / `get.var` return a value only when all QUIDs agree.
 *
 * @param quids List of QUID strings to target. Empty/whitespace entries are ignored.
 * @returns A `CssHandle` that broadcasts style mutations to all provided QUIDs.
 * @see make_style_setter
 * @see CssManager
 */
export function css_for_quids(
  a: LiveTree | readonly string[],
  b?: readonly string[],
): CssHandleBase<any> {
  const mgr = CssManager.invoke();

  const mk_getter_for_ids = (ids: readonly string[]) => {
    const readConsensus = (propCanon: string): string | undefined => {
      let seen: string | undefined;

      for (const quid of ids) {
        const v = mgr.getForQuid(quid, propCanon);
        if (v === undefined) return undefined;
        if (seen === undefined) { seen = v; continue; }
        if (v !== seen) return undefined;
      }
      return seen;
    };

    return make_style_getter({
      read: (propCanon) => readConsensus(propCanon),
    });
  };

  if (isLiveTree(a)) {
    const host: LiveTree = a;
    const ids = (b ?? []).map(q => q.trim()).filter(Boolean);

    const setter = make_style_setter<LiveTree>(
      host,
      mk_css_quids_adapters(host, mgr, ids), // single source of truth
    );

    const getter = mk_getter_for_ids(ids);

    return {
      ...setter,
      get: getter,
      atProperty: mgr.atProperty,
      keyframes: mgr.keyframes,
      anim: mgr.animForQuids(ids),
      devSnapshot: () => mgr.snapshot(),
      selector: (pattern: string) => make_selector_style_handle<LiveTree>(host, ids, pattern),

    };
  }

  const ids = a.map(q => q.trim()).filter(Boolean);

  const setter = make_style_setter<void>(
    undefined,
    // this overload has no LiveTree host; selector rule keys are ids+pattern only.
    mk_css_quids_adapters(undefined, mgr, ids),
  );

  const getter = mk_getter_for_ids(ids);

  return {
    ...setter,
    get: getter,
    devSnapshot: () => mgr.snapshot(),
    atProperty: mgr.atProperty,
    keyframes: mgr.keyframes,
    anim: mgr.animForQuids(ids),
    selector: (pattern: string) => make_selector_style_handle<void>(undefined, ids, pattern),

  }
};

/**
 * Convenience wrapper for the single-QUID case.
 *
 * Equivalent to calling `css_for_quids([quid])`.
 *
 * @param quid QUID to target.
 * @returns A `CssHandle` targeting exactly one QUID.
 * @see css_for_quids
 */

export function css_for_quid(host: LiveTree, quid: string): CssTreeHandle {
  return css_for_quids(host, [quid]);
}
