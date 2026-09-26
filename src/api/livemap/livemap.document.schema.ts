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
