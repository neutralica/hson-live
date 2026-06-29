// gate-mutation.ts

/**
 * Opaque origin tag for a gated mutation batch.
 */
export type OriginTag = Readonly<{ id: string }>;

/**
 * Observer callback signature for mutation batches.
 */
export type GateObserver = (
    records: readonly MutationRecord[],
    origin: OriginTag | null
) => void;

/**
 * Gate interface for origin-tagged writes and mutation observation.
 */
export interface MutationGate {
    // All DOM writes must go through here
    write(fn: (origin: OriginTag) => void): void;

    // Subscribe to mutations; returns an unsubscriber
    observe(cb: GateObserver): () => void;
}

/**
 * Create a scoped “mutation gate” around a DOM subtree.
 *
 * A mutation gate provides two things:
 * - A required write path (`write`) that tags a batch of DOM mutations with an origin token.
 * - A subscription API (`observe`) that fan-outs MutationObserver batches to multiple listeners,
 *   each receiving both the mutation records and (when applicable) the origin of the write.
 *
 * Origin tagging:
 * - Each `write(fn)` call generates a fresh `OriginTag` and sets it as `currentOrigin`.
 * - When the browser delivers a MutationObserver callback, the gate passes the captured
 *   `currentOrigin` to observers and then clears it.
 * - If a `write` produces *no* observable mutations, a microtask clears `currentOrigin`
 *   to prevent it from leaking into later unrelated mutation batches.
 *
 * Observer behavior:
 * - A single `MutationObserver` is created for `target` and dispatches to an internal
 *   subscriber list.
 * - Subscriber callbacks are invoked synchronously in registration order.
 * - Errors thrown by subscribers are not caught here (so failures surface loudly in dev).
 *
 * Observation scope:
 * - Observes `subtree`, `childList`, `attributes`, and `characterData` on `target`.
 *
 * @param target - Root node whose subtree will be observed.
 * @returns A `MutationGate` with `write` and `observe` methods.
 */
export function createMutationGate(target: Node): MutationGate {
    // keep a list of observers; no global `observerFn`
    const observers: GateObserver[] = [];

    // Tracks origin of the *current* gated write batch
    let currentOrigin: OriginTag | null = null;

    // single MutationObserver dispatching to all subscribers
    const mutationObserver: MutationObserver = new MutationObserver(
        (records: MutationRecord[]): void => {
            // Capture and clear the origin for this batch
            const origin: OriginTag | null = currentOrigin;
            currentOrigin = null;

            // Notify subscribers; readonly array passed through
            for (let i = 0; i < observers.length; i++) {
                // NOTE: do not catch here; let errors surface in dev
                observers[i](records, origin);
            }
        }
    );

    // Start observing the whole subtree
    mutationObserver.observe(target, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
    });

    // safe UUID fallback for older environments
    function newOriginId(): string {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
        // Low-collision fallback; still unique enough as an origin tag
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    // All writes must go through this gate
    function write(fn: (origin: OriginTag) => void): void {
        const origin: OriginTag = { id: newOriginId() };
        currentOrigin = origin;

        try {
            fn(origin);
        } finally {
            // if no mutations occurred (observer won’t run), clear origin soon
            // This prevents a stale origin from leaking into later, unrelated mutations.
            queueMicrotask((): void => {
                if (currentOrigin === origin) {
                    currentOrigin = null;
                }
            });
        }
    }

    // Subscribe; returns an unsubscriber
    function observe(cb: GateObserver): () => void {
        observers.push(cb);
        let active: boolean = true;

        // return an idempotent unsubscriber
        return (): void => {
            if (!active) return;
            active = false;
            const idx: number = observers.indexOf(cb);
            if (idx >= 0) observers.splice(idx, 1);
        };
    }

    return { write, observe };
}
