// schema.ts

import type { JsonValue } from "../../core/types.js";
import type { LivePath } from "./livemap.types.js";

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
  path: LivePath;
  message: string;
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

type InferLiveMapSchemaTuple<TItems extends readonly LiveMapSchemaInput[]> = {
  readonly [Index in keyof TItems]: InferLiveMapSchemaInput<TItems[Index]>;
};

type InferLiveMapTaggedSchema<TDiscriminator extends string, TVariants extends LiveMapSchemaVariants> = {
  [Tag in keyof TVariants & string]: Simplify<InferLiveMapSchemaShape<TVariants[Tag]> & { [Key in TDiscriminator]: Tag }>;
}[keyof TVariants & string];

type DeepPartialSchemaValue<TValue> =
  TValue extends readonly (infer Item)[] ? readonly DeepPartialSchemaValue<Item>[] :
  TValue extends object ? string extends keyof TValue ? Readonly<Record<string, DeepPartialSchemaValue<TValue[string]>>> : { [Key in keyof TValue]?: DeepPartialSchemaValue<TValue[Key]> } :
  TValue;

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
  pick: <const TChoices extends readonly LiveMapSchemaChoice[]>(...choices: TChoices) => LiveMapSchemaToken<InferLiveMapSchemaChoice<TChoices[number]>>;
  tagged: <TDiscriminator extends string, TVariants extends LiveMapSchemaVariants>(discriminator: TDiscriminator, variants: TVariants) => LiveMapSchemaToken<InferLiveMapTaggedSchema<TDiscriminator, TVariants>>;
  lazy: <TInput extends LiveMapSchemaInput>(makeInput: () => TInput) => LiveMapSchemaToken<InferLiveMapSchemaInput<TInput>>;
  refine: <TValue>(base: LiveMapSchemaInput<TValue>,label: string,validate: LiveMapSchemaRefinement<TValue & JsonValue>) => LiveMapSchemaToken<TValue>;
  array: <TInput extends LiveMapSchemaInput>(item: TInput) => LiveMapSchemaToken<readonly InferLiveMapSchemaInput<TInput>[]>;
  tuple: <TItems extends readonly LiveMapSchemaInput[]>(...items: TItems) => LiveMapSchemaToken<InferLiveMapSchemaTuple<TItems>>;
  record: <TInput extends LiveMapSchemaInput>(value: TInput) => LiveMapSchemaToken<Readonly<Record<string, InferLiveMapSchemaInput<TInput>>>>;
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
  array: LiveMapSchemaToken<readonly TValue[]>;
  readonly __value?: TValue;
}>;

type LiveMapSchemaNode = Readonly<{
  kind: LiveMapSchemaKind;
  optional: boolean;
  nullable: boolean;
  readonly: boolean;
  exact: boolean;
  literals: readonly JsonValue[];
  choices?: readonly LiveMapSchemaNode[];
  lazy?: () => LiveMapSchemaNode;
  base?: LiveMapSchemaNode;
  label?: string;
  validate?: LiveMapSchemaRefinement;
  item?: LiveMapSchemaNode;
  items?: readonly LiveMapSchemaNode[];
  props?: Readonly<Record<string, LiveMapSchemaNode>>;
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
const ARRAY_INDEX_PATH_PART = "*";
const RECORD_KEY_PATH_PART = "*";

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
export function define_livemap_schema<const TInput>(makeShape: (schema: LiveMapSchemaBuilder) => TInput): LiveMapSchema<InferLiveMapSchemaInput<TInput>> {
  return make_livemap_schema(makeShape(LIVEMAP_SCHEMA));
}

export function make_livemap_schema<const TInput>(input: TInput): LiveMapSchema<InferLiveMapSchemaInput<TInput>> {
  const root = normalize_schema_input(input as LiveMapSchemaInput);
  const rules = collect_schema_rules(root, []);

  return Object.freeze({
    root,
    rules,
    match: (path: LivePath) => match_schema_rule(rules, path),
    validateRoot: (value: JsonValue | undefined) => validate_schema_node(root, [], value),
    validateValue: (path: LivePath, value: JsonValue | undefined) => validate_schema_value(root, path, value),
  }) as LiveMapSchema<InferLiveMapSchemaInput<TInput>>;
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
  const partialShape: Record<string, LiveMapSchemaInput> = {};

  for (const [key, value] of Object.entries(shape)) {
    partialShape[key] = make_optional_schema_input(value);
  }

  return Object.freeze(partialShape);
}

function make_deep_partial_schema_shape(shape: LiveMapSchemaShape): LiveMapSchemaShape {
  const partialShape: Record<string, LiveMapSchemaInput> = {};

  for (const [key, value] of Object.entries(shape)) {
    partialShape[key] = make_deep_optional_schema_input(value);
  }

  return Object.freeze(partialShape);
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

  for (const [tag, shape] of Object.entries(variants)) {
    choices.push(Object.freeze({
      ...shape,
      [discriminator]: make_schema_token({ kind: "literal", literals: [tag] }),
    }));
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
    literals: draft.literals ?? [],
    choices: draft.choices === undefined ? undefined : draft.choices.map((choice) => normalize_schema_choice(choice)),
    lazy: draft.lazy === undefined ? undefined : memoize_schema_lazy(draft.lazy),
    base: draft.base === undefined ? undefined : normalize_schema_input(draft.base),
    label: draft.label,
    validate: draft.validate,
    item: draft.item === undefined ? undefined : normalize_schema_input(draft.item),
    items: draft.items === undefined ? undefined : draft.items.map((item) => normalize_schema_input(item)),
    props: draft.props === undefined ? undefined : normalize_schema_props(draft.props),
    record: draft.record === undefined ? undefined : normalize_schema_input(draft.record),
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

function normalize_schema_props(shape: LiveMapSchemaShape): Readonly<Record<string, LiveMapSchemaNode>> {
  const props: Record<string, LiveMapSchemaNode> = {};

  for (const [key, value] of Object.entries(shape)) {
    props[key] = normalize_schema_input(value);
  }

  return Object.freeze(props);
}

function is_schema_input(value: LiveMapSchemaChoice): value is LiveMapSchemaInput {
  return is_schema_token(value) || is_schema_shape(value);
}

function is_schema_shape(value: LiveMapSchemaChoice): value is LiveMapSchemaShape {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).some((item) => is_schema_input(item as LiveMapSchemaChoice));
}

function is_schema_token(value: LiveMapSchemaChoice): value is LiveMapSchemaToken & Readonly<{ [SCHEMA_DRAFT]: LiveMapSchemaDraft }> {
  return typeof value === "object" && value !== null && SCHEMA_DRAFT in value;
}

function collect_schema_rules(node: LiveMapSchemaNode, path: LivePath): readonly LiveMapSchemaRule[] {
  const rules: LiveMapSchemaRule[] = [schema_rule_from_node(node, path)];
  if (node.kind === "lazy") return rules;
  if (node.kind === "refine") return rules;

  if (node.kind === "object" && node.props !== undefined) {
    for (const [key, child] of Object.entries(node.props)) {
      rules.push(...collect_schema_rules(child, [...path, key]));
    }
  }

  if (node.kind === "array" && node.item !== undefined) {
    rules.push(...collect_schema_rules(node.item, [...path, ARRAY_INDEX_PATH_PART]));
  }

  if (node.kind === "tuple" && node.items !== undefined) {
    node.items.forEach((item, index) => {
      rules.push(...collect_schema_rules(item, [...path, index]));
    });
  }

  if (node.kind === "record" && node.record !== undefined) {
    rules.push(...collect_schema_rules(node.record, [...path, RECORD_KEY_PATH_PART]));
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
    literals: node.literals.length === 0 ? undefined : node.literals,
  });
}

function match_schema_rule(rules: readonly LiveMapSchemaRule[], path: LivePath): LiveMapSchemaRule | undefined {
  let bestRule: LiveMapSchemaRule | undefined;

  for (const rule of rules) {
    if (!schema_paths_match(rule.path, path)) continue;
    if (bestRule === undefined || rule.path.length > bestRule.path.length) bestRule = rule;
  }

  return bestRule;
}

function schema_paths_match(pattern: LivePath, path: LivePath): boolean {
  if (pattern.length !== path.length) return false;

  return pattern.every((part, index) => part === ARRAY_INDEX_PATH_PART || part === RECORD_KEY_PATH_PART || part === path[index]);
}

function validate_schema_value(root: LiveMapSchemaNode, path: LivePath, value: JsonValue | undefined): LiveMapSchemaValidation {
  const node = schema_node_at_path(root, path);
  if (node === undefined) {
    return validation_issue(path, `LiveMap schema has no rule for ${format_schema_path(path)}`);
  }

  return validate_schema_node(node, path, value);
}

function schema_node_at_path(node: LiveMapSchemaNode, path: LivePath): LiveMapSchemaNode | undefined {
  if (path.length === 0) return node;
  if (node.kind === "lazy") return node.lazy === undefined ? undefined : schema_node_at_path(node.lazy(), path);
  if (node.kind === "refine") return node.base === undefined ? undefined : schema_node_at_path(node.base, path);

  const [part, ...rest] = path;

  if (node.kind === "object" && typeof part === "string") {
    const child = node.props?.[part];
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

function validate_schema_node(node: LiveMapSchemaNode, path: LivePath, value: JsonValue | undefined): LiveMapSchemaValidation {
  if (value === undefined) {
    return node.optional ? validation_ok() : expected_schema_value_issue(node, path, "undefined");
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


function validate_literal_node(node: LiveMapSchemaNode, path: LivePath, value: JsonValue): LiveMapSchemaValidation {
  if (node.literals.some((literal) => json_values_equal(literal, value))) return validation_ok();

  return expected_schema_value_issue(node, path, JSON.stringify(value));
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

function validate_pick_node(node: LiveMapSchemaNode, path: LivePath, value: JsonValue): LiveMapSchemaValidation {
  const choices = node.choices ?? [];
  const validations = choices.map((choice) => validate_schema_node(choice, path, value));
  if (validations.some((validation) => validation.ok)) return validation_ok();

  if (is_plain_json_object(value) && choices.some((choice) => choice.kind === "object")) {
    const closestValidation = closest_schema_validation(validations);
    if (closestValidation !== undefined && closestValidation.issues.length > 0) return closestValidation;
  }

  return expected_schema_value_issue(node, path, json_value_type_label(value));
}

function validate_lazy_node(node: LiveMapSchemaNode, path: LivePath, value: JsonValue): LiveMapSchemaValidation {
  if (node.lazy === undefined) return validation_issue(path, `LiveMap schema lazy rule is not defined at ${format_schema_path(path)}`);
  return validate_schema_node(node.lazy(), path, value);
}

function validate_refine_node(node: LiveMapSchemaNode, path: LivePath, value: JsonValue): LiveMapSchemaValidation {
  if (node.base === undefined || node.validate === undefined) {
    return validation_issue(path, `LiveMap schema refinement is not defined at ${format_schema_path(path)}`);
  }

  const baseValidation = validate_schema_node(node.base, path, value);
  if (!baseValidation.ok) return baseValidation;

  if (node.validate(value)) return validation_ok();

  return expected_schema_value_issue(node, path, JSON.stringify(value));
}

function validate_array_node(node: LiveMapSchemaNode, path: LivePath, value: JsonValue): LiveMapSchemaValidation {
  if (!Array.isArray(value)) {
    return expected_schema_value_issue(node, path, json_value_type_label(value));
  }

  if (node.item === undefined) return validation_ok();

  return merge_validations(value.map((item, index) => validate_schema_node(node.item as LiveMapSchemaNode, [...path, index], item)));
}

function validate_tuple_node(node: LiveMapSchemaNode, path: LivePath, value: JsonValue): LiveMapSchemaValidation {
  if (!Array.isArray(value)) {
    return expected_schema_value_issue(node, path, json_value_type_label(value));
  }

  const items = node.items ?? [];
  const validations: LiveMapSchemaValidation[] = [];

  items.forEach((item, index) => {
    validations.push(validate_schema_node(item, [...path, index], value[index]));
  });

  if (value.length > items.length) {
    for (let index = items.length; index < value.length; index += 1) {
      validations.push(validation_issue([...path, index], `LiveMap schema does not allow tuple index ${index} at ${format_schema_path([...path, index])}`));
    }
  }

  return merge_validations(validations);
}

function validate_object_node(node: LiveMapSchemaNode, path: LivePath, value: JsonValue): LiveMapSchemaValidation {
  if (!is_plain_json_object(value)) {
    return expected_schema_value_issue(node, path, json_value_type_label(value));
  }

  const validations: LiveMapSchemaValidation[] = [];
  const props = node.props ?? {};

  for (const [key, child] of Object.entries(props)) {
    validations.push(validate_schema_node(child, [...path, key], value[key]));
  }

  if (node.exact) {
    for (const key of Object.keys(value)) {
      if (!(key in props)) validations.push(validation_issue([...path, key], `LiveMap schema does not allow key ${JSON.stringify(key)} at ${format_schema_path([...path, key])}`));
    }
  }

  return merge_validations(validations);
}

function validate_record_node(node: LiveMapSchemaNode, path: LivePath, value: JsonValue): LiveMapSchemaValidation {
  if (!is_plain_json_object(value)) {
    return expected_schema_value_issue(node, path, json_value_type_label(value));
  }

  if (node.record === undefined) return validation_ok();

  return merge_validations(Object.entries(value).map(([key, item]) => validate_schema_node(node.record as LiveMapSchemaNode, [...path, key], item)));
}

function expected_schema_value_issue(node: LiveMapSchemaNode, path: LivePath, received: string): LiveMapSchemaValidation {
  return validation_issue(path, `LiveMap schema expected ${schema_kind_label(node)} at ${format_schema_path(path)}, received ${received}`);
}

function validation_ok(): LiveMapSchemaValidation {
  return Object.freeze({ ok: true, issues: [] });
}

function validation_issue(path: LivePath, message: string): LiveMapSchemaValidation {
  return Object.freeze({
    ok: false,
    issues: [Object.freeze({ path, message })],
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
  if (node.kind === "literal") return node.literals.map((literal) => JSON.stringify(literal)).join(" | ");
  if (node.kind === "pick") return (node.choices ?? []).map(schema_kind_label).join(" | ") || "pick";
  if (node.kind === "lazy") return node.lazy === undefined ? "lazy" : schema_kind_label(node.lazy());
  if (node.kind === "refine") return node.label ?? "refinement";
  if (node.nullable && node.kind !== "null") return `${node.kind} | null`;

  return node.kind;
}

function json_value_type_label(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";

  return typeof value;
}

function is_plain_json_object(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json_values_equal(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;

    return left.every((item, index) => json_values_equal(item, right[index] as JsonValue));
  }

  if (!is_plain_json_object(left) || !is_plain_json_object(right)) return false;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key) => key in right && json_values_equal(left[key] as JsonValue, right[key] as JsonValue));
}

function format_schema_path(path: LivePath): string {
  return JSON.stringify(path);
}