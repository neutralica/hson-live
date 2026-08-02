// @hson-live-external-test
import assert from "node:assert/strict";
import {
  hson,
  validate_document_path,
} from "../src/index.ts";
import {
  append_document_path,
  compare_document_paths,
  document_path_equal,
  document_path_is_prefix,
  encode_document_path,
  find_document_node_path,
  LiveMapDocumentPathError,
  parent_document_path,
  resolve_document_path,
  transform_document_path,
} from "../src/api/livemap/livemap.document.path.ts";
import { LiveMapDocumentMutationError } from "../src/api/livemap/livemap.error.ts";
import type { ElementLiveMap, FragmentLiveMap } from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error("Expected element map");
  return map;
}

function fragment(source: string): FragmentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "fragment") throw new Error("Expected fragment map");
  return map;
}

const path = (...parts: number[]) => validate_document_path(parts);

check("validation detaches and freezes the nominal canonical path", () => {
  const input = [1, 2];
  const canonical = validate_document_path(input);
  input[0] = 9;
  assert.deepEqual(canonical, [1, 2]);
  assert.equal(Object.isFrozen(canonical), true);
});

check("the empty canonical root path is valid and deterministic", () => {
  const root = path();
  assert.deepEqual(root, []);
  assert.equal(encode_document_path(root), "[]");
});

check("non-array document paths reject as malformed", () => {
  assert.throws(() => validate_document_path({ 0: 1 }), (error: unknown) =>
    error instanceof LiveMapDocumentPathError && error.code === "MALFORMED_DOCUMENT_PATH");
});

check("negative, fractional, nonfinite, and unsafe path indexes reject", () => {
  for (const invalid of [-1, 0.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validate_document_path([invalid]), (error: unknown) =>
      error instanceof LiveMapDocumentPathError && error.code === "INVALID_DOCUMENT_PATH_INDEX");
  }
});

check("document paths do not admit projected LivePath string keys", () => {
  assert.throws(() => validate_document_path(["child"]), (error: unknown) =>
    error instanceof LiveMapDocumentPathError && error.code === "INVALID_DOCUMENT_PATH_INDEX");
});

check("path comparison is lexicographic and prefix-aware", () => {
  assert.equal(compare_document_paths(path(0, 2), path(0, 10)), -1);
  assert.equal(compare_document_paths(path(1), path(0, 99)), 1);
  assert.equal(compare_document_paths(path(1), path(1, 0)), -1);
});

check("path equality compares canonical numeric segments", () => {
  assert.equal(document_path_equal(path(0, 1), path(0, 1)), true);
  assert.equal(document_path_equal(path(0, 1), path(1, 0)), false);
});

check("prefix includes equality and strict ancestry only", () => {
  assert.equal(document_path_is_prefix(path(0), path(0, 2, 1)), true);
  assert.equal(document_path_is_prefix(path(0), path(0)), true);
  assert.equal(document_path_is_prefix(path(0, 2), path(0)), false);
});

check("append validates and returns a detached canonical path", () => {
  const appended = append_document_path(path(0), 3);
  assert.deepEqual(appended, [0, 3]);
  assert.equal(Object.isFrozen(appended), true);
  assert.throws(() => append_document_path(path(), -1), /safe integer/);
});

check("parent returns the canonical ancestor and root has none", () => {
  assert.deepEqual(parent_document_path(path(0, 3)), [0]);
  assert.equal(parent_document_path(path()), undefined);
});

check("element mode empty path addresses the one public top-level element", () => {
  const map = element(`<main id="root"/>`);
  const endpoint = resolve_document_path(map.root(), map.mode, path());
  assert.equal(typeof endpoint === "object" && endpoint !== null && endpoint.$_tag, "main");
});

check("element paths descend through the canonical element content cluster", () => {
  const map = element(`<main <section id="nested"/>/>`);
  const cluster = resolve_document_path(map.root(), map.mode, path(0));
  const nested = resolve_document_path(map.root(), map.mode, path(0, 0));
  assert.equal(typeof cluster === "object" && cluster !== null && cluster.$_tag, "_hson_elem");
  assert.equal(typeof nested === "object" && nested !== null && nested.$_tag, "section");
});

check("fragment mode empty path addresses the exact _hson_elem cluster boundary", () => {
  const map = fragment(`<a/> <b/>`);
  const endpoint = resolve_document_path(map.root(), map.mode, path());
  assert.equal(typeof endpoint === "object" && endpoint !== null && endpoint.$_tag, "_hson_elem");
});

check("fragment top-level siblings use direct cluster content indexes", () => {
  const map = fragment(`<a/> <b/>`);
  const first = resolve_document_path(map.root(), map.mode, path(0));
  const second = resolve_document_path(map.root(), map.mode, path(1));
  assert.equal(typeof first === "object" && first !== null && first.$_tag, "a");
  assert.equal(typeof second === "object" && second !== null && second.$_tag, "b");
});

check("legal primitive leaves are addressable through owning structural carriers", () => {
  const map = fragment(`"text" <b/>`);
  const primitive = resolve_document_path(map.root(), map.mode, path(0, 0));
  assert.equal(primitive, "text");
});

check("descent beyond a primitive reports a distinct structured failure", () => {
  const map = fragment(`"text" <b/>`);
  assert.throws(() => resolve_document_path(map.root(), map.mode, path(0, 0, 0)), (error: unknown) =>
    error instanceof LiveMapDocumentPathError && error.code === "DOCUMENT_PATH_PRIMITIVE_DESCENT");
});

check("out-of-range canonical content ownership reports a distinct failure", () => {
  const map = fragment(`<a/> <b/>`);
  assert.throws(() => resolve_document_path(map.root(), map.mode, path(2)), (error: unknown) =>
    error instanceof LiveMapDocumentPathError && error.code === "DOCUMENT_PATH_OUT_OF_RANGE");
});

check("attribute operations retain target-node-kind validation", () => {
  const map = element(`<main <span/>/>`);
  assert.throws(() => map.document.attrs.set({ kind: "path", path: [0] }, "id", "bad"), (error: unknown) =>
    error instanceof LiveMapDocumentMutationError && error.code === "DOCUMENT_TARGET_KIND");
});

check("exact-node discovery returns a canonical path in both modes", () => {
  const elementRoot = element(`<main <span/>/>`).root();
  const elementTarget = resolve_document_path(elementRoot, "element", path(0, 0));
  if (typeof elementTarget !== "object" || elementTarget === null) throw new Error("Expected node");
  assert.deepEqual(find_document_node_path(elementRoot, "element", elementTarget), [0, 0]);
  const fragmentRoot = fragment(`<a/> <b/>`).root();
  const fragmentTarget = resolve_document_path(fragmentRoot, "fragment", path(1));
  if (typeof fragmentTarget !== "object" || fragmentTarget === null) throw new Error("Expected node");
  assert.deepEqual(find_document_node_path(fragmentRoot, "fragment", fragmentTarget), [1]);
});

check("exact-node discovery does not equate detached structural clones", () => {
  const root = fragment(`<a/> <b/>`).root();
  assert.equal(find_document_node_path(root, "fragment", { $_tag: "a", $_content: [] }), undefined);
});

check("insertion shifts the inserted slot and following sibling paths", () => {
  assert.deepEqual(transform_document_path(path(2, 1), { kind: "insert", parent: path(), index: 1 }), {
    kind: "moved", path: [3, 1],
  });
  assert.deepEqual(transform_document_path(path(0), { kind: "insert", parent: path(), index: 1 }), {
    kind: "unchanged", path: [0],
  });
});

check("deletion retires the subtree and shifts following siblings", () => {
  assert.deepEqual(transform_document_path(path(1, 2), { kind: "delete", parent: path(), index: 1 }), {
    kind: "retired", reason: "deleted",
  });
  assert.deepEqual(transform_document_path(path(3), { kind: "delete", parent: path(), index: 1 }), {
    kind: "moved", path: [2],
  });
});

check("replacement retires only the replaced subtree", () => {
  assert.deepEqual(transform_document_path(path(1, 2), { kind: "replace", parent: path(), index: 1 }), {
    kind: "retired", reason: "replaced",
  });
  assert.deepEqual(transform_document_path(path(2), { kind: "replace", parent: path(), index: 1 }), {
    kind: "unchanged", path: [2],
  });
});

check("final-position moves preserve descendants and shift intervening siblings", () => {
  assert.deepEqual(transform_document_path(path(1, 4), { kind: "move", parent: path(), from: 1, to: 3 }), {
    kind: "moved", path: [3, 4],
  });
  assert.deepEqual(transform_document_path(path(3), { kind: "move", parent: path(), from: 1, to: 3 }), {
    kind: "moved", path: [2],
  });
  assert.deepEqual(transform_document_path(path(1), { kind: "move", parent: path(), from: 3, to: 1 }), {
    kind: "moved", path: [2],
  });
});

check("root replacement retires every old path and malformed effects are explicit", () => {
  assert.deepEqual(transform_document_path(path(), { kind: "replace-root" }), {
    kind: "retired", reason: "root-replaced",
  });
  assert.equal(transform_document_path(path(1), { kind: "insert", parent: path(), index: -1 }).kind, "invalid");
});

process.stdout.write(`# ${checks} canonical document-path checks passed\n`);
emit_hson_live_test_completion("livemap.document-path-contract", checks, checks, 0);
