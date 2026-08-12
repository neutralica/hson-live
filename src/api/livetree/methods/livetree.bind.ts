// livetree.bind.ts

import type { HsonNode, LiveMapPathHandle } from "../../../types/index.js";
import type { LiveTree } from "../livetree.js";
import { own_disposable_for_owner } from "../managers/lifecycle-registry.js";
import { runtime_for_tree } from "../runtime/livetree-runtime.js";

type LiveTreeBindable = Pick<LiveTree, "quid" | "text" | "attrs" | "css">;

export type LiveTreeBindApi<TTree extends LiveTreeBindable> = Readonly<{
  path: <TValue>(
    source: ProjectedBindingSource<TValue>,
    apply: PathApply<TTree, NoInfer<TValue>>,
  ) => LiveMapDisposer;

  paths: <const TValues extends readonly unknown[]>(
    sources: ProjectedBindingSourceTuple<TValues>,
    apply: PathsApply<TTree, TValues>,
  ) => LiveMapDisposer;

  textPaths: <const TValues extends readonly unknown[]>(
    sources: ProjectedBindingSourceTuple<TValues>,
    toText: PathsTextMapper<TValues>,
  ) => LiveMapDisposer;

  text: <TValue>(
    source: ProjectedBindingSource<TValue>,
    toText?: TextMapper<NoInfer<TValue>>,
  ) => LiveMapDisposer;

  attr: <TValue>(
    source: ProjectedBindingSource<TValue>,
    name: string,
    toValue?: TextMapper<NoInfer<TValue>>,
  ) => LiveMapDisposer;

  attrs: <TValue>(
    source: ProjectedBindingSource<TValue>,
    toAttrs: AttrMapper<NoInfer<TValue>>,
  ) => LiveMapDisposer;

  attrsPaths: <const TValues extends readonly unknown[]>(
    sources: ProjectedBindingSourceTuple<TValues>,
    toAttrs: PathsAttrMapper<TValues>,
  ) => LiveMapDisposer;

  css: <TValue>(
    source: ProjectedBindingSource<TValue>,
    toCss: CssMapper<NoInfer<TValue>>,
  ) => LiveMapDisposer;

  cssPaths: <const TValues extends readonly unknown[]>(
    sources: ProjectedBindingSourceTuple<TValues>,
    toCss: PathsCssMapper<TValues>,
  ) => LiveMapDisposer;
}>;

export function make_livetree_bind_api<TTree extends LiveTreeBindable>(tree: TTree): LiveTreeBindApi<TTree> {
  return Object.freeze({
    path: <TValue>(
      source: ProjectedBindingSource<TValue>,
      apply: PathApply<TTree, NoInfer<TValue>>,
    ) => bind_path_for(tree, source, apply),

    paths: <const TValues extends readonly unknown[]>(
      sources: ProjectedBindingSourceTuple<TValues>,
      apply: PathsApply<TTree, TValues>,
    ) => bind_paths_for(tree, sources, apply),

    textPaths: <const TValues extends readonly unknown[]>(
      sources: ProjectedBindingSourceTuple<TValues>,
      toText: PathsTextMapper<TValues>,
    ) => bind_text_paths_for(tree, sources, toText),

    text: <TValue>(
      source: ProjectedBindingSource<TValue>,
      toText?: TextMapper<NoInfer<TValue>>,
    ) => bind_text_for(tree, source, toText),

    attr: <TValue>(
      source: ProjectedBindingSource<TValue>,
      name: string,
      toValue?: TextMapper<NoInfer<TValue>>,
    ) => bind_attr_for(tree, source, name, toValue),

    attrs: <TValue>(
      source: ProjectedBindingSource<TValue>,
      toAttrs: AttrMapper<NoInfer<TValue>>,
    ) => bind_attrs_for(tree, source, toAttrs),

    attrsPaths: <const TValues extends readonly unknown[]>(
      sources: ProjectedBindingSourceTuple<TValues>,
      toAttrs: PathsAttrMapper<TValues>,
    ) => bind_attrs_paths_for(tree, sources, toAttrs),

    css: <TValue>(
      source: ProjectedBindingSource<TValue>,
      toCss: CssMapper<NoInfer<TValue>>,
    ) => bind_css_for(tree, source, toCss),

    cssPaths: <const TValues extends readonly unknown[]>(
      sources: ProjectedBindingSourceTuple<TValues>,
      toCss: PathsCssMapper<TValues>,
    ) => bind_css_paths_for(tree, sources, toCss),
  });
}
function bind_path_for<TTree extends LiveTreeBindable, TValue>(
  tree: TTree,
  source: ProjectedBindingSource<TValue>,
  apply: PathApply<TTree, TValue>,
): LiveMapDisposer {
  let previous: TValue | undefined;

  const sync = (value: TValue): void => {
    apply(tree, value, previous);
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

function bind_paths_for<TTree extends LiveTreeBindable, const TValues extends readonly unknown[]>(
  tree: TTree,
  sources: ProjectedBindingSourceTuple<TValues>,
  apply: PathsApply<TTree, TValues>,
): LiveMapDisposer {
  let previous: TValues | undefined;

  const sync = (): void => {
    const values = sources.map((source) => source.snap()) as unknown as TValues;
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

function bind_text_paths_for<TTree extends LiveTreeBindable, const TValues extends readonly unknown[]>(
  tree: TTree,
  sources: ProjectedBindingSourceTuple<TValues>,
  toText: PathsTextMapper<TValues>,
): LiveMapDisposer {
  return bind_paths_for<TTree, TValues>(tree, sources, (target, values, previous) => {
    target.text.set(toText(values, previous));
  });
}

function bind_attrs_paths_for<TTree extends LiveTreeBindable, const TValues extends readonly unknown[]>(
  tree: TTree,
  sources: ProjectedBindingSourceTuple<TValues>,
  toAttrs: PathsAttrMapper<TValues>,
): LiveMapDisposer {
  return bind_paths_for<TTree, TValues>(tree, sources, (target, values, previous) => {
    apply_attrs(target, toAttrs(values, previous));
  });
}

function bind_css_paths_for<TTree extends LiveTreeBindable, const TValues extends readonly unknown[]>(
  tree: TTree,
  sources: ProjectedBindingSourceTuple<TValues>,
  toCss: PathsCssMapper<TValues>,
): LiveMapDisposer {
  return bind_paths_for<TTree, TValues>(tree, sources, (target, values, previous) => {
    apply_css(target, toCss(values, previous));
  });
}

function bind_text_for<TTree extends LiveTreeBindable, TValue>(
  tree: TTree,
  source: ProjectedBindingSource<TValue>,
  toText?: TextMapper<TValue>,
): LiveMapDisposer {
  return bind_path_for(tree, source, (target, value, previous) => {
    const text = toText ? toText(value, previous) : String(value ?? "");
    target.text.set(text);
  });
}

function bind_attr_for<TTree extends LiveTreeBindable, TValue>(
  tree: TTree,
  source: ProjectedBindingSource<TValue>,
  name: string,
  toValue?: TextMapper<TValue>,
): LiveMapDisposer {
  return bind_path_for(tree, source, (target, value, previous) => {
    const attrValue = toValue ? toValue(value, previous) : value;
    apply_attrs(target, { [name]: attrValue as string | number | boolean | null | undefined });
  });
}

function bind_attrs_for<TTree extends LiveTreeBindable, TValue>(
  tree: TTree,
  source: ProjectedBindingSource<TValue>,
  toAttrs: AttrMapper<TValue>,
): LiveMapDisposer {
  return bind_path_for(tree, source, (target, value, previous) => {
    apply_attrs(target, toAttrs(value, previous));
  });
}

function bind_css_for<TTree extends LiveTreeBindable, TValue>(
  tree: TTree,
  source: ProjectedBindingSource<TValue>,
  toCss: CssMapper<TValue>,
): LiveMapDisposer {
  return bind_path_for(tree, source, (target, value, previous) => {
    apply_css(target, toCss(value, previous));
  });
}

type LiveMapDisposer = () => void;

type ProjectedBindingCapability<TValue = unknown> = Pick<LiveMapPathHandle<TValue>, "snap" | "watch">;
type ProjectedBindingSource<TValue = unknown> = [Extract<TValue, HsonNode>] extends [never]
  ? ProjectedBindingCapability<TValue>
  : never;

type ProjectedBindingSourceTuple<TValues extends readonly unknown[]> = {
  readonly [TIndex in keyof TValues]: ProjectedBindingSource<TValues[TIndex]>;
};

type PathApply<TTree extends LiveTreeBindable, TValue> = (
  tree: TTree,
  value: TValue,
  previous: TValue | undefined,
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

export function bind_path<TTree extends LiveTreeBindable, TValue>(
  this: TTree,
  source: ProjectedBindingSource<TValue>,
  apply: PathApply<TTree, NoInfer<TValue>>,
): LiveMapDisposer {
  return bind_path_for(this, source, apply);
}

export function bind_paths<TTree extends LiveTreeBindable, const TValues extends readonly unknown[]>(
  this: TTree,
  sources: ProjectedBindingSourceTuple<TValues>,
  apply: PathsApply<TTree, TValues>,
): LiveMapDisposer {
  return bind_paths_for(this, sources, apply);
}

export function bind_text_paths<TTree extends LiveTreeBindable, const TValues extends readonly unknown[]>(
  this: TTree,
  sources: ProjectedBindingSourceTuple<TValues>,
  toText: PathsTextMapper<TValues>,
): LiveMapDisposer {
  return bind_text_paths_for(this, sources, toText);
}

export function bind_text<TTree extends LiveTreeBindable, TValue>(
  this: TTree,
  source: ProjectedBindingSource<TValue>,
  toText?: TextMapper<NoInfer<TValue>>,
): LiveMapDisposer {
  return bind_text_for(this, source, toText);
}

export function bind_attr<TTree extends LiveTreeBindable, TValue>(
  this: TTree,
  source: ProjectedBindingSource<TValue>,
  name: string,
  toValue?: TextMapper<NoInfer<TValue>>,
): LiveMapDisposer {
  return bind_attr_for(this, source, name, toValue);
}

export function bind_attrs_paths<TTree extends LiveTreeBindable, const TValues extends readonly unknown[]>(
  this: TTree,
  sources: ProjectedBindingSourceTuple<TValues>,
  toAttrs: PathsAttrMapper<TValues>,
): LiveMapDisposer {
  return bind_attrs_paths_for(this, sources, toAttrs);
}

export function bind_attrs<TTree extends LiveTreeBindable, TValue>(
  this: TTree,
  source: ProjectedBindingSource<TValue>,
  toAttrs: AttrMapper<NoInfer<TValue>>,
): LiveMapDisposer {
  return bind_attrs_for(this, source, toAttrs);
}

export function bind_css_paths<TTree extends LiveTreeBindable, const TValues extends readonly unknown[]>(
  this: TTree,
  sources: ProjectedBindingSourceTuple<TValues>,
  toCss: PathsCssMapper<TValues>,
): LiveMapDisposer {
  return bind_css_paths_for(this, sources, toCss);
}

export function bind_css<TTree extends LiveTreeBindable, TValue>(
  this: TTree,
  source: ProjectedBindingSource<TValue>,
  toCss: CssMapper<NoInfer<TValue>>,
): LiveMapDisposer {
  return bind_css_for(this, source, toCss);
}
