import type { CssMap, CssMapInputCheck, CssDeclarationValue } from "../core/style.types.js";
import type { PropertyManager } from "./at-property.types.js";
import type { KeyframesManager } from "./keyframes.types.js";
import type { PropertyRegistration } from "./at-property.types.js";
import type { KeyframeSelector } from "./keyframes.types.js";

/** Structural wrapper occurrence; identity is its position, never a runtime identifier. */
export type DocumentCssOrderEntry = Readonly<{
  /** Exact subject selector owning this generated contribution; translated with CSS. */
  owner?: string;
} & (
  | { kind: "rule"; ruleKey: string; scopes: readonly string[] }
  | { kind: "property"; name: string }
  | { kind: "keyframes"; name: string }
  | { kind: "text"; text: string }
  | { kind: "group"; header: string; entries: readonly DocumentCssOrderEntry[] }
)>;

/** Structured, DOM-free capture and commit payload; ordinary authors use the facade. */
export type DocumentCssRecord = Readonly<{
  rules: readonly Readonly<{
    ruleKey: string; selector: string; scopes: readonly string[];
    declarations: readonly (readonly [string, string])[];
  }>[];
  properties: readonly PropertyRegistration[];
  keyframes: readonly Readonly<{
    name: string;
    steps: readonly Readonly<{ at: KeyframeSelector; declarations: readonly (readonly [string, string])[] }>[];
  }>[];
  order: readonly DocumentCssOrderEntry[];
}>;

/** Browser-independent value vocabulary used by document stylesheet authoring. */
export type DocumentCssValue = CssDeclarationValue | undefined;
export type DocumentCssMediaQuery = string | Readonly<{
  maxWidth?: string | number; minWidth?: string | number;
  maxHeight?: string | number; minHeight?: string | number;
  orientation?: "portrait" | "landscape"; hover?: "hover" | "none";
  pointer?: "fine" | "coarse" | "none";
}>;
export type DocumentCssSupportsQuery = string | Readonly<Record<string, string | number | boolean>>;

/** The proxy supports arbitrary CSS property spellings, with a var helper. */
export type DocumentCssSetSurface = Readonly<Record<string, (value: DocumentCssValue) => void>
  & { var: (name: string, value: DocumentCssValue) => void }>;

export type DocumentCssRuleHandle = Readonly<{
  readonly ruleKey: string;
  readonly selector: string;
  set: DocumentCssSetSurface;
  setProp: (property: string, value: DocumentCssValue) => void;
  setMany: <const T extends CssMap>(declarations: T & CssMapInputCheck<NoInfer<T>>) => void;
  remove: (property: string) => void;
  clear: () => void;
  drop: () => void;
}>;

export type DocumentCssVarFacade = Readonly<{
  name: (name: string) => `--${string}` | undefined;
  key: (name: string) => `var(--${string})`;
  set: (name: string, value: DocumentCssValue) => void;
  value: (name: string) => string | undefined;
  remove: (name: string) => void;
  clear: () => void;
  list: () => readonly `--${string}`[];
}>;

export type DocumentCssRuleFacade = Readonly<{
  rule: (ruleKey: string, selector: string) => DocumentCssRuleHandle;
  sel: (selector: string) => DocumentCssRuleHandle;
  var: DocumentCssVarFacade;
  scope: (scopeName: string, atRule: string) => DocumentCssRuleFacade;
  media: (query: DocumentCssMediaQuery) => DocumentCssRuleFacade;
  supports: (condition: DocumentCssSupportsQuery) => DocumentCssRuleFacade;
  layer: (name: string) => DocumentCssRuleFacade;
}>;

/** Root-only, document-wide portable stylesheet capability. */
export type DocumentCssHandle = DocumentCssRuleFacade & Readonly<{
  /** Replace the complete managed stylesheet with one opaque text contribution. */
  stylesheet: (cssText: string) => void;
  drop: (ruleKey: string) => void;
  clearAll: () => void;
  has: (ruleKey: string) => boolean;
  list: () => readonly string[];
  get: (ruleKey: string) => string | undefined;
  atProperty: PropertyManager;
  keyframes: KeyframesManager;
  snapshot: () => string;
}>;

/** The existing stylesheet authoring vocabulary with command results and no state reads. */
type CssCommandMethods<T, TResult> = { readonly [K in keyof T]: T[K] extends (...args: infer TArgs) => unknown ? (...args: TArgs) => TResult : never };
export type DocumentCssRuleCommands<TResult> = Readonly<{
  rule: (ruleKey: string, selector: string) => CssCommandMethods<Pick<DocumentCssRuleHandle, "setProp" | "remove" | "clear" | "drop">, TResult>
    & { readonly setMany: <const T extends CssMap>(declarations: T & CssMapInputCheck<NoInfer<T>>) => TResult }
    & Pick<DocumentCssRuleHandle, "ruleKey" | "selector"> & { readonly set: CssCommandMethods<DocumentCssSetSurface, TResult> };
  sel: (selector: string) => ReturnType<DocumentCssRuleCommands<TResult>["rule"]>;
  var: CssCommandMethods<Pick<DocumentCssVarFacade, "set" | "remove" | "clear">, TResult>;
  scope: (scopeName: string, atRule: string) => DocumentCssRuleCommands<TResult>;
  media: (query: DocumentCssMediaQuery) => DocumentCssRuleCommands<TResult>;
  supports: (condition: DocumentCssSupportsQuery) => DocumentCssRuleCommands<TResult>;
  layer: (name: string) => DocumentCssRuleCommands<TResult>;
}>;
export type DocumentCssCommands<TResult> = DocumentCssRuleCommands<TResult>
  & CssCommandMethods<Pick<DocumentCssHandle, "stylesheet" | "drop" | "clearAll">, TResult>
  & Readonly<{
    atProperty: CssCommandMethods<Pick<PropertyManager, "register" | "registerMany" | "unregister">, TResult>;
    keyframes: CssCommandMethods<Pick<KeyframesManager, "set" | "setMany" | "delete">, TResult>;
  }>;
export type DocumentCssRead = Pick<DocumentCssHandle, "snapshot" | "has" | "list" | "get"> & Readonly<{
  var: Pick<DocumentCssVarFacade, "name" | "key" | "value" | "list">;
  atProperty: Pick<PropertyManager, "has" | "get">;
  keyframes: Pick<KeyframesManager, "has" | "get">;
}>;
