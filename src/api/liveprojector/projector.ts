// projector.ts

import { Patch, Path } from "../livemap/types.livemap.js";

/*************************** 
 * (CURRENTLY UNUSED, TBC)
 ***************************/

/**
 * Presentation mode for a projector mount.
 *
 * - "snapshot": render once, no live updates.
 * - "dashboard": subscribe and display updates.
 * - "control": two-way binding (DOM -> store + store -> DOM).
 */
export type ProjectorMode = "snapshot" | "dashboard" | "control";

/**
 * Contract for projecting a store subtree into the DOM.
 */
export interface Projector {
  /**
   * Mount a projector into the DOM.
   *
   * @param root - DOM container to render into.
   * @param path - Path to the subtree to project.
   * @param mode - Presentation mode for the mount.
   * @returns void
   */
  mount(root: Element, path: Path, mode: ProjectorMode): void;
  /**
   * Unmount and clean up any listeners or subscriptions.
   *
   * @returns void
   */
  unmount(): void;
  /**
   * Handle patches emitted by the store or other projectors.
   *
   * Called by the substrate when *other* actors mutate the model.
   *
   * @param patch - Patch to apply or reconcile.
   * @returns void
   */
  onPatch(patch: Patch): void;
}
