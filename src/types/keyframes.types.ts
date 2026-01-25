// keyframes.types.ts

/** A `@keyframes` identifier (kept intentionally permissive). */

export type KeyframesName = string;
/**
 * A keyframe selector.
 *
 * `"from"` / `"to"` are named anchors.
 * `"<number>%"` is stored as a string so callers can supply `"12.5%"`, etc.
 */

export type KeyframeSelector = "from" | "to" | `${number}%`;
/**
 * Declaration map used inside a keyframe step.
 *
 * Keys are CSS property names (including custom properties like `--angle`).
 * Values are raw CSS value text (already-rendered literals).
 */

export type CssDeclMap = Readonly<Record<string, string>>;
/** A single keyframe step: selector + declaration map. */

export type KeyframeStep = Readonly<{
  // Which keyframe selector this step applies to.
  at: KeyframeSelector;

  // The declarations inside the frame.
  // Example: { transform: "rotate(90deg)", "--angle": "90deg" }
  decls: CssDeclMap;
}>;
/**
 * Canonical stored form of a full `@keyframes` block.
 *
 * `steps` are expected to be in deterministic order after normalization.
 */

export type KeyframesDef = Readonly<{
  // The keyframes name.
  name: KeyframesName;

  // Steps, in a deterministic order (we'll normalize).
  steps: readonly KeyframeStep[];
}>;
/**
 * Object-shaped keyframes input.
 *
 * Compact at call sites:
 * `{ name: "spin", steps: { from: {...}, "50%": {...}, to: {...} } }`
 */

export type KeyframesInputObject = Readonly<{
  name: KeyframesName;
  // Partial so you can provide any subset ("0%", "50%", "to", etc.)
  steps: Readonly<Partial<Record<KeyframeSelector, CssDeclMap>>>;
}>;
/**
 * Tuple-shaped keyframes input.
 *
 * Ordered at call sites:
 * `{ name: "spin", steps: [["from", {...}], ["50%", {...}], ["to", {...}]] }`
 */

export type KeyframesInputTuple = Readonly<{
  name: KeyframesName;
  steps: readonly (readonly [KeyframeSelector, CssDeclMap])[];
}>;
/** Union of accepted keyframes input shapes. */

export type KeyframesInput = KeyframesInputObject | KeyframesInputTuple;
/**
 * Minimal manager interface for storing and rendering `@keyframes` blocks.
 *
 * All names are treated canonically via trimming.
 * All rendering is intended to be deterministic for diff/snapshot use.
 */

export interface KeyframesManager {
  /**
   * Register (or replace) a `@keyframes` block by name.
   *  The input is normalized and validated at the boundary:
   *  - name is trimmed and must be non-empty
   *  - selectors must be `"from" | "to" | "<number>%"` with `0..100`
   *  - declarations are normalized (trimmed; empty keys/values dropped)
   *  - steps are merged (duplicate selectors last-wins) and sorted deterministically
   *
   *  If the resulting canonical definition is identical to the stored one,
   *  this is a no-op (does not call `onChange`).
   *
   * @param input
   *   The keyframes definition in either object or tuple form.
   *
   * @throws {Error}
   *   If validation fails (empty name, invalid selector, no steps, etc.).
   */
  set(input: KeyframesInput): void;

  /**
   * Register/replace multiple `@keyframes` blocks in one batch.
   *  Each input is normalized and stored using the same rules as `set()`.
   *  The owning system’s `onChange` callback is invoked once after the batch
   *  completes (assuming at least one input is provided).
   *
   * @param inputs
   *   A list of keyframes definitions to register.
   *
   * @throws {Error}
   *   If any input fails validation/normalization.
   */
  setMany(inputs: readonly KeyframesInput[]): void;

  /**
   * Remove a stored `@keyframes` block by name.
   *  Name is trimmed before lookup to match the manager’s canonical storage.
   *  Calls `onChange` only if an entry was actually removed.
   *
   * @param name - The keyframes name to delete.
   */
  delete(name: KeyframesName): void;

  /**
 * Check whether a `@keyframes` block is registered under the given name.
 *  Name is trimmed before lookup.
 *
 * @param name - The keyframes name to query.
 * @returns - `true` if a definition exists for the trimmed name.
 */
  has(name: KeyframesName): boolean;

  /**
   * Retrieve the canonical stored definition for a `@keyframes` block.
   *
   * Name is trimmed before lookup.
   *
   * @param name
   *   The keyframes name to retrieve.
   *
   * @returns
   *   The canonical `KeyframesDef` if present; otherwise `undefined`.
   */
  get(name: KeyframesName): KeyframesDef | undefined;

  /**
   * Render a single `@keyframes` block to CSS text.
   *
   * This renders the canonical stored form (deterministically ordered).
   * If the name is not registered, returns the empty string.
   *
   * @param name
   *   The keyframes name to render.
   *
   * @returns
   *   CSS for the single `@keyframes <name> { ... }` block, or `""` if missing.
   */
  renderOne(name: KeyframesName): string;
  /**
   * Render all registered `@keyframes` blocks to CSS text.
   *
   * Output is deterministic:
   * - keyframes blocks are ordered by name (sorted)
   * - steps within each block are in canonical order
   * - declarations within each step are sorted
   *
   * @returns
   *   CSS text containing all `@keyframes` blocks, separated by blank lines.
   */
  renderAll(): string;
}
