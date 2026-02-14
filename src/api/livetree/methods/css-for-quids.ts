// css_for_quids.ts


import { Primitive } from "hson-live/types";
import { CssHandleVoid, CssHandle, CssHandleBase, CssKey, CssValue, CssPseudoKey, CssMapBase } from "../../../types/css.types";
import { nrmlz_cssom_prop_key as nrmlz_css_prop_key } from "../../../utils/attrs-utils/normalize-css";
import { LiveTree } from "../livetree";
import { CssManager, isLiveTree, render_css_value } from "../managers/css-manager";
import { make_style_getter } from "../managers/style-getter";
import { make_style_setter, StyleSetterAdapters } from "../managers/style-setter";


/**
 * Create a multi-QUID CSS handle.
 *
 * This is the main entrypoint for “stylesheet-backed” styling. It produces a `CssHandle`
 * whose core mutation surface is a `StyleSetter` wired to `CssManager`:
 *
 * - `apply(prop, value)` writes `prop: value` into each QUID’s rule block
 * - `remove(prop)` removes that property from each QUID’s rule block
 * - `clear()` deletes each QUID’s rule block entirely
 *
 * The returned handle may also expose additional manager capabilities (e.g. `atProperty`,
 * `keyframes`, animation helpers, and dev tooling snapshots) as pass-throughs.
 *
 * @param quids List of QUID strings to target. Empty/whitespace entries are ignored.
 * @returns A `CssHandle` that broadcasts style mutations to all provided QUIDs.
 * @see make_style_setter
 * @see CssManager
 */

// CHANGED: one canonical adapter builder for CssManager-backed setters.
// This is the “make it impossible to forget applyPseudo” piece.
const mk_css_quids_adapters = (
  mgr: CssManager,
  ids: readonly string[],
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

    // ADDED: pseudo routing for quid-scoped rules
    applyPseudo: (pseudo: CssPseudoKey, pseudoDecls: CssMapBase) => {
      for (const quid of ids) {
        for (const [k, v] of Object.entries(pseudoDecls)) {
          if (v == null) continue;

          const propCanon = nrmlz_css_prop_key(k as CssKey);
          const rendered = render_css_value(v as CssValue);

          if (rendered == null) {
            mgr.unsetPseudoForQuid(quid, pseudo, propCanon);
          } else {
            mgr.setPseudoForQuid(quid, pseudo, propCanon, rendered);
          }
        }

        // ADDED: auto-content for ::before/::after if omitted
        if ((pseudo === "__before" || pseudo === "__after") && !("content" in pseudoDecls)) {
          mgr.setPseudoForQuid(quid, pseudo, "content", `""`);
        }
      }
    },
  };
};

export function css_for_quids(quids: readonly string[]): CssHandleVoid;
export function css_for_quids(host: LiveTree, quids: readonly string[]): CssHandle;
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
      mk_css_quids_adapters(mgr, ids), // CHANGED: single source of truth
    );

    const getter = mk_getter_for_ids(ids);

    return {
      ...setter,
      get: getter,
      atProperty: mgr.atProperty,
      keyframes: mgr.keyframes,
      anim: mgr.animForQuids(ids),
    };
  }

  const ids = a.map(q => q.trim()).filter(Boolean);

  const setter = make_style_setter<void>(
    undefined,
    mk_css_quids_adapters(mgr, ids), // CHANGED: same helper here too
  );

  const getter = mk_getter_for_ids(ids);

  // IMPORTANT: your previous code was missing this return (TS2366).
  return {
    ...setter,
    get: getter,
    atProperty: mgr.atProperty,
    keyframes: mgr.keyframes,
    anim: mgr.animForQuids(ids),
  };
}
/**
 * Convenience wrapper for the single-QUID case.
 *
 * Equivalent to calling `css_for_quids([quid])`.
 *
 * @param quid QUID to target.
 * @returns A `CssHandle` targeting exactly one QUID.
 * @see css_for_quids
 */

export function css_for_quid(host: LiveTree, quid: string): CssHandle {
  return css_for_quids(host, [quid]);
}
