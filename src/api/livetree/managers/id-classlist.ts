import { IdApi, ClassApi } from "../../../types/dom.types.js";
import { LiveTree } from "../livetree.js";
import { getAttrImpl, setAttrsImpl, removeAttrImpl } from "./attr-handle.js";


export function make_id_api<TTree extends LiveTree>(tree: TTree): IdApi<TTree> {

  return {
    // read from underlying attr impl to avoid calling tree.id.get() (recursion)
    get: () => {
      const v = getAttrImpl(tree, "id");
      return typeof v === "string" ? v : undefined;
    },

    // write via attr impl (id is just an attribute)
    set: (id: string) => {
      setAttrsImpl(tree, "id", id);
      return tree;
    },

    // clear via remove impl
    clear: () => {
      removeAttrImpl(tree, "id");
      return tree;
    },
  };
}

export function make_class_api<TTree extends LiveTree>(tree: TTree): ClassApi<TTree> {
  // read from attrs, not tree.classlist.get() (avoids self-recursion)
  const getRaw = (): string | undefined => {
    const v = tree.attr.get("class");
    return (typeof v === "string" && v.trim().length > 0) ? v : undefined;
  };

  // keep parsing centralized; uses getRaw() once per op
  const getSet = (): Set<string> => {
    const s = getRaw() ?? "";
    return new Set(s.split(/\s+/).filter(Boolean));
  };

  // centralize write semantics (empty => drop)
  const write = (names: Iterable<string>): TTree => {
    const next = Array.from(names).filter(Boolean).join(" ").trim();
    if (!next) tree.attr.drop("class");
    else tree.attr.set("class", next);
    return tree;
  };

  return {
    get: () => getRaw(),

    has: (name: string) => getSet().has(name),

    set: (cls) => {
      const next = Array.isArray(cls)
        ? cls.filter(Boolean).join(" ").trim()
        : (cls ?? "").trim();

      // write via attrs (no tree.classlist.*)
      if (!next) tree.attr.drop("class");
      else tree.attr.set("class", next);

      return tree;
    },

    add: (...names) => {
      const set = getSet();
      for (const n of names) if (n) set.add(n);
      return write(set);
    },

    remove: (...names) => {
      const set = getSet();
      for (const n of names) if (n) set.delete(n);
      return write(set);
    },

    toggle: (name, force) => {
      const set = getSet();
      const has = set.has(name);
      const shouldHave = (force === undefined) ? !has : force;

      if (shouldHave) set.add(name);
      else set.delete(name);

      return write(set);
    },

    clear: () => {
      // drop via attrs
      tree.attr.drop("class");
      return tree;
    },
  };
}
