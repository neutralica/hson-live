import type { LiveTree } from "../api/livetree/livetree.js";
import type { LocalActionHandler, LocalActionRegistry } from "./local-action.types.js";

export type LiveTreeActionContext = Readonly<{
  /** The root handle of the owning LiveTree environment. */
  tree: LiveTree;
  /** The exact handle on which a declarative listener was installed. */
  subject?: LiveTree;
  /** The native event received by that listener. */
  event?: Event;
}>;

export type LiveTreeActionHandler = LocalActionHandler<LiveTreeActionContext>;
export type LiveTreeActions = LocalActionRegistry<LiveTreeActionContext>;
