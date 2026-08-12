import { ELEM_TAG, ROOT_TAG, STR_TAG } from "../../core/constants.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import type { HsonNode } from "../../core/types.js";
import type {
  DocumentLiveMapMode,
  LiveMapSchemaIssueCode,
} from "../../types/livemap.types.js";
import type {
  LiveMapSchemaIssue,
  LiveMapSchemaValidation,
} from "./livemap.schema.js";

declare const DOCUMENT_SCHEMA_EVIDENCE: unique symbol;

type DocumentTextEvidence = Readonly<{ kind: "text" }>;
type DocumentElementEvidence<
  TTag extends string | undefined,
  TContent,
> = Readonly<{
  kind: "element";
  tag: TTag;
  content: TContent;
}>;
type DocumentSequenceEvidence<TItems extends readonly unknown[]> = Readonly<{
  kind: "sequence";
  items: TItems;
}>;
type DocumentRepeatEvidence<TItem> = Readonly<{
  kind: "repeat";
  item: TItem;
}>;
type DocumentPickEvidence<TChoices extends readonly unknown[]> = Readonly<{
  kind: "pick";
  choices: TChoices;
}>;
type DocumentFragmentEvidence<TContent> = Readonly<{
  kind: "fragment";
  content: TContent;
}>;

export type InternalDocumentItemSchema<TEvidence = unknown> = Readonly<{
  readonly [DOCUMENT_SCHEMA_EVIDENCE]: Readonly<{
    category: "item";
    evidence: TEvidence;
  }>;
}>;

export type InternalDocumentContentSchema<TEvidence = unknown> = Readonly<{
  readonly [DOCUMENT_SCHEMA_EVIDENCE]: Readonly<{
    category: "content";
    evidence: TEvidence;
  }>;
}>;

export type InternalDocumentElementSchema<TEvidence = unknown> =
  InternalDocumentItemSchema<TEvidence> & Readonly<{
    readonly [DOCUMENT_SCHEMA_EVIDENCE]: Readonly<{
      category: "item";
      evidence: TEvidence;
      rootMode: "element";
    }>;
  }>;

export type InternalDocumentFragmentSchema<TEvidence = unknown> = Readonly<{
  readonly [DOCUMENT_SCHEMA_EVIDENCE]: Readonly<{
    category: "root";
    evidence: TEvidence;
    rootMode: "fragment";
  }>;
}>;

export type InternalDocumentRootSchema =
  | InternalDocumentElementSchema
  | InternalDocumentFragmentSchema;

export type InternalDocumentRootSchemaForMode<TMode extends DocumentLiveMapMode> =
  TMode extends "element"
    ? InternalDocumentElementSchema
    : InternalDocumentFragmentSchema;

export type InternalDocumentSchemaController = Readonly<{
  getDocumentSchema: () => InternalDocumentRootSchema | undefined;
  useDocumentSchema: (schema: InternalDocumentRootSchema) => void;
}>;

export type InternalDocumentSchemaEvidence<TSchema> =
  TSchema extends Readonly<{
    readonly [DOCUMENT_SCHEMA_EVIDENCE]: Readonly<{ evidence: infer TEvidence }>;
  }>
    ? TEvidence
    : never;

type ItemEvidence<TSchema> = InternalDocumentSchemaEvidence<TSchema>;
type ContentEvidence<TSchema> = InternalDocumentSchemaEvidence<TSchema>;

type DocumentElementOptions<
  TTag extends string | undefined,
  TContent extends InternalDocumentContentSchema | undefined,
> = Readonly<{
  tag?: TTag;
  content?: TContent;
}>;

type DocumentSchemaNamespace = Readonly<{
  text: InternalDocumentItemSchema<DocumentTextEvidence>;
  element: {
    (): InternalDocumentElementSchema<DocumentElementEvidence<undefined, "broad">>;
    <
      const TTag extends string | undefined = undefined,
      const TContent extends InternalDocumentContentSchema | undefined = undefined,
    >(
      options: DocumentElementOptions<TTag, TContent>,
    ): InternalDocumentElementSchema<DocumentElementEvidence<
      TTag,
      TContent extends InternalDocumentContentSchema
        ? ContentEvidence<TContent>
        : "broad"
    >>;
  };
  fragment: <const TContent extends InternalDocumentContentSchema>(
    content: TContent,
  ) => InternalDocumentFragmentSchema<DocumentFragmentEvidence<ContentEvidence<TContent>>>;
  sequence: <const TItems extends readonly InternalDocumentItemSchema[]>(
    ...items: TItems
  ) => InternalDocumentContentSchema<DocumentSequenceEvidence<{
    readonly [TIndex in keyof TItems]: ItemEvidence<TItems[TIndex]>;
  }>>;
  repeat: <const TItem extends InternalDocumentItemSchema>(
    item: TItem,
  ) => InternalDocumentContentSchema<DocumentRepeatEvidence<ItemEvidence<TItem>>>;
  pick: {
    <const TChoices extends readonly [InternalDocumentItemSchema, ...InternalDocumentItemSchema[]]>(
      ...choices: TChoices
    ): InternalDocumentItemSchema<DocumentPickEvidence<{
      readonly [TIndex in keyof TChoices]: ItemEvidence<TChoices[TIndex]>;
    }>>;
    <const TChoices extends readonly [InternalDocumentContentSchema, ...InternalDocumentContentSchema[]]>(
      ...choices: TChoices
    ): InternalDocumentContentSchema<DocumentPickEvidence<{
      readonly [TIndex in keyof TChoices]: ContentEvidence<TChoices[TIndex]>;
    }>>;
  };
}>;

type DocumentItemNode =
  | Readonly<{ kind: "text"; category: "item" }>
  | DocumentElementNode
  | Readonly<{
    kind: "pick";
    category: "item";
    choices: readonly DocumentItemNode[];
  }>;

type DocumentElementNode = Readonly<{
  kind: "element";
  category: "item";
  tag?: string;
  content?: DocumentContentNode;
}>;

type DocumentContentNode =
  | Readonly<{
    kind: "sequence";
    category: "content";
    items: readonly DocumentItemNode[];
  }>
  | Readonly<{
    kind: "repeat";
    category: "content";
    item: DocumentItemNode;
  }>
  | Readonly<{
    kind: "pick";
    category: "content";
    choices: readonly DocumentContentNode[];
  }>;

type DocumentFragmentNode = Readonly<{
  kind: "fragment";
  category: "root";
  content: DocumentContentNode;
}>;

type DocumentRootNode = DocumentElementNode | DocumentFragmentNode;
type DocumentSchemaNode = DocumentItemNode | DocumentContentNode | DocumentFragmentNode;

const DOCUMENT_SCHEMA_NODES = new WeakMap<object, DocumentSchemaNode>();

function token<TSchema extends object>(node: DocumentSchemaNode): TSchema {
  const value = Object.freeze({});
  DOCUMENT_SCHEMA_NODES.set(value, node);
  return value as TSchema;
}

function frozen_item_pick(choices: readonly DocumentItemNode[]): DocumentItemNode {
  return Object.freeze({
    kind: "pick",
    category: "item",
    choices: Object.freeze([...choices]),
  });
}

function frozen_content_pick(choices: readonly DocumentContentNode[]): DocumentContentNode {
  return Object.freeze({
    kind: "pick",
    category: "content",
    choices: Object.freeze([...choices]),
  });
}

const text = token<InternalDocumentItemSchema<DocumentTextEvidence>>(
  Object.freeze({ kind: "text", category: "item" }),
);

function element(): InternalDocumentElementSchema<DocumentElementEvidence<undefined, "broad">>;
function element<
  const TTag extends string | undefined = undefined,
  const TContent extends InternalDocumentContentSchema | undefined = undefined,
>(
  options: DocumentElementOptions<TTag, TContent>,
): InternalDocumentElementSchema<DocumentElementEvidence<
  TTag,
  TContent extends InternalDocumentContentSchema
    ? ContentEvidence<TContent>
    : "broad"
>>;
function element(
  options?: DocumentElementOptions<string | undefined, InternalDocumentContentSchema | undefined>,
): InternalDocumentElementSchema {
  if (options !== undefined) {
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
      throw new TypeError("Document element schema options must be an object.");
    }
    for (const key of Object.keys(options)) {
      if (key !== "tag" && key !== "content") {
        throw new TypeError(`Document element schema has unknown option ${JSON.stringify(key)}.`);
      }
    }
  }

  const tag = options?.tag;
  if (tag !== undefined && (typeof tag !== "string" || tag.length === 0 || tag.startsWith("_hson_"))) {
    throw new TypeError("Document element schema tag must be a non-empty ordinary element tag.");
  }
  const content = options?.content === undefined
    ? undefined
    : require_schema_node(options.content, "content");
  const node: DocumentElementNode = Object.freeze({
    kind: "element",
    category: "item",
    ...(tag === undefined ? {} : { tag }),
    ...(content === undefined ? {} : { content: content as DocumentContentNode }),
  });
  return token(node);
}

function fragment<const TContent extends InternalDocumentContentSchema>(
  content: TContent,
): InternalDocumentFragmentSchema<DocumentFragmentEvidence<ContentEvidence<TContent>>> {
  const contentNode = require_schema_node(content, "content");
  return token(Object.freeze({
    kind: "fragment",
    category: "root",
    content: contentNode as DocumentContentNode,
  }));
}

function sequence<const TItems extends readonly InternalDocumentItemSchema[]>(
  ...items: TItems
): InternalDocumentContentSchema<DocumentSequenceEvidence<{
  readonly [TIndex in keyof TItems]: ItemEvidence<TItems[TIndex]>;
}>> {
  const itemNodes = items.map((item) => require_schema_node(item, "item") as DocumentItemNode);
  return token(Object.freeze({
    kind: "sequence",
    category: "content",
    items: Object.freeze(itemNodes),
  }));
}

function repeat<const TItem extends InternalDocumentItemSchema>(
  item: TItem,
): InternalDocumentContentSchema<DocumentRepeatEvidence<ItemEvidence<TItem>>> {
  const itemNode = require_schema_node(item, "item");
  return token(Object.freeze({
    kind: "repeat",
    category: "content",
    item: itemNode as DocumentItemNode,
  }));
}

function pick<const TChoices extends readonly [InternalDocumentItemSchema, ...InternalDocumentItemSchema[]]>(
  ...choices: TChoices
): InternalDocumentItemSchema<DocumentPickEvidence<{
  readonly [TIndex in keyof TChoices]: ItemEvidence<TChoices[TIndex]>;
}>>;
function pick<const TChoices extends readonly [InternalDocumentContentSchema, ...InternalDocumentContentSchema[]]>(
  ...choices: TChoices
): InternalDocumentContentSchema<DocumentPickEvidence<{
  readonly [TIndex in keyof TChoices]: ContentEvidence<TChoices[TIndex]>;
}>>;
function pick(...choices: readonly object[]): InternalDocumentItemSchema | InternalDocumentContentSchema {
  if (choices.length === 0) {
    throw new TypeError("Document schema pick requires at least one choice.");
  }
  const nodes = choices.map((choice) => require_schema_node(choice));
  const category = nodes[0]?.category;
  if (category !== "item" && category !== "content") {
    throw new TypeError("Document schema pick choices must be item schemas or content schemas.");
  }
  if (nodes.some((node) => node.category !== category)) {
    throw new TypeError("Document schema pick cannot mix item and content choices.");
  }
  return category === "item"
    ? token(frozen_item_pick(nodes as readonly DocumentItemNode[]))
    : token(frozen_content_pick(nodes as readonly DocumentContentNode[]));
}

export const LIVEMAP_DOCUMENT_SCHEMA: DocumentSchemaNamespace = Object.freeze({
  text,
  element,
  fragment,
  sequence,
  repeat,
  pick,
});

function require_schema_node(
  value: unknown,
  category?: "item" | "content",
): DocumentSchemaNode {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    throw new TypeError("Document schema composition requires document schema values.");
  }
  const node = DOCUMENT_SCHEMA_NODES.get(value);
  if (node === undefined) {
    throw new TypeError("Document schema composition received an unrecognized schema value.");
  }
  if (category !== undefined && node.category !== category) {
    throw new TypeError(`Document schema composition expected a ${category} schema; received ${node.category}.`);
  }
  return node;
}

export function require_document_root_schema<TMode extends DocumentLiveMapMode>(
  value: unknown,
  mode: TMode,
): Readonly<{
  value: InternalDocumentRootSchemaForMode<TMode>;
  node: DocumentRootNode;
}>;
export function require_document_root_schema(
  value: unknown,
): Readonly<{ value: InternalDocumentRootSchema; node: DocumentRootNode }>;
export function require_document_root_schema(
  value: unknown,
  mode?: DocumentLiveMapMode,
): Readonly<{ value: InternalDocumentRootSchema; node: DocumentRootNode }> {
  const node = require_schema_node(value);
  const rootMode = node.kind === "fragment"
    ? "fragment"
    : node.kind === "element"
      ? "element"
      : undefined;
  if (rootMode === undefined) {
    throw new TypeError("Document map schema.use(...) requires an element or fragment root schema.");
  }
  if (mode !== undefined && mode !== rootMode) {
    throw new TypeError(`Document schema root mode mismatch: expected ${mode}; received ${rootMode}.`);
  }
  return {
    value: value as InternalDocumentRootSchema,
    node: node as DocumentRootNode,
  };
}

export function validate_livemap_document_schema_root(
  schema: InternalDocumentRootSchema,
  root: HsonNode,
  mode: DocumentLiveMapMode,
): LiveMapSchemaValidation {
  const schemaNode = require_document_root_schema(schema).node;
  const schemaMode = schemaNode.kind === "fragment" ? "fragment" : "element";
  if (schemaMode !== mode) {
    return invalid([
      issue(
        "TYPE_MISMATCH",
        [],
        `Expected ${schemaMode} document root; received ${mode} document root.`,
        `${schemaMode} document root`,
        `${mode} document root`,
      ),
    ]);
  }

  if (schemaNode.kind === "element") {
    const elementRoot = root_element(root);
    if (elementRoot === undefined) {
      return invalid([
        issue("TYPE_MISMATCH", [], "Expected element document root.", "element", describe_root(root)),
      ]);
    }
    return validate_item(schemaNode, elementRoot, []);
  }

  const children = logical_root_children(root);
  if (children === undefined) {
    return invalid([
      issue("TYPE_MISMATCH", [], "Expected fragment document root.", "fragment", describe_root(root)),
    ]);
  }
  return validate_content(schemaNode.content, children, []);
}

function validate_item(
  schema: DocumentItemNode,
  value: HsonNode,
  path: readonly number[],
): LiveMapSchemaValidation {
  if (schema.kind === "pick") {
    return validate_pick(
      schema.choices.map((choice) => validate_item(choice, value, path)),
      path,
      "an allowed document item",
      describe_item(value),
    );
  }
  if (schema.kind === "text") {
    if (value.$_tag === STR_TAG
      && value.$_content.length === 1
      && typeof value.$_content[0] === "string") {
      return valid();
    }
    return invalid([
      issue(
        "TYPE_MISMATCH",
        path,
        `Expected text at ${JSON.stringify(path)}; received ${describe_item(value)}.`,
        "text",
        describe_item(value),
      ),
    ]);
  }

  if (!is_ordinary_element_node(value)) {
    return invalid([
      issue(
        "TYPE_MISMATCH",
        path,
        `Expected element at ${JSON.stringify(path)}; received ${describe_item(value)}.`,
        "element",
        describe_item(value),
      ),
    ]);
  }
  if (schema.tag !== undefined && schema.tag !== value.$_tag) {
    return invalid([
      issue(
        "INVALID_LITERAL",
        path,
        `Expected tag ${JSON.stringify(schema.tag)} at ${JSON.stringify(path)}; received ${JSON.stringify(value.$_tag)}.`,
        JSON.stringify(schema.tag),
        JSON.stringify(value.$_tag),
      ),
    ]);
  }
  if (schema.content === undefined) return valid();
  const children = logical_element_children(value);
  if (children === undefined) {
    return invalid([
      issue(
        "INVALID_SCHEMA",
        path,
        `Element at ${JSON.stringify(path)} does not expose canonical logical content.`,
      ),
    ]);
  }
  return validate_content(schema.content, children, path);
}

function validate_content(
  schema: DocumentContentNode,
  children: readonly HsonNode[],
  path: readonly number[],
): LiveMapSchemaValidation {
  if (schema.kind === "pick") {
    return validate_pick(
      schema.choices.map((choice) => validate_content(choice, children, path)),
      path,
      "an allowed complete content layout",
      `content length ${children.length}`,
    );
  }
  if (schema.kind === "repeat") {
    const issues: LiveMapSchemaIssue[] = [];
    children.forEach((child, index) => {
      const result = validate_item(schema.item, child, append_path(path, index));
      if (!result.ok) issues.push(...result.issues);
    });
    return issues.length === 0 ? valid() : invalid(issues);
  }

  if (children.length !== schema.items.length) {
    const mismatchPath = children.length < schema.items.length
      ? append_path(path, children.length)
      : path;
    const code: LiveMapSchemaIssueCode = children.length < schema.items.length
      ? "MISSING_REQUIRED"
      : "TUPLE_INDEX_OUT_OF_RANGE";
    return invalid([
      issue(
        code,
        mismatchPath,
        `Expected closed sequence length ${schema.items.length} at ${JSON.stringify(path)}; received length ${children.length}.`,
        `length ${schema.items.length}`,
        `length ${children.length}`,
      ),
    ]);
  }

  const issues: LiveMapSchemaIssue[] = [];
  schema.items.forEach((item, index) => {
    const result = validate_item(item, children[index] as HsonNode, append_path(path, index));
    if (!result.ok) issues.push(...result.issues);
  });
  return issues.length === 0 ? valid() : invalid(issues);
}

function validate_pick(
  branches: readonly LiveMapSchemaValidation[],
  path: readonly number[],
  expected: string,
  received: string,
): LiveMapSchemaValidation {
  if (branches.some((branch) => branch.ok)) return valid();
  const closest = [...branches].sort((left, right) => {
    const leftDepth = left.issues[0]?.path.length ?? 0;
    const rightDepth = right.issues[0]?.path.length ?? 0;
    if (leftDepth !== rightDepth) return rightDepth - leftDepth;
    return left.issues.length - right.issues.length;
  })[0];
  return invalid([
    issue(
      "TYPE_MISMATCH",
      path,
      `Expected ${expected} at ${JSON.stringify(path)}; received ${received}; no pick branch matched.`,
      expected,
      received,
    ),
    ...(closest?.issues ?? []),
  ]);
}

function root_element(root: HsonNode): HsonNode | undefined {
  const cluster = root.$_tag === ELEM_TAG
    ? root
    : root.$_tag === ROOT_TAG && is_Node(root.$_content[0]) && root.$_content[0].$_tag === ELEM_TAG
      ? root.$_content[0]
      : undefined;
  if (cluster === undefined || cluster.$_content.length !== 1) return undefined;
  const only = cluster.$_content[0];
  return is_ordinary_element_node(only) ? only : undefined;
}

function logical_root_children(root: HsonNode): readonly HsonNode[] | undefined {
  if (root.$_tag === ROOT_TAG && root.$_content.length === 0) return Object.freeze([]);
  const cluster = root.$_tag === ELEM_TAG
    ? root
    : root.$_tag === ROOT_TAG && is_Node(root.$_content[0]) && root.$_content[0].$_tag === ELEM_TAG
      ? root.$_content[0]
      : undefined;
  if (cluster === undefined) return undefined;
  return cluster.$_content.every(is_Node)
    ? Object.freeze([...cluster.$_content]) as readonly HsonNode[]
    : undefined;
}

function logical_element_children(element: HsonNode): readonly HsonNode[] | undefined {
  if (!is_ordinary_element_node(element)) return undefined;
  if (element.$_content.length === 0) return Object.freeze([]);
  if (element.$_content.length !== 1) return undefined;
  const cluster = element.$_content[0];
  if (!is_Node(cluster) || cluster.$_tag !== ELEM_TAG || !cluster.$_content.every(is_Node)) {
    return undefined;
  }
  return Object.freeze([...cluster.$_content]) as readonly HsonNode[];
}

function issue(
  code: LiveMapSchemaIssueCode,
  path: readonly number[],
  message: string,
  expected?: string,
  received?: string,
): LiveMapSchemaIssue {
  return Object.freeze({
    code,
    path: Object.freeze([...path]),
    message,
    ...(expected === undefined ? {} : { expected }),
    ...(received === undefined ? {} : { received }),
  });
}

function valid(): LiveMapSchemaValidation {
  return Object.freeze({ ok: true, issues: Object.freeze([]) });
}

function invalid(issues: readonly LiveMapSchemaIssue[]): LiveMapSchemaValidation {
  return Object.freeze({ ok: false, issues: Object.freeze([...issues]) });
}

function append_path(path: readonly number[], index: number): readonly number[] {
  return Object.freeze([...path, index]);
}

function describe_item(value: HsonNode): string {
  if (value.$_tag === STR_TAG) return "text";
  if (!value.$_tag.startsWith("_hson_")) return `element <${value.$_tag}>`;
  return `structural node <${value.$_tag}>`;
}

function describe_root(root: HsonNode): string {
  return `<${root.$_tag}>`;
}
