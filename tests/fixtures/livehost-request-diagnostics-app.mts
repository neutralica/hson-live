import { hsonLiveHost } from "hson-live/livehost";
import { setTimeout as delay } from "node:timers/promises";

export function application() {
  const app = hsonLiveHost.create({ name: "request-diagnostics" });
  app.GET("/ok", () => new Response("ok"));
  app.GET("/sync", () => { throw Error("diagnostic-sync-private"); });
  app.GET("/async", async () => { await Promise.resolve(); throw Error("diagnostic-async-private"); });
  app.GET("/abort-before", () => { throw new DOMException("diagnostic-abort-before-private", "AbortError"); });
  app.GET("/stream", () => {
    let next = false;
    return new Response(new ReadableStream<Uint8Array>({ async pull(controller) {
      if (next) { await new Promise(resolve => setTimeout(resolve, 20)); throw Error("diagnostic-stream-private"); }
      next = true; controller.enqueue(new TextEncoder().encode("partial"));
    } }));
  });
  app.GET("/complete", () => {
    let next = false;
    return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      controller.enqueue(new TextEncoder().encode(next ? "two" : "one"));
      if (next) controller.close(); next = true;
    } }));
  });
  for (const kind of ["abort", "node-abort", "foreign-abort", "foreign-node-abort", "disconnect"]) app.GET(`/${kind}`, async request => {
    await new Promise<void>(resolve => {
      if (request.signal.aborted) resolve();
      else request.signal.addEventListener("abort", () => resolve(), { once: true });
      process.send?.({ type: "diagnostic-route-entered" });
    });
    try {
      if (kind === "abort") request.signal.throwIfAborted();
      if (kind === "node-abort" || kind === "foreign-node-abort") {
        // Node wraps the reason in AbortError.cause; another signal is unrelated.
        await delay(0, undefined, { signal: kind === "node-abort" ? request.signal : AbortSignal.abort() });
      }
      if (kind === "foreign-abort") throw new DOMException("diagnostic-foreign-abort-private", "AbortError");
      throw Error("diagnostic-disconnect-private");
    } finally { process.send?.({ type: "diagnostic-route-finished" }); }
  });
  return app;
}
