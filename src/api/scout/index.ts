import type { HostedDocumentContinuation } from "../continuation/continuation.types.js";
import type { HostedContinuationOptions } from "../continuation/continue-hosted-document.lazy.js";

/** Application-owned material for one hosted browser continuation. */
export type ScoutProvider = () => HostedContinuationOptions | Promise<HostedContinuationOptions>;

type ScoutRecord = {
  owner: HTMLElement | undefined;
  status: "waiting" | "running" | "starting" | "started" | "failed" | "redundant";
  task?: Promise<void>;
  continuation?: HostedDocumentContinuation;
};

const records = new WeakMap<Document, ScoutRecord>();
const waiting = new Set<ScoutRecord>();
let provider: ScoutProvider | undefined;

/** Supply the ordinary hosted-continuation options when Scout is present. */
export function configure_scout(configuration: ScoutProvider): void {
  if (typeof configuration !== "function") throw new TypeError("Scout configuration must be a provider function.");
  if (provider !== undefined) throw new Error("Scout has already been configured in this browser runtime.");
  provider = configuration;
  for (const record of waiting) ignite(record);
}

function report_failure(cause: unknown): void {
  // Native global error reporting keeps the failure visible without giving Scout UI or telemetry duties.
  queueMicrotask(() => { throw cause; });
}

function validate_declaration(element: HTMLElement): void {
  const hidden = element.getAttribute("hidden");
  if (element.attributes.length !== 1 || hidden === null
    || (hidden !== "" && hidden.toLowerCase() !== "hidden")
    || element.childNodes.length !== 0) {
    throw new Error("Scout requires an empty <hson-scout hidden></hson-scout> declaration.");
  }
}

function ignite(record: ScoutRecord): void {
  if (record.status !== "waiting" || provider === undefined || !record.owner?.isConnected) return;
  waiting.delete(record);
  record.status = "running";
  record.task = run(record, provider).catch(report_failure);
}

async function run(record: ScoutRecord, configured: ScoutProvider): Promise<void> {
  const scout = record.owner;
  if (scout === undefined) return;
  try {
    validate_declaration(scout);
    const options = await configured();
    if (!scout.isConnected) throw new Error("Scout disconnected before continuation handoff.");
    if (options.root.ownerDocument !== scout.ownerDocument) {
      throw new Error("Scout continuation root belongs to a different document.");
    }
    const continuation = await import("../continuation/continue-hosted-document.js");
    if (!scout.isConnected) throw new Error("Scout disconnected before continuation preparation.");
    let prepared: ReturnType<typeof continuation.prepare_hosted_document_internal>;
    try {
      prepared = continuation.prepare_hosted_document_internal(options);
    } catch (cause) {
      const common = await import("../continuation/continuation.common.js");
      if (cause instanceof common.ContinuationRootReservedError
        && common.continuation_root_is_active(options.root)) {
        scout.remove();
        record.owner = undefined;
        record.status = "redundant";
        return;
      }
      throw cause;
    }
    // The controller now owns prepared resources. Scout leaves before start's first DOM adoption.
    record.status = "starting";
    try {
      if (!scout.isConnected) throw new Error("Scout disconnected before continuation handoff.");
      scout.remove();
      if (scout.isConnected) throw new Error("Scout could not leave the document before adoption.");
    } catch (cause) {
      try { prepared.dispose(); } catch { /* Preserve handoff failure. */ }
      throw cause;
    }
    record.owner = undefined;
    try {
      record.continuation = await prepared.start();
      record.status = "started";
    } catch (cause) {
      record.status = "failed";
      throw cause;
    }
  } catch (cause) {
    record.status = "failed";
    throw cause;
  }
}

if (typeof HTMLElement !== "undefined" && typeof customElements !== "undefined") {
  class ScoutElement extends HTMLElement {
    connectedCallback(): void {
      if (!this.isConnected) return;
      const doc = this.ownerDocument;
      const existing = records.get(doc);
      if (existing !== undefined) {
        if (existing.owner !== this) this.remove();
        return;
      }
      const record: ScoutRecord = { owner: this, status: "waiting" };
      records.set(doc, record);
      waiting.add(record);
      ignite(record);
    }
  }

  if (customElements.get("hson-scout") !== undefined) {
    throw new Error("An incompatible hson-scout custom element is already registered.");
  }
  customElements.define("hson-scout", ScoutElement);
}
