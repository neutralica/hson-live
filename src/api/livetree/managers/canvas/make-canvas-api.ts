import { LiveTree } from "../../livetree.js";
import { CanvasApi, CanvasDisplayMatchOptions, CanvasDisplaySize, CanvasSize } from "./canvas.types.js";

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
  const getBackingSize = (): CanvasSize => {
    return {
      width: getNumberAttr("width"),
      height: getNumberAttr("height"),
    };
  };

  const setBackingSize = (width: number, height: number): TTree => {
    setNumberAttr("width", width);
    setNumberAttr("height", height);

    return tree;
  };

  const clearBackingSize = (): TTree => {
    clearAttr("width");
    clearAttr("height");

    return tree;
  };

  const getDisplaySize = (
    opts?: { dpr?: number },
  ): CanvasDisplaySize | undefined => {
    const canvas = el();

    if (!canvas) {
      return undefined;
    }

    const rect = canvas.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return undefined;
    }

    const dpr = opts?.dpr ?? globalThis.window?.devicePixelRatio ?? 1;

    return {
      width: rect.width,
      height: rect.height,
      dpr,
      bitmapWidth: Math.round(rect.width * dpr),
      bitmapHeight: Math.round(rect.height * dpr),
    };
  };

  const matchDisplay = (
    opts?: CanvasDisplayMatchOptions,
  ): TTree => {
    const canvas = el();

    if (!canvas) {
      return tree;
    }

    const display = getDisplaySize({ dpr: opts?.dpr });

    if (!display) {
      return tree;
    }

    canvas.width = display.bitmapWidth;
    canvas.height = display.bitmapHeight;

    tree.attr.set("width", String(display.bitmapWidth));
    tree.attr.set("height", String(display.bitmapHeight));

    if (opts?.scaleContext !== false) {
      const ctx = canvas.getContext("2d");

      if (ctx) {
        ctx.setTransform(display.dpr, 0, 0, display.dpr, 0, 0);
      }
    }

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
    size: {
      get: getBackingSize,
      set: setBackingSize,
      clear: clearBackingSize,
    },

    display: {
      size: getDisplaySize,
      match: matchDisplay,
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