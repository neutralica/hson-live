import { canonical_attr_is_flag } from "../../core/public-attr-transitions.js";
import type { CanonicalPublicAttrs, Primitive } from "../../core/types.js";
import type {
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
} from "../../types/livemap.types.js";
import { document_binding_for_node, type DocumentBoundAttrsMutation } from "./lifecycle/document-binding-state.js";
import { parent_for_node } from "./lifecycle/graph-ownership.js";
import type { LiveTree } from "./livetree.js";
import {
  livetree_flag_values,
  normalize_livetree_attr_name,
  normalize_livetree_attr_value,
  normalize_livetree_attrs_input,
  normalize_livetree_drop_names,
  normalize_livetree_flag_names,
} from "./managers/attr-handle.js";

export type AsyncLiveTreeAttrs<TOwner extends LiveTree> = Readonly<{
  set(name: string, value: LiveMapDocumentAttributeValue): Promise<AsyncLiveTree<TOwner>>;
  setMany(values: LiveMapDocumentAttrs): Promise<AsyncLiveTree<TOwner>>;
  drop(name: string): Promise<AsyncLiveTree<TOwner>>;
  dropMany(names: readonly string[]): Promise<AsyncLiveTree<TOwner>>;
  clear(): Promise<AsyncLiveTree<TOwner>>;
  replace(values: LiveMapDocumentAttrs): Promise<AsyncLiveTree<TOwner>>;
}>;

export type AsyncLiveTreeFlags<TOwner extends LiveTree> = Readonly<{
  set(...names: string[]): Promise<AsyncLiveTree<TOwner>>;
  clear(...names: string[]): Promise<AsyncLiveTree<TOwner>>;
}>;

export type AsyncLiveTreeId<TOwner extends LiveTree> = Readonly<{
  set(value: string): Promise<AsyncLiveTree<TOwner>>;
  clear(): Promise<AsyncLiveTree<TOwner>>;
}>;

export type AsyncLiveTreeClasslist<TOwner extends LiveTree> = Readonly<{
  set(value: string | readonly string[]): Promise<AsyncLiveTree<TOwner>>;
  add(...names: string[]): Promise<AsyncLiveTree<TOwner>>;
  remove(...names: string[]): Promise<AsyncLiveTree<TOwner>>;
  toggle(name: string, force?: boolean): Promise<AsyncLiveTree<TOwner>>;
  clear(): Promise<AsyncLiveTree<TOwner>>;
}>;

export type AsyncLiveTreeText<TOwner extends LiveTree> = Readonly<{
  set(value: Primitive): Promise<AsyncLiveTree<TOwner>>;
  add(value: Primitive): Promise<AsyncLiveTree<TOwner>>;
  insert(index: number, value: Primitive): Promise<AsyncLiveTree<TOwner>>;
}>;

export type AsyncLiveTreeForm<TOwner extends LiveTree> = Readonly<{
  setValue(value: string): Promise<AsyncLiveTree<TOwner>>;
  setChecked(value: boolean): Promise<AsyncLiveTree<TOwner>>;
}>;

/** Explicit Promise-settled exact document-authoring context for one LiveTree. */
export interface AsyncLiveTree<TOwner extends LiveTree = LiveTree> {
  readonly attrs: AsyncLiveTreeAttrs<TOwner>;
  readonly flags: AsyncLiveTreeFlags<TOwner>;
  readonly id: AsyncLiveTreeId<TOwner>;
  readonly classlist: AsyncLiveTreeClasslist<TOwner>;
  readonly text: AsyncLiveTreeText<TOwner>;
  readonly form: AsyncLiveTreeForm<TOwner>;
  readonly sync: TOwner;
  empty(): Promise<AsyncLiveTree<TOwner>>;
  remove(): Promise<void>;
}

class AsyncLiveTreeImplementation<TOwner extends LiveTree> implements AsyncLiveTree<TOwner> {
  public readonly attrs: AsyncLiveTreeAttrs<TOwner>;
  public readonly flags: AsyncLiveTreeFlags<TOwner>;
  public readonly id: AsyncLiveTreeId<TOwner>;
  public readonly classlist: AsyncLiveTreeClasslist<TOwner>;
  public readonly text: AsyncLiveTreeText<TOwner>;
  public readonly form: AsyncLiveTreeForm<TOwner>;

  public constructor(private readonly owner: TOwner) {
    const fluent = (operation: () => void | Promise<void>): Promise<AsyncLiveTree<TOwner>> => {
      try {
        return Promise.resolve(operation()).then(() => this);
      } catch (cause) {
        return Promise.reject(cause);
      }
    };

    const attrs = (mutation: DocumentBoundAttrsMutation, local: () => void): Promise<AsyncLiveTree<TOwner>> =>
      fluent(async () => {
        const binding = document_binding_for_node(owner.node);
        if (binding !== undefined) await binding.delegateAttrsAsync(mutation);
        else local();
      });

    const attrSet = (name: string, value: LiveMapDocumentAttributeValue, operation: string): Promise<AsyncLiveTree<TOwner>> =>
      fluent(async () => {
        const key = normalize_livetree_attr_name(owner, name, operation);
        const decoded = normalize_livetree_attr_value(owner, key, value, operation);
        const binding = document_binding_for_node(owner.node);
        if (binding !== undefined) await binding.delegateAttrsAsync({ kind: "set", name: key, value: decoded });
        else owner.attrs.set(key, decoded);
      });

    const attrDrop = (name: string, operation: string): Promise<AsyncLiveTree<TOwner>> =>
      fluent(async () => {
        const key = normalize_livetree_attr_name(owner, name, operation);
        const binding = document_binding_for_node(owner.node);
        if (binding !== undefined) await binding.delegateAttrsAsync({ kind: "drop", name: key });
        else owner.attrs.drop(key);
      });

    this.attrs = Object.freeze({
      set: (name, value) => attrSet(name, value, "set"),
      setMany: (values) => fluent(async () => {
        const normalized = normalize_livetree_attrs_input(owner, values, "setMany");
        const binding = document_binding_for_node(owner.node);
        if (binding !== undefined) await binding.delegateAttrsAsync({ kind: "setMany", values: normalized });
        else owner.attrs.setMany(normalized);
      }),
      drop: (name) => attrDrop(name, "drop"),
      dropMany: (names) => fluent(async () => {
        const normalized = normalize_livetree_drop_names(owner, names, "dropMany");
        const binding = document_binding_for_node(owner.node);
        if (binding !== undefined) await binding.delegateAttrsAsync({ kind: "dropMany", names: normalized });
        else owner.attrs.dropMany(normalized);
      }),
      clear: () => attrs({ kind: "clear" }, () => { owner.attrs.clear(); }),
      replace: (values) => fluent(async () => {
        const normalized = normalize_livetree_attrs_input(owner, values, "replace");
        const binding = document_binding_for_node(owner.node);
        if (binding !== undefined) await binding.delegateAttrsAsync({ kind: "replace", values: normalized });
        else owner.attrs.replace(normalized);
      }),
    });

    this.flags = Object.freeze({
      set: (...names) => fluent(async () => {
        const normalized = normalize_livetree_flag_names(owner, names, "flags.set", true);
        const binding = document_binding_for_node(owner.node);
        if (binding !== undefined) await binding.delegateAttrsAsync({ kind: "setMany", values: livetree_flag_values(normalized) });
        else owner.flags.set(...normalized);
      }),
      clear: (...names) => fluent(async () => {
        const normalized = normalize_livetree_flag_names(owner, names, "flags.clear", true);
        const binding = document_binding_for_node(owner.node);
        if (binding !== undefined) {
          await binding.delegateAttrsAsync({
            kind: "transform",
            apply: (current: CanonicalPublicAttrs) => ({
              kind: "dropMany",
              names: normalized.filter((name) => canonical_attr_is_flag(current, name)),
            }),
          });
        } else owner.flags.clear(...normalized);
      }),
    });

    this.id = Object.freeze({
      set: (value) => attrSet("id", value, "id.set"),
      clear: () => attrDrop("id", "id.clear"),
    });

    const classTransform = (
      operation: (current: Set<string>) => Set<string>,
    ): Promise<AsyncLiveTree<TOwner>> => attrs({
      kind: "transform",
      apply: (current) => {
        const raw = typeof current.class === "string" ? current.class : "";
        const next = [...operation(new Set(raw.split(/\s+/).filter(Boolean)))].filter(Boolean).join(" ").trim();
        return next.length === 0
          ? { kind: "drop", name: "class" }
          : { kind: "set", name: "class", value: next };
      },
    }, () => {
      const raw = owner.attrs.get("class");
      const current = typeof raw === "string" ? raw : "";
      const next = [...operation(new Set(current.split(/\s+/).filter(Boolean)))].filter(Boolean).join(" ").trim();
      if (next.length === 0) owner.attrs.drop("class");
      else owner.attrs.set("class", next);
    });

    this.classlist = Object.freeze({
      set: (value) => {
        const next = (typeof value === "string" ? value : value.filter(Boolean).join(" ")).trim();
        return next.length === 0 ? attrDrop("class", "classlist.set") : attrSet("class", next, "classlist.set");
      },
      add: (...names) => classTransform((current) => {
        for (const name of names) if (name) current.add(name);
        return current;
      }),
      remove: (...names) => classTransform((current) => {
        for (const name of names) if (name) current.delete(name);
        return current;
      }),
      toggle: (name, force) => classTransform((current) => {
        const shouldHave = force === undefined ? !current.has(name) : force;
        if (shouldHave) current.add(name);
        else current.delete(name);
        return current;
      }),
      clear: () => attrDrop("class", "classlist.clear"),
    });

    const text = (kind: "set" | "add", value: Primitive): Promise<AsyncLiveTree<TOwner>> => fluent(async () => {
      const binding = document_binding_for_node(owner.node);
      if (binding !== undefined) await binding.delegateTextAsync({ kind, value });
      else owner.text[kind](value);
    });
    this.text = Object.freeze({
      set: (value) => text("set", value),
      add: (value) => text("add", value),
      insert: (index, value) => fluent(async () => {
        const binding = document_binding_for_node(owner.node);
        if (binding !== undefined) await binding.delegateTextAsync({ kind: "insert", index, value });
        else owner.text.insert(index, value);
      }),
    });

    this.form = Object.freeze({
      setValue: (value) => attrSet("value", value, "form.setValue"),
      setChecked: (value) => attrSet("checked", value, "form.setChecked"),
    });
    Object.freeze(this);
  }

  /** Explicitly return to projected/runtime synchronous LiveTree concerns. */
  public get sync(): TOwner {
    return this.owner;
  }

  public empty(): Promise<AsyncLiveTree<TOwner>> {
    try {
      const binding = document_binding_for_node(this.owner.node);
      const operation = binding !== undefined
        ? binding.delegateEmptyAsync()
        : Promise.resolve(this.owner.empty()).then(() => {});
      return operation.then(() => this);
    } catch (cause) {
      return Promise.reject(cause);
    }
  }

  public remove(): Promise<void> {
    try {
      const binding = document_binding_for_node(this.owner.node);
      if (binding !== undefined) return binding.delegateRemoveAsync();
      if (parent_for_node(this.owner.node) === undefined) {
        return Promise.reject(new Error("AsyncLiveTree.remove requires a non-root tree."));
      }
      this.owner.remove();
      return Promise.resolve();
    } catch (cause) {
      return Promise.reject(cause);
    }
  }
}

/** @internal Construct the one facade owned by LiveTree.async. */
export function create_async_livetree_internal<TOwner extends LiveTree>(owner: TOwner): AsyncLiveTree<TOwner> {
  return new AsyncLiveTreeImplementation(owner);
}
