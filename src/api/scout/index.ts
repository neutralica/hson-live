import type { HostedDocumentContinuation } from "../continuation/continuation.types.js";
import type { HostedContinuationOptions } from "../continuation/continue-hosted-document.lazy.js";

/** Application-owned material for one hosted browser continuation. */
export type ScoutProvider = () => HostedContinuationOptions | Promise<HostedContinuationOptions>;

type ScoutClaim = {
  document: Document | undefined;
  owner: HTMLElement | undefined;
  phase: "waiting" | "running" | "starting" | "cancelled";
};

type ScoutRecord = ScoutClaim | Readonly<{ phase: "consumed" | "failed" | "redundant" }>;

const records = new WeakMap<Document, ScoutRecord>();
const waiting = new Set<ScoutClaim>();
let provider: ScoutProvider | undefined;
let activeClaim: ScoutClaim | undefined;
let resolveResult: ((continuation: HostedDocumentContinuation) => void) | undefined;
let rejectResult: ((cause: unknown) => void) | undefined;

/** Supply options once and receive the ordinary continuation after Scout finishes. */
export function configure_scout(configuration: ScoutProvider): Promise<HostedDocumentContinuation> {
  if (typeof configuration !== "function") throw new TypeError("Scout configuration must be a provider function.");
  if (provider !== undefined) throw new Error("Scout has already been configured in this browser runtime.");
  const result = new Promise<HostedDocumentContinuation>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  provider = configuration;
  wakeWaiting();
  return result;
}

function validate_declaration(element: HTMLElement): void {
  const hidden = element.getAttribute("hidden");
  if (element.attributes.length !== 1 || hidden === null
    || (hidden !== "" && hidden.toLowerCase() !== "hidden")
    || element.childNodes.length !== 0) {
    throw new Error("Scout requires an empty <hson-scout hidden></hson-scout> declaration.");
  }
}

function current(claim: ScoutClaim): boolean {
  const doc = claim.document;
  const owner = claim.owner;
  return doc !== undefined && owner !== undefined && owner.isConnected
    && owner.ownerDocument === doc && records.get(doc) === claim
    && (claim.phase === "waiting" || claim.phase === "running");
}

function cancel(claim: ScoutClaim): void {
  const doc = claim.document;
  if (doc !== undefined && records.get(doc) === claim) records.delete(doc);
  waiting.delete(claim);
  const wasActive = activeClaim === claim;
  if (wasActive) activeClaim = undefined;
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
  records.set(doc, { phase });
  waiting.delete(claim);
  if (activeClaim === claim) activeClaim = undefined;
  claim.phase = "cancelled";
  claim.owner = undefined;
  claim.document = undefined;
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
  waiting.delete(claim);
  activeClaim = claim;
  claim.phase = "running";
  // The application-facing result is the only rejected Promise. Consume the internal task.
  void run(claim, provider).catch((cause: unknown) => {
    if (claim.phase === "starting" || current(claim)) fail(claim, cause);
  });
}

async function run(claim: ScoutClaim, configured: ScoutProvider): Promise<void> {
  // Do not keep an element or Document local across provider/module-import awaits.
  if (claim.owner !== undefined) validate_declaration(claim.owner);
  const options = await configured();
  if (!current(claim)) return;
  if (options.root.ownerDocument !== claim.document) {
    throw new Error("Scout continuation root belongs to a different document.");
  }
  const continuation = await import("../continuation/continue-hosted-document.js");
  if (!current(claim)) return;
  let prepared: ReturnType<typeof continuation.prepare_hosted_document_internal>;
  try {
    prepared = continuation.prepare_hosted_document_internal(options);
  } catch (cause) {
    const common = await import("../continuation/continuation.common.js");
    if (!current(claim)) return;
    if (cause instanceof common.ContinuationRootReservedError
      && common.continuation_root_is_active(options.root)) {
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
  claim.phase = "starting";
  try {
    scout.remove();
    if (scout.isConnected) throw new Error("Scout could not leave the document before adoption.");
  } catch (cause) {
    try { prepared.dispose(); } catch { /* Preserve handoff failure. */ }
    throw cause;
  }
  claim.owner = undefined;
  // The controller now owns prepared resources. Scout left before start's first DOM adoption.
  const result = await prepared.start();
  succeed(claim, result);
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
      if (provider !== undefined && resolveResult === undefined) {
        this.remove();
        return;
      }
      const claim: ScoutClaim = { document: doc, owner: this, phase: "waiting" };
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
