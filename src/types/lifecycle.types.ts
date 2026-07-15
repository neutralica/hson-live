import type { LiveTree } from "../api/livetree/livetree.js";

export type LiveTreeLifecycleResult = 0 | 1;

/** Ordered content group returned by `LiveTree.detachContents()`. */
export interface DetachedLiveContent {
  /** Number of direct content entries retained by this group. */
  readonly length: number;
  /** Whether this group has already been attached to a new owner. */
  readonly isAttached: boolean;
  /** Attach the exact retained content, in order, to an active target. */
  appendTo<TTree extends LiveTree>(target: TTree): TTree;
}
