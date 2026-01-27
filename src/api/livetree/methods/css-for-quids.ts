// css_for_quids.ts


import { CssHandleVoid, CssHandle, CssHandleBase } from "../../../types/css.types";
import { LiveTree } from "../livetree";
import { CssManager, isLiveTree } from "../managers-etc/css-manager";
import { make_style_getter } from "../managers-etc/style-getter";
import { make_style_setter } from "../managers-etc/style-setter";


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

export function css_for_quids(quids: readonly string[]): CssHandleVoid;
export function css_for_quids(host: LiveTree, quids: readonly string[]): CssHandle;
export function css_for_quids(
  a: LiveTree | readonly string[],
  b?: readonly string[]
): CssHandleBase<any> {
  const mgr = CssManager.invoke();

  const mk_getters_for_ids = (ids: readonly string[]) => {
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

    const setter = make_style_setter<LiveTree>(host, {
      apply: (propCanon, value) => { for (const quid of ids) mgr.setForQuid(quid, propCanon, value); },
      remove: (propCanon) => { for (const quid of ids) mgr.unsetForQuid(quid, propCanon); },
      clear: () => { for (const quid of ids) mgr.clearQuid(quid); },
    });

    const getter = mk_getters_for_ids(ids);

    return {
      ...setter,
      get: getter,
      atProperty: mgr.atProperty,
      keyframes: mgr.keyframes,
      anim: mgr.animForQuids(ids),
    };
  }

  const ids = a.map(q => q.trim()).filter(Boolean);

  const setter = make_style_setter<void>(undefined, {
    apply: (propCanon, value) => { for (const quid of ids) mgr.setForQuid(quid, propCanon, value); },
    remove: (propCanon) => { for (const quid of ids) mgr.unsetForQuid(quid, propCanon); },
    clear: () => { for (const quid of ids) mgr.clearQuid(quid); },
  });

  const getter = mk_getters_for_ids(ids);

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
