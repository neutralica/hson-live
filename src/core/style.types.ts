import type { CssPropertyName } from "./css-properties.js";
// style.types.ts

// Dependency-free CSS value/map types shared by core Hson attrs and LiveTree CSS APIs.

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

export type CssValue = CssDeclarationValue | undefined;

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

type Camel<S extends string> = S extends `${infer H}-${infer T}` ? `${H}${Capitalize<Camel<T>>}` : S;
type CssCamel<S extends string> = S extends `-webkit-${infer T}` ? `${"Webkit" | "webkit"}${Capitalize<Camel<T>>}`
  : S extends `-moz-${infer T}` ? `${"Moz" | "moz"}${Capitalize<Camel<T>>}`
  : S extends `-ms-${infer T}` ? `${"ms" | "Ms"}${Capitalize<Camel<T>>}`
  : S extends `-o-${infer T}` ? `${"O" | "o"}${Capitalize<Camel<T>>}` : Camel<S>;
export type AllowedStyleKey = CssCamel<CssPropertyName> | "cssFloat";
export type CssKey = string;
export type CssVarName = `--${string}`;
export type CssDeclarationValue = string | number | Readonly<{ value: string | number; unit?: string | undefined }>;
type Declarations = Readonly<Partial<Record<AllowedStyleKey | CssPropertyName | CssVarName | "float", CssDeclarationValue | undefined>>>;
export type CssMapBase = Declarations;
interface CssRelativeMap extends Declarations, Readonly<Partial<Record<CssPseudoKey, CssRelativeMap | undefined>>> {
  readonly [selector: `&${string}`]: CssRelativeMap | undefined;
}
type CssSubjectMap = CssRelativeMap & Readonly<Partial<Record<`@:${string}`, CssRelativeMap | undefined>>>;
export type CssMap = CssSubjectMap & Readonly<{ $media?: Readonly<Record<string, CssSubjectMap | undefined>> | undefined }>;

type CssDeclarationsValid<T> = T extends Declarations ? true : [Extract<keyof T, keyof Declarations>] extends [never] ? true : false;

/** Preserve excess-key checking through generic library-definition inference. */
export type CssMapInputCheck<T, Quad extends boolean = true, Media extends boolean = true> =
  T extends undefined ? unknown : T extends object
    // Retain each union member: a declaration-only branch must not collapse to {}.
    ? CssDeclarationsValid<T> extends true ? T & CssStructuredInputCheck<Omit<T, keyof Declarations>, Quad, Media> : never
    : never;

type CssStructuredInputCheck<T, Quad extends boolean, Media extends boolean> = { readonly [K in keyof T]: K extends CssPseudoKey | `&${string}` ? CssMapInputCheck<T[K], false, false> : K extends `@:${string}` ? Quad extends true ? CssMapInputCheck<T[K], false, false> : never : K extends '$media' ? Media extends true ? CssMediaInputCheck<T[K], Quad> : never : never };

type CssMediaInputCheck<T, Quad extends boolean> = T extends undefined ? unknown : T extends object
  ? { readonly [C in keyof T]: CssMapInputCheck<T[C], Quad, false> } : never;
