export interface CanvasApi<TSelf> {
  inScope(): boolean;

  el(): HTMLCanvasElement | undefined;

  ctx2d(settings?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | undefined;

  pointer(ev: MouseEvent | PointerEvent): CanvasPoint | undefined;

  width: {
    get(): number | undefined;
    set(value: number): TSelf;
    clear(): TSelf;
  };

  height: {
    get(): number | undefined;
    set(value: number): TSelf;
    clear(): TSelf;
  };

  size: CanvasSizeApi<TSelf>;
  display: CanvasDisplayApi<TSelf>;

  clear(): TSelf;
  clear(x: number, y: number, w: number, h: number): TSelf;

  plot(
    fn: (ctx: CanvasRenderingContext2D, cvs: HTMLCanvasElement) => void,
    settings?: CanvasRenderingContext2DSettings,
  ): TSelf;

  must: {
    el(label?: string): HTMLCanvasElement;

    ctx2d(
      settings?: CanvasRenderingContext2DSettings,
      label?: string,
    ): CanvasRenderingContext2D;

    pointer(ev: MouseEvent | PointerEvent, label?: string): CanvasPoint;

    plot(
      fn: (ctx: CanvasRenderingContext2D, cvs: HTMLCanvasElement) => void,
      settings?: CanvasRenderingContext2DSettings,
      label?: string,
    ): TSelf;
  };
}

export interface LiveTreeCanvas<TSelf> {
  /**
   * Canvas helper bound to this branch.
   */
  readonly canvas: CanvasApi<TSelf>;
}

export type CanvasSize = Readonly<{
  width: number | undefined;
  height: number | undefined;
}>;

export interface CanvasSizeApi<TSelf> {
  /**
   * Read the canvas backing bitmap width/height attrs.
   */
  get(): CanvasSize;

  /**
   * Set the canvas backing bitmap width/height attrs.
   */
  set(width: number, height: number): TSelf;

  /**
   * Clear the canvas backing bitmap width/height attrs.
   */
  clear(): TSelf;
}

export type CanvasPoint = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type CanvasDisplaySize = Readonly<{
  width: number;
  height: number;
  dpr: number;
  bitmapWidth: number;
  bitmapHeight: number;
}>;

export type CanvasDisplayMatchOptions = Readonly<{
  dpr?: number;
  scaleContext?: boolean;
}>;

export interface CanvasWatchHandle {
  off(): void;
}

export type CanvasMatchFn<TSelf> = {
  /**
   * Match the canvas backing bitmap size to its displayed CSS size.
   *
   * By default, uses `window.devicePixelRatio` and scales the 2D context so
   * drawing coordinates remain in CSS pixels.
   */
  (opts?: CanvasDisplayMatchOptions): TSelf;

  /**
   * Keep the canvas backing bitmap matched to its displayed CSS size.
   *
   * Runs one initial match immediately, then watches size changes with
   * ResizeObserver until `.off()` is called.
   */
  watch(opts?: CanvasDisplayMatchOptions): CanvasWatchHandle;
};

export interface CanvasDisplayApi<TSelf> {
  /**
   * Read the mounted canvas element's displayed CSS size and derived bitmap size.
   *
   * Returns undefined when the canvas is not mounted or not measurable.
   */
  size(opts?: { dpr?: number }): CanvasDisplaySize | undefined;

  /**
   * One-shot display/backing-size matcher, with `.watch()` for ResizeObserver mode.
   */
  match: CanvasMatchFn<TSelf>;
}