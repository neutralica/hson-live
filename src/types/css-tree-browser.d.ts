declare module "css-tree/dist/csstree.esm" {
  export const parse: typeof import("css-tree").parse;
  export const generate: typeof import("css-tree").generate;
  export const walk: typeof import("css-tree").walk;
  export const lexer: typeof import("css-tree").lexer & { getProperty(name: string): object | null };
  export const ident: typeof import("css-tree").ident;
  export const tokenTypes: Readonly<Record<string, number>>;
  export const tokenize: (source: string, callback: (type: number, start: number, end: number) => void) => void;
}
