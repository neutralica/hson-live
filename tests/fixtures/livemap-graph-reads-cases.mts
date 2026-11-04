import { snap_live_path as public_snap } from "../../src/api/livemap/index.js";
import { hsonTransform } from "../../src/api/transform/index.js";
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../../src/index.js";
import type { HsonNode, JsonValue } from "../../src/core/types.js";
import type { LivePath } from "../../src/types/livemap.types.js";
import { CREATE_NODE } from "../../src/core/factories.js";
import { ARR_TAG, II_TAG, OBJ_TAG, ROOT_TAG, STR_TAG, VAL_TAG } from "../../src/core/constants.js";
import { ordered_projected_array, ordered_projected_object, ordered_projected_value_equal, type OrderedProjectedValue } from "../../src/core/ordered-projected-value.js";
import { materialize_projected_hson_node, projected_value_from_hson_node, projected_value_to_hson_root } from "../../src/core/projected-value-graph.js";
import { materialize_projected_value } from "../../src/core/projected-value-materialization.js";
import { hson_data_text_from_value, hson_data_value } from "../../src/api/data/hson-data.js";
import { kind_live_path, project_live_path, resolve_value_node, snap_live_path } from "../../src/api/livemap/livemap.editor.js";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.js";
import { make_livemap_staged_writer } from "../../src/api/livemap/livemap.staged.js";
import { acquire_projected_identity } from "../helpers/livemap-identity-internal.mts";
import { INTERACTION_RESERVED_LIBRARY_KEY } from "../../src/internal/interaction-storage.js";
import { add_interaction, enable_interactions, replace_interaction, remove_interaction } from "../../src/api/interactions/interactions.js";

type Check = (name: string, run: () => void | Promise<void>) => Promise<void>;
const object = ordered_projected_object;
const array = ordered_projected_array;
const value = object([
  ["10", -0], ["2", object([["10", Number.MAX_VALUE], ["2", Number.MIN_VALUE], ["negatives", array([-Number.MAX_VALUE, -Number.MIN_VALUE])]])],
  ["__proto__", object([["safe", true]])], ["constructor", "own"], ["", null],
  ["emptyObject", object([])], ["emptyArray", array([])],
  ["nested", array([object([["text", '雪🦊\ud800\udfff"\\\n'], ["booleans", array([true, false, null])]]), array([0, -0])])],
]);
const source = Hson.data.fromSource(hson_data_text_from_value(value));

function differential(root: HsonNode, paths: readonly LivePath[]): void {
  for (const path of paths) {
    const projected = project_live_path(root, path);
    assert.deepEqual(snap_live_path(root, path), projected === undefined ? undefined : materialize_projected_value(projected));
  }
}

export async function livemap_graph_read_cases(check: Check): Promise<void> {
  await check("public snapshot export selects historical Document and strict Data contexts", () => {
    const document = hsonTransform.fromHson("<main/>").toNode();
    const before = JSON.stringify(document);
    assert.deepEqual(public_snap(document, []), {});
    assert.equal(public_snap(document, ["missing"]), undefined);
    assert.equal(JSON.stringify(document), before);
    for (const candidate of [null, true, false, "text", -0, Number.MAX_VALUE, object([]), array([]), array([value]), value]) {
      const graph = projected_value_to_hson_root(candidate);
      assert.deepEqual(public_snap(graph, []), materialize_projected_value(candidate));
      assert.equal(public_snap(graph, ["absent"]), undefined);
    }
    const root = projected_value_to_hson_root(value);
    differential(root, [[], ["2"], ["2", "10"], ["nested", 0], ["missing"]]);
    assert.deepEqual(public_snap(root, ["nested", 0]), snap_live_path(root, ["nested", 0]));
    const bad = (tag: string, content: HsonNode["$_content"]) => CREATE_NODE({ $_tag: tag, $_content: content });
    for (const malformed of [bad(VAL_TAG, ["1"]), bad(STR_TAG, [1]),
      bad(OBJ_TAG, [bad("$_meta", [bad(VAL_TAG, [1])])]),
      bad(OBJ_TAG, [bad("x", [bad(VAL_TAG, [1]), bad(VAL_TAG, [2])])]),
      bad(ROOT_TAG, [bad(OBJ_TAG, []), bad(OBJ_TAG, [])]),
      bad(OBJ_TAG, [bad("_hson_reserved", [bad(VAL_TAG, [1])])]),
      bad(ARR_TAG, [CREATE_NODE({$_tag:II_TAG,$_meta:{index:"1"},$_content:[bad(VAL_TAG,[0])]})])]) {
      assert.throws(() => public_snap(malformed, []));
      if (malformed.$_tag === OBJ_TAG) assert.throws(() => public_snap(malformed, [(malformed.$_content[0] as HsonNode).$_tag]));
    }
  });

  await check("array ranges select once, detach values and preserve boundary semantics", () => {
    const padding = Object.fromEntries(Array.from({length: 2048}, (_, i) => ["p" + i, i]));
    const map = hsonLiveMap.fromLibraries({state:{data:{...padding, selected:Array.from({length:512},(_,i)=>({n:i,zero:-0}))}}});
    const library = map.data.must("state"), owner = internal_livemap_aggregate_authority(map);
    const root = resolve_value_node(owner.root(owner.libraries()[0]!), [])!;
    const first = root.$_content[0] as HsonNode, tag = first.$_tag;
    let lookups = 0;
    Object.defineProperty(first, "$_tag", {configurable:true,get:()=>{lookups++;return tag;}});
    const api = library.at(["selected"]).asArray()!.array;
    try {
      lookups=0; api.slice(0,1); const one=lookups;
      lookups=0; const result=api.slice(0,512); assert.equal(lookups,one);
      for (const run of [() => api.take(512), () => api.drop(0), () => api.takeLast(512), () => api.dropLast(0)]) {
        lookups=0; run(); assert.equal(lookups,one);
      }
      assert.ok(one > 0);
      const item = result[0];
      assert.ok(item && typeof item === "object" && !Array.isArray(item));
      assert.ok(Object.is(item.zero,-0));
      Reflect.set(item, "n", 999); assert.equal(library.snap(["selected",0,"n"]),0);
      const expected=Array.from({length:512},(_,i)=>({n:i,zero:-0}));
      for(const count of [0,1,512,999]) {
        assert.deepEqual(api.take(count),expected.slice(0,count));
        assert.deepEqual(api.drop(count),expected.slice(count));
        assert.deepEqual(api.takeLast(count),count===0?[]:expected.slice(-count));
        assert.deepEqual(api.dropLast(count),count===0?expected:expected.slice(0,-count));
      }
      for(const [a,b] of [[-999,-1],[999,1000],[2,1],[0,0],[-2,999]]) assert.deepEqual(api.slice(a,b),expected.slice(a,b));
      for(const run of [()=>api.take(-1),()=>api.slice(0.5)]) assert.throws(run);
      library.at(["selected"]).replace([]);
      assert.deepEqual(api.slice(),[]); assert.deepEqual(api.takeLast(0),[]);
    } finally {Object.defineProperty(first,"$_tag",{value:tag,configurable:true,writable:true,enumerable:true});}
  });

  await check("direct materialization agrees with canonical projection across Data shapes and transparent wrappers", () => {
    const scalars = [null, true, false, "", "42", "<x 1>", "雪\ud800", 0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE];
    const values: readonly OrderedProjectedValue[] = [...scalars, object([]), array([]), value, array([value, array(scalars)])];
    for (const candidate of values) {
      const root = projected_value_to_hson_root(candidate);
      assert.deepEqual(materialize_projected_hson_node(root), materialize_projected_value(candidate));
      differential(root, [[], ["10"], ["2"], ["2", "10"], ["nested"], ["nested", 0, "text"], ["emptyArray", 0], ["missing"], [0], [1, 0]]);
      const wrapped = CREATE_NODE({ $_tag: OBJ_TAG, $_content: [CREATE_NODE({ $_tag: OBJ_TAG, $_content: root.$_content })] });
      assert.deepEqual(materialize_projected_hson_node(wrapped), materialize_projected_value(projected_value_from_hson_node(wrapped)));
      assert.equal(kind_live_path(wrapped, []), candidate === null || typeof candidate !== "object" ? "scalar" : Array.isArray(candidate) ? "array" : "object");
    }
    const snapshot = materialize_projected_hson_node(projected_value_to_hson_root(value));
    assert.ok(snapshot && !Array.isArray(snapshot) && typeof snapshot === "object");
    assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
    assert.equal(Object.hasOwn(snapshot, "__proto__"), true); assert.equal(snapshot.constructor, "own");
    assert.ok(Object.is(snapshot["10"], -0)); assert.equal(({} as Record<string, unknown>).safe, undefined);
  });

  await check("deterministic nested differential corpus preserves exact graph and Hson ordering", () => {
    let seed = 0x4d4d;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const generate = (depth: number): OrderedProjectedValue => {
      const choice = random() % (depth ? 7 : 5);
      if (choice === 0) return -0;
      if (choice === 1) return random() / 1024;
      if (choice === 2) return `text-${random()}\ud800`;
      if (choice === 3) return null;
      if (choice === 4) return Boolean(random() % 2);
      if (choice === 5) return array(Array.from({length: random() % 5}, () => generate(depth - 1)));
      return object(["10", "2", "__proto__", "constructor"].slice(0, random() % 5).map(key => [key, generate(depth - 1)] as const));
    };
    for (let i = 0; i < 200; i++) {
      const candidate = generate(4), root = projected_value_to_hson_root(candidate);
      assert.deepEqual(materialize_projected_hson_node(root), materialize_projected_value(candidate));
      assert.ok(ordered_projected_value_equal(projected_value_from_hson_node(root), candidate));
    }
    const map = hsonLiveMap.fromLibraries({ state: { data: source } }), library = map.data.must("state");
    assert.equal(library.hson(), source.toHson());
    assert.deepEqual(library.at([]).asObject()!.object.keys(), ["10", "2", "__proto__", "constructor", "", "emptyObject", "emptyArray", "nested"]);
    for (const path of [[], ["2"], ["2", "10"], ["nested"], ["nested", 0], ["10"]] satisfies LivePath[]) {
      const expected = project_live_path(library.root(), path)!;
      assert.equal(library.at(path).hson(), hson_data_text_from_value(expected));
      assert.deepEqual(library.snap(path), materialize_projected_value(expected));
    }
  });

  await check("malformed canonical reads fail exactly instead of skipping content or substituting values", () => {
    const n = (tag: string, content: HsonNode["$_content"] = []) => CREATE_NODE({ $_tag: tag, $_content: content });
    const malformed = [
      n(ROOT_TAG), n(ROOT_TAG, [n(OBJ_TAG), n(OBJ_TAG)]), n(STR_TAG), n(STR_TAG, [false]), n(STR_TAG, ["a", "b"]),
      n(VAL_TAG), n(VAL_TAG, ["42"]), n(VAL_TAG, [Infinity]), n(VAL_TAG, [NaN]), n(VAL_TAG, [n(OBJ_TAG)]),
      n("unsupported"), n(ARR_TAG, [n("wrong")]), n(ARR_TAG, [n(II_TAG, [n(VAL_TAG, [1])])]),
      n(ARR_TAG, [CREATE_NODE({ $_tag: II_TAG, $_meta: { index: "0" }, $_content: [] })]),
      n(OBJ_TAG, [1]), n(OBJ_TAG, [n("a")]), n(OBJ_TAG, [n("a", [n(VAL_TAG, [1]), n(VAL_TAG, [2])])]),
      n(OBJ_TAG, [n("$_meta", [n(VAL_TAG, [1])])]), n(OBJ_TAG, [n("_hson_reserved", [n(VAL_TAG, [1])])]),
      n(ARR_TAG, new Array(1)), n(OBJ_TAG, new Array(1)),
      n(OBJ_TAG, [n("a", [n(VAL_TAG, [1])]), n("a", [n(VAL_TAG, [2])])]),
    ];
    for (const root of malformed) {
      let canonical: unknown;
      try { materialize_projected_value(projected_value_from_hson_node(root)); } catch (error) { canonical = error; }
      assert.ok(canonical instanceof Error);
      const expected = canonical;
      assert.throws(() => materialize_projected_hson_node(root), error => error instanceof Error && error.constructor === expected.constructor && error.message === expected.message);
    }
  });

  await check("selected reads and shape guards never traverse unrelated Library subtrees", () => {
    const map = hsonLiveMap.fromLibraries({ state: { data: { scalar: -0, selected: { leaf: 3 }, rows: [{leaf: 1}, {leaf: 2}], other: { huge: [1,2,3] } } } });
    const library = map.data.must("state"), owner = internal_livemap_aggregate_authority(map), identity = owner.libraries()[0]!;
    const root = owner.root(identity), sibling = resolve_value_node(root, ["other", "huge"]);
    assert.ok(sibling);
    const content = Object.getOwnPropertyDescriptor(sibling, "$_content")!;
    Object.defineProperty(sibling, "$_content", { configurable: true, get: () => { throw Error("Unrelated subtree traversed"); } });
    try {
      assert.ok(Object.is(library.snap(["scalar"]), -0));
      assert.deepEqual(library.snap(["selected"]), {leaf: 3});
      assert.equal(library.at(["selected"]).hson(), Hson.data.from({leaf:3}).toHson());
      const objectApi = library.at([]).asObject()!.object, arrayApi = library.at(["rows"]).asArray()!.array;
      assert.deepEqual(objectApi.keys(), ["scalar", "selected", "rows", "other"]);
      assert.ok(objectApi.hasKey("other")); assert.equal(objectApi.size(), 4);
      assert.equal(library.at([]).kind(), "object"); assert.equal(arrayApi.length(), 2);
      assert.deepEqual(arrayApi.at(1), {leaf: 2}); assert.deepEqual(objectApi.getKey("selected"), {leaf:3});
      assert.equal(owner.projectedValue(identity, ["scalar"]), -0);
    } finally { Object.defineProperty(sibling, "$_content", content); }
  });

  await check("snapshots detach from graph and identity remains stable across reads and direct/staged writes", () => {
    const map = hsonLiveMap.fromLibraries({ state: { data: { value: {}, rows: [3,1,2] } } });
    const library = map.data.must("state"), owner = internal_livemap_aggregate_authority(map);
    library.at(["value"]).replace(source);
    const libraryId = owner.libraries()[0]!;
    const identity = acquire_projected_identity(library, ["value"]), quid = owner.projectedOverlay(libraryId).quidAtPath(["value"]);
    assert.ok(quid); assert.ok(identity.active);
    const ledger = owner.identityEpoch().issued(), epoch = owner.identityEpoch().current();
    const graph = library.root(), revision = map.rev;
    for (let i = 0; i < 10; i++) {
      assert.equal(library.at(["value"]).hson(), source.toHson());
      assert.deepEqual(identity.snap(), source.materialize());
      const snap = library.snap(); assert.ok(snap && !Array.isArray(snap) && typeof snap === "object");
      Reflect.set(snap, "value", "changed"); (snap.rows as JsonValue[]).push(99);
      const picked = library.at(["value"]).asObject()!.object.pick(["__proto__"]);
      assert.equal(Object.getPrototypeOf(picked), Object.prototype);
      Reflect.set(picked, "__proto__", "changed");
      assert.equal(library.at(["value"]).asObject()!.object.getKey("constructor"), "own");
    }
    assert.deepEqual(library.root(), graph); assert.equal(map.rev, revision);
    assert.equal(owner.identityEpoch().issued(), ledger); assert.equal(owner.identityEpoch().current(), epoch);
    assert.equal(owner.projectedOverlay(libraryId).quidAtPath(["value"]), quid);
    library.at(["value"]).asObject()!.object.setKey("new", -0);
    assert.equal(owner.projectedOverlay(libraryId).quidAtPath(["value"]), quid); assert.ok(Object.is(library.snap(["value", "new"]), -0));
    map.batch(tx => {
      tx.data.must("state").at(["rows"]).asArray()!.array.push(4);
      tx.data.must("state").at(["rows"]).asArray()!.array.move(3,0);
      tx.data.must("state").at(["value"]).asObject()!.object.setKey("later", "42");
    });
    const api = library.at(["rows"]).asArray()!.array;
    assert.deepEqual(api.toArray(), [4,3,1,2]); assert.equal(api.length(), 4); assert.equal(api.at(-1), 2);
    api.sortNumbers(); assert.deepEqual(api.toArray(), [1,2,3,4]);
    for (const start of [undefined,-6,-2,0,1,5]) for (const end of [undefined,-6,-1,0,2,5]) {
      assert.deepEqual(api.slice(start,end), [1,2,3,4].slice(start,end));
    }
    for (const count of [0,1,4,7]) {
      assert.deepEqual(api.take(count), [1,2,3,4].slice(0,count));
      assert.deepEqual(api.drop(count), [1,2,3,4].slice(count));
      assert.deepEqual(api.takeLast(count), count === 0 ? [] : [1,2,3,4].slice(-count));
      assert.deepEqual(api.dropLast(count), count === 0 ? [1,2,3,4] : [1,2,3,4].slice(0,-count));
    }
    assert.equal(library.snap(["value", "later"]), "42"); assert.equal(owner.projectedOverlay(libraryId).quidAtPath(["value"]), quid);
    differential(library.root(), [[], ["value"], ["value", "new"], ["rows"], ["rows", 0]]);
  });

  await check("literal strings, authenticated carriers and submission handoff preserve D4c and D4b contracts", () => {
    for (const candidate of ["42", "true", "null", "{}", "<a 1>", source]) {
      const map = hsonLiveMap.fromLibraries({ state: { data: candidate } }), library = map.data.must("state");
      assert.deepEqual(library.snap(), typeof candidate === "string" ? candidate : candidate.materialize());
      assert.equal(library.hson(), typeof candidate === "string" ? Hson.data.from(candidate).toHson() : candidate.toHson());
    }
    assert.equal(Hson.data.from(source), source);
    const map = hsonLiveMap.fromLibraries({ state: { data: { value: {} } } }), owner = internal_livemap_aggregate_authority(map);
    const staged = make_livemap_staged_writer(owner);
    staged.writer.data.must("state").at(["value"]).replace(source); staged.close();
    const queued = staged.writes()[0]; assert.ok(queued && queued.kind === "replace");
    assert.equal(queued.value, hson_data_value(source), "authenticated carrier identity survives submission handoff");
    owner.commit(staged.writes());
    assert.equal(map.data.must("state").at(["value"]).hson(), source.toHson());
    assert.equal(hson_data_value(source), queued.value);
  });

  await check("missing paths, refined handles and collection errors preserve failure contracts", () => {
    const map = hsonLiveMap.fromLibraries({ state: { data: { object: { a: 1 }, array: [], scalar: -0 } } }), library = map.data.must("state");
    const missing = library.at(["missing"]);
    assert.equal(missing.snap(), undefined); assert.equal(missing.hson(), undefined); assert.equal(missing.kind(), "missing");
    assert.throws(() => missing.must.snap()); assert.throws(() => missing.must.hson());
    assert.equal(library.at(["scalar"]).kind(), "scalar"); assert.equal(library.at(["scalar"]).asObject(), undefined);
    const empty = library.at(["array"]).asArray()!.array, obj = library.at(["object"]).asObject()!.object;
    assert.equal(empty.length(), 0); assert.ok(empty.isEmpty());
    for (const run of [() => empty.at(0), () => empty.first(), () => empty.last(), () => empty.at(0.5)]) assert.throws(run);
    assert.equal(obj.getKey("absent"), undefined); assert.equal(obj.hasKey("constructor"), false);
    assert.deepEqual(obj.omit(["a"]), {}); assert.deepEqual(obj.pick(["a"]), {a:1});
    assert.deepEqual(obj.entries(), [["a",1]]); assert.deepEqual(obj.values(), [1]);
    const retained = library.at(["object"]).asObject()!;
    library.at(["object"]).replace([]); const revision = map.rev;
    assert.equal(retained.snap(), undefined); assert.equal(retained.hson(), undefined);
    assert.throws(() => retained.object.setKey("a",2), /object/); assert.equal(map.rev, revision);
    assert.equal(library.at(["object", "a"]).snap(), undefined);
  });

  await check("object selection captures its snapshot before caller key-list access", () => {
    const map = hsonLiveMap.fromLibraries({state:{data:{a:{value:1},b:2}}}), library = map.data.must("state");
    const api = library.at([]).asObject()!.object;
    const keys: string[] = [];
    Object.defineProperty(keys,0,{enumerable:true,configurable:true,get:()=>{library.at(["a"]).replace({value:9});return "a";}});
    assert.deepEqual(api.pick(keys),{a:{value:1}});
    assert.deepEqual(library.snap(["a"]),{value:9});
    Object.defineProperty(keys,0,{enumerable:true,configurable:true,get:()=>{library.at(["a"]).replace({value:10});return "b";}});
    assert.deepEqual(api.omit(keys),{a:{value:9}});
  });

  await check("selected Part members and installed interaction descriptors agree after updates", () => {
    const map = hsonLiveMap.fromLibraries({ components: { parts: {
      button: {kind:"document",document:'<button hson:part title="%{title}"/>'},
      unused: {kind:"document",document:'<section hson:part/>'},
    } }, page: {document:'<main <button/>/>'} });
    assert.equal(map.parts.components.button.kind(), "object");
    assert.equal(typeof map.parts.components.button.write({title:"Read"}), "string");
    const owner = internal_livemap_aggregate_authority(map), parts = owner.libraries()[0]!;
    assert.equal(map.parts.components.button.hson(), hson_data_text_from_value(owner.projectedValue(parts, ["button"])!));
    enable_interactions(map);
    const descriptor = {
      id:"read",subject:{library:"page",path:[0,0,0]},
      listener:{event:"click",target:"element",capture:false,once:false,passive:false,missingTarget:"throw",preventDefault:false,stopPropagation:false,stopImmediatePropagation:false},
      kind:"browser",key:"run",args:source,
    } as const;
    add_interaction(map, descriptor);
    const system = owner.systemState(INTERACTION_RESERVED_LIBRARY_KEY); assert.ok(system);
    differential(owner.systemRoot(system), [[], ["descriptors"], ["descriptors", 0, "args"]]);
    assert.ok(ordered_projected_value_equal(project_live_path(owner.systemRoot(system), ["descriptors", 0, "args"])!, value));
    const before = map.capture();
    replace_interaction(map, {...descriptor,args:Hson.data.from("42")});
    assert.notDeepEqual(map.capture(), before);
    assert.equal(snap_live_path(owner.systemRoot(system), ["descriptors", 0, "args"]), "42");
    remove_interaction(map,"read");
    assert.deepEqual(snap_live_path(owner.systemRoot(system), ["descriptors"]), []);
    assert.throws(() => remove_interaction(map,"read"));
  });
}
