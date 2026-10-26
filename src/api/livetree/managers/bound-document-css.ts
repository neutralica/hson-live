import type { LiveMapDocumentLibrary } from "../../../types/livemap.types.js";
import type { CssGlobalHandle, CssGlobalRuleHandle, CssRuleFacade, CssMap } from "../../../types/css.types.js";
import type { DocumentCssRuleFacade, DocumentCssRuleHandle, DocumentCssValue } from "../../../types/document-css.types.js";
import { make_style_setter } from "./style-setter.js";
import type { LiveTree } from "../livetree.js";
import {
  runtime_for_tree,
  type LiveTreeRuntime,
  active_subject_for_tree,
} from "../runtime/livetree-runtime.js";
import { document_binding_for_node } from "../lifecycle/document-binding-state.js";
import { is_runtime_infrastructure, mark_runtime_infrastructure, unmark_runtime_infrastructure } from "../../../internal/browser-realization/browser-realization-dom.js";
import { MANAGED_DOCUMENT_CSS_MARKER, write_managed_document_css } from "../../../internal/browser-realization/managed-document-css.js";
import { document_css_state_internal, observe_client_library_retirement_internal, observe_document_css_reconciliation_internal } from "../../livemap/livemap.libraries.js";
import { report_livemap_observer_failure } from "../../livemap/livemap.observer-delivery.js";
import { document_css_subject_identities } from "../../../internal/css/css-identity-translation.js";
import { encode_portable_document_stylesheet, render_portable_document_stylesheet_carriers } from "../../../internal/css/portable-document-stylesheet.js";

export type DocumentCssReusePreparation = Readonly<{ commit: () => void; rollback: () => void }>;
export type DocumentCssReuse = (document: LiveMapDocumentLibrary, root: Element, assertCurrent: () => void) => DocumentCssReusePreparation | undefined;

type Binding = {
  document: LiveMapDocumentLibrary;
  hosted: boolean;
  active: boolean;
  prepareReuse?: DocumentCssReuse;
};
const BINDINGS = new WeakMap<object, Binding>();
const RUNTIME_BINDINGS = new WeakMap<LiveTreeRuntime, Set<Binding>>();

export function runtime_has_document_css_binding(runtime: LiveTreeRuntime): boolean {
  return (RUNTIME_BINDINGS.get(runtime)?.size ?? 0) > 0;
}

export function bound_document_css_for_tree(tree: LiveTree): Binding | undefined {
  const owner = document_binding_for_node(active_subject_for_tree(tree))?.owner;
  return owner === undefined ? undefined : BINDINGS.get(owner);
}

/** Borrowed only by the exact retained-root owner, before its binding is released. @internal */
export function capture_document_css_reuse(tree: LiveTree): DocumentCssReuse | undefined {
  return bound_document_css_for_tree(tree)?.prepareReuse;
}

/** The selected Library is the sole semantic owner; carriers are only its realization. */
export function bind_document_css_tree(
  tree: LiveTree,
  document: LiveMapDocumentLibrary,
  initialStyles: readonly HTMLStyleElement[],
  hosted: boolean,
  currentTree: () => LiveTree = () => tree,
): () => void {
  const owner = document_binding_for_node(active_subject_for_tree(tree))?.owner;
  if (owner === undefined) throw new Error("Document CSS binding requires active Mirror correspondence.");
  if (BINDINGS.has(owner)) throw new Error("Mirror already has a document CSS binding.");
  const binding: Binding = { document, hosted, active: true };
  BINDINGS.set(owner, binding);
  const runtime = runtime_for_tree(tree);
  const runtimeBindings = RUNTIME_BINDINGS.get(runtime) ?? new Set<Binding>();
  runtimeBindings.add(binding);
  RUNTIME_BINDINGS.set(runtime, runtimeBindings);
  let styles = [...initialStyles];
  let releasedStyles: readonly HTMLStyleElement[] = [];
  styles.forEach(mark_runtime_infrastructure);
  // Previous demand is only a derived projection checkpoint, never identity authority.
  let subjects = new Set<string>();
  const projectSubject = (quid: string, required: boolean): void => {
    const node = runtime.quidToNode.get(quid);
    const registration = node === undefined ? undefined : document_binding_for_node(node);
    if (registration?.owner !== owner) {
      if (required) throw new Error("Document CSS subject has no active owning Mirror correspondence.");
      return; // Terminal subject retirement already scrubbed its native carrier.
    }
    if (registration.projectCssIdentity === undefined) throw new Error("Document CSS subject cannot project native identity.");
    registration.projectCssIdentity(required);
  };
  let lifecycle: "active" | "disposing" | "disposed" = "active";
  let pending = false, running = false, requested = false, queued = false;
  let pendingFailure: unknown;
  let offRetry = () => {};
  const reconcilePass = (): void => {
    const phase = lifecycle;
    const state = phase === "active" ? document_css_state_internal(document) : undefined;
    const next = state === undefined ? [] : render_portable_document_stylesheet_carriers(state);
    const demanded = new Set(state === undefined ? [] : document_css_subject_identities(encode_portable_document_stylesheet(state), "outbound"));
    const current = (): boolean => phase === lifecycle;
    // Add before switching styles; remove obsolete identity only after the old
    // stylesheet is gone. Every native call may synchronously request disposal.
    for (const quid of demanded) {
      if (!current()) return;
      subjects.add(quid); // A projection may throw after changing native attrs.
      projectSubject(quid, true);
    }
    const failures: unknown[] = [];
    const attempt = (mutate: () => void): void => {
      if (!current()) return; // Never reinstall live CSS after disposal begins.
      try { mutate(); } catch (cause) { failures.push(cause); }
    };
    let head: Element | undefined;
    if (next.length && current()) {
      const root = currentTree().dom.el();
      head = Array.from(root?.childNodes ?? []).find((node): node is Element =>
        node.nodeType === 1 && (node as Element).localName === "head");
      if (head === undefined) throw new Error("Document CSS realization lost its explicit head.");
      // Exact owned-node inventory includes detached and partly published nodes.
      while (styles.length < next.length && current()) {
        const style = head.ownerDocument.createElement("style");
        styles.push(style);
        mark_runtime_infrastructure(style);
      }
      const mount = head;
      const anchor = styles.find(style => style.parentNode === mount) ?? Array.from(mount.childNodes).find(is_runtime_infrastructure) ?? null;
      styles.slice(0, next.length).forEach((style, index) => {
        attempt(() => {
          if (style.getAttribute(MANAGED_DOCUMENT_CSS_MARKER) !== "managed") style.setAttribute(MANAGED_DOCUMENT_CSS_MARKER, "managed");
          if (current()) write_managed_document_css(style, next[index]!);
        });
        attempt(() => { if (style.parentNode !== mount) mount.insertBefore(style, anchor); });
      });
      for (let index = next.length - 2; index >= 0; index--) attempt(() => {
        const style = styles[index]!, following = styles[index + 1]!;
        if (style.nextSibling !== following) mount.insertBefore(style, following);
      });
    }
    // Attempt every removal despite failures. Disposal uses this same path with
    // an empty target, independently of canonical access or Mirror health.
    for (const style of styles.slice(next.length)) attempt(() => { if (style.parentNode) style.remove(); });
    const matches = (): boolean => styles.length >= next.length && styles.every((style, index) => index < next.length
      ? style.parentNode === head && style.textContent === next[index]
        && style.getAttribute(MANAGED_DOCUMENT_CSS_MARKER) === "managed"
        && (index + 1 === next.length || style.nextSibling === styles[index + 1])
      : !style.parentNode);
    if (current() && !matches()) failures.push(new Error("Owned CSS carriers do not match the accepted stylesheet."));
    if (failures.length) throw new AggregateError(failures, "Document CSS carrier reconciliation is incomplete.");
    if (!current()) return;
    for (const quid of subjects) if (!demanded.has(quid) && lifecycle === "active") projectSubject(quid, false);
    // Identity removal invokes custom-element reactions too. Consult authority
    // and verify native state AFTER the final mutation, before clearing demand.
    if (!current() || phase === "active" && state !== document_css_state_internal(document)) {
      requested = true;
      return;
    }
    if (!matches()) throw new Error("Owned CSS carriers changed during final identity cleanup.");
    if (requested) return;
    if (lifecycle === "disposing") {
      // Retain detached node identity for the existing root cache, not active
      // sheets or authority. Reuse must prepare a fresh, reversible placement.
      releasedStyles = styles;
      styles = [];
    } else styles.length = next.length;
    subjects = demanded;
    pending = false;
    pendingFailure = undefined;
    if (lifecycle === "disposing") {
      lifecycle = "disposed";
      offRetry();
    }
  };
  const reconcile = (): void => {
    if (lifecycle === "disposed") return;
    pending = true;
    if (running) { requested = true; return; }
    running = true;
    const failures: unknown[] = [];
    let passes = 0;
    try {
      do {
        const phase = lifecycle;
        requested = false;
        try { reconcilePass(); } catch (cause) { failures.push(cause); }
        passes++;
        if (!pending || !requested) break;
        // Bound reentrant authoring as well as native failures. Disposal is a
        // monotonic transition and gets its cleanup pass at this safe boundary.
        if (passes >= 2 && !(phase === "active" && lifecycle === "disposing")) break;
      } while (true);
      if (pending && !failures.length) failures.push(new Error("Document CSS reconciliation did not settle within its bounded passes."));
      if (failures.length) throw new AggregateError(failures, "Document CSS carrier reconciliation is incomplete.");
    } finally { running = false; }
  };
  const retry = (scheduleRetry: boolean): void => {
    try { reconcile(); }
    catch (cause) {
      if (pending) pendingFailure = cause;
      // One deferred retry per external boundary, never a self-scheduling loop.
      // Each pass derives its target anew; no native snapshot becomes authority.
      if (pending && scheduleRetry && !queued) {
        queued = true;
        queueMicrotask(() => {
          queued = false;
          if (!pending || lifecycle === "disposed") return;
          try { retry(false); }
          catch (failure) { report_livemap_observer_failure("document-css-reconciliation", failure); }
        });
      }
      throw cause;
    }
  };
  offRetry = observe_document_css_reconciliation_internal(document, () => { if (pending) retry(true); });
  const stop = document.commits.observe(() => { retry(true); });
  const deactivate = (): void => {
    binding.active = false;
    stop();
    runtimeBindings.delete(binding);
    if (BINDINGS.get(owner) === binding) BINDINGS.delete(owner);
  };
  const dispose = (): void => {
    if (lifecycle === "disposed") return;
    const failure = pendingFailure;
    if (lifecycle === "active") {
      lifecycle = "disposing";
      pending = requested = true;
      deactivate(); // Revoke before any native operation or custom-element reaction.
      offRetirement?.();
    }
    if (running) return; // The active pass owns the deferred cleanup obligation.
    retry(true);
    // Preserve caller visibility of an unresolved projection even if teardown
    // removed its carriers successfully. Cleanup success never restores authoring.
    if (failure !== undefined) throw failure;
  };
  const offRetirement = hosted ? observe_client_library_retirement_internal(document, dispose) : undefined;
  try { reconcile(); }
  catch (cause) {
    lifecycle = "disposed";
    offRetry();
    offRetirement?.();
    deactivate();
    throw cause;
  }
  binding.prepareReuse = (selected, root, assertCurrent) => {
    if (lifecycle !== "disposed") throw new Error("Previous document CSS disposal is incomplete.");
    if (selected !== document) return undefined;
    const state = document_css_state_internal(document), revision = document.rev;
    const next = render_portable_document_stylesheet_carriers(state);
    const current = (): void => {
      assertCurrent();
      if (document.rev !== revision || document_css_state_internal(document) !== state
        || currentTree().dom.el() !== root) throw new Error("Retained document CSS preparation is stale.");
    };
    current();
    // Already-present carriers still go through the ordinary exact admission.
    if (root.querySelector(`[${MANAGED_DOCUMENT_CSS_MARKER}]`) !== null || !next.length) return undefined;
    const head = Array.from(root.childNodes).find((node): node is Element =>
      node.nodeType === 1 && (node as Element).localName === "head");
    if (head === undefined) throw new Error("Retained document CSS lost its explicit head.");
    const prepared = next.map((text, index) => {
      const style = releasedStyles[index] ?? head.ownerDocument.createElement("style");
      if (style.parentNode !== null) throw new Error("Released document CSS carrier acquired another native owner.");
      return { style, text, before: style.textContent ?? "", marker: style.getAttribute(MANAGED_DOCUMENT_CSS_MARKER),
        infrastructure: is_runtime_infrastructure(style) };
    });
    let finished = false, rollingBack = false;
    const rollback = (): void => {
      if (finished) return;
      const failures: unknown[] = [];
      // The preparation owns these exact nodes until commit. Return them through
      // the same bounded cleanup/retry path as disposal, without reviving writes.
      if (!rollingBack) {
        rollingBack = true;
        styles = prepared.map(({ style }) => style);
        lifecycle = "disposing";
        pending = requested = true;
        offRetry = observe_document_css_reconciliation_internal(document, () => { if (pending) retry(true); });
      }
      try { retry(true); } catch (cause) { failures.push(cause); }
      for (const { style, before, marker, infrastructure } of prepared) {
        try { write_managed_document_css(style, before); } catch (cause) { failures.push(cause); }
        try {
          if (marker === null) style.removeAttribute(MANAGED_DOCUMENT_CSS_MARKER);
          else style.setAttribute(MANAGED_DOCUMENT_CSS_MARKER, marker);
          if (!infrastructure) unmark_runtime_infrastructure(style);
        } catch (cause) { failures.push(cause); }
      }
      if (failures.length) throw new AggregateError(failures, "Retained document CSS rollback failed.");
      finished = true;
    };
    try {
      const anchor = Array.from(head.childNodes).find(is_runtime_infrastructure) ?? null;
      for (const { style, text } of prepared) {
        current();
        style.setAttribute(MANAGED_DOCUMENT_CSS_MARKER, "managed");
        current();
        write_managed_document_css(style, text);
        current();
        mark_runtime_infrastructure(style);
        head.insertBefore(style, anchor);
        current();
      }
    } catch (cause) {
      try { rollback(); }
      catch (failure) { throw new AggregateError([cause, failure], "Retained document CSS preparation failed."); }
      throw cause;
    }
    return { commit: () => { finished = true; }, rollback };
  };
  return dispose;
}

function bound_rule(rule: DocumentCssRuleHandle, write: () => void): CssGlobalRuleHandle {
  const setter = make_style_setter<void>(undefined, {
    apply: (property, value) => { write(); rule.setProp(property, value); },
    remove: (property) => { write(); rule.remove(property); },
    clear: () => { write(); rule.clear(); },
  });
  return Object.freeze({ ...setter, ruleKey: rule.ruleKey, selector: rule.selector,
    setMany: (map: CssMap) => { write(); rule.setMany(map); },
    drop: () => { write(); rule.drop(); },
  });
}

/** Preserve LiveTree's fluent global call shapes while forwarding every read/write to LiveMap. */
export function bound_document_css_api(binding: Binding): CssGlobalHandle {
  const css = binding.document.css;
  const write = (): void => {
    if (!binding.active) throw new Error("Document CSS continuation binding has been disposed.");
    if (binding.hosted) throw new Error("Hosted document CSS authoring requires the async authority path.");
  };
  const vars = (source: DocumentCssRuleFacade["var"]) => Object.freeze({ ...source,
    set: (name: string, value: DocumentCssValue) => { write(); source.set(name, value); },
    remove: (name: string) => { write(); source.remove(name); },
    clear: () => { write(); source.clear(); },
  });
  const facade = (source: DocumentCssRuleFacade): CssRuleFacade => Object.freeze({
    rule: (key, selector) => bound_rule(source.rule(key, selector), write),
    sel: (selector) => bound_rule(source.sel(selector), write),
    var: vars(source.var),
    scope: (name, atRule) => facade(source.scope(name, atRule)),
    media: (query) => facade(source.media(query)),
    supports: (condition) => facade(source.supports(condition)),
    layer: (name) => facade(source.layer(name)),
  });
  const root = facade(css);
  return Object.freeze({ ...root,
    stylesheet: (text: string) => { write(); css.stylesheet(text); },
    var: vars(css.var),
    drop: (key: string) => { write(); css.drop(key); },
    clearAll: () => { write(); css.clearAll(); },
    has: css.has, list: css.list, get: css.get,
    atProperty: Object.freeze({ ...css.atProperty,
      register: (input: Parameters<typeof css.atProperty.register>[0]) => { write(); css.atProperty.register(input); },
      registerMany: (inputs: Parameters<typeof css.atProperty.registerMany>[0]) => { write(); css.atProperty.registerMany(inputs); },
      unregister: (name: Parameters<typeof css.atProperty.unregister>[0]) => { write(); css.atProperty.unregister(name); },
    }),
    keyframes: Object.freeze({ ...css.keyframes,
      set: (input: Parameters<typeof css.keyframes.set>[0]) => { write(); css.keyframes.set(input); },
      setMany: (inputs: Parameters<typeof css.keyframes.setMany>[0]) => { write(); css.keyframes.setMany(inputs); },
      delete: (name: string) => { write(); css.keyframes.delete(name); },
    }),
  });
}
