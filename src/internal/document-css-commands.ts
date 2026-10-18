import { managed_css_rule_key, trim_managed_css } from "./css/managed-css-lexical.js";
import type { DocumentCssCommands, DocumentCssRuleCommands, DocumentCssRead, DocumentCssHandle, DocumentCssValue } from "../types/document-css.types.js";
import type { LiveMapCssOp } from "../types/livemap.types.js";
import { clone_node } from "../core/clone-node.js";
import { make_livemap_document_css } from "../api/livemap/livemap.css.js";
import { empty_portable_document_stylesheet, type PortableDocumentStylesheet } from "./css/portable-document-stylesheet.js";

/** A closed, internal authoring call, interpreted by the existing CSS facade at admission. */
export type DocumentCssCommand = Readonly<{
  route: readonly Readonly<{ method: "scope" | "media" | "supports" | "layer" | "rule" | "sel"; args: readonly unknown[] }>[];
  namespace?: "var" | "atProperty" | "keyframes" | "set";
  method: "stylesheet" | "drop" | "clearAll" | "set" | "remove" | "clear" | "setProp" | "setMany" | "register" | "registerMany" | "unregister" | "delete" | "var";
  args: readonly unknown[];
}>;

export function dispatch_document_css_command(css: DocumentCssHandle | DocumentCssCommands<unknown>, command: DocumentCssCommand): void {
  let receiver: object = css;
  for (const step of command.route) receiver = Reflect.apply(Reflect.get(receiver, step.method), receiver, step.args);
  if (command.namespace !== undefined) receiver = Reflect.get(receiver, command.namespace);
  Reflect.apply(Reflect.get(receiver, command.method), receiver, command.args);
}

/** Capture arguments now; validate with the same authoring normalization as local CSS. */
export function capture_document_css_command(command: DocumentCssCommand): DocumentCssCommand {
  const captured = clone_node(command);
  dispatch_document_css_command(make_livemap_document_css(empty_portable_document_stylesheet, () => {}), captured);
  return captured;
}

export function lower_document_css_command(current: PortableDocumentStylesheet, command: DocumentCssCommand): LiveMapCssOp | undefined {
  const operations: LiveMapCssOp[] = [];
  dispatch_document_css_command(make_livemap_document_css(() => current, operation => operations.push(operation)), command);
  if (operations.length > 1) throw new Error("A CSS authoring command must publish one semantic operation.");
  return operations[0];
}

/** Command-only facades retain no mutable graph or stylesheet. */
export function document_css_commands<TResult>(send: (command: DocumentCssCommand) => TResult, assertCurrent: () => void = () => {}): DocumentCssCommands<TResult> {
  const command = (route: DocumentCssCommand["route"], method: DocumentCssCommand["method"], args: readonly unknown[], namespace?: DocumentCssCommand["namespace"]) =>
    send({ route, method, args, ...(namespace === undefined ? {} : { namespace }) });
  const vars: DocumentCssCommands<TResult>["var"] = Object.freeze({
    set: (...args) => command([], "set", args, "var"), remove: (...args) => command([], "remove", args, "var"),
    clear: () => command([], "clear", [], "var"),
  });
  const scoped = (input: DocumentCssCommand["route"]): DocumentCssRuleCommands<TResult> => {
    assertCurrent();
    const route = clone_node(input);
    const rule = (method: "rule" | "sel", args: readonly unknown[]): ReturnType<DocumentCssRuleCommands<TResult>["rule"]> => {
      assertCurrent();
      const selected = clone_node([...route, { method, args }]);
      const rawSelector = args[method === "rule" ? 1 : 0], rawKey = args[0];
      if (typeof rawSelector !== "string" || typeof rawKey !== "string") throw new TypeError("Document CSS keys and selectors must be strings.");
      const selector = trim_managed_css(rawSelector);
      const ruleKey = method === "rule" ? managed_css_rule_key(rawKey) : `sel:${selector}`;
      if (!ruleKey || !selector || ruleKey.startsWith("stylesheet:")) throw new TypeError("Invalid document CSS rule key or selector.");
      const setProp = (...args: [string, DocumentCssValue]) => command(selected, "setProp", args);
      return Object.freeze({
        ruleKey, selector,
        set: new Proxy({} as ReturnType<DocumentCssRuleCommands<TResult>["rule"]>["set"], { get: (_target, key) => key === "var"
          ? (name: string, value: DocumentCssValue) => command(selected, "var", [name, value], "set")
          : typeof key === "string" ? (value: DocumentCssValue) => setProp(key, value) : undefined }),
        setProp, setMany: (...args) => command(selected, "setMany", args),
        remove: (...args) => command(selected, "remove", args), clear: () => command(selected, "clear", []), drop: () => command(selected, "drop", []),
      });
    };
    return Object.freeze({
      rule: (...args) => rule("rule", args), sel: (...args) => rule("sel", args), var: vars,
      scope: (...args) => scoped([...route, { method: "scope", args }]),
      media: (...args) => scoped([...route, { method: "media", args }]),
      supports: (...args) => scoped([...route, { method: "supports", args }]),
      layer: (...args) => scoped([...route, { method: "layer", args }]),
    });
  };
  return Object.freeze({ ...scoped([]),
    stylesheet: (...args) => command([], "stylesheet", args), drop: (...args) => command([], "drop", args), clearAll: () => command([], "clearAll", []),
    atProperty: Object.freeze<DocumentCssCommands<TResult>["atProperty"]>({ register: (...args) => command([], "register", args, "atProperty"),
      registerMany: (...args) => command([], "registerMany", args, "atProperty"), unregister: (...args) => command([], "unregister", args, "atProperty") }),
    keyframes: Object.freeze<DocumentCssCommands<TResult>["keyframes"]>({ set: (...args) => command([], "set", args, "keyframes"),
      setMany: (...args) => command([], "setMany", args, "keyframes"), delete: (...args) => command([], "delete", args, "keyframes") }),
  });
}

export function document_css_reads(css: DocumentCssHandle): DocumentCssRead {
  return Object.freeze({ snapshot: () => css.snapshot(), has: key => css.has(key), list: () => css.list(), get: key => css.get(key),
    var: Object.freeze<DocumentCssRead["var"]>({ name: css.var.name, key: css.var.key, value: name => css.var.value(name), list: () => css.var.list() }),
    atProperty: Object.freeze<DocumentCssRead["atProperty"]>({ has: name => css.atProperty.has(name), get: name => css.atProperty.get(name) }),
    keyframes: Object.freeze<DocumentCssRead["keyframes"]>({ has: name => css.keyframes.has(name), get: name => css.keyframes.get(name) }),
  });
}
