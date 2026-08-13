// schema.ts

import type { JsonValue } from "../../core/types.js";
import type { CanonicalPublicAttrValue } from "../../core/types.js";
import type {
  LiveMapSchemaIssueCode,
  LivePath,
} from "../../types/livemap.types.js";
import { clone_live_path, parent_live_path } from "./livemap.path.js";
import {
  admit_projected_value,
  ProjectedValueAdmissionError,
} from "../../core/projected-value-admission.js";
import {
  is_ordered_projected_object,
  ordered_projected_value_equal,
  type OrderedProjectedObject,
  type OrderedProjectedValue,
} from "../../core/ordered-projected-value.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import { emit_ordered_json } from "../transform/utils/json-utils/ordered-json.js";
import { HTML_TAGS, SVG_TAGS } from "../../core/all-html-tags.js";
import {
  decode_public_attr_value,
  is_public_attr_name,
} from "../../core/public-attrs.js";
import {
  add_document_pick_capabilities,
  add_document_text_capability,
  add_document_tuple_capability,
  add_document_unknown_capability,
  document_content_node,
  document_item_node,
  make_document_counted_repeat_schema,
  make_document_attrs_schema,
  make_document_element_schema,
  make_document_repeat_schema,
  make_document_tuple_schema,
  register_defined_document_schema,
  register_defined_document_attrs_schema,
  document_attrs_node,
  type DocumentAttrsEvidence,
  type DocumentAttrValueEvidence,
  type DocumentCountedRepeatEvidence,
  type DocumentElementEvidence,
  type DocumentFragmentEvidence,
  type DocumentPickEvidence,
  type DocumentRepeatEvidence,
  type DocumentSequenceEvidence,
  type DocumentTextEvidence,
  type DocumentUnknownEvidence,
  type InternalDocumentContentSchema,
  type InternalDocumentAttrsSchema,
  type InternalDocumentAttrRule,
  type InternalDocumentElementSchema,
  type InternalDocumentFragmentSchema,
  type InternalDocumentItemSchema,
  type InternalDocumentSchemaEvidence,
} from "./livemap.document.schema.js";

export type LiveMapSchemaKind =
  | "unknown"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "literal"
  | "pick"
  | "recurse"
  | "constrain"
  | "array"
  | "tuple"
  | "object"
  | "record";

export type LiveMapSchemaIssue = Readonly<{
  code: LiveMapSchemaIssueCode;
  path: LivePath;
  message: string;
  expected?: string;
  received?: string;
  attributeName?: string;
}>;

export type LiveMapSchemaValidation = Readonly<{
  ok: boolean;
  issues: readonly LiveMapSchemaIssue[];
}>;

export type LiveMapSchemaRule = Readonly<{
  kind: LiveMapSchemaKind;
  path: LivePath;
  optional: boolean;
  nullable: boolean;
  exact: boolean;
  literals?: readonly JsonValue[];
}>;

/** Concrete schema resolution for one runtime LivePath. */
export type LiveMapSchemaResolution = Readonly<{
  path: LivePath;
  rule: LiveMapSchemaRule;
  key?: LivePath[number];
  parentPath?: LivePath;
  parentRule?: LiveMapSchemaRule;
}>;

/** Throwing schema-resolution convenience surface. */
export type LiveMapSchemaMustApi = Readonly<{
  resolve: (path: LivePath) => LiveMapSchemaResolution;
}>;

/**
 * Runtime schema for LiveMap values.
 *
 * LiveMap validates the projected candidate root before applying a commit, so a
 * failed schema check must leave the current root unchanged. Error headlines use
 * the operation path for single endpoint operations and the first schema issue
 * path for multi-op object writes such as `setMany`.
 */
declare const LIVEMAP_SCHEMA_VALUE: unique symbol;

/** One opaque reusable schema contract returned by `hson.liveMap.schema.define`. */
export type LiveMapSchema<TValue = unknown> = Readonly<{
  readonly [LIVEMAP_SCHEMA_VALUE]?: TValue;
}>;

export type LiveMapSchemaConstraint<TValue = JsonValue> = (value: TValue) => boolean;

type LiveMapSchemaConstrainModifier<TValue> = {
  (validate: LiveMapSchemaConstraint<Exclude<TValue, undefined>>): LiveMapSchemaToken<Exclude<TValue, undefined>>;
  (label: string, validate: LiveMapSchemaConstraint<Exclude<TValue, undefined>>): LiveMapSchemaToken<Exclude<TValue, undefined>>;
};

/** Internal projected-root capability retained by compatible defined schemas. */
export type LiveMapProjectedSchema<TValue = unknown> = LiveMapSchema<TValue> & Readonly<{
  root: LiveMapSchemaNode;
  rules: readonly LiveMapSchemaRule[];
  match: (path: LivePath) => LiveMapSchemaRule | undefined;
  /** Resolve a concrete runtime path to its matching rule and parent context. */
  resolve: (path: LivePath) => LiveMapSchemaResolution | undefined;
  /** Return whether one concrete runtime path resolves against this schema. */
  has: (path: LivePath) => boolean;
  /** Throwing schema-resolution convenience surface. */
  must: LiveMapSchemaMustApi;
  /** Validate a complete candidate root. This is the normal LiveMap commit path. */
  validateRoot: (value: JsonValue | undefined) => LiveMapSchemaValidation;
  /** Validate one value against the schema node at `path`. */
  validateValue: (path: LivePath, value: JsonValue | undefined) => LiveMapSchemaValidation;
  optional: LiveMapSchemaToken<TValue | undefined>;
  nullable: LiveMapSchemaToken<TValue | null>;
  constrain: LiveMapSchemaConstrainModifier<TValue>;
}>;

export interface LiveMapSchemaShape {
  readonly [key: string]: LiveMapSchemaInput;
}

export interface LiveMapSchemaVariants {
  readonly [variant: string]: LiveMapSchemaInput;
}

export type LiveMapSchemaInput<TValue = unknown> =
  | LiveMapSchemaToken<TValue>
  | LiveMapProjectedSchema<TValue>;

export type LiveMapSchemaChoice =
  | JsonValue
  | LiveMapSchemaInput;

export type InferLiveMapSchema<TSchema> = TSchema extends LiveMapSchema<infer TValue> ? TValue : never;
export type LiveMapSchemaValue<TSchema> = InferLiveMapSchema<TSchema>;
export type InferLiveMapSchemaToken<TToken> = TToken extends LiveMapSchemaToken<infer TValue> ? TValue : never;

export type InferLiveMapSchemaInput<TInput> =
  TInput extends LiveMapSchemaToken<infer TValue> ? TValue :
  TInput extends LiveMapProjectedSchema<infer TValue> ? TValue :
  never;

export type InferLiveMapSchemaChoice<TChoice> =
  TChoice extends LiveMapSchemaInput ? InferLiveMapSchemaInput<TChoice> :
  TChoice extends JsonValue ? TChoice :
  never;

export type InferLiveMapSchemaShape<TShape extends LiveMapSchemaShape> = Simplify<{
  [Key in RequiredSchemaShapeKeys<TShape>]: InferLiveMapSchemaInput<TShape[Key]>;
} & {
  [Key in OptionalSchemaShapeKeys<TShape>]?: Exclude<InferLiveMapSchemaInput<TShape[Key]>, undefined>;
}>;

type ProjectedSchemaValue =
  | string
  | number
  | boolean
  | null
  | readonly ProjectedSchemaValue[]
  | Readonly<{ [key: string]: ProjectedSchemaValue }>;

type InferOpenLiveMapSchemaShape<TShape extends LiveMapSchemaShape> = Simplify<
  InferLiveMapSchemaShape<TShape>
  & Readonly<Record<string, ProjectedSchemaValue | undefined>>
>;

type OptionalSchemaShapeKeys<TShape extends LiveMapSchemaShape> = {
  [Key in keyof TShape]: undefined extends InferLiveMapSchemaInput<TShape[Key]> ? Key : never;
}[keyof TShape];

type RequiredSchemaShapeKeys<TShape extends LiveMapSchemaShape> = Exclude<keyof TShape, OptionalSchemaShapeKeys<TShape>>;

type InferLiveMapSchemaPresent<TInput extends LiveMapSchemaInput> =
  Exclude<InferLiveMapSchemaInput<TInput>, undefined>;

type AllLiveMapSchemaTupleItemsOptional<TItems extends readonly LiveMapSchemaInput[]> =
  TItems extends readonly [] ? true :
  TItems extends readonly [
    infer THead extends LiveMapSchemaInput,
    ...infer TTail extends readonly LiveMapSchemaInput[],
  ] ? undefined extends InferLiveMapSchemaInput<THead>
      ? AllLiveMapSchemaTupleItemsOptional<TTail>
      : false
    : false;

type InferOptionalLiveMapSchemaTuple<TItems extends readonly LiveMapSchemaInput[]> =
  TItems extends readonly [
    infer THead extends LiveMapSchemaInput,
    ...infer TTail extends readonly LiveMapSchemaInput[],
  ] ? readonly [
      InferLiveMapSchemaPresent<THead>?,
      ...InferOptionalLiveMapSchemaTuple<TTail>,
    ]
    : readonly [];

type InferLiveMapSchemaTuple<TItems extends readonly LiveMapSchemaInput[]> =
  TItems extends readonly [
    infer THead extends LiveMapSchemaInput,
    ...infer TTail extends readonly LiveMapSchemaInput[],
  ] ? AllLiveMapSchemaTupleItemsOptional<TItems> extends true
      ? InferOptionalLiveMapSchemaTuple<TItems>
      : readonly [
          InferLiveMapSchemaPresent<THead>,
          ...InferLiveMapSchemaTuple<TTail>,
        ]
    : readonly [];

type InferLiveMapTaggedSchema<TDiscriminator extends string, TVariants extends LiveMapSchemaVariants> = {
  [Tag in keyof TVariants & string]: Simplify<InferLiveMapSchemaPresent<TVariants[Tag]> & { [Key in TDiscriminator]: Tag }>;
}[keyof TVariants & string];

type DeepPartialSchemaValue<TValue> =
  TValue extends readonly unknown[]
    ? number extends TValue["length"]
      ? readonly DeepPartialSchemaValue<Exclude<TValue[number], undefined>>[]
      : { readonly [Index in keyof TValue]?: DeepPartialSchemaValue<Exclude<TValue[Index], undefined>> }
    : TValue extends object
      ? DeepPartialSchemaObjectValue<TValue>
      : TValue;

type DeepPartialSchemaObjectValue<TValue extends object> = Simplify<
  {
    [Key in keyof TValue]?: string extends keyof TValue
      ? undefined extends TValue[string & keyof TValue]
        ? string extends Key
          ? TValue[Key]
          : number extends Key
            ? TValue[Key]
            : DeepPartialSchemaValue<Exclude<TValue[Key], undefined>>
        : DeepPartialSchemaValue<Exclude<TValue[Key], undefined>>
      : DeepPartialSchemaValue<Exclude<TValue[Key], undefined>>
  }
  & (string extends keyof TValue
    ? Readonly<Record<
      string,
      undefined extends TValue[string & keyof TValue]
        ? TValue[string & keyof TValue]
        : DeepPartialSchemaValue<TValue[string & keyof TValue]>
    >>
    : unknown)
>;

type Simplify<TValue> = { [Key in keyof TValue]: TValue[Key] } & {};

export type LiveMapSchemaToken<TValue = unknown> = Readonly<{
  kind: LiveMapSchemaKind;
  optional: LiveMapSchemaToken<TValue | undefined>;
  nullable: LiveMapSchemaToken<TValue | null>;
  constrain: LiveMapSchemaConstrainModifier<TValue>;
  readonly __value?: readonly [TValue];
}>;

declare const LIVEMAP_FLAG_SCHEMA_VALUE: unique symbol;
export type InternalLiveMapFlagSchema<TOptional extends boolean = false> = Readonly<{
  kind: "flag";
  optional: InternalLiveMapFlagSchema<true>;
  readonly [LIVEMAP_FLAG_SCHEMA_VALUE]?: TOptional;
}>;

type AttrPrimitive = string | number | boolean | null;
type AttrSchemaInputGuard<TInput> =
  TInput extends InternalLiveMapFlagSchema<boolean>
    ? TInput
    : TInput extends LiveMapSchemaInput<infer TValue>
      ? JsonValue extends Exclude<TValue, undefined>
        ? TInput
        : Exclude<TValue, undefined> extends AttrPrimitive
          ? TInput
          : never
      : never;

export interface InternalLiveMapAttrsShape {
  readonly [key: string]: LiveMapSchemaInput | InternalLiveMapFlagSchema<boolean>;
}

type AttrShapeGuard<TShape extends InternalLiveMapAttrsShape> = {
  readonly [TKey in keyof TShape]: AttrSchemaInputGuard<TShape[TKey]>;
};

type AttrValueEvidenceFor<TKey extends PropertyKey, TInput> =
  TInput extends InternalLiveMapFlagSchema<infer TOptional>
    ? DocumentAttrValueEvidence<TKey & string, TOptional, true>
    : TInput extends LiveMapSchemaInput<infer TValue>
      ? DocumentAttrValueEvidence<
          JsonValue extends Exclude<TValue, undefined> ? CanonicalPublicAttrValue : Exclude<TValue, undefined>,
          undefined extends TValue ? true : false,
          false
        >
      : never;

type AttrShapeEvidence<TShape extends InternalLiveMapAttrsShape> = Readonly<{
  [TKey in keyof TShape]: AttrValueEvidenceFor<TKey, TShape[TKey]>;
}>;

type AttrsSchemaBuilder = {
  <const TShape extends InternalLiveMapAttrsShape>(
    shape: TShape & AttrShapeGuard<TShape>,
  ): InternalDocumentAttrsSchema<DocumentAttrsEvidence<AttrShapeEvidence<TShape>, false>>;
  exact: <const TShape extends InternalLiveMapAttrsShape>(
    shape: TShape & AttrShapeGuard<TShape>,
  ) => InternalDocumentAttrsSchema<DocumentAttrsEvidence<AttrShapeEvidence<TShape>, true>>;
};

type DocumentItemEvidence<TSchema> = InternalDocumentSchemaEvidence<TSchema>;
type DocumentContentEvidence<TSchema> = InternalDocumentSchemaEvidence<TSchema>;
type DocumentChildArguments =
  | readonly []
  | readonly [InternalDocumentContentSchema]
  | readonly InternalDocumentItemSchema[];
type DocumentChildrenEvidence<TChildren extends DocumentChildArguments> =
  TChildren extends readonly []
    ? "broad"
    : TChildren extends readonly [InternalDocumentContentSchema<infer TEvidence>]
      ? TEvidence
      : TChildren extends readonly InternalDocumentItemSchema[]
        ? DocumentSequenceEvidence<Readonly<{
          readonly [TIndex in keyof TChildren]: DocumentItemEvidence<TChildren[TIndex]>;
        }> & readonly unknown[]>
        : never;
type DocumentTagArguments =
  | DocumentChildArguments
  | readonly [InternalDocumentAttrsSchema]
  | readonly [InternalDocumentAttrsSchema, InternalDocumentContentSchema]
  | readonly [InternalDocumentAttrsSchema, ...InternalDocumentItemSchema[]];
type DocumentTagAttrsEvidence<TArgs extends DocumentTagArguments> =
  TArgs extends readonly [InternalDocumentAttrsSchema<infer TAttrs>, ...readonly unknown[]]
    ? TAttrs
    : "broad";
type DocumentTagChildren<TArgs extends DocumentTagArguments> =
  TArgs extends readonly [InternalDocumentAttrsSchema, ...infer TRest]
    ? Extract<TRest, DocumentChildArguments>
    : Extract<TArgs, DocumentChildArguments>;

type ProjectedInputGuard<TInput> =
  TInput extends LiveMapSchemaToken | LiveMapProjectedSchema
    ? TInput
    : TInput extends InternalDocumentItemSchema | InternalDocumentContentSchema
      ? never
      : never;
type ProjectedChoiceGuard<TChoice> =
  TChoice extends LiveMapSchemaToken | LiveMapProjectedSchema
    ? TChoice
    : TChoice extends InternalDocumentItemSchema | InternalDocumentContentSchema
    ? never
      : TChoice extends JsonValue
        ? TChoice
        : ProjectedInputGuard<TChoice>;

type ProjectedObjectInputGuard<TInput extends LiveMapSchemaInput> =
  InferLiveMapSchemaPresent<TInput> extends readonly unknown[]
    ? never
    : InferLiveMapSchemaPresent<TInput> extends object
      ? TInput
      : never;

type ProjectedShapeGuard<TShape extends LiveMapSchemaShape> = {
  readonly [TKey in keyof TShape]: ProjectedInputGuard<TShape[TKey]>;
};

type ProjectedVariantGuard<TVariants extends LiveMapSchemaVariants> = {
  readonly [TVariant in keyof TVariants]: TVariants[TVariant] & ProjectedObjectInputGuard<TVariants[TVariant]>;
};

type NonEmptyVariantGuard<TVariants extends LiveMapSchemaVariants> =
  keyof TVariants extends never ? never : unknown;

type DocumentTagBuilder<TTag extends string> = <const TArgs extends DocumentTagArguments>(
  ...args: TArgs
) => InternalDocumentElementSchema<DocumentElementEvidence<
  TTag,
  DocumentChildrenEvidence<DocumentTagChildren<TArgs>>,
  DocumentTagAttrsEvidence<TArgs>
>>;
type AnyCreateTag = (typeof HTML_TAGS)[number] | (typeof SVG_TAGS)[number];

type ProjectedPickCapability<TChoices extends readonly unknown[]> =
  [TChoices[number]] extends [ProjectedChoiceGuard<TChoices[number]>]
    ? LiveMapSchemaToken<Exclude<InferLiveMapSchemaChoice<TChoices[number]>, undefined>>
    : unknown;
type HasProjectedPickCapability<TChoices extends readonly unknown[]> =
  [TChoices[number]] extends [ProjectedChoiceGuard<TChoices[number]>] ? true : false;
type DocumentItemPickCapability<TChoices extends readonly unknown[]> =
  [TChoices[number]] extends [InternalDocumentItemSchema]
    ? InternalDocumentItemSchema<DocumentPickEvidence<Readonly<{
      readonly [TIndex in keyof TChoices]: DocumentItemEvidence<TChoices[TIndex]>;
    }> & readonly unknown[]>>
    : unknown;
type HasDocumentItemPickCapability<TChoices extends readonly unknown[]> =
  [TChoices[number]] extends [InternalDocumentItemSchema] ? true : false;
type DocumentContentPickCapability<TChoices extends readonly unknown[]> =
  [TChoices[number]] extends [InternalDocumentContentSchema]
    ? InternalDocumentContentSchema<DocumentPickEvidence<Readonly<{
      readonly [TIndex in keyof TChoices]: DocumentContentEvidence<TChoices[TIndex]>;
    }> & readonly unknown[]>>
    : unknown;
type HasDocumentContentPickCapability<TChoices extends readonly unknown[]> =
  [TChoices[number]] extends [InternalDocumentContentSchema] ? true : false;
type CompatiblePickArguments<TChoices extends readonly unknown[]> =
  true extends HasProjectedPickCapability<TChoices>
    | HasDocumentItemPickCapability<TChoices>
    | HasDocumentContentPickCapability<TChoices>
    ? unknown
    : { readonly [TIndex in keyof TChoices]: never };
type UnifiedPickResult<TChoices extends readonly unknown[]> =
  ProjectedPickCapability<TChoices>
  & DocumentItemPickCapability<TChoices>
  & DocumentContentPickCapability<TChoices>;

type ProjectedTupleCapability<TItems extends readonly unknown[]> =
  [TItems[number]] extends [ProjectedInputGuard<TItems[number]>]
    ? LiveMapSchemaToken<InferLiveMapSchemaTuple<Extract<TItems, readonly LiveMapSchemaInput[]>>>
    : unknown;
type DocumentTupleCapability<TItems extends readonly unknown[]> =
  [TItems[number]] extends [InternalDocumentItemSchema]
    ? InternalDocumentContentSchema<DocumentSequenceEvidence<Readonly<{
      readonly [TIndex in keyof TItems]: DocumentItemEvidence<TItems[TIndex]>;
    }> & readonly unknown[]>>
    : unknown;
type HasProjectedTupleCapability<TItems extends readonly unknown[]> =
  [TItems[number]] extends [ProjectedInputGuard<TItems[number]>] ? true : false;
type HasDocumentTupleCapability<TItems extends readonly unknown[]> =
  [TItems[number]] extends [InternalDocumentItemSchema] ? true : false;
type CompatibleTupleArguments<TItems extends readonly unknown[]> =
  true extends HasProjectedTupleCapability<TItems> | HasDocumentTupleCapability<TItems>
    ? unknown
    : { readonly [TIndex in keyof TItems]: never };
type UnifiedTupleResult<TItems extends readonly unknown[]> =
  ProjectedTupleCapability<TItems> & DocumentTupleCapability<TItems>;

type SchemaPickOperand = LiveMapSchemaChoice | InternalDocumentItemSchema | InternalDocumentContentSchema;
type SchemaTupleOperand = LiveMapSchemaInput | InternalDocumentItemSchema;
type InvalidDocumentRepeatLiteral<TCount extends number> = TCount extends unknown
  ? `${TCount}` extends `-${string}` | `${string}.${string}` ? TCount : never
  : never;
type DocumentRepeatCountGuard<TCount extends number> = number extends TCount
  ? unknown
  : [InvalidDocumentRepeatLiteral<TCount>] extends [never] ? unknown : never;
type DocumentCountedRepeatResult<
  TCount extends number,
  TItem extends InternalDocumentItemSchema,
> = InternalDocumentContentSchema<
  TCount extends 0
    ? DocumentSequenceEvidence<readonly []>
    : DocumentCountedRepeatEvidence<TCount, DocumentItemEvidence<TItem>>
>;
type DocumentRepeatOperator = {
  <const TItem extends InternalDocumentItemSchema>(
    item: TItem,
  ): InternalDocumentContentSchema<DocumentRepeatEvidence<DocumentItemEvidence<TItem>>>;
  <const TCount extends number, const TItem extends InternalDocumentItemSchema>(
    count: TCount & DocumentRepeatCountGuard<TCount>,
    item: TItem,
  ): DocumentCountedRepeatResult<TCount, TItem>;
};
export type InternalLiveMapSchemaExpression = LiveMapSchemaInput | InternalDocumentItemSchema | InternalDocumentContentSchema | InternalDocumentAttrsSchema;
export type InternalLiveMapSchemaDefinition = InternalLiveMapSchemaExpression;

type DefinedProjectedCapability<TExpression> =
  TExpression extends LiveMapSchemaInput
    ? LiveMapProjectedSchema<Exclude<InferLiveMapSchemaInput<TExpression>, undefined>>
    : LiveMapSchema;
type DefinedDocumentItemCapability<TExpression> =
  TExpression extends InternalDocumentElementSchema<infer TEvidence>
    ? InternalDocumentElementSchema<TEvidence>
    : TExpression extends InternalDocumentItemSchema<infer TEvidence>
      ? InternalDocumentItemSchema<TEvidence>
      : unknown;
type DefinedDocumentContentCapability<TExpression> =
  TExpression extends InternalDocumentFragmentSchema<infer TEvidence>
    ? InternalDocumentFragmentSchema<TEvidence>
    : TExpression extends InternalDocumentContentSchema<infer TEvidence>
      ? InternalDocumentContentSchema<TEvidence>
        & InternalDocumentFragmentSchema<DocumentFragmentEvidence<TEvidence>>
      : unknown;
type DefinedDocumentAttrsCapability<TExpression> =
  TExpression extends InternalDocumentAttrsSchema<infer TEvidence>
    ? InternalDocumentAttrsSchema<TEvidence>
    : unknown;
export type InternalDefinedLiveMapSchema<TExpression> =
  DefinedProjectedCapability<TExpression>
  & DefinedDocumentItemCapability<TExpression>
  & DefinedDocumentContentCapability<TExpression>
  & DefinedDocumentAttrsCapability<TExpression>;

type AnyDocumentTagBuilder = {
  (): InternalDocumentElementSchema<DocumentElementEvidence<undefined, "broad", "broad">>;
  <const TArgs extends DocumentTagArguments>(
    ...args: TArgs
  ): InternalDocumentElementSchema<DocumentElementEvidence<
    undefined,
    DocumentChildrenEvidence<DocumentTagChildren<TArgs>>,
    DocumentTagAttrsEvidence<TArgs>
  >>;
};

type SchemaTag = AnyDocumentTagBuilder & Readonly<{
  readonly [tag: string]: DocumentTagBuilder<string>;
}>;

type LiveMapSchemaOperators = Readonly<{
  unknown: LiveMapSchemaToken<JsonValue> & InternalDocumentItemSchema<DocumentUnknownEvidence>;
  string: LiveMapSchemaToken<string> & InternalDocumentItemSchema<DocumentTextEvidence>;
  number: LiveMapSchemaToken<number>;
  boolean: LiveMapSchemaToken<boolean>;
  null: LiveMapSchemaToken<null>;
  flag: InternalLiveMapFlagSchema;
  attrs: AttrsSchemaBuilder;
  literal: <const TValues extends readonly [JsonValue, ...JsonValue[]]>(...values: TValues) => LiveMapSchemaToken<TValues[number]>;
  pick: <const TChoices extends readonly [SchemaPickOperand, ...SchemaPickOperand[]]>(...choices: TChoices & CompatiblePickArguments<NoInfer<TChoices>>) => UnifiedPickResult<TChoices>;
  tagged: <TDiscriminator extends string, TVariants extends LiveMapSchemaVariants>(discriminator: TDiscriminator, variants: TVariants & ProjectedVariantGuard<TVariants> & NonEmptyVariantGuard<TVariants>) => LiveMapSchemaToken<InferLiveMapTaggedSchema<TDiscriminator, TVariants>>;
  recurse: <TInput extends LiveMapSchemaInput>(makeInput: () => TInput & ProjectedInputGuard<TInput>) => LiveMapSchemaToken<InferLiveMapSchemaPresent<TInput>>;
  array: <TInput extends LiveMapSchemaInput>(item: TInput & ProjectedInputGuard<TInput>) => LiveMapSchemaToken<readonly InferLiveMapSchemaPresent<TInput>[]>;
  tuple: <const TItems extends readonly SchemaTupleOperand[]>(...items: TItems & CompatibleTupleArguments<NoInfer<TItems>>) => UnifiedTupleResult<TItems>;
  record: <TInput extends LiveMapSchemaInput>(value: TInput & ProjectedInputGuard<TInput>) => LiveMapSchemaToken<Readonly<Record<string, InferLiveMapSchemaPresent<TInput>>>>;
  object: <TShape extends LiveMapSchemaShape>(shape: TShape & ProjectedShapeGuard<TShape>) => LiveMapSchemaToken<InferOpenLiveMapSchemaShape<TShape>>;
  partial: <TInput extends LiveMapSchemaInput>(input: TInput & ProjectedObjectInputGuard<TInput>) => LiveMapSchemaToken<Partial<InferLiveMapSchemaPresent<TInput>>>;
  deepPartial: <TInput extends LiveMapSchemaInput>(input: TInput & ProjectedObjectInputGuard<TInput>) => LiveMapSchemaToken<DeepPartialSchemaValue<InferLiveMapSchemaPresent<TInput>>>;
  exact: <TShape extends LiveMapSchemaShape>(shape: TShape & ProjectedShapeGuard<TShape>) => LiveMapSchemaToken<InferLiveMapSchemaShape<TShape>>;
  empty: InternalDocumentContentSchema<DocumentSequenceEvidence<readonly []>>;
  repeat: DocumentRepeatOperator;
  tag: SchemaTag;
}>;

type KnownDocumentTagBuilders = Readonly<{
  [TTag in Exclude<AnyCreateTag, keyof LiveMapSchemaOperators>]: DocumentTagBuilder<TTag>;
}>;

/** Direct stateless toolkit supplied only to `schema.define(s => ...)`. */
export type LiveMapSchemaBuilder = LiveMapSchemaOperators & KnownDocumentTagBuilders;

type LiveMapSchemaNode = Readonly<{
  kind: LiveMapSchemaKind;
  optional: boolean;
  nullable: boolean;
  exact: boolean;
  literals: readonly OrderedProjectedValue[];
  choices?: readonly LiveMapSchemaNode[];
  recurse?: () => LiveMapSchemaNode;
  base?: LiveMapSchemaNode;
  label?: string;
  validate?: LiveMapSchemaConstraint;
  item?: LiveMapSchemaNode;
  items?: readonly LiveMapSchemaNode[];
  props?: readonly (readonly [string, LiveMapSchemaNode])[];
  record?: LiveMapSchemaNode;
}>;

type LiveMapSchemaDraft = Readonly<{
  kind: LiveMapSchemaKind;
  optional?: boolean;
  nullable?: boolean;
  exact?: boolean;
  literals?: readonly JsonValue[];
  choices?: readonly LiveMapSchemaChoice[];
  recurse?: () => LiveMapSchemaInput;
  base?: LiveMapSchemaInput;
  label?: string;
  validate?: LiveMapSchemaConstraint;
  item?: LiveMapSchemaInput;
  items?: readonly LiveMapSchemaInput[];
  props?: LiveMapSchemaShape;
  record?: LiveMapSchemaInput;
}>;

const SCHEMA_DRAFT: unique symbol = Symbol("LiveMapSchemaDraft");
const DEFINED_PROJECTED_NODES = new WeakMap<object, LiveMapSchemaNode>();
const COMPILED_PROJECTED_TOKENS = new WeakMap<object, LiveMapSchemaNode>();
// CHANGED: public schema rules retain "*" paths, while private matcher paths
// use distinct sentinels that cannot collide with a real property named "*".
const PUBLIC_WILDCARD_PATH_PART = "*";
const ARRAY_INDEX_MATCH_PART: unique symbol = Symbol("LiveMapArrayIndexMatchPart");
const RECORD_KEY_MATCH_PART: unique symbol = Symbol("LiveMapRecordKeyMatchPart");

type LiveMapSchemaMatchPathPart =
  | LivePath[number]
  | typeof ARRAY_INDEX_MATCH_PART
  | typeof RECORD_KEY_MATCH_PART;
type LiveMapSchemaMatchPath = readonly LiveMapSchemaMatchPathPart[];
type CompiledLiveMapSchemaRule = Readonly<{
  rule: LiveMapSchemaRule;
  matchPath: LiveMapSchemaMatchPath;
}>;

const sharedUnknown = add_document_unknown_capability(make_schema_token<JsonValue>({ kind: "unknown" }));
const sharedString = add_document_text_capability(make_schema_token<string>({ kind: "string" }));
const sharedEmpty = make_document_tuple_schema();

const TAG_FAMILY_PRIMITIVE_LABEL = "hson.liveMap.schema.tag";

type UnknownCallback = (...args: readonly unknown[]) => unknown;

function is_unknown_callback(value: unknown): value is UnknownCallback {
  return typeof value === "function";
}

function document_schema_children(values: readonly unknown[]): readonly object[] {
  if (!values.every((value): value is object => (
    (typeof value === "object" && value !== null) || typeof value === "function"
  ))) {
    throw new TypeError("Document element children must be document schema expressions.");
  }
  return values;
}

const flagSchemaOptionalDraft: { kind: "flag"; optional?: InternalLiveMapFlagSchema<true> } = { kind: "flag" };
flagSchemaOptionalDraft.optional = flagSchemaOptionalDraft as InternalLiveMapFlagSchema<true>;
const FLAG_SCHEMA_OPTIONAL = Object.freeze(flagSchemaOptionalDraft) as InternalLiveMapFlagSchema<true>;
const FLAG_SCHEMA = Object.freeze({
  kind: "flag",
  get optional() { return FLAG_SCHEMA_OPTIONAL; },
}) as InternalLiveMapFlagSchema;

function is_flag_schema(value: unknown): value is InternalLiveMapFlagSchema<boolean> {
  return value === FLAG_SCHEMA || value === FLAG_SCHEMA_OPTIONAL;
}

function make_attrs_schema(shape: InternalLiveMapAttrsShape, exact: boolean): InternalDocumentAttrsSchema {
  const entries = schema_attr_shape_entries(shape);
  const props = entries.map(([name, input]) => {
    if (!is_public_attr_name(name)) {
      throw new TypeError(`Document attrs schema name ${JSON.stringify(name)} is not a canonical public attribute name.`);
    }
    if (is_flag_schema(input)) {
      const optional = input === FLAG_SCHEMA_OPTIONAL;
      const rule: InternalDocumentAttrRule = Object.freeze({
        optional,
        flag: true,
        validate: (value) => value === name
          ? Object.freeze({ ok: true, issues: Object.freeze([]) })
          : Object.freeze({
              ok: false,
              issues: Object.freeze([Object.freeze({
                code: "INVALID_LITERAL" as const,
                path: Object.freeze([]),
                message: `Expected canonical flag value ${JSON.stringify(name)}; received ${JSON.stringify(value)}.`,
                expected: JSON.stringify(name),
                received: JSON.stringify(value),
              })]),
            }),
      });
      return Object.freeze([name, rule] as const);
    }
    const node = normalize_schema_input(input);
    if (!is_attr_value_schema_node(node)) {
      throw new TypeError(`Document attribute ${JSON.stringify(name)} requires a primitive/unknown attr-value schema.`);
    }
    const rule: InternalDocumentAttrRule = Object.freeze({
      optional: node.optional,
      flag: false,
      validate: (value) => {
        const admitted = decode_public_attr_value(name, value);
        if (admitted === undefined) {
          return Object.freeze({
            ok: false,
            issues: Object.freeze([Object.freeze({
              code: "TYPE_MISMATCH" as const,
              path: Object.freeze([]),
              message: "Value is not canonical for this attribute name.",
            })]),
          });
        }
        return validate_attr_schema_node(node, admitted);
      },
    });
    return Object.freeze([name, rule] as const);
  });
  return make_document_attrs_schema<DocumentAttrsEvidence<unknown, boolean>>({
    exact,
    props: Object.freeze(props),
  });
}

function schema_attr_shape_entries(
  shape: InternalLiveMapAttrsShape,
): readonly (readonly [string, LiveMapSchemaInput | InternalLiveMapFlagSchema<boolean>])[] {
  if (typeof shape !== "object" || shape === null || Array.isArray(shape)) {
    throw new TypeError("Document attrs schema shape must be a plain object.");
  }
  const prototype = Object.getPrototypeOf(shape);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Document attrs schema shape must use Object.prototype or null.");
  }
  return Object.freeze(Object.keys(shape).sort().map((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(shape, name);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("Document attrs schema properties must be enumerable data properties.");
    }
    return Object.freeze([name, descriptor.value] as const);
  }));
}

function is_attr_value_schema_node(node: LiveMapSchemaNode, seen = new Set<LiveMapSchemaNode>()): boolean {
  if (seen.has(node)) return true;
  seen.add(node);
  if (["unknown", "string", "number", "boolean", "null", "literal"].includes(node.kind)) return true;
  if (node.kind === "pick") return (node.choices ?? []).every((choice) => is_attr_value_schema_node(choice, seen));
  if (node.kind === "constrain") return node.base !== undefined && is_attr_value_schema_node(node.base, seen);
  if (node.kind === "recurse") return node.recurse !== undefined && is_attr_value_schema_node(node.recurse(), seen);
  return false;
}

function validate_attr_schema_node(node: LiveMapSchemaNode, value: unknown): LiveMapSchemaValidation {
  try {
    return validate_schema_node(node, [], admit_projected_value(value));
  } catch {
    return Object.freeze({
      ok: false,
      issues: Object.freeze([Object.freeze({
        code: "TYPE_MISMATCH" as const,
        path: Object.freeze([]),
        message: "Attribute value is not admitted by its schema.",
      })]),
    });
  }
}

function make_schema_tag_family(): SchemaTag {
  const target = (...children: readonly unknown[]) => (
    make_document_element_schema(undefined, document_schema_children(children))
  );

  if (!Reflect.deleteProperty(target, "name") || !Reflect.deleteProperty(target, "length")) {
    throw new TypeError("Unable to initialize the document tag schema family.");
  }
  Object.setPrototypeOf(target, null);
  Object.freeze(target);

  let suppressThenLookup = false;
  let tagFamily: SchemaTag;
  const primitiveValue = Object.freeze(() => TAG_FAMILY_PRIMITIVE_LABEL);

  tagFamily = new Proxy(target, {
    get(_target, property) {
      if (property === "then" && suppressThenLookup) return undefined;
      if (property === Symbol.toPrimitive) return primitiveValue;
      if (typeof property !== "string") return undefined;

      return Object.freeze(function (this: unknown, ...children: readonly unknown[]) {
        // Promise assimilation invokes `then` with a resolver pair. Functions
        // are not legal document children, so this cannot mask a valid schema.
        if (
          property === "then"
          && this === tagFamily
          && children.length === 2
          && is_unknown_callback(children[0])
          && is_unknown_callback(children[1])
        ) {
          suppressThenLookup = true;
          try {
            children[0](tagFamily);
          } finally {
            suppressThenLookup = false;
          }
          return undefined;
        }

        // JSON.stringify probes `toJSON` with one raw key string. Raw strings
        // are not document child schemas, so preserve ordinary JSON behavior.
        if (
          property === "toJSON"
          && this === tagFamily
          && children.length === 1
          && typeof children[0] === "string"
        ) {
          return tagFamily;
        }

        return make_document_element_schema(
          property,
          document_schema_children(children),
        );
      });
    },
  }) as SchemaTag;

  return tagFamily;
}

const ATTRS_SCHEMA_BUILDER = Object.freeze(Object.assign(
  (shape: InternalLiveMapAttrsShape) => make_attrs_schema(shape, false),
  { exact: (shape: InternalLiveMapAttrsShape) => make_attrs_schema(shape, true) },
)) as AttrsSchemaBuilder;

const LIVEMAP_SCHEMA_RUNTIME_BASE: LiveMapSchemaOperators = {
  unknown: sharedUnknown,
  string: sharedString,
  number: make_schema_token<number>({ kind: "number" }),
  boolean: make_schema_token<boolean>({ kind: "boolean" }),
  null: make_schema_token<null>({ kind: "null" }),
  flag: FLAG_SCHEMA,
  attrs: ATTRS_SCHEMA_BUILDER,
  literal: ((...values: readonly JsonValue[]) => {
    if (values.length === 0) throw new TypeError("Schema literal requires at least one value.");
    return make_schema_token({ kind: "literal", literals: values });
  }) as LiveMapSchemaOperators["literal"],
  pick: ((...choices: readonly SchemaPickOperand[]) => make_unified_pick(choices)) as LiveMapSchemaOperators["pick"],
  tagged: ((discriminator: string, variants: LiveMapSchemaVariants) => make_schema_token({ kind: "pick", choices: make_tagged_schema_choices(discriminator, variants) })) as LiveMapSchemaOperators["tagged"],
  recurse: (makeInput: () => LiveMapSchemaInput) => make_schema_token({ kind: "recurse", recurse: makeInput }),
  array: (item: LiveMapSchemaInput) => make_schema_token({ kind: "array", item }),
  tuple: ((...items: readonly SchemaTupleOperand[]) => make_unified_tuple(items)) as LiveMapSchemaOperators["tuple"],
  record: (value: LiveMapSchemaInput) => make_schema_token({ kind: "record", record: value }),
  object: (shape: LiveMapSchemaShape) => make_schema_token({ kind: "object", props: shape }),
  partial: ((input: LiveMapSchemaInput) => make_partial_schema_input(input, false)) as LiveMapSchemaOperators["partial"],
  deepPartial: ((input: LiveMapSchemaInput) => make_partial_schema_input(input, true)) as LiveMapSchemaOperators["deepPartial"],
  exact: (shape: LiveMapSchemaShape) => make_schema_token({ kind: "object", props: shape, exact: true }),
  empty: sharedEmpty,
  repeat: ((countOrItem: number | InternalDocumentItemSchema, maybeItem?: InternalDocumentItemSchema) => (
    maybeItem === undefined
      ? make_document_repeat_schema(countOrItem as InternalDocumentItemSchema)
      : make_document_counted_repeat_schema(countOrItem as number, maybeItem)
  )) as DocumentRepeatOperator,
  tag: make_schema_tag_family(),
};

const toolkitRecord: Record<string, unknown> = { ...LIVEMAP_SCHEMA_RUNTIME_BASE };
for (const tag of [...HTML_TAGS, ...SVG_TAGS]) {
  if (Object.hasOwn(toolkitRecord, tag)) continue;
  toolkitRecord[tag] = (...children: readonly object[]) => make_document_element_schema(tag, children);
}
const LIVEMAP_SCHEMA_RUNTIME = Object.freeze(toolkitRecord) as LiveMapSchemaBuilder;

const LIVEMAP_SCHEMA = LIVEMAP_SCHEMA_RUNTIME;

/**
 * Define a typed LiveMap schema from the builder surface.
 *
 * The returned schema carries both runtime validation rules and an inferred
 * TypeScript value type used by schema-bound LiveMap APIs.
 */
export function define_livemap_schema<const TExpression extends InternalLiveMapSchemaDefinition>(
  define: (schema: LiveMapSchemaBuilder) => TExpression,
): InternalDefinedLiveMapSchema<TExpression> {
  return define_schema_expression(define(LIVEMAP_SCHEMA));
}

function make_livemap_schema<const TInput extends LiveMapSchemaInput>(
  input: TInput,
): LiveMapProjectedSchema<InferLiveMapSchemaPresent<TInput>> {
  return define_schema_expression(input) as LiveMapProjectedSchema<InferLiveMapSchemaPresent<TInput>>;
}

function define_schema_expression<const TExpression extends InternalLiveMapSchemaDefinition>(
  expression: TExpression,
): InternalDefinedLiveMapSchema<TExpression> {
  const projectedRoot = definition_projected_schema_node(expression);
  const target = projectedRoot === undefined ? {} : projected_schema_surface(projectedRoot);
  const hasDocumentCapability = register_defined_document_schema(target, expression);
  const hasAttrsCapability = register_defined_document_attrs_schema(target, expression);
  if (projectedRoot === undefined && !hasDocumentCapability && !hasAttrsCapability) {
    throw new TypeError("schema.define(...) callback must return one recognized schema expression.");
  }
  if (projectedRoot !== undefined) DEFINED_PROJECTED_NODES.set(target, projectedRoot);
  return Object.freeze(target) as InternalDefinedLiveMapSchema<TExpression>;
}

function projected_schema_surface(root: LiveMapSchemaNode): LiveMapProjectedSchema {
  const compiledRules = collect_schema_rules(root, [], []);
  const rules = Object.freeze(compiledRules.map(({ rule }) => rule));
  const resolve = (
    path: LivePath,
  ): LiveMapSchemaResolution | undefined =>
    resolve_schema_path(compiledRules, path);
  const has = (path: LivePath): boolean => resolve(path) !== undefined;
  const must = Object.freeze({
    resolve: (path: LivePath): LiveMapSchemaResolution => {
      const resolved = resolve(path);
      if (resolved !== undefined) return resolved;
      throw new Error(
        `LiveMap schema has no rule for ${format_schema_path(path)}`,
      );
    },
  });
  return {
    root,
    rules,
    match: (path: LivePath) => resolve(path)?.rule,
    resolve,
    has,
    must,
    validateRoot: (value: JsonValue | undefined) => validate_public_schema_root(root, value),
    validateValue: (path: LivePath, value: JsonValue | undefined) => validate_public_schema_value(root, path, value),
    get optional() {
      return make_compiled_schema_token(Object.freeze({ ...root, optional: true }));
    },
    get nullable() {
      return make_compiled_schema_token(Object.freeze({ ...root, nullable: true }));
    },
    constrain: ((...args: SchemaConstraintArguments) =>
      make_compiled_schema_token(make_constrained_schema_node(root, args))) as LiveMapSchemaConstrainModifier<unknown>,
  } as LiveMapProjectedSchema;
}

/** Validate one already-admitted candidate without materializing or rereading caller state. */
export function validate_livemap_schema_projected_root(
  schema: LiveMapProjectedSchema,
  value: OrderedProjectedValue,
): LiveMapSchemaValidation {
  return validate_schema_node(schema.root, [], value);
}

function make_schema_token<TValue = unknown>(draft: LiveMapSchemaDraft): LiveMapSchemaToken<TValue> {
  const token = Object.freeze({
    kind: draft.kind,
    get optional() {
      return make_schema_token({ ...draft, optional: true });
    },
    get nullable() {
      return make_schema_token({ ...draft, nullable: true });
    },
    constrain: ((...args: SchemaConstraintArguments) => {
      const constraint = normalize_schema_constraint_arguments(args);
      return make_schema_token({
        kind: "constrain",
        base: token,
        ...(constraint.label === undefined ? {} : { label: constraint.label }),
        validate: constraint.validate,
      });
    }) as unknown as LiveMapSchemaConstrainModifier<TValue>,
    [SCHEMA_DRAFT]: draft,
  }) as LiveMapSchemaToken<TValue> & Readonly<{ [SCHEMA_DRAFT]: LiveMapSchemaDraft }>;

  return token;
}

function make_compiled_schema_token<TValue = unknown>(root: LiveMapSchemaNode): LiveMapSchemaToken<TValue> {
  const token = {
    kind: root.kind,
    get optional() {
      return make_compiled_schema_token(Object.freeze({ ...root, optional: true }));
    },
    get nullable() {
      return make_compiled_schema_token(Object.freeze({ ...root, nullable: true }));
    },
    constrain: ((...args: SchemaConstraintArguments) =>
      make_compiled_schema_token(make_constrained_schema_node(root, args))) as unknown as LiveMapSchemaConstrainModifier<TValue>,
  } as LiveMapSchemaToken<TValue>;
  COMPILED_PROJECTED_TOKENS.set(token, root);
  return Object.freeze(token);
}

type SchemaConstraintArguments =
  | readonly [LiveMapSchemaConstraint]
  | readonly [string, LiveMapSchemaConstraint];

function normalize_schema_constraint_arguments(
  args: readonly unknown[],
): Readonly<{ label?: string; validate: LiveMapSchemaConstraint }> {
  if (args.length === 1 && typeof args[0] === "function") {
    return Object.freeze({ validate: args[0] as LiveMapSchemaConstraint });
  }
  if (args.length === 2 && typeof args[0] === "string" && typeof args[1] === "function") {
    return Object.freeze({ label: args[0], validate: args[1] as LiveMapSchemaConstraint });
  }
  throw new TypeError("Schema.constrain requires a predicate or a diagnostic label followed by a predicate.");
}

function make_constrained_schema_node(
  base: LiveMapSchemaNode,
  args: readonly unknown[],
): LiveMapSchemaNode {
  const constraint = normalize_schema_constraint_arguments(args);
  return Object.freeze({
    kind: "constrain",
    optional: false,
    nullable: false,
    exact: false,
    literals: Object.freeze([]),
    base,
    ...(constraint.label === undefined ? {} : { label: constraint.label }),
    validate: constraint.validate,
  });
}

function make_unified_pick(choices: readonly SchemaPickOperand[]): object {
  if (choices.length === 0) throw new TypeError("Schema pick requires at least one choice.");
  const projected = choices.every(is_projected_schema_choice);
  const target = projected
    ? make_schema_token({ kind: "pick", choices: choices as readonly LiveMapSchemaChoice[] })
    : {};
  add_document_pick_capabilities(target, choices);
  if (!projected && document_item_node(target) === undefined && document_content_node(target) === undefined) {
    throw new TypeError("Schema pick choices do not share a compatible schema capability.");
  }
  return Object.isFrozen(target) ? target : Object.freeze(target);
}

function make_unified_tuple(items: readonly SchemaTupleOperand[]): object {
  const projected = items.every((item) => is_schema_input(item));
  const target = projected
    ? make_schema_token({ kind: "tuple", items: items as readonly LiveMapSchemaInput[] })
    : {};
  add_document_tuple_capability(target, items);
  if (!projected && document_content_node(target) === undefined) {
    throw new TypeError("Schema tuple items do not share a compatible schema capability.");
  }
  return Object.isFrozen(target) ? target : Object.freeze(target);
}

function is_projected_schema_choice(choice: SchemaPickOperand): choice is LiveMapSchemaChoice {
  if (is_schema_input(choice)) return true;
  if (document_item_node(choice) !== undefined || document_content_node(choice) !== undefined) return false;
  try {
    admit_projected_value(choice);
    return true;
  } catch {
    return false;
  }
}

function projected_schema_node(value: unknown): LiveMapSchemaNode | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const defined = DEFINED_PROJECTED_NODES.get(value);
  if (defined !== undefined) return defined;
  const compiled = COMPILED_PROJECTED_TOKENS.get(value);
  if (compiled !== undefined) return compiled;
  if (is_schema_token(value)) return normalize_schema_draft(value[SCHEMA_DRAFT]);
  return undefined;
}

function definition_projected_schema_node(value: unknown): LiveMapSchemaNode | undefined {
  return projected_schema_node(value);
}

function make_partial_schema_input(input: LiveMapSchemaInput, deep: boolean): LiveMapSchemaToken {
  const node = normalize_schema_input(input);
  if (node.kind !== "object" || node.props === undefined) {
    throw new TypeError(`${deep ? "deepPartial" : "partial"} requires an object schema expression.`);
  }
  return make_compiled_schema_token(Object.freeze({
    ...node,
    props: Object.freeze(node.props.map(([key, child]) => Object.freeze([
      key,
      deep
        ? make_deep_optional_schema_node(child)
        : Object.freeze({ ...child, optional: true }),
    ] as const))),
  }));
}

function make_deep_optional_schema_node(node: LiveMapSchemaNode): LiveMapSchemaNode {
  return Object.freeze({
    ...node,
    optional: true,
    ...(node.kind === "object" && node.props !== undefined
      ? { props: Object.freeze(node.props.map(([key, child]) => Object.freeze([key, make_deep_optional_schema_node(child)] as const))) }
      : {}),
    ...(node.kind === "array" && node.item !== undefined
      ? { item: make_deep_optional_schema_node(node.item) }
      : {}),
    ...(node.kind === "tuple" && node.items !== undefined
      ? { items: Object.freeze(node.items.map(make_deep_optional_schema_node)) }
      : {}),
    ...(node.kind === "record" && node.record !== undefined
      ? { record: make_deep_optional_schema_node(node.record) }
      : {}),
  });
}

function make_tagged_schema_choices(discriminator: string, variants: LiveMapSchemaVariants): readonly LiveMapSchemaChoice[] {
  const choices: LiveMapSchemaChoice[] = [];

  for (const [tag, variant] of schema_variant_entries(variants)) {
    const node = normalize_schema_input(variant);
    if (node.kind !== "object" || node.props === undefined || node.optional || node.nullable) {
      throw new TypeError(`LiveMap tagged schema variant ${JSON.stringify(tag)} must be an unmodified object schema expression.`);
    }
    const discriminatorNode = normalize_schema_draft({ kind: "literal", literals: [tag] });
    choices.push(make_compiled_schema_token(Object.freeze({
      ...node,
      props: Object.freeze([
        ...node.props.filter(([key]) => key !== discriminator),
        Object.freeze([discriminator, discriminatorNode] as const),
      ]),
    })));
  }

  if (choices.length === 0) throw new TypeError("Schema tagged variants require at least one branch.");
  return Object.freeze(choices);
}



function normalize_schema_input(input: LiveMapSchemaInput): LiveMapSchemaNode {
  const node = projected_schema_node(input);
  if (node !== undefined) return node;
  if (document_item_node(input) !== undefined || document_content_node(input) !== undefined) {
    throw new TypeError("Projected schema composition received a document-only schema expression.");
  }
  throw new TypeError("Projected schema composition received an unrecognized schema expression.");
}

function normalize_schema_draft(draft: LiveMapSchemaDraft): LiveMapSchemaNode {
  return Object.freeze({
    kind: draft.kind,
    optional: draft.optional === true,
    nullable: draft.nullable === true,
    exact: draft.exact === true,
    literals: Object.freeze((draft.literals ?? []).map((literal) => admit_projected_value(literal))),
    ...(draft.choices !== undefined ? { choices: Object.freeze(draft.choices.map((choice) => normalize_schema_choice(choice))) } : {}),
    ...(draft.recurse !== undefined ? { recurse: memoize_schema_recursion(draft.recurse) } : {}),
    ...(draft.base !== undefined ? { base: normalize_schema_input(draft.base) } : {}),
    ...(draft.label !== undefined ? { label: draft.label } : {}),
    ...(draft.validate !== undefined ? { validate: draft.validate } : {}),
    ...(draft.item !== undefined ? { item: normalize_schema_input(draft.item) } : {}),
    ...(draft.items !== undefined ? { items: Object.freeze(draft.items.map((item) => normalize_schema_input(item))) } : {}),
    ...(draft.props !== undefined ? { props: normalize_schema_props(draft.props) } : {}),
    ...(draft.record !== undefined ? { record: normalize_schema_input(draft.record) } : {}),
  });
}

function normalize_schema_choice(choice: LiveMapSchemaChoice): LiveMapSchemaNode {
  if (is_schema_input(choice)) return normalize_schema_input(choice);
  return normalize_schema_draft({ kind: "literal", literals: [choice] });
}

function memoize_schema_recursion(makeInput: () => LiveMapSchemaInput): () => LiveMapSchemaNode {
  let node: LiveMapSchemaNode | undefined;

  return () => {
    node ??= normalize_schema_input(makeInput());
    return node;
  };
}

function normalize_schema_props(shape: LiveMapSchemaShape): readonly (readonly [string, LiveMapSchemaNode])[] {
  return Object.freeze(schema_shape_entries(shape).map(([key, value]) => (
    Object.freeze([key, normalize_schema_input(value)] as const)
  )));
}

function is_schema_input(value: unknown): value is LiveMapSchemaInput {
  if (projected_schema_node(value) !== undefined) return true;
  return false;
}

function is_schema_token(value: unknown): value is LiveMapSchemaToken & Readonly<{ [SCHEMA_DRAFT]: LiveMapSchemaDraft }> {
  return typeof value === "object"
    && value !== null
    && Object.getOwnPropertyDescriptor(value, SCHEMA_DRAFT)?.value !== undefined;
}

function schema_shape_entries(shape: LiveMapSchemaShape): readonly (readonly [string, LiveMapSchemaInput])[] {
  const prototype = Object.getPrototypeOf(shape);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("LiveMap schema shape must use Object.prototype or null.");
  }
  const entries: Array<readonly [string, LiveMapSchemaInput]> = [];
  for (const key of Reflect.ownKeys(shape)) {
    if (typeof key !== "string") throw new TypeError("LiveMap schema shape cannot contain symbol keys.");
    const descriptor = Object.getOwnPropertyDescriptor(shape, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`LiveMap schema shape property ${JSON.stringify(key)} must be an enumerable data property.`);
    }
    entries.push(Object.freeze([key, descriptor.value] as const));
  }
  return Object.freeze(entries);
}

function schema_variant_entries(variants: LiveMapSchemaVariants): readonly (readonly [string, LiveMapSchemaInput])[] {
  const prototype = Object.getPrototypeOf(variants);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("LiveMap tagged schema variants must use Object.prototype or null.");
  }
  const entries: Array<readonly [string, LiveMapSchemaInput]> = [];
  for (const key of Reflect.ownKeys(variants)) {
    if (typeof key !== "string") throw new TypeError("LiveMap tagged schema variants cannot contain symbol keys.");
    const descriptor = Object.getOwnPropertyDescriptor(variants, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`LiveMap tagged schema variant ${JSON.stringify(key)} must be an enumerable data property.`);
    }
    if (!is_schema_input(descriptor.value)) {
      throw new TypeError(`LiveMap tagged schema variant ${JSON.stringify(key)} must be a projected schema expression.`);
    }
    entries.push(Object.freeze([key, descriptor.value] as const));
  }
  return Object.freeze(entries);
}

function collect_schema_rules(
  node: LiveMapSchemaNode,
  path: LivePath,
  matchPath: LiveMapSchemaMatchPath,
): readonly CompiledLiveMapSchemaRule[] {
  const rules: CompiledLiveMapSchemaRule[] = [
    Object.freeze({
      rule: schema_rule_from_node(node, path),
      matchPath,
    }),
  ];
  if (node.kind === "recurse") return rules;
  if (node.kind === "constrain") return rules;
  if (node.kind === "object" && node.props !== undefined) {
    for (const [key, child] of node.props) {
      rules.push(...collect_schema_rules(
        child,
        [...path, key],
        [...matchPath, key],
      ));
    }
  }
  if (node.kind === "array" && node.item !== undefined) {
    rules.push(...collect_schema_rules(
      node.item,
      [...path, PUBLIC_WILDCARD_PATH_PART],
      [...matchPath, ARRAY_INDEX_MATCH_PART],
    ));
  }
  if (node.kind === "tuple" && node.items !== undefined) {
    node.items.forEach((item, index) => {
      rules.push(...collect_schema_rules(
        item,
        [...path, index],
        [...matchPath, index],
      ));
    });
  }
  if (node.kind === "record" && node.record !== undefined) {
    rules.push(...collect_schema_rules(
      node.record,
      [...path, PUBLIC_WILDCARD_PATH_PART],
      [...matchPath, RECORD_KEY_MATCH_PART],
    ));
  }
  return rules;
}

function schema_rule_from_node(node: LiveMapSchemaNode, path: LivePath): LiveMapSchemaRule {
  return Object.freeze({
    kind: node.kind,
    path,
    optional: node.optional,
    nullable: node.nullable,
    exact: node.exact,
    ...(node.literals.length > 0 ? {
      literals: Object.freeze(node.literals.map(materialize_projected_value)),
    } : {}),
  });
}

// CHANGED: expose one authoritative concrete-path resolver while keeping
// private wildcard matcher paths out of the public schema surface.
function resolve_schema_path(
  rules: readonly CompiledLiveMapSchemaRule[],
  path: LivePath,
): LiveMapSchemaResolution | undefined {
  const rule = match_schema_rule(rules, path);
  if (rule === undefined) return undefined;
  const resolvedPath = clone_live_path(path);
  const parentPath = parent_live_path(path);
  if (parentPath === undefined) {
    return Object.freeze({
      path: resolvedPath,
      rule,
    });
  }
  const parentRule = match_schema_rule(rules, parentPath);
  return Object.freeze({
    path: resolvedPath,
    rule,
    ...(path[path.length - 1] !== undefined
      ? { key: path[path.length - 1] }
      : {}),
    parentPath: clone_live_path(parentPath),
    ...(parentRule !== undefined ? { parentRule } : {}),
  });
}

function match_schema_rule(
  rules: readonly CompiledLiveMapSchemaRule[],
  path: LivePath,
): LiveMapSchemaRule | undefined {
  let bestRule: CompiledLiveMapSchemaRule | undefined;
  for (const compiledRule of rules) {
    if (!schema_paths_match(compiledRule.matchPath, path)) continue;
    if (
      bestRule === undefined
      || compiledRule.matchPath.length > bestRule.matchPath.length
    ) {
      bestRule = compiledRule;
    }
  }
  return bestRule?.rule;
}

function schema_paths_match(
  pattern: LiveMapSchemaMatchPath,
  path: LivePath,
): boolean {
  if (pattern.length !== path.length) return false;
  return pattern.every((part, index) => {
    if (part === ARRAY_INDEX_MATCH_PART) {
      return typeof path[index] === "number";
    }
    if (part === RECORD_KEY_MATCH_PART) {
      return typeof path[index] === "string";
    }
    return part === path[index];
  });
}

function validate_public_schema_root(
  root: LiveMapSchemaNode,
  value: JsonValue | undefined,
): LiveMapSchemaValidation {
  return admit_public_schema_value(value, [], (admitted) => validate_schema_node(root, [], admitted));
}

function validate_public_schema_value(
  root: LiveMapSchemaNode,
  path: LivePath,
  value: JsonValue | undefined,
): LiveMapSchemaValidation {
  const node = schema_node_at_path(root, path);
  if (node === undefined) {
    return validation_issue(
      "UNKNOWN_PATH",
      path,
      `LiveMap schema has no rule for ${format_schema_path(path)}`,
    );
  }
  return admit_public_schema_value(value, path, (admitted) => validate_schema_node(node, path, admitted));
}

function admit_public_schema_value(
  value: unknown,
  path: LivePath,
  validate: (value: OrderedProjectedValue) => LiveMapSchemaValidation,
): LiveMapSchemaValidation {
  try {
    return validate(admit_projected_value(value, path));
  } catch (error) {
    if (!(error instanceof ProjectedValueAdmissionError)) throw error;
    return validation_issue(
      "TYPE_MISMATCH",
      error.path,
      `LiveMap schema received an invalid projected value at ${format_schema_path(error.path)} (${error.code})`,
      { received: projected_admission_received(error) },
    );
  }
}

function schema_node_at_path(node: LiveMapSchemaNode, path: LivePath): LiveMapSchemaNode | undefined {
  if (path.length === 0) return node;
  if (node.kind === "recurse") return node.recurse === undefined ? undefined : schema_node_at_path(node.recurse(), path);
  if (node.kind === "constrain") return node.base === undefined ? undefined : schema_node_at_path(node.base, path);

  const [part, ...rest] = path;

  if (node.kind === "object" && typeof part === "string") {
    const child = node.props?.find(([key]) => key === part)?.[1];
    if (child !== undefined) return schema_node_at_path(child, rest);
    if (node.exact) return undefined;
    return undefined;
  }

  if (node.kind === "array" && typeof part === "number") {
    return node.item === undefined ? undefined : schema_node_at_path(node.item, rest);
  }

  if (node.kind === "tuple" && typeof part === "number") {
    const child = node.items?.[part];
    return child === undefined ? undefined : schema_node_at_path(child, rest);
  }

  if (node.kind === "record" && typeof part === "string") {
    return node.record === undefined ? undefined : schema_node_at_path(node.record, rest);
  }

  return undefined;
}

const MISSING_SCHEMA_VALUE: unique symbol = Symbol("LiveMapMissingSchemaValue");
type SchemaCandidateValue = OrderedProjectedValue | typeof MISSING_SCHEMA_VALUE;

function validate_schema_node(node: LiveMapSchemaNode, path: LivePath, value: SchemaCandidateValue): LiveMapSchemaValidation {
  if (value === MISSING_SCHEMA_VALUE) {
    return node.optional
      ? validation_ok()
      : expected_schema_value_issue(
        node,
        path,
        "missing",
        "MISSING_REQUIRED",
      );
  }

  if (node.kind === "constrain") {
    if (value === null && node.nullable) return validation_ok();
    return validate_constrain_node(node, path, value);
  }

  if (value === null) {
    if (node.kind === "null" || node.nullable) return validation_ok();
    return expected_schema_value_issue(node, path, "null");
  }

  if (node.kind === "unknown") return validation_ok();

  if (node.kind === "literal") return validate_literal_node(node, path, value);
  if (node.kind === "pick") return validate_pick_node(node, path, value);
  if (node.kind === "recurse") return validate_recurse_node(node, path, value);
  if (node.kind === "array") return validate_array_node(node, path, value);
  if (node.kind === "tuple") return validate_tuple_node(node, path, value);
  if (node.kind === "object") return validate_object_node(node, path, value);
  if (node.kind === "record") return validate_record_node(node, path, value);

  if (typeof value !== node.kind) {
    return expected_schema_value_issue(node, path, json_value_type_label(value));
  }

  return validation_ok();
}


function validate_literal_node(node: LiveMapSchemaNode, path: LivePath, value: OrderedProjectedValue): LiveMapSchemaValidation {
  if (node.literals.some((literal) => ordered_projected_value_equal(literal, value))) return validation_ok();

  return expected_schema_value_issue(
    node,
    path,
    emit_ordered_json(value),
    "INVALID_LITERAL",
  );
}

function closest_schema_validation(validations: readonly LiveMapSchemaValidation[]): LiveMapSchemaValidation | undefined {
  let closestValidation: LiveMapSchemaValidation | undefined;

  for (const validation of validations) {
    if (closestValidation === undefined || validation.issues.length < closestValidation.issues.length) {
      closestValidation = validation;
    }
  }

  return closestValidation;
}

function validate_pick_node(node: LiveMapSchemaNode, path: LivePath, value: OrderedProjectedValue): LiveMapSchemaValidation {
  const choices = node.choices ?? [];
  const validations = choices.map((choice) => validate_schema_node(choice, path, value));
  if (validations.some((validation) => validation.ok)) return validation_ok();

  if (is_ordered_projected_object(value) && choices.some((choice) => choice.kind === "object")) {
    const closestValidation = closest_schema_validation(validations);
    if (closestValidation !== undefined && closestValidation.issues.length > 0) return closestValidation;
  }

  return expected_schema_value_issue(node, path, json_value_type_label(value));
}

function validate_recurse_node(node: LiveMapSchemaNode, path: LivePath, value: OrderedProjectedValue): LiveMapSchemaValidation {
  if (node.recurse === undefined) {
    return validation_issue(
      "INVALID_SCHEMA",
      path,
      `LiveMap schema recursion rule is not defined at ${format_schema_path(path)}`,
    );
  }
  return validate_schema_node(node.recurse(), path, value);
}

function validate_constrain_node(node: LiveMapSchemaNode, path: LivePath, value: OrderedProjectedValue): LiveMapSchemaValidation {
  if (node.base === undefined || node.validate === undefined) {
    return validation_issue(
      "INVALID_SCHEMA",
      path,
      `LiveMap schema constraint is not defined at ${format_schema_path(path)}`,
    );
  }

  const baseValidation = validate_schema_node(node.base, path, value);
  if (!baseValidation.ok) return baseValidation;

  if (node.validate(materialize_projected_value(value))) return validation_ok();

  return expected_schema_value_issue(
    node,
    path,
    emit_ordered_json(value),
    "INVALID_CONSTRAINT",
  );
}

function validate_array_node(node: LiveMapSchemaNode, path: LivePath, value: OrderedProjectedValue): LiveMapSchemaValidation {
  if (!Array.isArray(value)) {
    return expected_schema_value_issue(node, path, json_value_type_label(value));
  }

  if (node.item === undefined) return validation_ok();

  return merge_validations(value.map((item, index) => validate_schema_node(node.item as LiveMapSchemaNode, [...path, index], item)));
}

function validate_tuple_node(node: LiveMapSchemaNode, path: LivePath, value: OrderedProjectedValue): LiveMapSchemaValidation {
  if (!Array.isArray(value)) {
    return expected_schema_value_issue(node, path, json_value_type_label(value));
  }

  const items = node.items ?? [];
  const validations: LiveMapSchemaValidation[] = [];

  items.forEach((item, index) => {
    validations.push(validate_schema_node(
      item,
      [...path, index],
      index < value.length ? value[index] as OrderedProjectedValue : MISSING_SCHEMA_VALUE,
    ));
  });

  if (value.length > items.length) {
    for (let index = items.length; index < value.length; index += 1) {
      validations.push(validation_issue(
        "TUPLE_INDEX_OUT_OF_RANGE",
        [...path, index],
        `LiveMap schema does not allow tuple index ${index} at ${format_schema_path([...path, index])}`,
      ));
    }
  }

  return merge_validations(validations);
}

function validate_object_node(node: LiveMapSchemaNode, path: LivePath, value: OrderedProjectedValue): LiveMapSchemaValidation {
  if (!is_ordered_projected_object(value)) {
    return expected_schema_value_issue(node, path, json_value_type_label(value));
  }

  const validations: LiveMapSchemaValidation[] = [];
  const props = new Map(node.props ?? []);
  const values = new Map(value.entries);

  for (const [key, child] of props) {
    validations.push(validate_schema_node(
      child,
      [...path, key],
      values.has(key) ? values.get(key) as OrderedProjectedValue : MISSING_SCHEMA_VALUE,
    ));
  }

  if (node.exact) {
    for (const [key] of value.entries) {
      if (!props.has(key)) {
        validations.push(validation_issue(
          "UNKNOWN_KEY",
          [...path, key],
          `LiveMap schema does not allow key ${JSON.stringify(key)} at ${format_schema_path([...path, key])}`,
        ));
      }
    }
  }

  return merge_validations(validations);
}

function validate_record_node(node: LiveMapSchemaNode, path: LivePath, value: OrderedProjectedValue): LiveMapSchemaValidation {
  if (!is_ordered_projected_object(value)) {
    return expected_schema_value_issue(node, path, json_value_type_label(value));
  }

  if (node.record === undefined) return validation_ok();

  return merge_validations(value.entries.map(([key, item]) => validate_schema_node(node.record as LiveMapSchemaNode, [...path, key], item)));
}

function expected_schema_value_issue(
  node: LiveMapSchemaNode,
  path: LivePath,
  received: string,
  code: LiveMapSchemaIssueCode = "TYPE_MISMATCH",
): LiveMapSchemaValidation {
  const expected = schema_kind_label(node);
  return validation_issue(
    code,
    path,
    `LiveMap schema expected ${expected} at ${format_schema_path(path)}, received ${received}`,
    {
      expected,
      received,
    },
  );
}

function validation_ok(): LiveMapSchemaValidation {
  return Object.freeze({ ok: true, issues: [] });
}

type LiveMapSchemaIssueDetails = Readonly<{
  expected?: string;
  received?: string;
}>;

function validation_issue(
  code: LiveMapSchemaIssueCode,
  path: LivePath,
  message: string,
  details: LiveMapSchemaIssueDetails = {},
): LiveMapSchemaValidation {
  return Object.freeze({
    ok: false,
    issues: [
      Object.freeze({
        code,
        path,
        message,
        ...(details.expected !== undefined
          ? { expected: details.expected }
          : {}),
        ...(details.received !== undefined
          ? { received: details.received }
          : {}),
      }),
    ],
  });
}

function merge_validations(validations: readonly LiveMapSchemaValidation[]): LiveMapSchemaValidation {
  const issues = validations.flatMap((validation) => validation.issues);

  return Object.freeze({
    ok: issues.length === 0,
    issues,
  });
}

function schema_kind_label(node: LiveMapSchemaNode): string {
  if (node.kind === "literal") return node.literals.map(emit_ordered_json).join(" | ");
  if (node.kind === "pick") return (node.choices ?? []).map(schema_kind_label).join(" | ") || "pick";
  if (node.kind === "recurse") return node.recurse === undefined ? "recurse" : schema_kind_label(node.recurse());
  if (node.kind === "constrain") return node.label ?? "constraint";
  if (node.nullable && node.kind !== "null") return `${node.kind} | null`;

  return node.kind;
}

function json_value_type_label(value: OrderedProjectedValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";

  return typeof value;
}

function projected_admission_received(error: ProjectedValueAdmissionError): string {
  if (error.code === "UNDEFINED_VALUE") return "undefined";
  if (error.code === "NONFINITE_NUMBER") return "non-finite number";
  return error.code.toLowerCase().replaceAll("_", " ");
}

function format_schema_path(path: LivePath): string {
  return JSON.stringify(path);
}
