import { LiveTree } from "../../livetree.js";
import { CanvasApi } from "./canvas.types.js";

export function make_canvas_api<TTree extends LiveTree>(
  tree: TTree,
): CanvasApi<TTree> {
  const el = (): HTMLCanvasElement | undefined => {
    const node = tree.dom.el();

    if (node instanceof HTMLCanvasElement) {
      return node;
    }

    return undefined;
  };

  const getNumberAttr = (name: string): number | undefined => {
    const value = tree.attr.get(name);

    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    }

    return undefined;
  };

  const setNumberAttr = (name: string, value: number): TTree => {
    tree.attr.set(name, String(value));
    return tree;
  };

  const clearAttr = (name: string): TTree => {
    tree.attr.drop(name);
    return tree;
  };

  return {
    inScope: () => tree.node._tag === "canvas",

    el,

    ctx2d: (settings) => {
      const canvas = el();

      if (!canvas) {
        return undefined;
      }

      return canvas.getContext("2d", settings) ?? undefined;
    },

    width: {
      get: () => getNumberAttr("width"),
      set: (value) => setNumberAttr("width", value),
      clear: () => clearAttr("width"),
    },

    height: {
      get: () => getNumberAttr("height"),
      set: (value) => setNumberAttr("height", value),
      clear: () => clearAttr("height"),
    },

    must: {
      el: (label) => {
        const canvas = el();

        if (!canvas) {
          throw new Error(label ?? "[LiveTree.canvas.must.el] no canvas element available");
        }

        return canvas;
      },

      ctx2d: (settings, label) => {
        const ctx = el()?.getContext("2d", settings);

        if (!ctx) {
          throw new Error(label ?? "[LiveTree.canvas.must.ctx2d] no 2D canvas context available");
        }

        return ctx;
      },
    },
  };
}