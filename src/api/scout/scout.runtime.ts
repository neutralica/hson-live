import type { HostedDocumentContinuation } from "../continuation/continuation.types.js";
import type { HostedContinuationOptions } from "../continuation/continue-hosted-document.lazy.js";

/** Application-owned options; payload is unchanged opaque transport text, or undefined for an empty Scout. */
export type ScoutProvider = (payload?: string) => HostedContinuationOptions | Promise<HostedContinuationOptions>;

/** @internal Resources owned by one Scout attempt. */
export type ScoutProvision = Readonly<{
  options: HostedContinuationOptions;
  handoff?: () => void;
  accept?: (continuation: HostedDocumentContinuation) => void;
  dispose?: () => void;
}>;
type Provider = (payload: string | undefined, document: Document, signal: AbortSignal) => ScoutProvision | Promise<ScoutProvision>;

type ScoutClaim = {
  abort: AbortController;
  pagehide: () => void;
  document: Document | undefined;
  owner: HTMLElement | undefined;
  phase: "waiting" | "running" | "starting" | "cancelled";
};

type ScoutRecord = ScoutClaim | Readonly<{ phase: "consumed" | "failed" | "redundant" }>;

const records = new WeakMap<Document, ScoutRecord>();
const waiting = new Set<ScoutClaim>();
let provider: Provider | undefined;
let mode: "standard" | "advanced" | undefined;
let activeClaim: ScoutClaim | undefined;
let resolveResult: ((continuation: HostedDocumentContinuation) => void) | undefined;
let rejectResult: ((cause: unknown) => void) | undefined;

/** @internal The single deferred dependency for both deployment modes. */
export function load_scout_hosted_internal() {
  return import("./scout-hosted.js");
}

/** Supply options once and receive the ordinary continuation after Scout finishes. */
export function configure_scout(configuration: ScoutProvider): Promise<HostedDocumentContinuation> {
  if (typeof configuration !== "function") throw new TypeError("Scout configuration must be a provider function.");
  return configure_scout_internal("advanced", async (payload) => ({ options: await configuration(payload) }));
}

/** @internal One explicit owner for both deployment modes. */
export function configure_scout_internal(selected: "standard" | "advanced", configuration: Provider): Promise<HostedDocumentContinuation> {
  if (mode !== undefined) throw new Error(`Scout already has a ${mode} owner; deployment modes cannot be mixed.`);
  mode = selected;
  const result = new Promise<HostedDocumentContinuation>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  provider = configuration;
  wakeWaiting();
  return result;
}

function validate_declaration(element: HTMLElement): string | undefined {
  const hidden = element.getAttribute("hidden");
  const payload = element.textContent ?? "";
  // Validate transport characters only: no markup, character references, or whitespace.
  if (element.attributes.length !== 1 || hidden === null
    || (hidden !== "" && hidden.toLowerCase() !== "hidden")
    || Array.from(element.childNodes).some((child) => child.nodeType !== 3)
    || /[^A-Za-z0-9_=-]/.test(payload)) {
    throw new Error("Scout requires <hson-scout hidden> with optional text using only A-Z, a-z, 0-9, _, -, and =.");
  }
  return payload === "" ? undefined : payload;
}

function current(claim: ScoutClaim): boolean {
  const doc = claim.document;
  const owner = claim.owner;
  return doc !== undefined && owner !== undefined && owner.isConnected
    && owner.ownerDocument === doc && records.get(doc) === claim
    && (claim.phase === "waiting" || claim.phase === "running");
}

function release_listeners(claim: ScoutClaim): void {
  claim.document?.removeEventListener("DOMContentLoaded", wakeWaiting);
  claim.document?.defaultView?.removeEventListener("pagehide", claim.pagehide);
}

function cancel(claim: ScoutClaim): void {
  const doc = claim.document;
  release_listeners(claim);
  if (doc !== undefined && records.get(doc) === claim) records.delete(doc);
  waiting.delete(claim);
  const wasActive = activeClaim === claim;
  if (wasActive) activeClaim = undefined;
  claim.abort.abort();
  claim.phase = "cancelled";
  claim.owner = undefined;
  claim.document = undefined;
  if (wasActive) wakeWaiting();
}

function retireWaiting(): void {
  for (const claim of waiting) {
    const owner = claim.owner;
    cancel(claim);
    owner?.remove();
  }
}

function settle(claim: ScoutClaim, phase: "consumed" | "failed" | "redundant"): boolean {
  const doc = claim.document;
  if (doc === undefined || records.get(doc) !== claim) return false;
  release_listeners(claim);
  records.set(doc, { phase });
  waiting.delete(claim);
  if (activeClaim === claim) activeClaim = undefined;
  claim.phase = "cancelled";
  claim.owner = undefined;
  claim.document = undefined;
  provider = undefined;
  retireWaiting();
  return true;
}

function succeed(claim: ScoutClaim, continuation: HostedDocumentContinuation): void {
  if (!settle(claim, "consumed")) return;
  const resolve = resolveResult;
  resolveResult = undefined;
  rejectResult = undefined;
  resolve?.(continuation);
}

function fail(claim: ScoutClaim, cause: unknown, phase: "failed" | "redundant" = "failed"): void {
  if (!settle(claim, phase)) return;
  const reject = rejectResult;
  resolveResult = undefined;
  rejectResult = undefined;
  reject?.(cause);
}

function wakeWaiting(): void {
  if (provider === undefined || resolveResult === undefined || activeClaim !== undefined) return;
  for (const claim of waiting) {
    if (current(claim)) {
      ignite(claim);
      return;
    }
  }
}

function ignite(claim: ScoutClaim): void {
  if (claim.phase !== "waiting" || provider === undefined || resolveResult === undefined
    || activeClaim !== undefined || !current(claim)) return;
  // A parser-created element can connect before its text arrives. Defer/module
  // startup already runs after parsing; early registration waits for that boundary.
  if (claim.document?.readyState === "loading") {
    claim.document.addEventListener("DOMContentLoaded", wakeWaiting, { once: true });
    return;
  }
  claim.document?.removeEventListener("DOMContentLoaded", wakeWaiting);
  waiting.delete(claim);
  activeClaim = claim;
  claim.phase = "running";
  // The application-facing result is the only rejected Promise. Consume the internal task.
  void run(claim, provider).catch((cause: unknown) => {
    if (claim.phase === "starting" || current(claim)) fail(claim, cause);
  });
}

async function run(claim: ScoutClaim, configured: Provider): Promise<void> {
  // Do not keep an element or Document local across provider/module-import awaits.
  const payload = claim.owner === undefined ? undefined : validate_declaration(claim.owner);
  const provision = await configured(payload, claim.document!, claim.abort.signal);
  let accepted = false;
  try {
    const options = provision.options;
    if (!current(claim)) return;
    if (options.root.ownerDocument !== claim.document) {
      throw new Error("Scout continuation root belongs to a different document.");
    }
    const continuation = await load_scout_hosted_internal();
    if (!current(claim)) return;
    let prepared: ReturnType<typeof continuation.prepare_hosted_document_internal>;
    try {
      prepared = continuation.prepare_hosted_document_internal(options);
    } catch (cause) {
      if (cause instanceof continuation.ContinuationRootReservedError
        && continuation.continuation_root_is_active(options.root)) {
        claim.owner?.remove();
        fail(claim, cause, "redundant");
        return;
      }
      throw cause;
    }
    if (!current(claim)) {
      prepared.dispose();
      return;
    }
    const scout = claim.owner;
    if (scout === undefined) {
      prepared.dispose();
      return;
    }
    release_listeners(claim);
    claim.phase = "starting";
    try {
      scout.remove();
      if (scout.isConnected) throw new Error("Scout could not leave the document before adoption.");
    } catch (cause) {
      try { prepared.dispose(); } catch { /* Preserve handoff failure. */ }
      throw cause;
    }
    claim.owner = undefined;
    try { provision.handoff?.(); } catch (cause) { prepared.dispose(); throw cause; }
    // The controller now owns prepared resources. Scout left before start's first DOM adoption.
    const result = await prepared.start();
    provision.accept?.(result);
    accepted = true;
    succeed(claim, result);
  } finally {
    if (!accepted) provision.dispose?.();
  }
}

if (typeof HTMLElement !== "undefined" && typeof customElements !== "undefined") {
  class ScoutElement extends HTMLElement {
    private claim: ScoutClaim | undefined;
    private everClaimed = false;
    private movedInert = false;

    connectedCallback(): void {
      if (!this.isConnected || this.movedInert) return;
      const doc = this.ownerDocument;
      if (this.claim !== undefined && this.claim.document !== undefined
        && this.claim.document !== doc) {
        this.movedInert = true;
        cancel(this.claim);
        return;
      }
      if (this.claim !== undefined && records.get(doc) === this.claim) return;
      const existing = records.get(doc);
      if (existing !== undefined && "owner" in existing && existing.phase !== "starting"
        && !existing.owner?.isConnected) cancel(existing);
      if (records.has(doc)) {
        this.remove();
        return;
      }
      if (mode !== undefined && resolveResult === undefined) {
        this.remove();
        return;
      }
      const claim: ScoutClaim = { document: doc, owner: this, phase: "waiting", abort: new AbortController(),
        pagehide: () => cancel(claim) };
      // Native import cannot be aborted; invalidate its claim before it can provision resources.
      doc.defaultView?.addEventListener("pagehide", claim.pagehide, { once: true });
      this.claim = claim;
      this.everClaimed = true;
      records.set(doc, claim);
      waiting.add(claim);
      wakeWaiting();
    }

    disconnectedCallback(): void {
      const claim = this.claim;
      if (claim === undefined || claim.phase === "starting") return;
      queueMicrotask(() => {
        if (this.claim !== claim || claim.phase === "cancelled" || claim.phase === "starting") return;
        if (this.isConnected && this.ownerDocument === claim.document) return;
        if (this.ownerDocument !== claim.document) this.movedInert = true;
        cancel(claim);
      });
    }

    adoptedCallback(): void {
      if (!this.everClaimed) return;
      this.movedInert = true;
      if (this.claim !== undefined && this.claim.phase !== "starting") cancel(this.claim);
    }
  }

  if (customElements.get("hson-scout") !== undefined) {
    throw new Error("An incompatible hson-scout custom element is already registered.");
  }
  customElements.define("hson-scout", ScoutElement);
}
