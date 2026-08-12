// livetree.bind.ts

import { is_Node } from "../../../core/node-guards.js";
import type { DocumentLiveMap, HsonNode, LiveMapPathHandle } from "../../../types/index.js";
import { is_livemap_document_location } from "../../livemap/livemap.document.location.js";
import { is_livemap_projected_location } from "../../livemap/livemap.handle.js";
import type { LiveTree } from "../livetree.js";
import { own_disposable_for_owner } from "../managers/lifecycle-registry.js";
import { runtime_for_tree } from "../runtime/livetree-runtime.js";

type LiveTreeBindable = Pick<LiveTree, "quid" | "text" | "attrs" | "css">;

export type LiveTreeBindApi<TTree extends LiveTreeBindable> = Readonly<{
  path: <TSource extends BindingSource>(
    source: TSource,
    apply: PathApply<TTree, NoInfer<BindingValue<TSource>>>,
  ) => LiveMapDisposer;

  paths: <const TSources extends readonly BindingSource[]>(
    sources: TSources,
    apply: PathsApply<TTree, BindingValues<TSources>>,
  ) => LiveMapDisposer;

  textPaths: <const TSources extends readonly BindingSource[]>(
    sources: TSources,
    toText: PathsTextMapper<BindingValues<TSources>>,
  ) => LiveMapDisposer;

  text: <TSource extends BindingSource>(
    source: TSource,
    ...formatter: TextFormatterArgument<TSource>
  ) => LiveMapDisposer;

  attr: <TSource extends BindingSource>(
    source: TSource,
    name: string,
    ...formatter: TextFormatterArgument<TSource>
  ) => LiveMapDisposer;

  attrs: <TSource extends BindingSource>(
    source: TSource,
    toAttrs: AttrMapper<NoInfer<BindingValue<TSource>>>,
  ) => LiveMapDisposer;

  attrsPaths: <const TSources extends readonly BindingSource[]>(
    sources: TSources,
    toAttrs: PathsAttrMapper<BindingValues<TSources>>,
  ) => LiveMapDisposer;

  css: <TSource extends BindingSource>(
    source: TSource,
    toCss: CssMapper<NoInfer<BindingValue<TSource>>>,
  ) => LiveMapDisposer;

  cssPaths: <const TSources extends readonly BindingSource[]>(
    sources: TSources,
    toCss: PathsCssMapper<BindingValues<TSources>>,
  ) => LiveMapDisposer;
}>;

export function make_livetree_bind_api<TTree extends LiveTreeBindable>(tree: TTree): LiveTreeBindApi<TTree> {
  return Object.freeze({
    path: <TSource extends BindingSource>(
      source: TSource,
      apply: PathApply<TTree, NoInfer<BindingValue<TSource>>>,
    ) => bind_path_for(tree, binding_capability(source), (target, value, previous) => {
      apply(target, value, previous);
    }),

    paths: <const TSources extends readonly BindingSource[]>(
      sources: TSources,
      apply: PathsApply<TTree, BindingValues<TSources>>,
    ) => bind_paths_for(tree, sources, apply),

    textPaths: <const TSources extends readonly BindingSource[]>(
      sources: TSources,
      toText: PathsTextMapper<BindingValues<TSources>>,
    ) => bind_text_paths_for(tree, sources, toText),

    text: <TSource extends BindingSource>(
      source: TSource,
      ...formatter: TextFormatterArgument<TSource>
    ) => bind_text_for(tree, binding_capability(source), text_formatter(formatter)),

    attr: <TSource extends BindingSource>(
      source: TSource,
      name: string,
      ...formatter: TextFormatterArgument<TSource>
    ) => bind_attr_for(tree, binding_capability(source), name, text_formatter(formatter)),

    attrs: <TSource extends BindingSource>(
      source: TSource,
      toAttrs: AttrMapper<NoInfer<BindingValue<TSource>>>,
    ) => bind_attrs_for(tree, binding_capability(source), toAttrs),

    attrsPaths: <const TSources extends readonly BindingSource[]>(
      sources: TSources,
      toAttrs: PathsAttrMapper<BindingValues<TSources>>,
    ) => bind_attrs_paths_for(tree, sources, toAttrs),

    css: <TSource extends BindingSource>(
      source: TSource,
      toCss: CssMapper<NoInfer<BindingValue<TSource>>>,
    ) => bind_css_for(tree, binding_capability(source), toCss),

    cssPaths: <const TSources extends readonly BindingSource[]>(
      sources: TSources,
      toCss: PathsCssMapper<BindingValues<TSources>>,
    ) => bind_css_paths_for(tree, sources, toCss),
  });
}
function bind_path_for<TTree extends LiveTreeBindable, TValue>(
  tree: TTree,
  source: BindingCapability<TValue>,
  apply: InternalPathApply<TTree, TValue>,
): LiveMapDisposer {
  let previous: TValue | undefined;
  const mode = classify_binding_source(source);

  const sync = (value: TValue): void => {
    apply(tree, value, previous, mode);
    previous = value;
  };

  sync(source.snap());
  return own_disposable_for_owner(
    tree.quid,
    source.watch(sync),
    "binding",
    runtime_for_tree(tree),
  );
}

function bind_paths_for<TTree extends LiveTreeBindable, const TSources extends readonly BindingSource[]>(
  tree: TTree,
  sources: TSources,
  apply: PathsApply<TTree, BindingValues<TSources>>,
): LiveMapDisposer {
  let previous: BindingValues<TSources> | undefined;
  sources.forEach(classify_binding_source);

  const sync = (): void => {
    const values = sources.map((source) => source.snap()) as unknown as BindingValues<TSources>;
    apply(tree, values, previous);
    previous = values;
  };

  sync();
  const disposers = sources.map((source) => source.watch(sync));
  return own_disposable_for_owner(
    tree.quid,
    () => dispose_all(disposers),
    "binding",
    runtime_for_tree(tree),
  );
}

function bind_text_paths_for<TTree extends LiveTreeBindable, const TSources extends readonly BindingSource[]>(
  tree: TTree,
  sources: TSources,
  toText: PathsTextMapper<BindingValues<TSources>>,
): LiveMapDisposer {
  return bind_paths_for(tree, sources, (target, values, previous) => {
    target.text.set(toText(values, previous));
  });
}

function bind_attrs_paths_for<TTree extends LiveTreeBindable, const TSources extends readonly BindingSource[]>(
  tree: TTree,
  sources: TSources,
  toAttrs: PathsAttrMapper<BindingValues<TSources>>,
): LiveMapDisposer {
  return bind_paths_for(tree, sources, (target, values, previous) => {
    apply_attrs(target, toAttrs(values, previous));
  });
}

function bind_css_paths_for<TTree extends LiveTreeBindable, const TSources extends readonly BindingSource[]>(
  tree: TTree,
  sources: TSources,
  toCss: PathsCssMapper<BindingValues<TSources>>,
): LiveMapDisposer {
  return bind_paths_for(tree, sources, (target, values, previous) => {
    apply_css(target, toCss(values, previous));
  });
}

function bind_text_for<TTree extends LiveTreeBindable, TValue>(
  tree: TTree,
  source: BindingCapability<TValue>,
  toText?: TextMapper<TValue>,
): LiveMapDisposer {
  return bind_path_for(tree, source, (target, value, previous, mode) => {
    if (toText === undefined) reject_unmapped_document_node(mode, value);
    const text = toText ? toText(value, previous) : String(value ?? "");
    target.text.set(text);
  });
}

function bind_attr_for<TTree extends LiveTreeBindable, TValue>(
  tree: TTree,
  source: BindingCapability<TValue>,
  name: string,
  toValue?: TextMapper<TValue>,
): LiveMapDisposer {
  return bind_path_for(tree, source, (target, value, previous, mode) => {
    if (toValue === undefined) reject_unmapped_document_node(mode, value);
    const attrValue = toValue ? toValue(value, previous) : value;
    apply_attrs(target, { [name]: attrValue as string | number | boolean | null | undefined });
  });
}

function bind_attrs_for<TTree extends LiveTreeBindable, TValue>(
  tree: TTree,
  source: BindingCapability<TValue>,
  toAttrs: AttrMapper<TValue>,
): LiveMapDisposer {
  return bind_path_for(tree, source, (target, value, previous) => {
    apply_attrs(target, toAttrs(value, previous));
  });
}

function bind_css_for<TTree extends LiveTreeBindable, TValue>(
  tree: TTree,
  source: BindingCapability<TValue>,
  toCss: CssMapper<TValue>,
): LiveMapDisposer {
  return bind_path_for(tree, source, (target, value, previous) => {
    apply_css(target, toCss(value, previous));
  });
}

type LiveMapDisposer = () => void;

type BindingCapability<TValue = unknown> = Readonly<{
  snap(): TValue;
  watch(listener: (next: TValue) => void): LiveMapDisposer;
}>;
type ProjectedBindingSource<TValue = unknown> = Pick<LiveMapPathHandle<TValue>, "snap" | "watch" | "feed">;
type DocumentBindingSource = ReturnType<DocumentLiveMap["at"]>;
type BindingSource = ProjectedBindingSource | DocumentBindingSource;
type BindingValue<TSource extends BindingSource> = ReturnType<TSource["snap"]>;
type BindingValues<TSources extends readonly BindingSource[]> = {
  readonly [TIndex in keyof TSources]: BindingValue<TSources[TIndex]>;
};
type BindingSourceMode = "projected" | "document";

type TextFormatterArgument<TSource extends BindingSource> =
  TSource extends ProjectedBindingSource
    ? readonly [toText?: TextMapper<NoInfer<BindingValue<TSource>>>]
    : [Extract<BindingValue<TSource>, HsonNode>] extends [never]
      ? readonly [toText?: TextMapper<NoInfer<BindingValue<TSource>>>]
      : readonly [toText: TextMapper<NoInfer<BindingValue<TSource>>>];

type PathApply<TTree extends LiveTreeBindable, TValue> = (
  tree: TTree,
  value: TValue,
  previous: TValue | undefined,
) => void;

type InternalPathApply<TTree extends LiveTreeBindable, TValue> = (
  tree: TTree,
  value: TValue,
  previous: TValue | undefined,
  mode: BindingSourceMode,
) => void;

type PathsApply<TTree extends LiveTreeBindable, TValues extends readonly unknown[]> = (
  tree: TTree,
  values: TValues,
  previous: TValues | undefined,
) => void;

type CssValueMap = Readonly<Record<string, string | number | null | undefined>>;
type AttrValueMap = Readonly<Record<string, string | number | boolean | null | undefined>>;

type CssMapper<TValue> = (value: TValue, previous: TValue | undefined) => CssValueMap;
type AttrMapper<TValue> = (value: TValue, previous: TValue | undefined) => AttrValueMap;
type TextMapper<TValue> = (value: TValue, previous: TValue | undefined) => string;
type PathsCssMapper<TValues extends readonly unknown[]> = (values: TValues, previous: TValues | undefined) => CssValueMap;
type PathsAttrMapper<TValues extends readonly unknown[]> = (values: TValues, previous: TValues | undefined) => AttrValueMap;
type PathsTextMapper<TValues extends readonly unknown[]> = (values: TValues, previous: TValues | undefined) => string;

function dispose_all(disposers: readonly LiveMapDisposer[]): void {
  disposers.forEach((dispose) => dispose());
}

function classify_binding_source(source: unknown): BindingSourceMode {
  if (is_livemap_projected_location(source)) return "projected";
  if (is_livemap_document_location(source)) return "document";
  throw new TypeError("LiveTree.bind source must be an authentic passive LiveMap or LiveHost location.");
}

function binding_capability<TSource extends BindingSource>(
  source: TSource,
): BindingCapability<BindingValue<TSource>> {
  return source as BindingCapability<BindingValue<TSource>>;
}

function text_formatter<TSource extends BindingSource>(
  formatter: TextFormatterArgument<TSource>,
): TextMapper<BindingValue<TSource>> | undefined {
  return formatter[0] as TextMapper<BindingValue<TSource>> | undefined;
}

function reject_unmapped_document_node(mode: BindingSourceMode, value: unknown): void {
  if (mode === "document" && is_Node(value)) {
    throw new TypeError("LiveTree.bind document HSON values require an explicit mapper for primitive destinations.");
  }
}

function apply_css(tree: LiveTreeBindable, values: CssValueMap): void {
  Object.entries(values).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      tree.css.remove(key);
      return;
    }

    tree.css.setProp(key, String(value));
  });
}

function apply_attrs(tree: LiveTreeBindable, values: AttrValueMap): void {
  Object.entries(values).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) {
      tree.attrs.drop(key);
      return;
    }

    tree.attrs.set(key, value === true ? key : String(value));
  });
}

export function bind_path<TTree extends LiveTreeBindable, TSource extends BindingSource>(
  this: TTree,
  source: TSource,
  apply: PathApply<TTree, NoInfer<BindingValue<TSource>>>,
): LiveMapDisposer {
  return bind_path_for(this, binding_capability(source), (target, value, previous) => {
    apply(target, value, previous);
  });
}

export function bind_paths<TTree extends LiveTreeBindable, const TSources extends readonly BindingSource[]>(
  this: TTree,
  sources: TSources,
  apply: PathsApply<TTree, BindingValues<TSources>>,
): LiveMapDisposer {
  return bind_paths_for(this, sources, apply);
}

export function bind_text_paths<TTree extends LiveTreeBindable, const TSources extends readonly BindingSource[]>(
  this: TTree,
  sources: TSources,
  toText: PathsTextMapper<BindingValues<TSources>>,
): LiveMapDisposer {
  return bind_text_paths_for(this, sources, toText);
}

export function bind_text<TTree extends LiveTreeBindable, TSource extends BindingSource>(
  this: TTree,
  source: TSource,
  ...formatter: TextFormatterArgument<TSource>
): LiveMapDisposer {
  return bind_text_for(this, binding_capability(source), text_formatter(formatter));
}

export function bind_attr<TTree extends LiveTreeBindable, TSource extends BindingSource>(
  this: TTree,
  source: TSource,
  name: string,
  ...formatter: TextFormatterArgument<TSource>
): LiveMapDisposer {
  return bind_attr_for(this, binding_capability(source), name, text_formatter(formatter));
}

export function bind_attrs_paths<TTree extends LiveTreeBindable, const TSources extends readonly BindingSource[]>(
  this: TTree,
  sources: TSources,
  toAttrs: PathsAttrMapper<BindingValues<TSources>>,
): LiveMapDisposer {
  return bind_attrs_paths_for(this, sources, toAttrs);
}

export function bind_attrs<TTree extends LiveTreeBindable, TSource extends BindingSource>(
  this: TTree,
  source: TSource,
  toAttrs: AttrMapper<NoInfer<BindingValue<TSource>>>,
): LiveMapDisposer {
  return bind_attrs_for(this, binding_capability(source), toAttrs);
}

export function bind_css_paths<TTree extends LiveTreeBindable, const TSources extends readonly BindingSource[]>(
  this: TTree,
  sources: TSources,
  toCss: PathsCssMapper<BindingValues<TSources>>,
): LiveMapDisposer {
  return bind_css_paths_for(this, sources, toCss);
}

export function bind_css<TTree extends LiveTreeBindable, TSource extends BindingSource>(
  this: TTree,
  source: TSource,
  toCss: CssMapper<NoInfer<BindingValue<TSource>>>,
): LiveMapDisposer {
  return bind_css_for(this, binding_capability(source), toCss);
}
