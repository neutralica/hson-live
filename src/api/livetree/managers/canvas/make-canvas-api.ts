// make-canvas-api.ts

import { LiveTree } from "../../livetree.js";
import { disposable_add_for_owner, disposable_remove_for_owner } from "../lifecycle-registry.js";
import { CanvasApi, CanvasDisplayMatchOptions, CanvasDisplaySize, CanvasMatchFn, CanvasPoint, CanvasSize, CanvasWatchHandle } from "./canvas.types.js";

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

  const matchOnce = (
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
  const match = ((opts?: CanvasDisplayMatchOptions): TTree => {
    return matchOnce(opts);
  }) as CanvasMatchFn<TTree>;

  match.watch = (opts?: CanvasDisplayMatchOptions): CanvasWatchHandle => {
    const canvas = el();

    if (!canvas || typeof ResizeObserver === "undefined") {
      return {
        off: () => undefined,
      };
    }

    matchOnce(opts);

    const observer = new ResizeObserver(() => {
      matchOnce(opts);
    });

    observer.observe(canvas);

    let active = true;

    const off = (): void => {
      if (!active) return;

      active = false;
      observer.disconnect();
      disposable_remove_for_owner(tree.quid, off);
    };

    disposable_add_for_owner(tree.quid, off, "resize-observer");

    return { off };
  };

  const clear = (...args: [] | [number, number, number, number]): TTree => {
    const canvas = el();
    if (!canvas) {
      return tree;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return tree;
    }
    if (args.length === 4) {
      ctx.clearRect(args[0], args[1], args[2], args[3]);
      return tree;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return tree;
  };

  const pointer = (ev: MouseEvent | PointerEvent): CanvasPoint | undefined => {
    const cvs = el();
    if (!cvs) return undefined;

    const rect = cvs.getBoundingClientRect();

    return {
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
  };
  const mustPointer = (
    ev: MouseEvent | PointerEvent,
    label?: string,
  ): CanvasPoint => {
    const pt = pointer(ev);

    if (!pt) {
      throw new Error(label ?? "[LiveTree.canvas.must.pointer] no canvas element available");
    }

    return pt;
  };

  const plot = (
    fn: (
      ctx: CanvasRenderingContext2D,
      canvas: HTMLCanvasElement,
    ) => void,
    settings?: CanvasRenderingContext2DSettings,
  ): TTree => {
    const canvas = el();
    if (!canvas) {
      return tree;
    }
    const ctx = canvas.getContext("2d", settings);
    if (!ctx) {
      return tree;
    }
    fn(ctx, canvas);
    return tree;
  };

  const mustPlot = (
    fn: (ctx: CanvasRenderingContext2D, cvs: HTMLCanvasElement) => void,
    settings?: CanvasRenderingContext2DSettings,
    label?: string,
  ): TTree => {
    const cvs = el();
    if (!cvs) {
      throw new Error(label ?? "[LiveTree.canvas.must.plot] no canvas element available");
    }
    const ctx = cvs.getContext("2d", settings);
    if (!ctx) {
      throw new Error(label ?? "[LiveTree.canvas.must.plot] no 2D canvas context available");
    }
    fn(ctx, cvs);
    return tree;
  };

  return {
    inScope: () => tree.node.$_tag === "canvas",

    el,

    ctx2d: (settings) => {
      const canvas = el();

      if (!canvas) {
        return undefined;
      }

      return canvas.getContext("2d", settings) ?? undefined;
    },

    pointer,

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
      get: () => {
        return {
          width: getNumberAttr("width"),
          height: getNumberAttr("height"),
        };
      },

      set: (width, height) => {
        setNumberAttr("width", width);
        setNumberAttr("height", height);
        return tree;
      },

      clear: () => {
        clearAttr("width");
        clearAttr("height");
        return tree;
      },
    },

    display: {
      size: getDisplaySize,
      match,
    },

    clear,
    plot,

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

      pointer: mustPointer,
      plot: mustPlot,
    },
  };
}
