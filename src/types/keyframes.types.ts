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
  name: KeyframesName;
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
 * Supported application interface for managing `@keyframes` blocks.
 *
 * All names are treated canonically via trimming.
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
   *  this is a no-op.
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
   *  The batch is published as one logical update.
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
   *  Does nothing when no matching definition exists.
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

}

/** Runtime ownership and rendering access for the stylesheet owner. @internal */
export interface KeyframesRegistry extends KeyframesManager {
  list(): readonly KeyframesName[];
  setOwned(owner: string, input: KeyframesInput): void;
  releaseOwner(owner: string): void;
  renderAll(): string;
}
