// livetree-projector.ts

import { HsonNode } from "../../types/node.types";
import { Patch, Path, Store } from "../livemap/types.livemap";
import { Projector, ProjectorMode } from "./projector";


/*************************** 
 * (CURRENTLY UNUSED, TBC)
 ***************************/


/**
 * Options for LiveTree projection.
 */
export type LiveTreeOptions = {
  // Future: hydration flags, virtualization thresholds, etc.
};

/**
 * Projector that renders a HSON tree into live DOM.
 */
export class LiveTreeProjector implements Projector {
  private store: Store;
  private root: Element | null = null;
  private path: Path = [];
  private mode: ProjectorMode = "snapshot";
  private unsubscribe: (() => void) | null = null;

  /**
   * @param store - Backing data store.
   * @param _opts - Optional projection options (unused for now).
   */
  constructor(store: Store, _opts?: LiveTreeOptions) {
    this.store = store;
  }

  /**
   * Mount into a DOM container and render the selected subtree.
   *
   * @param root - DOM container to render into.
   * @param path - Subtree path to render.
   * @param mode - Presentation mode (snapshot/dashboard/control).
   * @returns void
   */
  mount(root: Element, path: Path, mode: ProjectorMode): void {
    this.root = root;
    this.path = path;
    this.mode = mode;


    const node: HsonNode = this.store.readNode(path);
    // TODO: replace this with existing NEW→DOM renderer.
    this.renderInitialDom(node, root);

    // Subscribe to the store and apply minimal DOM patches.
    this.unsubscribe = this.store.subscribe((patch) => {
      if (patch.origin === "dom:tree") return;            // reentrancy guard
      this.onPatch(patch);
    });
  }

  /**
   * Unmount and tear down subscriptions.
   *
   * @returns void
   */
  unmount(): void {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    this.root = null;
  }

  /**
   * Apply a patch from the store (excluding self-originated DOM patches).
   *
   * @param patch - Patch to reconcile.
   * @returns void
   */
  onPatch(patch: Patch): void {
    if (!this.root) return;
    // TODO: For each op that touches this.path subtree, compute and apply minimal DOM updates.

  }

  private renderInitialDom(node: HsonNode, root: Element): void {
    // TODO: Call DOM projector.
  }
}
