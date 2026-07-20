// livetree.bind.ts

import type { JsonValue, LivePath } from "../../../types/index.js";
import type { LiveTree } from "../livetree.js";
import { own_disposable_for_owner } from "../managers/lifecycle-registry.js";

type LiveTreeBindable = Pick<LiveTree, "quid" | "text" | "attrs" | "css">;

export type LiveTreeBindApi<TTree extends LiveTreeBindable> = Readonly<{
  path: <TValue extends JsonValue | undefined = JsonValue | undefined>(
    map: LiveMapBindable,
    path: LivePath,
    apply: PathApply<TTree, TValue>,
  ) => LiveMapDisposer;

  paths: (
    map: LiveMapBindable,
    paths: readonly LivePath[],
    apply: PathsApply<TTree>,
  ) => LiveMapDisposer;

  textPaths: (
    map: LiveMapBindable,
    paths: readonly LivePath[],
    toText: PathsTextMapper,
  ) => LiveMapDisposer;

  text: <TValue extends JsonValue | undefined = JsonValue | undefined>(
    map: LiveMapBindable,
    path: LivePath,
    toText?: TextMapper<TValue>,
  ) => LiveMapDisposer;

  attr: <TValue extends JsonValue | undefined = JsonValue | undefined>(
    map: LiveMapBindable,
    path: LivePath,
    name: string,
    toValue?: TextMapper<TValue>,
  ) => LiveMapDisposer;

  attrs: <TValue extends JsonValue | undefined = JsonValue | undefined>(
    map: LiveMapBindable,
    path: LivePath,
    toAttrs: AttrMapper<TValue>,
  ) => LiveMapDisposer;

  attrsPaths: (
    map: LiveMapBindable,
    paths: readonly LivePath[],
    toAttrs: PathsAttrMapper,
  ) => LiveMapDisposer;

  css: <TValue extends JsonValue | undefined = JsonValue | undefined>(
    map: LiveMapBindable,
    path: LivePath,
    toCss: CssMapper<TValue>,
  ) => LiveMapDisposer;

  cssPaths: (
    map: LiveMapBindable,
    paths: readonly LivePath[],
    toCss: PathsCssMapper,
  ) => LiveMapDisposer;
}>;

export function make_livetree_bind_api<TTree extends LiveTreeBindable>(tree: TTree): LiveTreeBindApi<TTree> {
  return Object.freeze({
    path: <TValue extends JsonValue | undefined = JsonValue | undefined>(
      map: LiveMapBindable,
      path: LivePath,
      apply: PathApply<TTree, TValue>,
    ) => bind_path_for(tree, map, path, apply),

    paths: (
      map: LiveMapBindable,
      paths: readonly LivePath[],
      apply: PathsApply<TTree>,
    ) => bind_paths_for(tree, map, paths, apply),

    textPaths: (
      map: LiveMapBindable,
      paths: readonly LivePath[],
      toText: PathsTextMapper,
    ) => bind_text_paths_for(tree, map, paths, toText),

    text: <TValue extends JsonValue | undefined = JsonValue | undefined>(
      map: LiveMapBindable,
      path: LivePath,
      toText?: TextMapper<TValue>,
    ) => bind_text_for(tree, map, path, toText),

    attr: <TValue extends JsonValue | undefined = JsonValue | undefined>(
      map: LiveMapBindable,
      path: LivePath,
      name: string,
      toValue?: TextMapper<TValue>,
    ) => bind_attr_for(tree, map, path, name, toValue),

    attrs: <TValue extends JsonValue | undefined = JsonValue | undefined>(
      map: LiveMapBindable,
      path: LivePath,
      toAttrs: AttrMapper<TValue>,
    ) => bind_attrs_for(tree, map, path, toAttrs),

    attrsPaths: (
      map: LiveMapBindable,
      paths: readonly LivePath[],
      toAttrs: PathsAttrMapper,
    ) => bind_attrs_paths_for(tree, map, paths, toAttrs),

    css: <TValue extends JsonValue | undefined = JsonValue | undefined>(
      map: LiveMapBindable,
      path: LivePath,
      toCss: CssMapper<TValue>,
    ) => bind_css_for(tree, map, path, toCss),

    cssPaths: (
      map: LiveMapBindable,
      paths: readonly LivePath[],
      toCss: PathsCssMapper,
    ) => bind_css_paths_for(tree, map, paths, toCss),
  });
}
function bind_path_for<TTree extends LiveTreeBindable, TValue extends JsonValue | undefined = JsonValue | undefined>(
  tree: TTree,
  map: LiveMapBindable,
  path: LivePath,
  apply: PathApply<TTree, TValue>,
): LiveMapDisposer {
  let previous: TValue | undefined;

  const sync = (): void => {
    const value = path_value<TValue>(map, path);
    apply(tree, value, previous);
    previous = value;
  };

  sync();
  return own_disposable_for_owner(
    tree.quid,
    normalize_disposer(map.sub.path(path, sync)),
    "binding",
  );
}

function bind_paths_for<TTree extends LiveTreeBindable>(
  tree: TTree,
  map: LiveMapBindable,
  paths: readonly LivePath[],
  apply: PathsApply<TTree>,
): LiveMapDisposer {
  let previous: readonly (JsonValue | undefined)[] | undefined;

  const sync = (): void => {
    const values = paths.map((path) => path_value(map, path));
    apply(tree, values, previous);
    previous = values;
  };

  sync();
  const disposers = paths.map((path) => normalize_disposer(map.sub.path(path, sync)));
  return own_disposable_for_owner(tree.quid, () => dispose_all(disposers), "binding");
}

function bind_text_paths_for<TTree extends LiveTreeBindable>(
  tree: TTree,
  map: LiveMapBindable,
  paths: readonly LivePath[],
  toText: PathsTextMapper,
): LiveMapDisposer {
  return bind_paths_for(tree, map, paths, (target, values, previous) => {
    target.text.set(toText(values, previous));
  });
}

function bind_attrs_paths_for<TTree extends LiveTreeBindable>(
  tree: TTree,
  map: LiveMapBindable,
  paths: readonly LivePath[],
  toAttrs: PathsAttrMapper,
): LiveMapDisposer {
  return bind_paths_for(tree, map, paths, (target, values, previous) => {
    apply_attrs(target, toAttrs(values, previous));
  });
}

function bind_css_paths_for<TTree extends LiveTreeBindable>(
  tree: TTree,
  map: LiveMapBindable,
  paths: readonly LivePath[],
  toCss: PathsCssMapper,
): LiveMapDisposer {
  return bind_paths_for(tree, map, paths, (target, values, previous) => {
    apply_css(target, toCss(values, previous));
  });
}

function bind_text_for<TTree extends LiveTreeBindable, TValue extends JsonValue | undefined = JsonValue | undefined>(
  tree: TTree,
  map: LiveMapBindable,
  path: LivePath,
  toText?: TextMapper<TValue>,
): LiveMapDisposer {
  return bind_path_for<TTree, TValue>(tree, map, path, (target, value, previous) => {
    const text = toText ? toText(value, previous) : String(value ?? "");
    target.text.set(text);
  });
}

function bind_attr_for<TTree extends LiveTreeBindable, TValue extends JsonValue | undefined = JsonValue | undefined>(
  tree: TTree,
  map: LiveMapBindable,
  path: LivePath,
  name: string,
  toValue?: TextMapper<TValue>,
): LiveMapDisposer {
  return bind_path_for<TTree, TValue>(tree, map, path, (target, value, previous) => {
    const attrValue = toValue ? toValue(value, previous) : value;
    apply_attrs(target, { [name]: attrValue as string | number | boolean | null | undefined });
  });
}

function bind_attrs_for<TTree extends LiveTreeBindable, TValue extends JsonValue | undefined = JsonValue | undefined>(
  tree: TTree,
  map: LiveMapBindable,
  path: LivePath,
  toAttrs: AttrMapper<TValue>,
): LiveMapDisposer {
  return bind_path_for<TTree, TValue>(tree, map, path, (target, value, previous) => {
    apply_attrs(target, toAttrs(value, previous));
  });
}

function bind_css_for<TTree extends LiveTreeBindable, TValue extends JsonValue | undefined = JsonValue | undefined>(
  tree: TTree,
  map: LiveMapBindable,
  path: LivePath,
  toCss: CssMapper<TValue>,
): LiveMapDisposer {
  return bind_path_for<TTree, TValue>(tree, map, path, (target, value, previous) => {
    apply_css(target, toCss(value, previous));
  });
}

type LiveMapDisposer = () => void;

type LiveMapPathSubscriber = Readonly<{
  path: (path: LivePath, listener: () => void) => LiveMapDisposer | void;
}>;

type LiveMapReadablePath = Readonly<{
  snap: () => JsonValue | undefined;
}>;

type LiveMapBindable = Readonly<{
  at: (path: LivePath) => LiveMapReadablePath;
  sub: LiveMapPathSubscriber;
}>;

type PathApply<TTree extends LiveTreeBindable, TValue extends JsonValue | undefined> = (
  tree: TTree,
  value: TValue,
  previous: TValue | undefined,
) => void;

type PathsApply<TTree extends LiveTreeBindable> = (
  tree: TTree,
  values: readonly (JsonValue | undefined)[],
  previous: readonly (JsonValue | undefined)[] | undefined,
) => void;

type PathsMapperInput = readonly (JsonValue | undefined)[];

type CssValueMap = Readonly<Record<string, string | number | null | undefined>>;
type AttrValueMap = Readonly<Record<string, string | number | boolean | null | undefined>>;

type CssMapper<TValue extends JsonValue | undefined> = (value: TValue, previous: TValue | undefined) => CssValueMap;
type AttrMapper<TValue extends JsonValue | undefined> = (value: TValue, previous: TValue | undefined) => AttrValueMap;
type TextMapper<TValue extends JsonValue | undefined> = (value: TValue, previous: TValue | undefined) => string;
type PathsCssMapper = (values: PathsMapperInput, previous: PathsMapperInput | undefined) => CssValueMap;
type PathsAttrMapper = (values: PathsMapperInput, previous: PathsMapperInput | undefined) => AttrValueMap;
type PathsTextMapper = (values: PathsMapperInput, previous: PathsMapperInput | undefined) => string;

function dispose_all(disposers: readonly LiveMapDisposer[]): void {
  disposers.forEach((dispose) => dispose());
}

function normalize_disposer(disposer: LiveMapDisposer | void): LiveMapDisposer {
  return typeof disposer === "function" ? disposer : () => undefined;
}

function path_value<TValue extends JsonValue | undefined>(map: LiveMapBindable, path: LivePath): TValue {
  return map.at(path).snap() as TValue;
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

export function bind_path<TTree extends LiveTreeBindable, TValue extends JsonValue | undefined = JsonValue | undefined>(
  this: TTree,
  map: LiveMapBindable,
  path: LivePath,
  apply: PathApply<TTree, TValue>,
): LiveMapDisposer {
  return bind_path_for(this, map, path, apply);
}

export function bind_paths<TTree extends LiveTreeBindable>(
  this: TTree,
  map: LiveMapBindable,
  paths: readonly LivePath[],
  apply: PathsApply<TTree>,
): LiveMapDisposer {
  return bind_paths_for(this, map, paths, apply);
}

export function bind_text_paths<TTree extends LiveTreeBindable>(
  this: TTree,
  map: LiveMapBindable,
  paths: readonly LivePath[],
  toText: PathsTextMapper,
): LiveMapDisposer {
  return bind_text_paths_for(this, map, paths, toText);
}

export function bind_text<TTree extends LiveTreeBindable, TValue extends JsonValue | undefined = JsonValue | undefined>(
  this: TTree,
  map: LiveMapBindable,
  path: LivePath,
  toText?: TextMapper<TValue>,
): LiveMapDisposer {
  return bind_text_for(this, map, path, toText);
}

export function bind_attr<TTree extends LiveTreeBindable, TValue extends JsonValue | undefined = JsonValue | undefined>(
  this: TTree,
  map: LiveMapBindable,
  path: LivePath,
  name: string,
  toValue?: TextMapper<TValue>,
): LiveMapDisposer {
  return bind_attr_for(this, map, path, name, toValue);
}

export function bind_attrs_paths<TTree extends LiveTreeBindable>(
  this: TTree,
  map: LiveMapBindable,
  paths: readonly LivePath[],
  toAttrs: PathsAttrMapper,
): LiveMapDisposer {
  return bind_attrs_paths_for(this, map, paths, toAttrs);
}

export function bind_attrs<TTree extends LiveTreeBindable, TValue extends JsonValue | undefined = JsonValue | undefined>(
  this: TTree,
  map: LiveMapBindable,
  path: LivePath,
  toAttrs: AttrMapper<TValue>,
): LiveMapDisposer {
  return bind_attrs_for(this, map, path, toAttrs);
}

export function bind_css_paths<TTree extends LiveTreeBindable>(
  this: TTree,
  map: LiveMapBindable,
  paths: readonly LivePath[],
  toCss: PathsCssMapper,
): LiveMapDisposer {
  return bind_css_paths_for(this, map, paths, toCss);
}

export function bind_css<TTree extends LiveTreeBindable, TValue extends JsonValue | undefined = JsonValue | undefined>(
  this: TTree,
  map: LiveMapBindable,
  path: LivePath,
  toCss: CssMapper<TValue>,
): LiveMapDisposer {
  return bind_css_for(this, map, path, toCss);
}
