// style.types.ts

// Dependency-free CSS value/map types shared by core HSON attrs and LiveTree CSS APIs.

export type CssUnit =
  | "px"
  | "em"
  | "rem"
  | "%"
  | "vh"
  | "vw"
  | "s"
  | "ms"
  | "deg"
  | "_";

export type CssValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Readonly<{ value: string | number; unit?: string }>;

export interface CssText {
  id: string;
  css: string;
}

export interface CssRule {
  id: string;
  selector: string;
  body: string;
}

export type CssProp = Record<string, CssValue>;

export type CssRuleBlock = {
  selector: string;
  declarations: CssProp;
};

export interface CssRuleBuilder {
  readonly id: string;
  readonly selector: string;
  set(property: string, value: CssValue): CssRuleBuilder;
  setMany(decls: Record<string, CssValue>): CssRuleBuilder;
  remove(): void;
}

export type CssPseudoKey =
  | "_hover"
  | "_active"
  | "_focus"
  | "_focusWithin"
  | "_focusVisible"
  | "_visited"
  | "_checked"
  | "_disabled"
  | "__before"
  | "__after";

type StringKeys<T> = Extract<keyof T, string>;
type KeysWithStringValues<T> = {
  [K in StringKeys<T>]: T[K] extends string ? K : never
}[StringKeys<T>];

export type AllowedStyleKey = Exclude<KeysWithStringValues<CSSStyleDeclaration>, "cssText">;
export type CssKey = string;
export type CssVarName = `--${string}`;

interface CssMapBase_ extends Partial<Record<AllowedStyleKey | "float", CssValue>> {
  [k: string]: CssValue | CssMapBase_ | undefined;
}

export type CssMapBase = Readonly<CssMapBase_>;

export type CssMap = Readonly<
  CssMapBase_ &
  Partial<Record<CssPseudoKey, CssMapBase_>>
>;
