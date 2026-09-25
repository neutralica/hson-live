import { canonical_keyframes_definition, render_keyframes_definition } from "../../../internal/css/keyframes-definition.js";
import type { KeyframesInput, KeyframesDef, KeyframesName, KeyframesRegistry } from "../../../types/keyframes.types.js";
export { canonical_keyframes_definition, render_keyframes_definition, normalize_decls } from "../../../internal/css/keyframes-definition.js";

/**
 * Create a small in-memory manager for `@keyframes` blocks.
 *
 * The manager:
 * - Stores canonical keyframe definitions by name (`KeyframesName → KeyframesDef`).
 * - Normalizes all inputs at the boundary (`normalizeKeyframesInput`), ensuring:
 *   - deterministic step ordering
 *   - trimmed keys/values
 *   - validated selectors
 * - Renders either a single block (`renderOne`) or the full set (`renderAll`)
 *   in deterministic name order for snapshot/diff friendliness.
 *
 * Change signaling:
 * - Any mutating operation (`set`, `setMany`, `delete`) calls `args.onChange()`
 *   when it actually changes stored state.
 *
 * Intended usage:
 * - As a sub-manager inside a larger stylesheet system (e.g. a CSS manager)
 *   that re-renders a combined `<style>` element whenever keyframes change.
 *
 * @param args
 *   Construction options.
 *
 * @param args.onChange
 *   Callback invoked after a successful mutation so the owning system can
 *   re-render or flush the stylesheet.
 *
 * @returns
 *   A `KeyframesManager` instance providing set/get/query and render APIs.
 */
export function manage_keyframes(args: {
  // Called whenever keyframes change.
  onChange: () => void;
  /** Internal runtime-local emitted-name prefix. */
  namePrefix?: string;
}): KeyframesRegistry {
  // storage by name.
  const byName: Map<KeyframesName, KeyframesDef> = new Map();

  // changed: ownership index for generated/node-owned keyframes.
  const namesByOwner: Map<string, Set<KeyframesName>> = new Map();
  const ownerByName: Map<KeyframesName, string> = new Map();

  const releaseNameOwnership = (name: KeyframesName): void => {
    const priorOwner = ownerByName.get(name);
    if (!priorOwner) return;

    ownerByName.delete(name);

    const owned = namesByOwner.get(priorOwner);
    if (!owned) return;

    owned.delete(name);
    if (owned.size === 0) namesByOwner.delete(priorOwner);
  };

  const claimNameForOwner = (owner: string, name: KeyframesName): void => {
    const o = owner.trim();
    if (!o) return;

    releaseNameOwnership(name);

    let owned = namesByOwner.get(o);
    if (!owned) {
      owned = new Set<KeyframesName>();
      namesByOwner.set(o, owned);
    }

    owned.add(name);
    ownerByName.set(name, o);
  };

  return {
    set(input: KeyframesInput): void {
      // normalize at boundary.
      const next = canonical_keyframes_definition(input);

      // optional changed-detection.
      const prev = byName.get(next.name);
      const isSame = prev !== undefined && JSON.stringify(prev) === JSON.stringify(next);
      if (isSame) return;

      // changed: explicit set() means durable/global; clear generated ownership.
      releaseNameOwnership(next.name);

      // store + dirty.
      byName.set(next.name, next);
      args.onChange();
    },

    /**
     * Register or replace a `@keyframes` block owned by a node/subtree.
     *
     * The keyframes are still rendered globally, but their lifecycle is tied to
     * `owner`. Calling `releaseOwner(owner)` removes all keyframes registered
     * through this path for that owner.
     */
    setOwned(owner: string, input: KeyframesInput): void {
      const o = owner.trim();
      if (!o) return;

      const next = canonical_keyframes_definition(input);

      const prev = byName.get(next.name);
      const priorOwner = ownerByName.get(next.name);
      const isSame = prev !== undefined && JSON.stringify(prev) === JSON.stringify(next) && priorOwner === o;
      if (isSame) return;

      byName.set(next.name, next);
      claimNameForOwner(o, next.name);
      args.onChange();
    },

    setMany(inputs: readonly KeyframesInput[]): void {
      // batch normalize.
      for (const input of inputs) {
        const next = canonical_keyframes_definition(input);
        // changed: explicit setMany() means durable/global; clear generated ownership.
        releaseNameOwnership(next.name);
        byName.set(next.name, next);
      }

      // dirty once.
      args.onChange();
    },

    delete(name: KeyframesName): void {
      // delete with trim consistency.
      const key = name.trim();
      const did = byName.delete(key);
      if (!did) return;

      releaseNameOwnership(key);
      args.onChange();
    },

    releaseOwner(owner: string): void {
      const o = owner.trim();
      if (!o) return;

      const owned = namesByOwner.get(o);
      if (!owned || owned.size === 0) return;

      const names = Array.from(owned);
      for (const name of names) {
        byName.delete(name);
        ownerByName.delete(name);
      }

      namesByOwner.delete(o);
      args.onChange();
    },

    has(name: KeyframesName): boolean {
      return byName.has(name.trim());
    },

    get(name: KeyframesName): KeyframesDef | undefined {
      return byName.get(name.trim());
    },

    renderAll(): string {
      // deterministic output by sorting names.
      const names = Array.from(byName.keys()).sort();

      // render in order.
      const blocks: string[] = [];
      for (const n of names) {
        const def = byName.get(n);
        if (def) blocks.push(render_keyframes_definition(def, `${args.namePrefix ?? ""}${def.name}`));
      }

      return blocks.join("\n\n");
    },
  };
}
