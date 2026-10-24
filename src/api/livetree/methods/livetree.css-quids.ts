import { relative_css_selector, scope_css_selector } from "../../../internal/css/relative-selector.js";
import { assert_mutation_publication_available } from "../lifecycle/mutation-publication.js";
// css-for-quid.ts


import { normalize_css_key } from "../../transform/utils/attrs-utils/normalize-css.js";
import { CssTreeHandle, CssHandleBase, CssPseudoKey, CssMapBase, StyleHandle, CssKey, MediaQueryInput, SupportsQueryInput, CssRuleFacade } from "../../../types/css.types.js";
import { LiveTree } from "../livetree.js";
import { CssRuntimeManager } from "../managers/css-manager.js";
import { bound_document_css_api, bound_document_css_for_tree } from "../managers/bound-document-css.js";
import { pseudo_to_suffix } from "../managers/css-render.js";
import { make_style_get_many, make_style_getter, StyleGetMany, StyleGetter, StyleGetterAdapters } from "../managers/style-getter.js";
import { compose_style_branch, style_branch_pattern, prepare_style_map, make_css_var_facade, make_style_setter, StyleSetter, StyleSetterAdapters } from "../managers/style-setter.js";
import { PERSISTED_QUID_LENGTH } from "../../../core/hson-node-quid.js";
import { default_livetree_runtime, runtime_for_tree } from "../runtime/livetree-runtime.js";

function manager_for_host(host: LiveTree): CssRuntimeManager {
  const runtime = runtime_for_tree(host);
  return CssRuntimeManager.forRuntime(runtime, {
    claimAmbientDocument: runtime === default_livetree_runtime(),
  });
}

function assert_css_write_available(host: LiveTree, quid: string): void {
  const runtime = runtime_for_tree(host);
  const subject = runtime.quidToNode.get(quid);
  if (subject) assert_mutation_publication_available(subject);
}

function api_for_host(host: LiveTree): CssRuleFacade & ReturnType<typeof CssRuntimeManager.apiForRuntime> {
  return CssRuntimeManager.apiForRuntime(runtime_for_tree(host));
}

function cache_surface_value<TValue>(
  target: object,
  key: string,
  value: TValue,
): TValue {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
  return value;
}

// one canonical adapter builder for CssManager-backed setters.
// This is the “make it impossible to forget applyPseudo” piece.
const mkCssQuidAdapter = (
  host: LiveTree,
  mgr: CssRuntimeManager,
  quid: string,
): StyleSetterAdapters & {
  applyPseudo: (pseudo: CssPseudoKey, pseudoDecls: CssMapBase) => void;
} => {
  const resolveBranch = (key: string): string => relative_css_selector(style_branch_pattern(key), quidSelector(quid, mgr));
  return {
    resolveBranch,
    apply: (propCanon, value) => {
      assert_css_write_available(host, quid);
      mgr.setForQuid(quid, propCanon, value);
    },

    remove: (propCanon) => {
      assert_css_write_available(host, quid);
      mgr.unsetForQuid(quid, propCanon);
    },

    clear: () => {
      assert_css_write_available(host, quid);
      mgr.clearQuid(quid);

      // CHANGED: pseudos and nested selector blocks are now selector-backed
      // rules. Clearing a css handle should clear selector rules owned by this
      // same handle, but not selector rules owned by child nodes.
      mgr.dropGlobalRulesByPrefix(selectorRuleOwnerKey(host, quid));
    },
    applySelector: (pattern, decls) => {
      assert_css_write_available(host, quid);
      // Shared setMany preflight already requires anchored nesting on every arm.
      const selector = resolveBranch(pattern);
      // CHANGED: selector rules are keyed by their resolved selector, not the raw
      // pattern. This keeps set/get addressing identical for selector CSS.
      const ruleKey = selectorRuleKey(host, quid, selector);
      const handle = api_for_host(host).rule(ruleKey, selector);

      handle.setMany(decls);
    },
    // pseudo routing for quid-scoped rules
    applyPseudo: (pseudo: CssPseudoKey, pseudoDecls: CssMapBase) => {
      assert_css_write_available(host, quid);
      // CHANGED: pseudo shorthand keys are now selector-rule sugar. This makes
      // `__before` and `css.selector("&::before")` address the same rule store.
      const selector = resolveBranch(pseudo);
      const ruleKey = selectorRuleKey(host, quid, selector);
      const handle = api_for_host(host).rule(ruleKey, selector);

      handle.setMany(pseudoDecls);
      // auto-content for ::before/::after if omitted
      if ((pseudo === "__before" || pseudo === "__after") && !("content" in pseudoDecls)) {
        handle.setProp("content", `""`);
      }
    },
  };
};

function quidSelector(quid: string, manager: CssRuntimeManager): string {
  const q = quid.trim();
  if (!q) throw new Error("quid_selector: empty quid");
  return manager.selectorForQuid(q);
}

function resolveSelector(
  quid: string,
  patternRaw: string,
  manager: CssRuntimeManager,
): string {
  const pattern = patternRaw.trim();
  if (!pattern) throw new Error("css.selector: empty selector pattern");

  return scope_css_selector(pattern, quidSelector(quid, manager));
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
  host: LiveTree,
  quid: string,
  scopeKey = "",
): string {
  // CHANGED: selector rules created from one css handle share an owner prefix.
  // css.clear() can then drop selector/pseudo rules owned by this handle without
  // touching child-node selector rules, which use different QUID ids. Scoped
  // at-rules get their own prefix so base, media, supports, and layer rules do
  // not collide.
  const hostKey = host.id;
  const scope = scopeKey.trim();
  return `${hostKey} ${quid} ${scope ? `${scope} ` : ""}`;
}

function selectorRuleKey(
  host: LiveTree,
  quid: string,
  selector: string,
  scopeKey = "",
): string {
  // CHANGED: selector keys use the resolved selector string plus any at-rule
  // scope. The resolved selector is the actual CSS rule identity; the scope
  // keeps `css.setMany(...)` and `css.media(...).setMany(...)` independent.
  return `${selectorRuleOwnerKey(host, quid, scopeKey)}${selector}`;
}

function mkSelectorStyleGetter(
  host: LiveTree,
  quid: string,
  pattern: string,
  scopeKey = "",
): StyleGetterAdapters {
  const gcss = api_for_host(host);
  const selector = resolveSelector(quid, pattern, manager_for_host(host));
  const ruleKey = selectorRuleKey(host, quid, selector, scopeKey);

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

function mkSelectorStyleHandle(
  ret: LiveTree,
  quid: string,
  patternRaw: string,
  scopeKey = "",
  ruleApi?: CssRuleFacade,
): StyleHandle<LiveTree> {
  const runtimeRuleApi = ruleApi ?? api_for_host(ret);
  const setter = mkSelectorStyleSetter(ret, quid, patternRaw, scopeKey, runtimeRuleApi);
  const getterAdapters = mkSelectorStyleGetter(ret, quid, patternRaw, scopeKey);
  const getMany = make_style_get_many(getterAdapters);

  return {
    ...setter,
    get get(): StyleGetter {
      return cache_surface_value(this, "get", make_style_getter(getterAdapters));
    },
    getMany,
    get var() {
      return cache_surface_value(this, "var", make_css_var_facade<LiveTree>(
        ret,
        (name, value) => setter.set.var(name, value),
        (name) => getterAdapters.read(name),
      ));
    },
  };
}

function mkSelectorStyleSetter(
  ret: LiveTree,
  quid: string,
  patternRaw: string,
  scopeKey = "",
  ruleApi?: CssRuleFacade,
): StyleSetter<LiveTree> {
  const gcss = api_for_host(ret);
  const runtimeRuleApi = ruleApi ?? gcss;

  const selector = resolveSelector(quid, patternRaw, manager_for_host(ret));
  // CHANGED: setter and getter must address the selector rule by the same
  // resolved selector+scope key.
  const ruleKey = selectorRuleKey(ret, quid, selector, scopeKey);

  const handle = runtimeRuleApi.rule(ruleKey, selector);

  const resolveBranch = (key: string): string => compose_style_branch(selector, key);
  return make_style_setter<LiveTree>(ret, {
    resolveBranch,
    apply: (propCanon, value) => {
      assert_css_write_available(ret, quid);
      handle.setProp(propCanon as CssKey, value);
    },

    remove: (propCanon) => {
      assert_css_write_available(ret, quid);
      handle.remove(propCanon);
    },

    clear: () => {
      assert_css_write_available(ret, quid);
      // CHANGED: clear both the rule handle's local declaration closure and the
      // manager-backed rendered rule. Dropping only the manager rule leaves this
      // handle's local `decls` copy stale, so a later setMany(all) with the same
      // values can be skipped as "unchanged" and fail to re-render the rule.
      handle.clear();
      gcss.drop(ruleKey);
    },

    // keep pseudo support working on selector-scoped rules too
    applyPseudo: (pseudo: CssPseudoKey, pseudoDecls: CssMapBase) => {
      assert_css_write_available(ret, quid);
      const suf = pseudo_to_suffix(pseudo);
      const pseudoHandle = runtimeRuleApi.rule(`${ruleKey}${suf}`, resolveBranch(pseudo));
      pseudoHandle.setMany(pseudoDecls);

      if ((pseudo === "__before" || pseudo === "__after") && !("content" in pseudoDecls)) {
        pseudoHandle.setProp("content", `""`);
      }
    },
  });
}

function mkScopedQuidStyleHandle(
  ret: LiveTree,
  quid: string,
  scopeKey: string,
  ruleApi: CssRuleFacade,
): CssHandleBase<LiveTree> {
  const gcss = api_for_host(ret);
  const manager = manager_for_host(ret);
  const selector = resolveSelector(quid, "&", manager);
  const ruleKey = selectorRuleKey(ret, quid, selector, scopeKey);
  const handle = ruleApi.rule(ruleKey, selector);

  const resolveBranch = (key: string): string => relative_css_selector(style_branch_pattern(key), quidSelector(quid, manager));
  const setter = make_style_setter<LiveTree>(ret, {
    resolveBranch,
    apply: (propCanon, value) => {
      assert_css_write_available(ret, quid);
      handle.setProp(propCanon as CssKey, value);
    },

    remove: (propCanon) => {
      assert_css_write_available(ret, quid);
      handle.remove(propCanon);
    },

    clear: () => {
      assert_css_write_available(ret, quid);
      handle.clear();
      manager.dropGlobalRulesByPrefix(selectorRuleOwnerKey(ret, quid, scopeKey));
    },

    applySelector: (pattern, decls) => {
      assert_css_write_available(ret, quid);
      const scopedSelector = resolveBranch(pattern);
      const scopedRuleKey = selectorRuleKey(ret, quid, scopedSelector, scopeKey);
      const scopedHandle = ruleApi.rule(scopedRuleKey, scopedSelector);

      scopedHandle.setMany(decls);
    },

    applyPseudo: (pseudo: CssPseudoKey, pseudoDecls: CssMapBase) => {
      assert_css_write_available(ret, quid);
      const pseudoSelector = resolveBranch(pseudo);
      const pseudoRuleKey = selectorRuleKey(ret, quid, pseudoSelector, scopeKey);
      const pseudoHandle = ruleApi.rule(pseudoRuleKey, pseudoSelector);

      pseudoHandle.setMany(pseudoDecls);
      if ((pseudo === "__before" || pseudo === "__after") && !("content" in pseudoDecls)) {
        pseudoHandle.setProp("content", `""`);
      }
    },
  });

  const getterAdapters = mkSelectorStyleGetter(ret, quid, "&", scopeKey);
  const getMany = make_style_get_many(getterAdapters);

  return {
    ...setter,
    get get(): StyleGetter {
      return cache_surface_value(this, "get", make_style_getter(getterAdapters));
    },
    getMany,
    get var() {
      return cache_surface_value(this, "var", make_css_var_facade<LiveTree>(
        ret,
        (name, value) => setter.set.var(name, value),
        (name) => getterAdapters.read(name),
      ));
    },
    atProperty: gcss.atProperty,
    keyframes: gcss.keyframes,
    get anim() {
      return cache_surface_value(this, "anim", manager.animForQuids([quid]));
    },
    selector: (pattern: string) => mkSelectorStyleHandle(ret, quid, pattern, scopeKey, ruleApi),
    media: (query: MediaQueryInput) => mkScopedQuidStyleHandle(ret, quid, joinScopeKey(scopeKey, scopeKeyFor("media", query)), ruleApi.media(query)),
    supports: (cond: SupportsQueryInput) => mkScopedQuidStyleHandle(ret, quid, joinScopeKey(scopeKey, scopeKeyFor("supports", cond)), ruleApi.supports(cond)),
    layer: (layerName: string) => mkScopedQuidStyleHandle(ret, quid, joinScopeKey(scopeKey, scopeKeyFor("layer", layerName)), ruleApi.layer(layerName)),
  };
}

function make_getter_for_quid(mgr: CssRuntimeManager, quid: string): StyleGetter {
  return make_style_getter({
    read: (propCanon) => mgr.getForQuid(quid, propCanon),
    readMany: () => mgr.getAllForQuid(quid) ?? {},
  });
}

function scopedMethods(
  ret: LiveTree,
  quid: string,
) {
  const gcss = api_for_host(ret);

  return {
    media: (query: MediaQueryInput) => mkScopedQuidStyleHandle(ret, quid, scopeKeyFor("media", query), gcss.media(query)),
    supports: (cond: SupportsQueryInput) => mkScopedQuidStyleHandle(ret, quid, scopeKeyFor("supports", cond), gcss.supports(cond)),
    layer: (layerName: string) => mkScopedQuidStyleHandle(ret, quid, scopeKeyFor("layer", layerName), gcss.layer(layerName)),
  };
}

/** Global and snapshot access do not demand subject identity. Subject capabilities
 * delegate lazily to the existing QUID-authorized handle. */
export function css_for_tree(host: LiveTree): CssTreeHandle {
  let scoped: CssTreeHandle | undefined;
  let global: ReturnType<typeof bound_document_css_api> | undefined;
  // Retain document authority even before the global namespace is resolved.
  // Its capability enforces revocation; losing correspondence cannot authorize
  // runtime-global fallback. A current binding still permits legitimate rebinding.
  let documentBinding = bound_document_css_for_tree(host);
  const withQuid = (): CssTreeHandle => {
    scoped ??= css_for_quid(host, host.quid);
    return scoped;
  };
  // Every canonical QUID has the same token shape and width. Prepare the cold
  // subject path with that shape before demanding identity; this spelling is
  // never issued, stored or published. Warm handles prepare in their own setter.
  const preparationQuid = "0".repeat(PERSISTED_QUID_LENGTH);
  const setMany: CssTreeHandle["setMany"] = map => {
    if (!scoped) prepare_style_map(map, mkCssQuidAdapter(host, manager_for_host(host), preparationQuid));
    return withQuid().setMany(map);
  };
  const selector = (pattern: string): StyleHandle<LiveTree> => {
    if (!scoped) resolveSelector(preparationQuid, pattern, manager_for_host(host));
    return withQuid().selector(pattern);
  };
  const snapshot = (): string => {
    const documentCss = bound_document_css_for_tree(host)?.document.css.snapshot() ?? "";
    const runtimeCss = manager_for_host(host).renderCss();
    return documentCss && runtimeCss ? `${documentCss}\n\n${runtimeCss}` : documentCss || runtimeCss;
  };
  return new Proxy({} as CssTreeHandle, {
    get(_target, key) {
      if (key === "global") {
        const binding = bound_document_css_for_tree(host) ?? documentBinding;
        if (binding !== undefined) {
          if (global === undefined && !binding.active) {
            throw new Error("Document CSS continuation binding has been disposed.");
          }
          documentBinding = binding;
          return global ??= bound_document_css_api(binding);
        }
        return global ??= api_for_host(host);
      }
      if (key === "snapshot") return snapshot;
      if (key === "setMany") return setMany;
      if (key === "selector") return selector;
      return Reflect.get(withQuid(), key);
    },
    ownKeys: () => Reflect.ownKeys(withQuid()),
    getOwnPropertyDescriptor(_target, key) {
      if (key === "global") return { configurable: true, enumerable: true, get: () => host.css.global };
      if (key === "snapshot") return { configurable: true, enumerable: true, value: snapshot };
      return Reflect.getOwnPropertyDescriptor(withQuid(), key);
    },
  });
}

/**
 * Create a stylesheet-backed handle for one QUID.
 *
 * @param quid QUID to target.
 * @returns A `CssHandle` targeting exactly one QUID.
 */

export function css_for_quid(host: LiveTree, quid: string): CssTreeHandle {
  const mgr = manager_for_host(host);
  const id = quid.trim();
  const setter = make_style_setter<LiveTree>(host, mkCssQuidAdapter(host, mgr, id));

  return {
    ...setter,
    get get(): StyleGetter {
      return cache_surface_value(this, "get", make_getter_for_quid(mgr, id));
    },
    getMany: () => mgr.getAllForQuid(id) ?? {},
    get var() {
      return cache_surface_value(this, "var", make_css_var_facade<LiveTree>(
        host,
        (name, value) => setter.set.var(name, value),
        (name) => mgr.getForQuid(id, name),
      ));
    },
    atProperty: mgr.atProperty,
    keyframes: mgr.keyframes,
    get global() {
      const binding = bound_document_css_for_tree(host);
      return cache_surface_value(this, "global", binding === undefined
        ? CssRuntimeManager.apiForRuntime(runtime_for_tree(host))
        : bound_document_css_api(binding));
    },
    snapshot: () => {
      const documentCss = bound_document_css_for_tree(host)?.document.css.snapshot() ?? "";
      const runtimeCss = mgr.renderCss();
      return documentCss && runtimeCss ? `${documentCss}\n\n${runtimeCss}` : documentCss || runtimeCss;
    },
    get anim() {
      return cache_surface_value(this, "anim", mgr.animForQuids([id]));
    },
    selector: (pattern: string) => mkSelectorStyleHandle(host, id, pattern),
    ...scopedMethods(host, id),
  };
}
