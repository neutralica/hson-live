import type { LiveMapDocumentLibrary } from "../../../types/livemap.types.js";
import type { CssGlobalHandle, CssGlobalRuleHandle, CssRuleFacade, CssMap } from "../../../types/css.types.js";
import type { DocumentCssRuleFacade, DocumentCssRuleHandle, DocumentCssMap, DocumentCssValue } from "../../../types/document-css.types.js";
import { make_style_setter } from "./style-setter.js";
import { is_css_declaration_value } from "../../../core/inline-style.js";
import type { LiveTree } from "../livetree.js";
import {
  runtime_for_tree,
  type LiveTreeRuntime,
  active_subject_for_tree,
} from "../runtime/livetree-runtime.js";
import { document_binding_for_node } from "../lifecycle/document-binding-state.js";
import { is_runtime_infrastructure, mark_runtime_infrastructure } from "../../../internal/browser-realization/browser-realization-dom.js";
import { MANAGED_DOCUMENT_CSS_MARKER, write_managed_document_css } from "../../../internal/browser-realization/managed-document-css.js";
import { document_css_state_internal, observe_client_library_retirement_internal } from "../../livemap/livemap.libraries.js";
import { document_css_subject_identities } from "../../../internal/css/css-identity-translation.js";
import { encode_portable_document_stylesheet } from "../../../internal/css/portable-document-stylesheet.js";

type Binding = {
  document: LiveMapDocumentLibrary;
  hosted: boolean;
  active: boolean;
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

/** The selected Library is the sole semantic owner; the parsed style is only its realization. */
export function bind_document_css_tree(
  tree: LiveTree,
  document: LiveMapDocumentLibrary,
  style: HTMLStyleElement | undefined,
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
  if (style !== undefined) mark_runtime_infrastructure(style);
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
  const sync = (): void => {
    if (BINDINGS.get(owner) !== binding) return;
    const next = document.css.snapshot();
    const demanded = new Set(document_css_subject_identities(encode_portable_document_stylesheet(document_css_state_internal(document)), "outbound"));
    // Add before switching styles; remove obsolete carriers only after the old
    // stylesheet is gone. Synchronous style observation sees coherent selectors.
    for (const quid of demanded) if (!subjects.has(quid)) projectSubject(quid, true);
    if (!next) {
      if (style !== undefined) {
        style.remove();
        style = undefined;
      }
      for (const quid of subjects) if (!demanded.has(quid)) projectSubject(quid, false);
      subjects = demanded;
      return;
    }
    {
      const root = currentTree().dom.el();
      const head = Array.from(root?.childNodes ?? []).find((node): node is Element =>
        node.nodeType === 1 && (node as Element).localName === "head");
      if (head === undefined) throw new Error("Document CSS realization lost its explicit head.");
      const needsPlacement = style === undefined || style.parentNode !== head;
      style ??= head.ownerDocument.createElement("style");
      if (style.getAttribute(MANAGED_DOCUMENT_CSS_MARKER) !== "managed") style.setAttribute(MANAGED_DOCUMENT_CSS_MARKER, "managed");
      write_managed_document_css(style, next);
      if (needsPlacement) {
        const runtimeHost = Array.from(head.childNodes).find(is_runtime_infrastructure);
        head.insertBefore(style, runtimeHost ?? null);
      }
      mark_runtime_infrastructure(style);
    }
    for (const quid of subjects) if (!demanded.has(quid)) projectSubject(quid, false);
    subjects = demanded;
  };
  const stop = document.commits.observe(sync);
  const offRetirement = hosted ? observe_client_library_retirement_internal(document, () => {
    style?.remove();
    style = undefined;
    stop();
    binding.active = false;
    runtimeBindings.delete(binding);
    if (BINDINGS.get(owner) === binding) BINDINGS.delete(owner);
  }) : undefined;
  try { sync(); }
  catch (cause) {
    stop();
    offRetirement?.();
    binding.active = false;
    runtimeBindings.delete(binding);
    if (BINDINGS.get(owner) === binding) BINDINGS.delete(owner);
    throw cause;
  }
  return (): void => {
    stop();
    offRetirement?.();
    binding.active = false;
    runtimeBindings.delete(binding);
    if (BINDINGS.get(owner) === binding) BINDINGS.delete(owner);
  };
}

function bound_rule(rule: DocumentCssRuleHandle, write: () => void): CssGlobalRuleHandle {
  const setter = make_style_setter<void>(undefined, {
    apply: (property, value) => { write(); rule.setProp(property, value); },
    remove: (property) => { write(); rule.remove(property); },
    clear: () => { write(); rule.clear(); },
  });
  return Object.freeze({ ...setter, ruleKey: rule.ruleKey, selector: rule.selector,
    setMany: (map: CssMap) => {
      write();
      const declarations: Record<string, DocumentCssValue | Readonly<Record<string, DocumentCssValue>>> = {};
      for (const [key, value] of Object.entries(map)) {
        if (is_css_declaration_value(value)) {
          declarations[key] = value;
          continue;
        }
        if (value === undefined || typeof value !== "object" || value === null) {
          throw new TypeError("Invalid CSS declaration value.");
        }
        const nested: Record<string, DocumentCssValue> = {};
        for (const [property, inner] of Object.entries(value)) {
          if (!is_css_declaration_value(inner)) throw new TypeError("Invalid nested CSS declaration value.");
          nested[property] = inner;
        }
        declarations[key] = nested;
      }
      rule.setMany(declarations);
    },
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
