// schema.ts

import type { JsonValue } from "../../core/types.js";
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

export type LiveMapSchemaKind =
  | "unknown"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "literal"
  | "pick"
  | "lazy"
  | "refine"
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
  readonly: boolean;
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
export type LiveMapSchema<TValue = unknown> = Readonly<{
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
}> & Readonly<{ readonly __value?: TValue }>;

export interface LiveMapSchemaShape {
  readonly [key: string]: LiveMapSchemaInput;
}

export interface LiveMapSchemaVariants {
  readonly [variant: string]: LiveMapSchemaShape;
}

export type LiveMapSchemaInput<TValue = unknown> =
  | LiveMapSchemaToken<TValue>
  | LiveMapSchemaShape;

export type LiveMapSchemaChoice =
  | JsonValue
  | LiveMapSchemaInput;

export type LiveMapSchemaRefinement<TValue = JsonValue> = (value: TValue) => boolean;

export type InferLiveMapSchema<TSchema> = TSchema extends LiveMapSchema<infer TValue> ? TValue : never;
export type LiveMapSchemaValue<TSchema> = InferLiveMapSchema<TSchema>;
export type InferLiveMapSchemaToken<TToken> = TToken extends LiveMapSchemaToken<infer TValue> ? TValue : never;

export type InferLiveMapSchemaInput<TInput> =
  TInput extends LiveMapSchemaToken<infer TValue> ? TValue :
  TInput extends LiveMapSchemaShape ? InferLiveMapSchemaShape<TInput> :
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
  [Tag in keyof TVariants & string]: Simplify<InferLiveMapSchemaShape<TVariants[Tag]> & { [Key in TDiscriminator]: Tag }>;
}[keyof TVariants & string];

type DeepPartialSchemaValue<TValue> =
  TValue extends readonly unknown[]
    ? number extends TValue["length"]
      ? readonly DeepPartialSchemaValue<Exclude<TValue[number], undefined>>[]
      : { readonly [Index in keyof TValue]?: DeepPartialSchemaValue<Exclude<TValue[Index], undefined>> }
    : TValue extends object
      ? string extends keyof TValue
        ? Readonly<Record<string, DeepPartialSchemaValue<Exclude<TValue[string], undefined>>>>
        : { [Key in keyof TValue]?: DeepPartialSchemaValue<Exclude<TValue[Key], undefined>> }
      : TValue;

type Simplify<TValue> = { [Key in keyof TValue]: TValue[Key] } & {};

/**
 * Builder surface used by `define_livemap_schema`.
 *
 * `object(...)` validates declared keys while allowing extra keys.
 * `exact(...)` validates declared keys and rejects extra keys.
 * `partial(...)` makes the top-level declared keys optional.
 * `deepPartial(...)` recursively makes declared object/array/tuple/record
 * children optional.
 */
export type LiveMapSchemaBuilder = Readonly<{
  unknown: LiveMapSchemaToken<JsonValue>;
  string: LiveMapSchemaToken<string>;
  number: LiveMapSchemaToken<number>;
  boolean: LiveMapSchemaToken<boolean>;
  null: LiveMapSchemaToken<null>;
  literal: <const TValues extends readonly JsonValue[]>(...values: TValues) => LiveMapSchemaToken<TValues[number]>;
  pick: <const TChoices extends readonly LiveMapSchemaChoice[]>(...choices: TChoices) => LiveMapSchemaToken<Exclude<InferLiveMapSchemaChoice<TChoices[number]>, undefined>>;
  tagged: <TDiscriminator extends string, TVariants extends LiveMapSchemaVariants>(discriminator: TDiscriminator, variants: TVariants) => LiveMapSchemaToken<InferLiveMapTaggedSchema<TDiscriminator, TVariants>>;
  lazy: <TInput extends LiveMapSchemaInput>(makeInput: () => TInput) => LiveMapSchemaToken<InferLiveMapSchemaPresent<TInput>>;
  refine: <TInput extends LiveMapSchemaInput>(base: TInput, label: string, validate: LiveMapSchemaRefinement<InferLiveMapSchemaPresent<TInput>>) => LiveMapSchemaToken<InferLiveMapSchemaPresent<TInput>>;
  array: <TInput extends LiveMapSchemaInput>(item: TInput) => LiveMapSchemaToken<readonly InferLiveMapSchemaPresent<TInput>[]>;
  tuple: <TItems extends readonly LiveMapSchemaInput[]>(...items: TItems) => LiveMapSchemaToken<InferLiveMapSchemaTuple<TItems>>;
  record: <TInput extends LiveMapSchemaInput>(value: TInput) => LiveMapSchemaToken<Readonly<Record<string, InferLiveMapSchemaPresent<TInput>>>>;
  object: <TShape extends LiveMapSchemaShape>(shape: TShape) => LiveMapSchemaToken<InferLiveMapSchemaShape<TShape>>;
  partial: <TShape extends LiveMapSchemaShape>(shape: TShape) => LiveMapSchemaToken<Partial<InferLiveMapSchemaShape<TShape>>>;
  deepPartial: <TShape extends LiveMapSchemaShape>(shape: TShape) => LiveMapSchemaToken<DeepPartialSchemaValue<InferLiveMapSchemaShape<TShape>>>;
  exact: <TShape extends LiveMapSchemaShape>(shape: TShape) => LiveMapSchemaToken<InferLiveMapSchemaShape<TShape>>;
}>;

export type LiveMapSchemaToken<TValue = unknown> = Readonly<{
  kind: LiveMapSchemaKind;
  optional: LiveMapSchemaToken<TValue | undefined>;
  nullable: LiveMapSchemaToken<TValue | null>;
  readonly: LiveMapSchemaToken<TValue>;
  array: LiveMapSchemaToken<readonly Exclude<TValue, undefined>[]>;
  readonly __value?: TValue;
}>;

type LiveMapSchemaNode = Readonly<{
  kind: LiveMapSchemaKind;
  optional: boolean;
  nullable: boolean;
  readonly: boolean;
  exact: boolean;
  literals: readonly OrderedProjectedValue[];
  choices?: readonly LiveMapSchemaNode[];
  lazy?: () => LiveMapSchemaNode;
  base?: LiveMapSchemaNode;
  label?: string;
  validate?: LiveMapSchemaRefinement;
  item?: LiveMapSchemaNode;
  items?: readonly LiveMapSchemaNode[];
  props?: readonly (readonly [string, LiveMapSchemaNode])[];
  record?: LiveMapSchemaNode;
}>;

type LiveMapSchemaDraft = Readonly<{
  kind: LiveMapSchemaKind;
  optional?: boolean;
  nullable?: boolean;
  readonly?: boolean;
  exact?: boolean;
  literals?: readonly JsonValue[];
  choices?: readonly LiveMapSchemaChoice[];
  lazy?: () => LiveMapSchemaInput;
  base?: LiveMapSchemaInput;
  label?: string;
  validate?: LiveMapSchemaRefinement;
  item?: LiveMapSchemaInput;
  items?: readonly LiveMapSchemaInput[];
  props?: LiveMapSchemaShape;
  record?: LiveMapSchemaInput;
}>;

const SCHEMA_DRAFT: unique symbol = Symbol("LiveMapSchemaDraft");
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

const LIVEMAP_SCHEMA_RUNTIME = Object.freeze({
  unknown: make_schema_token<JsonValue>({ kind: "unknown" }),
  string: make_schema_token<string>({ kind: "string" }),
  number: make_schema_token<number>({ kind: "number" }),
  boolean: make_schema_token<boolean>({ kind: "boolean" }),
  null: make_schema_token<null>({ kind: "null" }),
  literal: (...values: readonly JsonValue[]) => make_schema_token({ kind: "literal", literals: values }),
  pick: (...choices: readonly LiveMapSchemaChoice[]) => make_schema_token({ kind: "pick", choices }),
  tagged: (discriminator: string, variants: LiveMapSchemaVariants) => make_schema_token({ kind: "pick", choices: make_tagged_schema_choices(discriminator, variants) }),
  lazy: (makeInput: () => LiveMapSchemaInput) => make_schema_token({ kind: "lazy", lazy: makeInput }),
  refine: (base: LiveMapSchemaInput, label: string, validate: LiveMapSchemaRefinement) => make_schema_token({ kind: "refine", base, label, validate }),
  array: (item: LiveMapSchemaInput) => make_schema_token({ kind: "array", item }),
  tuple: (...items: readonly LiveMapSchemaInput[]) => make_schema_token({ kind: "tuple", items }),
  record: (value: LiveMapSchemaInput) => make_schema_token({ kind: "record", record: value }),
  object: (shape: LiveMapSchemaShape) => make_schema_token({ kind: "object", props: shape }),
  partial: (shape: LiveMapSchemaShape) => make_schema_token({ kind: "object", props: make_partial_schema_shape(shape) }),
  deepPartial: (shape: LiveMapSchemaShape) => make_schema_token({ kind: "object", props: make_deep_partial_schema_shape(shape) }),
  exact: (shape: LiveMapSchemaShape) => make_schema_token({ kind: "object", props: shape, exact: true }),
});

export const LIVEMAP_SCHEMA = LIVEMAP_SCHEMA_RUNTIME as unknown as LiveMapSchemaBuilder;

/**
 * Define a typed LiveMap schema from the builder surface.
 *
 * The returned schema carries both runtime validation rules and an inferred
 * TypeScript value type used by schema-bound LiveMap APIs.
 */
export function define_livemap_schema<const TInput extends LiveMapSchemaInput>(
  makeShape: (schema: LiveMapSchemaBuilder) => TInput,
): LiveMapSchema<InferLiveMapSchemaPresent<TInput>> {
  return make_livemap_schema(makeShape(LIVEMAP_SCHEMA));
}

export function make_livemap_schema<const TInput extends LiveMapSchemaInput>(
  input: TInput,
): LiveMapSchema<InferLiveMapSchemaPresent<TInput>> {
  const root = normalize_schema_input(input);
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
  return Object.freeze({
    root,
    rules,
    match: (path: LivePath) => resolve(path)?.rule,
    resolve,
    has,
    must,
    validateRoot: (value: JsonValue | undefined) => validate_public_schema_root(root, value),
    validateValue: (path: LivePath, value: JsonValue | undefined) => validate_public_schema_value(root, path, value),
  }) as LiveMapSchema<InferLiveMapSchemaPresent<TInput>>;
}

/** Validate one already-admitted candidate without materializing or rereading caller state. */
export function validate_livemap_schema_projected_root(
  schema: LiveMapSchema,
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
    get readonly() {
      return make_schema_token({ ...draft, readonly: true });
    },
    get array() {
      return make_schema_token({ kind: "array", item: token });
    },
    [SCHEMA_DRAFT]: draft,
  }) as LiveMapSchemaToken<TValue> & Readonly<{ [SCHEMA_DRAFT]: LiveMapSchemaDraft }>;

  return token;
}


function make_partial_schema_shape(shape: LiveMapSchemaShape): LiveMapSchemaShape {
  return schema_shape_from_entries(schema_shape_entries(shape).map(([key, value]) => (
    [key, make_optional_schema_input(value)] as const
  )));
}

function make_deep_partial_schema_shape(shape: LiveMapSchemaShape): LiveMapSchemaShape {
  return schema_shape_from_entries(schema_shape_entries(shape).map(([key, value]) => (
    [key, make_deep_optional_schema_input(value)] as const
  )));
}

function make_deep_optional_schema_input(input: LiveMapSchemaInput): LiveMapSchemaInput {
  if (is_schema_token(input)) return make_deep_optional_schema_token(input);

  return make_schema_token({ kind: "object", props: make_deep_partial_schema_shape(input as LiveMapSchemaShape), optional: true });
}

function make_deep_optional_schema_token(input: LiveMapSchemaToken): LiveMapSchemaToken {
  const token = input as LiveMapSchemaToken & Readonly<{ [SCHEMA_DRAFT]: LiveMapSchemaDraft }>;
  const draft = token[SCHEMA_DRAFT];

  if (draft.kind === "object" && draft.props !== undefined) {
    return make_schema_token({ ...draft, props: make_deep_partial_schema_shape(draft.props), optional: true });
  }

  if (draft.kind === "array" && draft.item !== undefined) {
    return make_schema_token({ ...draft, item: make_deep_optional_schema_input(draft.item), optional: true });
  }

  if (draft.kind === "tuple" && draft.items !== undefined) {
    return make_schema_token({ ...draft, items: draft.items.map((item) => make_deep_optional_schema_input(item)), optional: true });
  }

  if (draft.kind === "record" && draft.record !== undefined) {
    return make_schema_token({ ...draft, record: make_deep_optional_schema_input(draft.record), optional: true });
  }

  return input.optional;
}


function make_optional_schema_input(input: LiveMapSchemaInput): LiveMapSchemaInput {
  if (is_schema_token(input)) return input.optional;

  return make_schema_token({ kind: "object", props: input as LiveMapSchemaShape, optional: true });
}


function make_tagged_schema_choices(discriminator: string, variants: LiveMapSchemaVariants): readonly LiveMapSchemaChoice[] {
  const choices: LiveMapSchemaChoice[] = [];

  for (const [tag, shape] of schema_shape_entries(variants as LiveMapSchemaShape)) {
    choices.push(schema_shape_from_entries([
      ...schema_shape_entries(shape as LiveMapSchemaShape),
      [discriminator, make_schema_token({ kind: "literal", literals: [tag] })],
    ]));
  }

  return Object.freeze(choices);
}



function normalize_schema_input(input: LiveMapSchemaInput): LiveMapSchemaNode {
  if (is_schema_token(input)) return normalize_schema_draft(input[SCHEMA_DRAFT]);
  return normalize_schema_draft({ kind: "object", props: input as LiveMapSchemaShape });
}

function normalize_schema_draft(draft: LiveMapSchemaDraft): LiveMapSchemaNode {
  return Object.freeze({
    kind: draft.kind,
    optional: draft.optional === true,
    nullable: draft.nullable === true,
    readonly: draft.readonly === true,
    exact: draft.exact === true,
    literals: Object.freeze((draft.literals ?? []).map((literal) => admit_projected_value(literal))),
    ...(draft.choices !== undefined ? { choices: draft.choices.map((choice) => normalize_schema_choice(choice)) } : {}),
    ...(draft.lazy !== undefined ? { lazy: memoize_schema_lazy(draft.lazy) } : {}),
    ...(draft.base !== undefined ? { base: normalize_schema_input(draft.base) } : {}),
    ...(draft.label !== undefined ? { label: draft.label } : {}),
    ...(draft.validate !== undefined ? { validate: draft.validate } : {}),
    ...(draft.item !== undefined ? { item: normalize_schema_input(draft.item) } : {}),
    ...(draft.items !== undefined ? { items: draft.items.map((item) => normalize_schema_input(item)) } : {}),
    ...(draft.props !== undefined ? { props: normalize_schema_props(draft.props) } : {}),
    ...(draft.record !== undefined ? { record: normalize_schema_input(draft.record) } : {}),
  });
}

function normalize_schema_choice(choice: LiveMapSchemaChoice): LiveMapSchemaNode {
  if (is_schema_input(choice)) return normalize_schema_input(choice);
  return normalize_schema_draft({ kind: "literal", literals: [choice] });
}

function memoize_schema_lazy(makeInput: () => LiveMapSchemaInput): () => LiveMapSchemaNode {
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

function is_schema_input(value: LiveMapSchemaChoice): value is LiveMapSchemaInput {
  return is_schema_token(value) || is_schema_shape(value);
}

function is_schema_shape(value: LiveMapSchemaChoice): value is LiveMapSchemaShape {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return schema_shape_entries(value as LiveMapSchemaShape).some(([, item]) => is_schema_input(item as LiveMapSchemaChoice));
}

function is_schema_token(value: LiveMapSchemaChoice): value is LiveMapSchemaToken & Readonly<{ [SCHEMA_DRAFT]: LiveMapSchemaDraft }> {
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

function schema_shape_from_entries(
  entries: readonly (readonly [string, LiveMapSchemaInput])[],
): LiveMapSchemaShape {
  const shape = Object.create(null) as Record<string, LiveMapSchemaInput>;
  for (const [key, value] of entries) {
    Object.defineProperty(shape, key, {
      value,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(shape);
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
  if (node.kind === "lazy") return rules;
  if (node.kind === "refine") return rules;
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
    readonly: node.readonly,
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
  if (node.kind === "lazy") return node.lazy === undefined ? undefined : schema_node_at_path(node.lazy(), path);
  if (node.kind === "refine") return node.base === undefined ? undefined : schema_node_at_path(node.base, path);

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

  if (value === null) {
    if (node.kind === "null" || node.nullable) return validation_ok();
    return expected_schema_value_issue(node, path, "null");
  }

  if (node.kind === "unknown") return validation_ok();

  if (node.kind === "literal") return validate_literal_node(node, path, value);
  if (node.kind === "pick") return validate_pick_node(node, path, value);
  if (node.kind === "lazy") return validate_lazy_node(node, path, value);
  if (node.kind === "refine") return validate_refine_node(node, path, value);
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

function validate_lazy_node(node: LiveMapSchemaNode, path: LivePath, value: OrderedProjectedValue): LiveMapSchemaValidation {
  if (node.lazy === undefined) {
    return validation_issue(
      "INVALID_SCHEMA",
      path,
      `LiveMap schema lazy rule is not defined at ${format_schema_path(path)}`,
    );
  }
  return validate_schema_node(node.lazy(), path, value);
}

function validate_refine_node(node: LiveMapSchemaNode, path: LivePath, value: OrderedProjectedValue): LiveMapSchemaValidation {
  if (node.base === undefined || node.validate === undefined) {
    return validation_issue(
      "INVALID_SCHEMA",
      path,
      `LiveMap schema refinement is not defined at ${format_schema_path(path)}`,
    );
  }

  const baseValidation = validate_schema_node(node.base, path, value);
  if (!baseValidation.ok) return baseValidation;

  if (node.validate(materialize_projected_value(value))) return validation_ok();

  return expected_schema_value_issue(
    node,
    path,
    emit_ordered_json(value),
    "INVALID_REFINEMENT",
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
  if (node.kind === "lazy") return node.lazy === undefined ? "lazy" : schema_kind_label(node.lazy());
  if (node.kind === "refine") return node.label ?? "refinement";
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
