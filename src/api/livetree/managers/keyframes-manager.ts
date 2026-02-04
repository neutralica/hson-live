// keyframes.ts

import { canon_to_css_prop } from "../../../utils/attrs-utils/normalize-css";
import { KeyframesInput, KeyframesInputTuple, KeyframeSelector, CssDeclMap, KeyframeStep, KeyframesDef, KeyframesName, KeyframesManager } from "../../../types/keyframes.types";

/**
 * Narrow a `KeyframesInput` union to the tuple-shaped variant.
 *
 * Tuple-shaped inputs store steps as an ordered list of `[selector, decls]`
 * pairs, while object-shaped inputs store steps as a selector-keyed record.
 *
 * This discriminator is intentionally shallow and structural:
 * it inspects the first `steps` entry and checks whether it is an array.
 * That keeps it fast and avoids depending on any sentinel properties.
 *
 * Notes:
 * - Empty `steps` technically makes this ambiguous; in that case, this
 *   function returns `false` and normalization will later reject the input
 *   as invalid (no steps).
 * - This is internal-only and assumes callers validate the overall shape.
 *
 * @param x
 *   A `KeyframesInput` value that may be object-shaped or tuple-shaped.
 *
 * @returns
 *   `true` if `x` is the tuple-shaped `KeyframesInputTuple` form.
 */
function isKeyframesTupleInput(x: KeyframesInput): x is KeyframesInputTuple {
  // tuple input has steps as an array of tuples; object input has a record.
  // We discriminate by checking whether the first entry is an array.
  const first = (x as KeyframesInputTuple).steps[0] as unknown;
  return Array.isArray(first);
}

/**
 * Validate that a keyframe selector is within the accepted subset.
 *
 * Allowed selectors:
 * - `"from"`
 * - `"to"`
 * - `"<number>%"` where `<number>` is finite and within `[0, 100]`
 *
 * This is stricter than CSS (which tolerates some oddities) on purpose:
 * the manager aims to be deterministic and “diff-friendly”, and tighter
 * validation helps catch mistakes early at the boundary.
 *
 * @param at
 *   A keyframe selector (`"from"`, `"to"`, or a percentage string).
 *
 * @throws {Error}
 *   If the selector is not `"from"`/`"to"`, not parseable as a percentage,
 *   or the numeric percentage is outside the range `0..100`.
 */
function assertValidSelector(at: KeyframeSelector): void {
  // allow from/to.
  if (at === "from" || at === "to") return;

  // parse "<number>%".
  const n = Number(at.slice(0, -1));

  // basic sanity checks.
  if (!Number.isFinite(n)) {
    throw new Error(`@keyframes: invalid selector "${at}" (not a number%).`);
  }

  // enforce 0–100 range (CSS effectively expects this).
  if (n < 0 || n > 100) {
    throw new Error(`@keyframes: invalid selector "${at}" (must be 0%..100%).`);
  }
}

/**
 * Normalize a declaration map used inside a keyframe step.
 *
 * Normalization rules:
 * - Drops entries whose property key is empty/whitespace.
 * - Trims keys and values.
 * - Drops entries whose trimmed value becomes the empty string.
 *
 * This keeps the stored form canonical and reduces noisy diffs between
 * semantically equivalent inputs (e.g. accidental trailing whitespace).
 *
 * @param decls
 *   A map of CSS property → raw CSS value text.
 *
 * @returns
 *   A fresh declaration map containing only non-empty keys and values,
 *   with all keys/values trimmed.
 */
function normalizeDecls(decls: CssDeclMap): CssDeclMap {
  // create a fresh object with trimmed values.
  const out: Record<string, string> = {};

  // normalize entries.
  for (const [k, v] of Object.entries(decls)) {
    // skip empty keys.
    if (!k || k.trim() === "") continue;

    // keep value trimming conservative.
    const vv = String(v).trim();

    // allow empty string values if you want; here we drop empties.
    if (vv === "") continue;

    // store.
    out[k.trim()] = vv;
  }

  // freeze-ish via Readonly return type.
  return out;
}

/**
 * Sort keyframe steps into a deterministic order.
 *
 * Ordering rules:
 * - `"from"` comes first.
 * - `"to"` comes last.
 * - Percentage selectors are ordered by their numeric value ascending.
 *
 * Deterministic ordering matters because:
 * - it stabilizes `renderAll()` output for snapshot/diff testing
 * - it prevents incidental input ordering from affecting serialized CSS
 *
 * @param steps
 *   A list of keyframe steps to sort. The input is not mutated.
 *
 * @returns
 *   A new array containing the same steps in canonical order.
 */
function sortSteps(steps: readonly KeyframeStep[]): KeyframeStep[] {
  // copy so we don’t mutate caller data.
  const copy = [...steps];

  // ordering function.
  copy.sort((a, b) => {
    // from is smallest.
    if (a.at === "from" && b.at !== "from") return -1;
    if (b.at === "from" && a.at !== "from") return 1;

    // to is largest.
    if (a.at === "to" && b.at !== "to") return 1;
    if (b.at === "to" && a.at !== "to") return -1;

    // both are percentages; compare numeric.
    const na = Number(a.at.slice(0, -1));
    const nb = Number(b.at.slice(0, -1));
    return na - nb;
  });

  // return sorted copy.
  return copy;
}

/**
 * Normalize any accepted `KeyframesInput` shape into canonical `KeyframesDef`.
 *
 * Responsibilities:
 * - Trims and validates the keyframes name.
 * - Validates all selectors (`from` / `to` / `n%` in `0..100`).
 * - Normalizes per-step declaration maps via `normalizeDecls`.
 * - Coerces both input forms (object-record or tuple-list) into a single
 *   stored representation.
 * - Collapses duplicate selectors using a last-wins rule.
 * - Sorts steps into deterministic order via `sortSteps`.
 *
 * This function is the main “boundary normalizer” for the manager: callers
 * should treat the returned `KeyframesDef` as stable/canonical.
 *
 * @param input
 *   Either:
 *   - `{ name, steps: { from: {...}, "50%": {...}, to: {...} } }`, or
 *   - `{ name, steps: [["from", {...}], ["50%", {...}], ["to", {...}]] }`
 *
 * @returns
 *   A canonical `KeyframesDef` suitable for storage and rendering.
 *
 * @throws {Error}
 *   If:
 *   - the name is empty after trimming
 *   - there are zero steps
 *   - any selector is invalid
 */
function normalizeKeyframesInput(input: KeyframesInput): KeyframesDef {
  // normalize name (trim only).
  const name: KeyframesName = input.name.trim();

  // basic name guard.
  if (name === "") {
    throw new Error(`@keyframes: name cannot be empty.`);
  }

  // build steps array.
  const steps: KeyframeStep[] = [];

  // tuple input path.
  if (isKeyframesTupleInput(input)) {
    for (const [at, decls] of input.steps) {
      assertValidSelector(at);
      steps.push({ at, decls: normalizeDecls(decls) });
    }
  } else {
    // object input path.
    for (const [atRaw, decls] of Object.entries(input.steps)) {
      if (!decls) continue; // Partial<Record> may yield undefined

      const at = atRaw as KeyframeSelector;
      assertValidSelector(at);

      steps.push({ at, decls: normalizeDecls(decls) });
    }
  }

  // reject empty steps.
  if (steps.length === 0) {
    throw new Error(`@keyframes ${name}: must have at least one step.`);
  }

  // merge duplicate selectors by last-wins (simple, predictable).
  // If you prefer strictness, throw on duplicates instead.
  const byAt: Map<KeyframeSelector, KeyframeStep> = new Map();
  for (const s of steps) byAt.set(s.at, s);

  // deterministic ordering.
  const sorted = sortSteps(Array.from(byAt.values()));

  // canonical form.
  return { name, steps: sorted };
}

/**
 * Render a declaration map into CSS declaration lines.
 *
 * Output is deterministic: properties are emitted in sorted key order.
 * The returned lines are intended to be inserted inside a surrounding
 * `{ ... }` block by the caller.
 *
 * @param decls
 *   A map of CSS property → raw CSS value text.
 *
 * @returns
 *   An array of CSS lines like `"    transform: rotate(90deg);"` suitable
 *   for inclusion in a keyframe step block.
 */
function renderDecls(decls: CssDeclMap): string[] {
  // stable ordering by original canonical keys
  const keys = Object.keys(decls).sort();

  return keys.map((k) => {
    // CHANGE: canonical -> emitted css prop (camel->kebab, keep --vars, etc.)
    const prop = canon_to_css_prop(k);

    // CHANGE: index safely; avoid "possibly undefined" by falling back to ""
    const val = decls[k] ?? "";

    return `    ${prop}: ${val};`;
  });
}

/**
 * Render a full `@keyframes` block from a canonical `KeyframesDef`.
 *
 * Assumes `def` has already been normalized:
 * - name is trimmed and non-empty
 * - steps are sorted deterministically
 * - declaration maps contain only trimmed, non-empty entries
 *
 * Rendering style:
 * - Uses a stable indentation scheme
 * - Emits selectors in canonical order
 * - Emits declarations in sorted order per step
 *
 * @param def
 *   A canonical keyframes definition.
 *
 * @returns
 *   Complete CSS text for a single `@keyframes <name> { ... }` block.
 */
function renderKeyframes(def: KeyframesDef): string {
  // start block.
  const lines: string[] = [];
  lines.push(`@keyframes ${def.name} {`);

  // render steps.
  for (const step of def.steps) {
    lines.push(`  ${step.at} {`);
    lines.push(...renderDecls(step.decls));
    lines.push(`  }`);
  }

  // end block.
  lines.push(`}`);

  // join.
  return lines.join("\n");
}

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
}): KeyframesManager {
  // storage by name.
  const byName: Map<KeyframesName, KeyframesDef> = new Map();

  return {
    set(input: KeyframesInput): void {
      // normalize at boundary.
      const next = normalizeKeyframesInput(input);

      // optional changed-detection.
      const prev = byName.get(next.name);
      const isSame = prev !== undefined && JSON.stringify(prev) === JSON.stringify(next);
      if (isSame) return;

      // store + dirty.
      byName.set(next.name, next);
      args.onChange();
    },

    setMany(inputs: readonly KeyframesInput[]): void {
      // batch normalize.
      for (const input of inputs) {
        const next = normalizeKeyframesInput(input);
        byName.set(next.name, next);
      }

      // dirty once.
      args.onChange();
    },

    delete(name: KeyframesName): void {
      // delete with trim consistency.
      const did = byName.delete(name.trim());
      if (did) args.onChange();
    },

    has(name: KeyframesName): boolean {
      return byName.has(name.trim());
    },

    get(name: KeyframesName): KeyframesDef | undefined {
      return byName.get(name.trim());
    },

    renderOne(name: KeyframesName): string {
      const def = byName.get(name.trim());
      return def ? renderKeyframes(def) : "";
    },

    renderAll(): string {
      // deterministic output by sorting names.
      const names = Array.from(byName.keys()).sort();

      // render in order.
      const blocks: string[] = [];
      for (const n of names) {
        const def = byName.get(n);
        if (def) blocks.push(renderKeyframes(def));
      }

      return blocks.join("\n\n");
    },
  };
}