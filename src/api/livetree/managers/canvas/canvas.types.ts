
export interface CanvasApi<TSelf> {
  /**
   * Returns true when this tree is a `<canvas>` element or belongs to a canvas-specific scope.
   */
  inScope(): boolean;

  /**
   * Return the mounted HTMLCanvasElement when available.
   */
  el(): HTMLCanvasElement | undefined;

  /**
   * Return this canvas element's 2D rendering context when available.
   */
  ctx2d(settings?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | undefined;

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

  must: {
    el(label?: string): HTMLCanvasElement;
    ctx2d(
      settings?: CanvasRenderingContext2DSettings,
      label?: string
    ): CanvasRenderingContext2D;
  };
}

export interface LiveTreeCanvas<TSelf> {
  /**
   * Canvas helper bound to this branch.
   */
  readonly canvas: CanvasApi<TSelf>;
}
