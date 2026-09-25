import type { LiveMapDocumentLibrary } from "../../../types/livemap.types.js";
import type { CssGlobalHandle, CssGlobalRuleHandle, CssRuleFacade, CssMap } from "../../../types/css.types.js";
import type { DocumentCssRuleFacade, DocumentCssRuleHandle, DocumentCssMap, DocumentCssValue } from "../../../types/document-css.types.js";
import { make_style_setter } from "./style-setter.js";
import { is_css_declaration_value } from "../../../core/inline-style.js";
import type { LiveTree } from "../livetree.js";
import { runtime_for_tree, type LiveTreeRuntime } from "../runtime/livetree-runtime.js";
import { document_binding_for_node } from "../lifecycle/document-binding-state.js";
import { is_runtime_infrastructure, mark_runtime_infrastructure } from "../../../internal/browser-realization/browser-realization-dom.js";
import { MANAGED_DOCUMENT_CSS_MARKER } from "../../../internal/browser-realization/managed-document-css.js";
import { observe_client_library_retirement_internal } from "../../livemap/livemap.libraries.js";

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
  const owner = document_binding_for_node(tree.node)?.owner;
  return owner === undefined ? undefined : BINDINGS.get(owner);
}

/** The selected Library is the sole semantic owner; the parsed style is only its realization. */
export function bind_document_css_tree(
  tree: LiveTree,
  document: LiveMapDocumentLibrary,
  style: HTMLStyleElement | undefined,
  hosted: boolean,
): () => void {
  const owner = document_binding_for_node(tree.node)?.owner;
  if (owner === undefined) throw new Error("Document CSS binding requires active Mirror correspondence.");
  if (BINDINGS.has(owner)) throw new Error("Mirror already has a document CSS binding.");
  const binding: Binding = { document, hosted, active: true };
  BINDINGS.set(owner, binding);
  const runtime = runtime_for_tree(tree);
  const runtimeBindings = RUNTIME_BINDINGS.get(runtime) ?? new Set<Binding>();
  runtimeBindings.add(binding);
  RUNTIME_BINDINGS.set(runtime, runtimeBindings);
  if (style !== undefined) mark_runtime_infrastructure(style);
  const sync = (): void => {
    if (BINDINGS.get(owner) !== binding) return;
    const next = document.css.snapshot();
    if (!next) {
      if (style !== undefined) {
        style.remove();
        style = undefined;
      }
      return;
    }
    if (style === undefined) {
      const root = tree.dom.el();
      const head = Array.from(root?.childNodes ?? []).find((node): node is Element =>
        node.nodeType === 1 && (node as Element).localName === "head");
      if (head === undefined) throw new Error("Document CSS realization lost its explicit head.");
      style = head.ownerDocument.createElement("style");
      style.setAttribute(MANAGED_DOCUMENT_CSS_MARKER, "v1");
      style.textContent = next;
      const runtimeHost = Array.from(head.childNodes).find(is_runtime_infrastructure);
      head.insertBefore(style, runtimeHost ?? null);
      mark_runtime_infrastructure(style);
      return;
    }
    if (style.textContent !== next) style.textContent = next;
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
