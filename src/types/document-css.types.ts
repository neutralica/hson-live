import type { PropertyManager } from "./at-property.types.js";
import type { KeyframesManager } from "./keyframes.types.js";
import type { PropertyRegistration } from "./at-property.types.js";
import type { KeyframeSelector } from "./keyframes.types.js";

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
}>;

/** Browser-independent value vocabulary used by document stylesheet authoring. */
export type DocumentCssValue = string | number | boolean | null | undefined
  | Readonly<{ value: string | number; unit?: string }>;
export type DocumentCssMap = Readonly<Record<string, DocumentCssValue | Readonly<Record<string, DocumentCssValue>>>>;
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
  setMany: (declarations: DocumentCssMap) => void;
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
  drop: (ruleKey: string) => void;
  clearAll: () => void;
  has: (ruleKey: string) => boolean;
  list: () => readonly string[];
  get: (ruleKey: string) => string | undefined;
  atProperty: PropertyManager;
  keyframes: KeyframesManager;
  snapshot: () => string;
}>;
