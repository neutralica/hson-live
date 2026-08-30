import type { HsonSchema } from "../transform/transform.types.js";

export type DocumentAttrValueEvidence<
  TValue,
  TOptional extends boolean,
  TFlag extends boolean,
> = Readonly<{
  value: TValue;
  optional: TOptional;
  flag: TFlag;
}>;

export type DocumentAttrsEvidence<
  TShape,
  TExact extends boolean,
> = Readonly<{
  kind: "attrs";
  shape: TShape;
  exact: TExact;
}>;

export type InternalDocumentSchemaController = Readonly<{
  getDocumentSchema: () => HsonSchema | undefined;
  useDocumentSchema: (schema: HsonSchema) => void;
}>;
