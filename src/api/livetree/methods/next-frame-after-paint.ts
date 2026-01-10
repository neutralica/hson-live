// next-frame-after-paint.ts

/**
 * Await the browser’s next animation frame.
 *
 * Semantics:
 * - Wraps `requestAnimationFrame` in a Promise and resolves shortly
 *   before the next paint.
 * - Useful after DOM / style mutations when code should run once the
 *   browser has had a chance to schedule a frame.
 *
 * Notes:
 * - This does *not* guarantee that the frame has already been painted,
 *   only that the callback is queued in the RAF phase before paint.
 * - Intended for browser environments; will no-op / throw if
 *   `requestAnimationFrame` is not available.
 */
export function nextFrame(): Promise<void> {
  // resolves right before the next paint
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}
/**
 * Await at least one full paint boundary before continuing.
 *
 * Semantics:
 * - Awaits `nextFrame()` twice in a row.
 * - In normal browsers this gives:
 *   - 1st `await`: code runs in the next RAF tick.
 *   - 2nd `await`: code runs in the *following* RAF tick,
 *     after at least one paint opportunity.
 *
 * Typical use cases:
 * - Ensuring layout / style changes have been flushed before measuring.
 * - Waiting for “settled” DOM state in demos/tests that depend on
 *   visual updates rather than just synchronous mutations.
 */
export async function after_paint(): Promise<void> {
  // ensures at least one paint between awaits
  await nextFrame();
  await nextFrame();
}
