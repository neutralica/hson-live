// tree-selector.ts

import { LiveTree } from "./livetree.js";

type LiveTreeStyle = LiveTree["style"];
type LiveTreeCss = LiveTree["css"];
type LiveTreeListen = LiveTree["listen"];


export interface TreeSelectorType {
  items(): LiveTree[];
  count(): number;
  first(): LiveTree | undefined;

  each(fn: (tree: LiveTree, index: number) => void): void;
  map<T>(fn: (tree: LiveTree, index: number) => T): T[];
  filter(fn: (tree: LiveTree, index: number) => boolean): TreeSelector;

  removeAt(ix: number): boolean;
  removeAll(): number;

  readonly listen: LiveTreeListen;
  readonly style: LiveTreeStyle;
  readonly css: LiveTreeCss;


  readonly data: LiveTree["data"];
}

/**
 * Broadcast helper:
 * Creates a proxy that forwards any method call to *each* selected LiveTree’s manager.
 *
 * Example: selector.style.setMany({ ... }) calls tree.style.setMany(...) for every tree.
 */
function makeBroadcastProxy<T extends object>(
  items: readonly LiveTree[],
  pick: (t: LiveTree) => T,
): T {

  const base: T | undefined = items[0] ? pick(items[0]) : undefined;

  // empty selection: return a no-op proxy that safely absorbs calls.
  if (!base) {
    const noop = new Proxy(
      {},
      {
        get() {
          return () => undefined;
        },
      },
    );
    // TS can’t infer Proxy shape; this is one contained cast.
    return noop as unknown as T;
  }

  const proxy = new Proxy(base, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);

      // Pass through non-functions (properties, getters, etc.)
      if (typeof v !== "function") return v;

      // Broadcast function calls across all items
      return (...args: unknown[]) => {
        let last: unknown = undefined;

        for (let i = 0; i < items.length; i += 1) {
          const mgr = pick(items[i]);
          const fn = (mgr as unknown as Record<PropertyKey, unknown>)[prop];

          if (typeof fn === "function") {
            last = (fn as (...xs: unknown[]) => unknown).apply(mgr, args);
          }
        }

        // Return the last manager’s return value (usually ignored, but keeps behavior predictable)
        return last;
      };
    },
  });

  return proxy as unknown as T; // isolated cast
}

export class TreeSelector implements TreeSelectorType {
  private readonly contents: LiveTree[];

  public readonly listen: LiveTreeListen;
  public readonly style: LiveTreeStyle;
  public readonly css: LiveTreeCss;
  public readonly data: LiveTree["data"];

  public constructor(trees: LiveTree[]) {
    // Defensive copy to avoid external mutation.
    this.contents = [...trees];

    // Broadcast proxies.
    // If you already have a dedicated makeMultiListener(items), you can swap this line.
    this.listen = makeBroadcastProxy(this.contents, (t) => t.listen);

    this.style = makeBroadcastProxy(this.contents, (t) => t.style);
    this.css = makeBroadcastProxy(this.contents, (t) => t.css);

    // If your LiveTree uses `dataset` not `data`, change to (t) => t.dataset
    this.data = makeBroadcastProxy(this.contents, (t) => t.data);
  }

  public items(): LiveTree[] {
    return [...this.contents];
  }

  public count(): number {
    return this.contents.length;
  }

  public first(): LiveTree | undefined {
    return this.contents[0];
  }

  public each(fn: (tree: LiveTree, index: number) => void): void {
    for (let i = 0; i < this.contents.length; i += 1) fn(this.contents[i], i);
  }

  public map<T>(fn: (tree: LiveTree, index: number) => T): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.contents.length; i += 1) out.push(fn(this.contents[i], i));
    return out;
  }

  public filter(fn: (tree: LiveTree, index: number) => boolean): TreeSelector {
    const next: LiveTree[] = [];
    for (let i = 0; i < this.contents.length; i += 1) {
      if (fn(this.contents[i], i)) next.push(this.contents[i]);
    }
    return new TreeSelector(next);
  }
  public removeAt(ix: number): boolean {
    const hit = this.contents[ix];
    if (!hit) return false;

    hit.removeSelf();
    return true;
  }

  public removeAll(): number {
    let n = 0;

    for (const t of this.contents) {
      t.removeSelf();
      n += 1;
    }

    return n;
  }
}