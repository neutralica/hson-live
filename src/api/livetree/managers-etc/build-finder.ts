import { LiveTree } from "../../livetree/livetree";
import { search_nodes } from "../methods/search";
import { make_tree_selector } from "../livetree-creation/make-tree-selector";
import { TreeSelector } from "../tree-selector";
import { wrap_in_tree } from "../create-livetree";
import { HsonQuery } from "../../../types/livetree.types";


interface FinderBuilder {
  tag(tag: string): FinderBuilder;
  attr(name: string, value: string): FinderBuilder;
  flag(flag: string): FinderBuilder;
  id(id: string): FinderBuilder;

  get(): LiveTree | undefined;
  must(label?: string): LiveTree;
}

interface FindAllBuilder {
  tag(tag: string): FindAllBuilder;
  attr(name: string, value: string): FindAllBuilder;
  flag(flag: string): FindAllBuilder;
  ids(...ids: string[]): FindAllBuilder;

  get(): TreeSelector;
  must(label?: string): TreeSelector;
}

export function build_finder(tree: LiveTree): FinderBuilder {
  let query: HsonQuery = {};

  const api: FinderBuilder = {
    tag(tag) {
      query = { ...query, tag };
      return api;
    },

    attr(name, value) {
      query = {
        ...query,
        attrs: { ...(query.attrs ?? {}), [name]: value },
      };
      return api;
    },

    flag(flag) {
      return api.attr(flag, flag);
    },

    id(id) {
      return api.attr("id", id);
    },

    get() {
      const found = search_nodes([tree.node], query, { findFirst: true });
      if (!found.length) return undefined;
      return wrap_in_tree(tree, found[0]);
    },

    must(label) {
      const res = api.get();
      if (!res) {
        const desc = label ?? JSON.stringify(query);
        throw new Error(`[LiveTree.find.must] expected match for ${desc}`);
      }
      return res;
    },
  };

  return api;
}

export function build_findall(tree: LiveTree): FindAllBuilder {
  let queries: HsonQuery[] = [{}];

  const api: FindAllBuilder = {
    tag(tag) {
      queries = queries.map(q => ({ ...q, tag }));
      return api;
    },

    attr(name, value) {
      queries = queries.map(q => ({
        ...q,
        attrs: { ...(q.attrs ?? {}), [name]: value },
      }));
      return api;
    },

    flag(flag) {
      return api.attr(flag, flag);
    },

    ids(...ids) {
      queries = ids.map(id => ({ attrs: { id } }));
      return api;
    },

    get() {
      const out: LiveTree[] = [];

      for (const q of queries) {
        const found = search_nodes([tree.node], q, { findFirst: false });
        for (const node of found) {
          out.push(wrap_in_tree(tree, node));
        }
      }

      return make_tree_selector(out);
    },

    must(label) {
      const sel = api.get();
      if (sel.count() === 0) {
        const desc = label ?? JSON.stringify(queries);
        throw new Error(`[LiveTree.findAll.must] expected >=1 match for ${desc}`);
      }
      return sel;
    },
  };

  return api;
}