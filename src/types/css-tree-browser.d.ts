declare module "css-tree/dist/csstree.esm" {
  export const parse: typeof import("css-tree").parse;
  export const generate: typeof import("css-tree").generate;
  export const tokenTypes: Readonly<Record<string, number>>;
  export const tokenize: (source: string, callback: (type: number, start: number, end: number) => void) => void;
}
