
export interface CanvasApi<TSelf> {

  /**
   * Return the mounted HTMLCanvasElement when available.
   */
  el(): HTMLCanvasElement | undefined;

  /**
 * Returns true when this tree is a `<canvas>` element or belongs to a canvas-specific scope.
 */
  inScope(): boolean;

  /**
   * Return this canvas element's 2D rendering context when available.
   */
  ctx2d(settings?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | undefined;

  /**
   * Clear the canvas bitmap.
   *
   * With no arguments, clears the full backing bitmap.
   * With x/y/w/h arguments, clears the provided rectangle.
   *
   * Returns this tree for chaining. If no mounted 2D context is available,
   * this is a no-op.
   */
  clear(): TSelf;
  clear(x: number, y: number, w: number, h: number): TSelf;

  pointer: (ev: PointerEvent | MouseEvent) => CanvasPoint | undefined;

  /**
   * Canvas dimension attribute helpers.
   */
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
  must: {
    el(label?: string): HTMLCanvasElement;
    ctx2d(
      settings?: CanvasRenderingContext2DSettings,
      label?: string
    ): CanvasRenderingContext2D;
    plot(
      fn: (ctx: CanvasRenderingContext2D, cvs: HTMLCanvasElement) => void,
      settings?: CanvasRenderingContext2DSettings,
      label?: string,
    ): TSelf;
    pointer: (ev: PointerEvent | MouseEvent) => CanvasPoint;
  };


  /**
   * Run native 2D canvas commands against this branch's mounted canvas.
   *
   * This is a guarded bridge into the browser's CanvasRenderingContext2D:
   * if the branch is not mounted as a canvas or no 2D context is available,
   * the callback is not called.
   *
   * Returns this tree for chaining.
   */
  plot(
    fn: (
      ctx: CanvasRenderingContext2D,
      cvs: HTMLCanvasElement,
    ) => void,
    settings?: CanvasRenderingContext2DSettings,
  ): TSelf;



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
  get(): CanvasSize;
  set(width: number, height: number): TSelf;
  clear(): TSelf;
}

export type CanvasPoint = {
  x: number;
  y: number;
  width: number;
  height: number;
};

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

export interface CanvasDisplayApi<TSelf> {
  /**
   * Read the mounted canvas element's displayed CSS size and derived bitmap size.
   *
   * Returns undefined when the canvas is not mounted or not measurable.
   */
  size(opts?: { dpr?: number }): CanvasDisplaySize | undefined;

  /**
   * Match the canvas backing bitmap size to its displayed CSS size.
   *
   * By default, uses `window.devicePixelRatio` and scales the 2D context so
   * drawing coordinates remain in CSS pixels.
   */
  match(opts?: CanvasDisplayMatchOptions): TSelf;
}