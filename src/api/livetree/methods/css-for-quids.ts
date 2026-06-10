// css_for_quids.ts


import { normalize_css_key } from "../../../_tests/test-exports.js";
import { CssHandleVoid, CssTreeHandle, CssHandleBase, CssPseudoKey, CssMapBase, StyleHandle, CssKey, MediaQueryInput, SupportsQueryInput, CssRuleFacade } from "../../../types/css.types.js";
import { LiveTree } from "../livetree.js";
import { CssManager, isLiveTree, pseudo_to_suffix } from "../managers/css-manager.js";
import { make_style_get_many, make_style_getter, StyleGetMany, StyleGetter, StyleGetterAdapters } from "../managers/style-getter.js";
import { make_css_var_facade, make_style_setter, StyleSetter, StyleSetterAdapters } from "../managers/style-setter.js";


// one canonical adapter builder for CssManager-backed setters.
// This is the “make it impossible to forget applyPseudo” piece.
const mkCssQuidAdapter = (
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
      }

      // CHANGED: pseudos and nested selector blocks are now selector-backed
      // rules. Clearing a css handle should clear selector rules owned by this
      // same handle, but not selector rules owned by child nodes.
      CssManager.api().dropByPrefix(selectorRuleOwnerKey(hostOrVoid, ids));
    },
    applySelector: (pattern, decls) => {
      // CHANGED: setMany selector blocks must opt in with `&`. The public
      // css.selector(...) method remains more permissive, but object-shaped
      // setMany keys should not be guessed into selectors.
      if (!is_explicit_selector_pattern(pattern)) return;

      const selector = resolveSelector(ids, pattern);
      // CHANGED: selector rules are keyed by their resolved selector, not the raw
      // pattern. This keeps set/get addressing identical for selector CSS.
      const ruleKey = selectorRuleKey(hostOrVoid, ids, selector);
      const handle = CssManager.api().rule(ruleKey, selector);

      handle.setMany(decls);
    },
    // pseudo routing for quid-scoped rules
    applyPseudo: (pseudo: CssPseudoKey, pseudoDecls: CssMapBase) => {
      // CHANGED: pseudo shorthand keys are now selector-rule sugar. This makes
      // `__before` and `css.selector("&::before")` address the same rule store.
      const selector = resolveSelector(ids, `&${pseudo_to_suffix(pseudo)}`);
      const ruleKey = selectorRuleKey(hostOrVoid, ids, selector);
      const handle = CssManager.api().rule(ruleKey, selector);

      handle.setMany(pseudoDecls);
      // auto-content for ::before/::after if omitted
      if ((pseudo === "__before" || pseudo === "__after") && !("content" in pseudoDecls)) {
        handle.setProp("content", `""`);
      }
    },
  };
};

function quidSelector(quid: string): string {
  const q = quid.trim();
  if (!q) throw new Error("quid_selector: empty quid");
  return `[data-_quid="${q}"]`;
}

function resolveSelector(
  ids: readonly string[],
  patternRaw: string,
): string {
  const pattern = patternRaw.trim();
  if (!pattern) throw new Error("css.selector: empty selector pattern");

  return ids
    .map((quid) => quidSelector(quid))
    // CHANGED: explicit `&` performs placeholder replacement. Without `&`,
    // css.selector(pattern) preserves the older appended-pattern behavior.
    .map((selfSel) => pattern.includes("&")
      ? pattern.replaceAll("&", selfSel)
      : `${selfSel}${pattern}`)
    .join(", ");
}

function is_explicit_selector_pattern(patternRaw: string): boolean {
  return patternRaw.trim().includes("&");
}

function scopeKeyFor(kind: "media" | "supports" | "layer", input: unknown): string {
  if (typeof input === "string") return `${kind}:${input.trim()}`;
  return `${kind}:${JSON.stringify(input)}`;
}

function joinScopeKey(parent: string, child: string): string {
  const p = parent.trim();
  const c = child.trim();
  if (!p) return c;
  if (!c) return p;
  return `${p}::${c}`;
}


function readDeclFromRule(
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
    // CHANGED: rendered CSS rules serialize declarations in CSS spelling
    // (`border-radius`, `-webkit-appearance`), while the getter path receives
    // canonical normalized keys (`borderRadius`, `WebkitAppearance`). Vendor
    // properties may also pass through one layer with the leading dash removed,
    // so compare a small normalized candidate set instead of one spelling.
    if (!cssPropKeysMatch(key, propCanon)) continue;

    return part.slice(ix + 1).trim();
  }

  return undefined;
}

function readManyFromRendered(rendered: string | undefined): StyleGetMany {
  if (!rendered) return {};

  const open = rendered.indexOf("{");
  const close = rendered.lastIndexOf("}");
  if (open < 0 || close <= open) return {};

  const body = rendered.slice(open + 1, close);
  const out: Record<string, string> = {};

  for (const part of body.split(";")) {
    const ix = part.indexOf(":");
    if (ix < 0) continue;

    const rawKey = part.slice(0, ix).trim();
    const value = part.slice(ix + 1).trim();
    if (!rawKey || !value) continue;

    // CHANGED: getMany() returns a setMany-compatible declaration map.
    // Preserve custom properties exactly; normalize normal CSS keys to the
    // same canonical spelling used by setter/getter internals.
    const key = rawKey.startsWith("--")
      ? rawKey
      : normalize_css_key(rawKey);

    out[key] = value;
  }

  return out;
}

function cssPropKeysMatch(renderedKey: string, propCanon: string): boolean {
  const key = renderedKey.trim();
  const prop = propCanon.trim();
  if (!key || !prop) return false;

  const keyCandidates = new Set<string>([
    key,
    normalize_css_key(key),
  ]);

  // CHANGED: tolerate vendor declarations that have lost exactly one leading
  // dash somewhere in the write/render/read path, e.g. `webkit-appearance`
  // versus `-webkit-appearance`.
  if (!key.startsWith("-") && key.includes("-")) {
    keyCandidates.add(`-${key}`);
    keyCandidates.add(normalize_css_key(`-${key}`));
  }

  const propCandidates = new Set<string>([
    prop,
    normalize_css_key(prop as CssKey),
  ]);

  if (!prop.startsWith("-") && prop.includes("-")) {
    propCandidates.add(`-${prop}`);
    propCandidates.add(normalize_css_key(`-${prop}`));
  }

  for (const candidate of keyCandidates) {
    if (propCandidates.has(candidate)) return true;
  }

  return false;
}

function selectorRuleOwnerKey(
  host: LiveTree | void,
  ids: readonly string[],
  scopeKey = "",
): string {
  // CHANGED: selector rules created from one css handle share an owner prefix.
  // css.clear() can then drop selector/pseudo rules owned by this handle without
  // touching child-node selector rules, which use different QUID ids. Scoped
  // at-rules get their own prefix so base, media, supports, and layer rules do
  // not collide.
  const hostKey = host ? host.id : "void";
  const scope = scopeKey.trim();
  return `${hostKey} ${ids.join(" ")} ${scope ? `${scope} ` : ""}`;
}

function selectorRuleKey(
  host: LiveTree | void,
  ids: readonly string[],
  selector: string,
  scopeKey = "",
): string {
  // CHANGED: selector keys use the resolved selector string plus any at-rule
  // scope. The resolved selector is the actual CSS rule identity; the scope
  // keeps `css.setMany(...)` and `css.media(...).setMany(...)` independent.
  return `${selectorRuleOwnerKey(host, ids, scopeKey)}${selector}`;
}

function mkSelectorStyleGetter(
  host: LiveTree | void,
  ids: string[],
  pattern: string,
  scopeKey = "",
): StyleGetterAdapters {
  const gcss = CssManager.api();
  const selector = resolveSelector(ids, pattern);
  const ruleKey = selectorRuleKey(host, ids, selector, scopeKey);

  return {
    read: (propCanon: string) => {
      // CHANGED: read from the same resolved selector+scope key used by writes.
      return readDeclFromRule(gcss.get(ruleKey), propCanon);
    },

    readMany: () => {
      // CHANGED: selector-backed handles can enumerate their own rendered rule,
      // making css.selector(...).getMany() useful for diagnostics and round trips.
      return readManyFromRendered(gcss.get(ruleKey));
    },
  };
}

export function make_selector_style_getter(
  host: LiveTree | void,
  ids: string[],
  pattern: string,
  scopeKey = "",
): StyleGetter {
  return make_style_getter(mkSelectorStyleGetter(host, ids, pattern, scopeKey));
}

function mkSelectorStyleHandle<TReturn extends LiveTree | void>(
  ret: TReturn,
  ids: string[],
  patternRaw: string,
  scopeKey = "",
  ruleApi: CssRuleFacade = CssManager.api(),
): StyleHandle<TReturn> {
  const setter = mkSelectorStyleSetter(ret, ids, patternRaw, scopeKey, ruleApi);
  const getterAdapters = mkSelectorStyleGetter(ret, ids, patternRaw, scopeKey);
  const getter = make_style_getter(getterAdapters);
  const getMany = make_style_get_many(getterAdapters);
  const vars = make_css_var_facade<TReturn>(
    ret,
    (name, value) => setter.set.var(name, value),
    // CHANGED: `.var.value()` reads through the selector backend directly;
    // it no longer depends on the removed public `get.var()` method.
    (name) => getterAdapters.read(name),
  );

  return {
    ...setter,
    get: getter,
    getMany,
    var: vars,
  };
}

export function make_style_getter_for_ids(
  host: LiveTree | undefined,
  ids: string[],
) {
  if (isLiveTree(host)) {
    return {
      selector: (pattern: string) =>
        mkSelectorStyleHandle<LiveTree>(host, ids, pattern),
    };
  } else {
    return {
      selector: (pattern: string) =>
        mkSelectorStyleHandle<void>(undefined, ids, pattern),
    };
  }
}


function mkSelectorStyleSetter<TReturn extends LiveTree | void>(
  ret: TReturn,
  ids: string[],
  patternRaw: string,
  scopeKey = "",
  ruleApi: CssRuleFacade = CssManager.api(),
): StyleSetter<TReturn> {
  const gcss = CssManager.api();

  const selector = resolveSelector(ids, patternRaw);
  // CHANGED: setter and getter must address the selector rule by the same
  // resolved selector+scope key.
  const ruleKey = selectorRuleKey(ret, ids, selector, scopeKey);

  const handle = ruleApi.rule(ruleKey, selector);

  return make_style_setter<TReturn>(ret, {
    apply: (propCanon, value) => {
      handle.setProp(propCanon as CssKey, value);
    },

    remove: (propCanon) => {
      handle.remove(propCanon);
    },

    clear: () => {
      // CHANGED: clear both the rule handle's local declaration closure and the
      // manager-backed rendered rule. Dropping only the manager rule leaves this
      // handle's local `decls` copy stale, so a later setMany(all) with the same
      // values can be skipped as "unchanged" and fail to re-render the rule.
      handle.clear();
      gcss.drop(ruleKey);
    },

    // keep pseudo support working on selector-scoped rules too
    applyPseudo: (pseudo: CssPseudoKey, pseudoDecls: CssMapBase) => {
      const suf = pseudo_to_suffix(pseudo);
      const pseudoHandle = ruleApi.rule(`${ruleKey}${suf}`, `${selector}${suf}`);
      pseudoHandle.setMany(pseudoDecls);

      if ((pseudo === "__before" || pseudo === "__after") && !("content" in pseudoDecls)) {
        pseudoHandle.setProp("content", `""`);
      }
    },
  });
}

function mkScopedQuidStyleHandle<TReturn extends LiveTree | void>(
  ret: TReturn,
  ids: string[],
  scopeKey: string,
  ruleApi: CssRuleFacade,
): CssHandleBase<TReturn> {
  const gcss = CssManager.api();
  const selector = resolveSelector(ids, "&");
  const ruleKey = selectorRuleKey(ret, ids, selector, scopeKey);
  const handle = ruleApi.rule(ruleKey, selector);

  const setter = make_style_setter<TReturn>(ret, {
    apply: (propCanon, value) => {
      handle.setProp(propCanon as CssKey, value);
    },

    remove: (propCanon) => {
      handle.remove(propCanon);
    },

    clear: () => {
      handle.clear();
      gcss.dropByPrefix(selectorRuleOwnerKey(ret, ids, scopeKey));
    },

    applySelector: (pattern, decls) => {
      if (!is_explicit_selector_pattern(pattern)) return;

      const scopedSelector = resolveSelector(ids, pattern);
      const scopedRuleKey = selectorRuleKey(ret, ids, scopedSelector, scopeKey);
      const scopedHandle = ruleApi.rule(scopedRuleKey, scopedSelector);

      scopedHandle.setMany(decls);
    },

    applyPseudo: (pseudo: CssPseudoKey, pseudoDecls: CssMapBase) => {
      const pseudoSelector = resolveSelector(ids, `&${pseudo_to_suffix(pseudo)}`);
      const pseudoRuleKey = selectorRuleKey(ret, ids, pseudoSelector, scopeKey);
      const pseudoHandle = ruleApi.rule(pseudoRuleKey, pseudoSelector);

      pseudoHandle.setMany(pseudoDecls);
      if ((pseudo === "__before" || pseudo === "__after") && !("content" in pseudoDecls)) {
        pseudoHandle.setProp("content", `""`);
      }
    },
  });

  const getterAdapters = mkSelectorStyleGetter(ret, ids, "&", scopeKey);
  const getter = make_style_getter(getterAdapters);
  const getMany = make_style_get_many(getterAdapters);
  const vars = make_css_var_facade<TReturn>(
    ret,
    (name, value) => setter.set.var(name, value),
    (name) => getterAdapters.read(name),
  );

  return {
    ...setter,
    get: getter,
    getMany,
    var: vars,
    atProperty: gcss.atProperty,
    keyframes: gcss.keyframes,
    anim: CssManager.invoke().animForQuids(ids),
    devSnapshot: () => CssManager.invoke().snapshot(),
    selector: (pattern: string) => mkSelectorStyleHandle(ret, ids, pattern, scopeKey, ruleApi),
    media: (query: MediaQueryInput) => mkScopedQuidStyleHandle(ret, ids, joinScopeKey(scopeKey, scopeKeyFor("media", query)), ruleApi.media(query)),
    supports: (cond: SupportsQueryInput) => mkScopedQuidStyleHandle(ret, ids, joinScopeKey(scopeKey, scopeKeyFor("supports", cond)), ruleApi.supports(cond)),
    layer: (layerName: string) => mkScopedQuidStyleHandle(ret, ids, joinScopeKey(scopeKey, scopeKeyFor("layer", layerName)), ruleApi.layer(layerName)),
  };
}

function scopedMethods<TReturn extends LiveTree | void>(
  ret: TReturn,
  ids: string[],
) {
  const gcss = CssManager.api();

  return {
    media: (query: MediaQueryInput) => mkScopedQuidStyleHandle(ret, ids, scopeKeyFor("media", query), gcss.media(query)),
    supports: (cond: SupportsQueryInput) => mkScopedQuidStyleHandle(ret, ids, scopeKeyFor("supports", cond), gcss.supports(cond)),
    layer: (layerName: string) => mkScopedQuidStyleHandle(ret, ids, scopeKeyFor("layer", layerName), gcss.layer(layerName)),
  };
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
  * - `get.prop` returns a value only when all QUIDs agree.
 * - `var.value(...)` reads a custom property only when all QUIDs agree.
 * - `get.vars([...])` returns selected custom properties that agree.
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

  const mkGetManyForIds = (ids: readonly string[]): (() => StyleGetMany) => {
    return (): StyleGetMany => {
      const out: Record<string, string> = {};
      const allKeys = new Set<string>();

      for (const quid of ids) {
        const found = mgr.getAllForQuid(quid);
        if (!found) return {};

        for (const key of Object.keys(found)) {
          allKeys.add(key);
        }
      }

      for (const key of allKeys) {
        let seen: string | undefined;
        let agreed = true;

        for (const quid of ids) {
          const value = mgr.getForQuid(quid, key);
          if (value === undefined) {
            agreed = false;
            break;
          }
          if (seen === undefined) {
            seen = value;
            continue;
          }
          if (seen !== value) {
            agreed = false;
            break;
          }
        }

        if (agreed && seen !== undefined) {
          out[key] = seen;
        }
      }

      return out;
    };
  };

  const readConsensusForIds = (ids: readonly string[]) => {
    return (propCanon: string): string | undefined => {
      let seen: string | undefined;

      for (const quid of ids) {
        const v = mgr.getForQuid(quid, propCanon);
        if (v === undefined) return undefined;
        if (seen === undefined) { seen = v; continue; }
        if (v !== seen) return undefined;
      }

      return seen;
    };
  };

  const mkGetterForIds = (ids: readonly string[]) => {
    const readConsensus = readConsensusForIds(ids);

    return make_style_getter({
      read: (propCanon) => readConsensus(propCanon),

      readMany: () => {
        // CHANGED: enumerate the QUID-backed declaration model directly so
        // css.getMany() returns the same consensus view as point reads.
        const out: Record<string, string> = {};
        const allKeys = new Set<string>();

        for (const quid of ids) {
          const found = mgr.getAllForQuid(quid);
          if (!found) return {};

          for (const key of Object.keys(found)) {
            allKeys.add(key);
          }
        }

        for (const key of allKeys) {
          const value = readConsensus(key);
          if (value !== undefined) {
            out[key] = value;
          }
        }

        return out;
      },
    });
  };

  if (isLiveTree(a)) {
    const host: LiveTree = a;
    const ids = (b ?? []).map(q => q.trim()).filter(Boolean);

    const setter = make_style_setter<LiveTree>(
      host,
      mkCssQuidAdapter(host, mgr, ids), // single source of truth
    );

    const getter = mkGetterForIds(ids);
    const getMany = mkGetManyForIds(ids);
    const readConsensus = readConsensusForIds(ids);
    const vars = make_css_var_facade<LiveTree>(
      host,
      (name, value) => setter.set.var(name, value),
      // CHANGED: `.var.value()` reads through the QUID consensus backend
      // directly; it no longer depends on the removed public `get.var()` method.
      readConsensus,
    );
    return {
      ...setter,
      get: getter,
      getMany,
      var: vars,
      atProperty: mgr.atProperty,
      keyframes: mgr.keyframes,
      anim: mgr.animForQuids(ids),
      devSnapshot: () => mgr.snapshot(),
      selector: (pattern: string) => mkSelectorStyleHandle<LiveTree>(host, ids, pattern),
      ...scopedMethods(host, ids),

    };
  }

  const ids = a.map(q => q.trim()).filter(Boolean);

  const setter = make_style_setter<void>(
    undefined,
    // this overload has no LiveTree host; selector rule keys are ids+pattern only.
    mkCssQuidAdapter(undefined, mgr, ids),
  );

  const getter = mkGetterForIds(ids);
  const getMany = mkGetManyForIds(ids);
  const readConsensus = readConsensusForIds(ids);
  const vars = make_css_var_facade<void>(
    undefined,
    (name, value) => setter.set.var(name, value),
    // CHANGED: `.var.value()` reads through the QUID consensus backend
    // directly; it no longer depends on the removed public `get.var()` method.
    readConsensus,
  );
  return {
    ...setter,
    get: getter,
    getMany,
    var: vars,
    devSnapshot: () => mgr.snapshot(),
    atProperty: mgr.atProperty,
    keyframes: mgr.keyframes,
    anim: mgr.animForQuids(ids),
    selector: (pattern: string) => mkSelectorStyleHandle<void>(undefined, ids, pattern),
    ...scopedMethods(undefined, ids),

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
