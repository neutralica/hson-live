import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { read_livemap_part_internal as readPart, make_livemap_mirror_from_semantic_checkpoint_internal as restore,
  prepare_hosted_livemap_library_add_internal as hostedAdd } from "../../src/api/livemap/livemap.libraries.ts";
import { document_scoped_libraries_semantically_equal as scopedEqual } from "../../src/api/livemap/livemap.document.scoped-portable.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { expand_document_composition, document_composition_options } from "../../src/api/livemap/livemap.document.composition.ts";
import { parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import { STR_TAG } from "../../src/core/constants.ts";
import type { HsonNode } from "../../src/core/types.ts";
import type { CssMap } from "../../src/core/style.types.ts";
import type { LiveMap } from "../../src/types/livemap.types.ts";
import { compile_hson_schema } from "../../src/internal/hson-schema/compiler.ts";
import { evaluate_static_schema_candidate } from "../../src/internal/hson-schema/candidate-evaluation.ts";
import { atomic, doc, part } from "./livemap-document-composition-cases.mts";

const invocation = (items: unknown) => Hson.document`<hson-part lib="parts" at="list" data:items="${Hson.data.from(items)}"/>`;
const fixture = (body: string, items: unknown, css?: CssMap) => hsonLiveMap.fromLibraries({
  parts: { parts: { list: { ...part(body), ...(css === undefined ? {} : { css }) } } }, page: { document: invocation(items) },
});
function leaves(root: HsonNode): unknown[] {
  return root.$_tag === STR_TAG ? root.$_content : root.$_content.flatMap(child => is_Node(child) ? leaves(child) : [child]);
}
const scopes = (map: LiveMap) => {
  const authority = owner(map);
  return authority.documentScopes(authority.libraries()[authority.hostedRegistry().libraries.findIndex(library => library.name === "page")]!)!;
};

export function part_iteration_cases(verify: (name: string, run: () => void) => void): void {
  const check = verify;
  check("object iteration: positional aliases, exact ordered keys and canonical consumption", () => {
    const items = Hson.data`<'10' 10 '2' 2 '' false 'a.b!' null 'a/b' "slash" '__proto__' "own">`;
    for (const [directive, text, expected] of [
      ['per:key:value', '^{key}:^{value}', ['10:10', '2:2', ':false', 'a.b!:null', 'a/b:slash', '__proto__:own']],
      ['per:key', '^{key}', ['10', '2', '', 'a.b!', 'a/b', '__proto__']],
      ['per::value', '^{value}', ['10', '2', 'false', 'null', 'slash', 'own']],
    ] as const) {
      const map = hsonLiveMap.fromLibraries({ parts: { parts: { list: part(`<dl hson:part items:data="%{items}" <div ${directive}="^{items}" "${text}"/>/>`) } },
        page: { document: Hson.document`<hson-part lib="parts" at="list" data:items="${items}"/>` } });
      assert.deepEqual(leaves(doc(map).root()), expected);
      assert.equal(scopes(map).occurrences.length, 7);
      const canonical = Hson.document.fromNode(doc(map).root()), transform = hsonTransform.fromHson(canonical);
      for (const output of [canonical, transform.toJson().serialize(), hsonTransform.fromBinary(transform.toBinary().serialize()).toHson().serialize()]) {
        assert.doesNotMatch(output, /per:|hson:part|items:data/);
      }
    }
    assert.deepEqual(leaves(doc(fixture('<p hson:part items:data="%{items}" <b per:data:doc="^{items}" "^{data}:^{doc.key}:^{doc.value}"/>/>', { only: { key: 'real key', value: 'real value' } })).root()), ['only:real key:real value']);
  });
  check("object iteration: mixed nesting and source-before-shadow preserve outer bindings", () => {
    const body = '<main hson:part items:data="%{items}" <section per:key:items="^{items}" <b for:items:i="^{items}" <em per:key:items="^{items}" "^{key}:^{items}"/> "^{i}"/> "^{key}"/>/>';
    assert.deepEqual(leaves(doc(fixture(body, { first: [{ a: 1, b: 2 }], second: [{ c: 3 }] })).root()), ['a:1', 'b:2', '0', 'first', 'c:3', '0', 'second']);
    const nested = '<main hson:part items:data="%{items}" <section per::items="^{items}" <b per::items="^{items}" "^{items.title}"/>/>/>';
    assert.deepEqual(leaves(doc(fixture(nested, { a: { b: { title: 'nested' } } })).root()), ['nested']);
    assert.deepEqual(leaves(doc(fixture('<main hson:part items:data="%{items}" <b per::v="^{items.group}" "^{v}"/>/>', { group: { first: 'selected' } })).root()), ['selected']);
  });
  check("object iteration: optional presence follows repeated outputs, including present null and empty keys", () => {
    const body = '<main hson:part items:data="%{items}" <section part:optional <i per::value="^{items}" part:optional "^{value.title}"/>/> <aside <b per::value="^{items}" part:optional "^{value.title}"/>/>/>';
    for (const items of [{}, { a: {}, b: {} }]) assert.equal(doc(fixture(body, items)).hson(), '<main\n  <aside/>\n/>');
    assert.deepEqual(leaves(doc(fixture(body, { a: {}, b: { title: null } })).root()), ['null', 'null']);
    const root = '<main hson:part part:optional items:data="%{items}" <b per:key="^{items}" "^{key}"/>/>';
    assert.equal(doc(fixture(root, {})).root().$_content.length, 0);
    assert.deepEqual(leaves(doc(fixture(root, { '': {} })).root()), ['']);
    assert.equal(doc(fixture(root.replace('"^{key}"', '"literal"'), { a: 1 })).root().$_content.length, 0);
    assert.equal(doc(fixture('<ul hson:part items:data="%{items}" <li per::v="^{items}" "^{v}"/>/>', {})).hson(), '<ul/>');
  });
  check("object iteration: malformed declarations and invalid references reject even for empty objects", () => {
    const base = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
    for (const directive of ['per:', 'per::', 'per:key:', 'per:key:value:extra', 'per:key:key', 'per:bad.name', 'per:0key', 'per::bad.name']) {
      atomic(base, () => base.addLibraries({ bad: { parts: { unused: part(`<ul hson:part items:data="%{items}" <li ${directive}="^{items}"/>/>`) } } }), /iterat|alias|per:/i);
    }
    for (const document of ['<ul hson:part per:key="^{items}"/>', '<ul hson:part <li per:a="^{x}" per:b="^{x}"/>/>', '<ul hson:part <li per:a="^{x}" for:b="^{x}"/>/>']) {
      atomic(base, () => base.addLibraries({ bad: { parts: { unused: part(document) } } }), /definition root|one.*iterator/i);
    }
    for (const source of ['%{items}', 'prefix ^{items}', '^{items} suffix', '^{bad!}']) {
      assert.throws(() => fixture(`<ul hson:part items:data="%{items}" <li per:key="${source}"/>/>`, {}), /iteration|local|reference/i);
    }
    for (const child of ['<li per::value="^{items}" "^{key}"/>', '<li per:key="^{items}" "^{value}"/>', '<li per:key="^{items}"/> <b "^{key}"/>', '<li per:key="^{items}" title="^{key.value}"/>']) {
      assert.throws(() => fixture(`<ul hson:part items:data="%{items}" ${child}/>`, {}), /local declaration|representation/);
    }
    for (const child of ['<li per:key="^{items}" "%{required}"/>', '<li per:key="^{items}" <hson-part at="absent"/>/>', '<li per:key="^{items}" onclick="^{key}"/>']) {
      assert.throws(() => fixture(`<ul hson:part items:data="%{items}" ${child}/>`, {}), /Missing Part|is missing|absent|Unknown|event|attribute|handler/);
    }
    assert.throws(() => fixture('<main hson:part items:data="%{items}" content:doc="%{content}" <hson-part per:key="^{items}" ^{content}/>/>', {}), /Structural hson-part/);
  });
  check("object iteration: wrong sources and late invalid values reject before identity allocation", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: { list: part('<ul hson:part items:data="%{items}" <li per::value="^{items}" "^{value.title}"/>/>') } }, page: { document: '<main/>' } });
    let allocations = 0;
    allocator(owner(map).identityEpoch().owner, () => { allocations++; throw new Error('Unexpected allocation'); });
    try {
      for (const items of [[], ['x'], '', 'string', 0, false, null, { a: { title: 'valid' }, b: { title: {} } }, { a: { title: 'valid' }, b: {} }]) {
        atomic(map, () => map.addLibraries({ bad: { document: invocation(items) } }), /object Data|primitive output|Missing Part path/);
      }
      atomic(map, () => map.addLibraries({ bad: { document: '<hson-part lib="parts" at="list"/>' } }), /missing Data input/);
      assert.equal(allocations, 0);
    } finally { allocator(owner(map).identityEpoch().owner, undefined); }
    assert.throws(() => fixture('<ul hson:part items:data="%{items}" <li per::v="^{items.missing}" part:optional "^{v}"/>/>', {}), /Missing Part path/);
    assert.throws(() => fixture('<ul hson:part items:data="%{items}" <li per::v="^{items}" "^{v}"/>/>', { a: { title: 'data' } }), /primitive output/);
  });
  check("object iteration: bounded expansion and canonical admission share array controls", () => {
    const map = fixture('<ul hson:part items:data="%{items}" <li per::value="^{items}" "^{value}"/>/>', {});
    const root = parse_authored_document_library(invocation(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, 'a'])))).root;
    for (const limits of [{ maxNodes: 20 }, { maxCharacters: 100 }, { maxDepth: 2 }]) {
      atomic(map, () => expand_document_composition('shell', () => ({ root }), document_composition_options(limits), (lib, at) => readPart(map, lib, at)), /limit/);
    }
    atomic(map, () => map.addLibraries({ bad: { document: '<ul <li per:key="^{items}"/>/>' } }), /iteration|governed/);
    atomic(map, () => map.addLibraries({ bad: { document: hsonTransform.fromHson('<p per:key="^{items}"/>').toNode() } }), /construction|composition|governed/);
  });
  check("object iteration: repeated landmarks, real value properties and exact CSS restrictions", () => {
    const body = '<main hson:part @:root items:data="%{items}" <section per:key:value="^{items}" @:row <b @:label "^{key}:^{value.title}"/>/> <footer @:tail/>/>';
    const map = fixture(body, { a: { title: 'A' }, b: { title: 'B' } }, { '& b': { color: 'red' } });
    const state = scopes(map), rows = state.occurrences.filter(scope => scope.bindings.some(binding => binding.name === 'row'));
    assert.equal(rows.length, 2); assert.notEqual(rows[0]!.rootQuid, rows[1]!.rootQuid);
    assert.notEqual(rows[0]!.bindings.find(binding => binding.name === 'label')!.quid, rows[1]!.bindings.find(binding => binding.name === 'label')!.quid);
    assert.ok(state.occurrences[0]!.bindings.some(binding => binding.name === 'tail'));
    assert.match(doc(map).css.snapshot(), /color:red/);
    for (const items of [{}, { a: { title: 'A' } }, { a: { title: 'A' }, b: { title: 'B' } }]) {
      assert.throws(() => fixture(body, items, { '& [hson\\:quad="row"]': { color: 'red' } }), /Enclosing exact-QUAD CSS/);
    }
  });
  check("object connector iteration: key selection and scalar keys with repeated selected Parts", () => {
    const definitions = {
      list: part('<main hson:part items:data="%{items}" <hson-part per:name:block="^{items}" @:row at="leaf" name="^{name}" data:block="^{block}"/>/>'),
      leaf: { ...part('<p hson:part @:root block:data="%{block}" "%{name}:^{block.key}:^{block.value}"/>'), css: { color: 'red' } },
    };
    const map = hsonLiveMap.fromLibraries({ parts: { parts: definitions }, page: { document: invocation({ 'a/b': { key: 'k1', value: 'v1' }, '': { key: 'k2', value: 'v2' } }) } });
    assert.deepEqual(leaves(doc(map).root()), ['a/b:k1:v1', ':k2:v2']);
    assert.equal(scopes(map).occurrences.length, 3);
    assert.equal(new Set(scopes(map).occurrences.map(scope => scope.rootQuid)).size, 3);
    assert.equal((doc(map).css.snapshot().match(/@scope/g) ?? []).length, 2);
    const byKey = hsonLiveMap.fromLibraries({ parts: { parts: {
      list: part('<main hson:part items:data="%{items}" <hson-part per:name="^{items}" at="^{name}"/>/>'),
      first: part('<b hson:part "one"/>'), second: part('<i hson:part "two"/>'),
    } }, page: { document: invocation({ second: null, first: [] }) } });
    assert.deepEqual(leaves(doc(byKey).root()), ['two', 'one']);
  });
  check("object iteration: ordinary repeated bodies compose nested Parts and Document placeholders", () => {
    const content = Hson.document`<b @:label "document"/>`;
    const map = hsonLiveMap.fromLibraries({ parts: { parts: {
      list: part('<main hson:part items:data="%{items}" content:doc="%{content}" <section per:key:value="^{items}" @:row <hson-part ^{content}/> <hson-part at="leaf" name="^{key}" data:value="^{value}" part:optional/>/>/>'),
      leaf: part('<i hson:part value:data="%{value}" <em per::ignored="^{value}"/> "%{name}"/>'),
    } }, page: { document: Hson.document`<hson-part lib="parts" at="list" data:items="${Hson.data.from({ first: {}, second: {} })}" doc:content="${content}"/>` } });
    assert.deepEqual(leaves(doc(map).root()), ['document', 'first', 'document', 'second']);
    const state = scopes(map);
    assert.equal(state.occurrences.filter(scope => scope.bindings.some(binding => binding.name === 'row')).length, 2);
    const labels = state.occurrences.flatMap(scope => scope.bindings.filter(binding => binding.name === 'label'));
    assert.equal(labels.length, 2); assert.notEqual(labels[0]!.quid, labels[1]!.quid);
    assert.doesNotMatch(doc(map).hson(), /per:|hson-part|part:optional/);
  });
  check("iteration: zero, one, many, scalar attributes and canonical consumption", () => {
    const body = '<ul hson:part items:data="%{items}" <li for:item:i="^{items}" title="^{item}" data-index="^{i}" "^{i}: ^{item}"/>/>';
    for (const items of [[], ["alpha"], ["alpha", "beta"], [null, false, 0]]) {
      const map = fixture(body, items), output = doc(map).root();
      assert.deepEqual(leaves(output), items.map((item, index) => `${index}: ${item}`));
      const text = doc(map).hson();
      assert.doesNotMatch(text, /for:|hson:part|items:data/);
      assert.doesNotMatch(hsonTransform.fromHson(Hson.document.fromNode(output)).toJson().serialize(), /for:/);
      assert.equal(scopes(map).occurrences.length, 1 + items.length);
      if (!items.length) assert.equal(text, '<ul/>');
      else {
        const ul = output.$_content[0]; assert.ok(is_Node(ul));
        const cluster = ul.$_content[0]; assert.ok(is_Node(cluster));
        for (const [index, child] of cluster.$_content.entries()) {
          assert.ok(is_Node(child)); assert.equal(child.$_attrs?.["data-index"], String(index));
          assert.equal(child.$_attrs?.title, String(items[index]));
        }
      }
    }
  });
  check("iteration: nested scopes shadow only after their collection is resolved", () => {
    const body = '<main hson:part items:data="%{items}" <section for:items:i="^{items}" title="^{items.title}" <b for:items:i="^{items.values}" "^{i}:^{items}"/> <em "^{i}:^{items.title}"/>/>/>';
    const map = fixture(body, [{ title: "a", values: ["x", "y"] }, { title: "b", values: [] }]);
    assert.deepEqual(leaves(doc(map).root()), ["0:x", "1:y", "0:a", "1:b"]);
    assert.equal(scopes(map).occurrences.length, 5);
    const indexOnly = fixture('<ul hson:part items:data="%{items}" <li for::i="^{items}" "^{i}"/>/>', ["ignored", {}]);
    assert.deepEqual(leaves(doc(indexOnly).root()), ["0", "1"]);
    const aliases = fixture('<ul hson:part items:data="%{items}" <li for:data:doc="^{items}" "^{doc}:^{data.title}"/>/>', [{ title: "yes" }]);
    assert.deepEqual(leaves(doc(aliases).root()), ["0:yes"]);
    const selector = fixture('<ul hson:part items:data="%{items}" <li for:item="^{items[0].values}" "^{item}"/>/>', [{ values: ["selected"] }]);
    assert.deepEqual(leaves(doc(selector).root()), ["selected"]);
  });
  check("iteration: optional presence follows realized bodies, not control reads", () => {
    const body = '<main hson:part items:data="%{items}" <section part:optional <i for:item="^{items}" part:optional "^{item.title}"/>/> <aside <b for:item="^{items}" part:optional "^{item.title}"/>/>/>';
    for (const items of [[], [{}, {}]]) assert.equal(doc(fixture(body, items)).hson(), '<main\n  <aside/>\n/>');
    assert.deepEqual(leaves(doc(fixture(body, [{}, { title: "present" }])).root()), ["present", "present"]);
    assert.equal(doc(fixture('<main hson:part items:data="%{items}" <section part:optional <i for:item="^{items}" "literal"/>/>/>', [1])).hson(), '<main/>');
    const map = fixture('<main hson:part part:optional items:data="%{items}" <i for:item="^{items}" "^{item}"/>/>', []);
    assert.equal(doc(map).root().$_content.length, 0); assert.equal(scopes(map)?.occurrences.length ?? 0, 0);
  });
  check("iteration: declaration and lexical errors are independent of collection cardinality", () => {
    const base = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
    for (const directive of ['for:', 'for::', 'for:item:', 'for:item:i:extra', 'for:item:item', 'for:bad.name', 'for:0item']) {
      atomic(base, () => base.addLibraries({ bad: { parts: { unused: part(`<ul hson:part items:data="%{items}" <li ${directive}="^{items}"/>/>`) } } }), /iterat|alias|for:/i);
    }
    atomic(base, () => base.addLibraries({ bad: { parts: { unused: part('<ul hson:part for:item="^{items}"/>') } } }), /definition root/);
    atomic(base, () => base.addLibraries({ bad: { parts: { unused: part('<ul hson:part <li for:a="^{x}" for:b="^{x}"/>/>') } } }), /one.*iterator/i);
    for (const source of ['%{items}', 'prefix ^{items}', '^{items} suffix', '^{bad!}']) {
      assert.throws(() => fixture(`<ul hson:part items:data="%{items}" <li for:item="${source}"/>/>`, []), /iteration|local|reference/i);
    }
    for (const child of ['<li for:item="^{items}" "^{unknown}"/>', '<li for:item="^{items}" title="^{i}"/>', '<li for:item="^{items}"/> <b "^{item}"/>']) {
      assert.throws(() => fixture(`<ul hson:part items:data="%{items}" ${child}/>`, []), /Missing Part local declaration/);
    }
    assert.throws(() => fixture('<ul hson:part items:data="%{items}" <li for:item="^{items}" "%{required}"/>/>', []), /missing scalar input/);
    assert.throws(() => fixture('<ul hson:part items:data="%{items}" <li for:item="^{items}" <hson-part at="absent"/>/>/>', []), /absent|Unknown/);
    assert.throws(() => fixture('<ul hson:part items:data="%{items}" <li for:item="^{items}" onclick="^{item}"/>/>', []), /event|attribute|handler/);
  });
  check("iteration: missing, null, non-array and invalid paths reject atomically", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: {
      list: part('<ul hson:part items:data="%{items}" <li for:item="^{items}" "^{item.title}"/>/>'),
    } }, page: { document: '<main/>' } });
    let allocations = 0;
    allocator(owner(map).identityEpoch().owner, () => { allocations++; throw new Error("Unexpected allocation before validation"); });
    try {
      for (const items of [null, "string", 2, {}, [{ title: "first" }, { title: {} }], [{ title: "first" }, {}]]) {
        atomic(map, () => map.addLibraries({ bad: { document: invocation(items) } }), /array Data|primitive output|Missing Part path/);
      }
      atomic(map, () => map.addLibraries({ bad: { document: '<hson-part lib="parts" at="list"/>' } }), /missing Data input/);
      assert.equal(allocations, 0);
    } finally { allocator(owner(map).identityEpoch().owner, undefined); }
    for (const source of ['^{items.missing}', '^{items[0].missing}']) assert.throws(() => fixture(`<main hson:part items:data="%{items}" <b part:optional for:item="${source}" "^{item}"/>/>`, [{}]), /Missing Part path|Invalid Part path/);
  });
  check("iteration: repeated QUADs have independent occurrences and preserve shifted siblings", () => {
    const map = fixture('<ul hson:part @:root items:data="%{items}" <li for:item="^{items}" @:row <b @:label "^{item}"/>/> <footer @:tail/>/>', ["a", "b"]);
    const state = scopes(map); assert.equal(state.occurrences.length, 3);
    const rows = state.occurrences.filter(scope => scope.bindings.some(binding => binding.name === "row"));
    assert.equal(rows.length, 2); assert.notEqual(rows[0]!.rootQuid, rows[1]!.rootQuid);
    assert.notEqual(rows[0]!.bindings.find(binding => binding.name === "label")!.quid, rows[1]!.bindings.find(binding => binding.name === "label")!.quid);
    assert.ok(state.occurrences[0]!.bindings.some(binding => binding.name === "tail"));
    assert.throws(() => fixture('<ul hson:part items:data="%{items}" <li for:item="^{items}" @:row "^{item}"/>/>', [1, 2], { '& [hson\\:quad="row"]': { color: 'red' } }), /Enclosing exact-QUAD CSS/);
    const styled = fixture('<ul hson:part items:data="%{items}" <li for:item="^{items}" "^{item}"/>/>', [1, 2], { '& li': { color: 'red' } });
    assert.match(doc(styled).css.snapshot(), /li/);
  });
  check("iteration: preparation is bounded and residual controls cannot enter canonical Documents", () => {
    const map = fixture('<ul hson:part items:data="%{items}" <li for:item="^{items}" "^{item}"/>/>', []);
    const root = parse_authored_document_library(invocation(Array.from({ length: 1000 }, () => "a"))).root;
    for (const limits of [{ maxNodes: 20 }, { maxCharacters: 100 }, { maxDepth: 2 }]) {
      atomic(map, () => expand_document_composition("shell", () => ({ root }), document_composition_options(limits), (lib, at) => readPart(map, lib, at)), /limit/);
    }
    atomic(map, () => map.addLibraries({ bad: { document: '<ul <li for:item="^{items}"/>/>' } }), /iteration|governed/);
    atomic(map, () => map.addLibraries({ bad: { document: hsonTransform.fromHson('<p for:item="^{items}"/>').toNode() } }), /construction|composition|governed/);
  });

  for (const kind of ['array', 'object'] as const) {
    const check = (name: string, run: () => void) => verify(`${kind} ${name}`, run);
    const invocation = (items: unknown) => Hson.document`<hson-part lib="parts" at="list" data:items="${Hson.data.from(kind === 'object' && Array.isArray(items) ? Object.fromEntries(items.map((value, index) => [`entry/${index}`, value])) : items)}"/>`;
    const column = {
      list: { ...part(`<section hson:part @:root items:data="%{items}" <hson-part ${kind === 'array' ? 'for:block:i' : 'per:i:block'}="^{items}" @:row lib="parts" at="^{block.kind}" data:block="^{block}"/>/>`), css: { '& .content': { fontWeight: 'bold' } } },
      heading: { ...part('<h1 hson:part @:root block:data="%{block}" class="content" "^{block.text}"/>'), css: { color: 'blue' } },
      text: { ...part('<p hson:part @:root block:data="%{block}" class="content" "^{block.text}"/>'), css: { color: 'red' } },
    };
    const blocks = [{ kind: 'heading', text: 'Title' }, { kind: 'text', text: 'Paragraph' }];
    const columnMap = () => hsonLiveMap.fromLibraries({ page: { document: invocation(blocks) }, parts: { parts: column } });
    const element = (source: string): HsonNode => {
      const value = hsonTransform.fromHson(source).toNode().$_content[0];
      assert.ok(is_Node(value)); return value;
    };
    for (const batch of [false, true]) check(`iteration: public ${batch ? 'batch' : 'direct'} writes preserve scopes, checkpoints and CSS lifetimes`, () => {
      const map = hsonLiveMap.fromLibraries({ parts: { parts: column }, page: { document: '<main <i/>/>' } });
      const page = doc(map), target = { kind: 'path' as const, path: path([0, 0]) };
      const insert = (items: unknown) => {
        const content = element(invocation(items));
        return batch ? map.batch(writer => writer.doc.must('page').content.insert(target, 1, content))
          : page.document.content.insert(target, 1, content);
      };
      assert.equal(scopes(map), undefined);
      insert(blocks);
      const initial = scopes(map);
      assert.equal(initial.occurrences.length, 3);
      const rows = initial.occurrences.filter(scope => scope.bindings.some(binding => binding.name === 'row'));
      assert.equal(rows.length, 2); assert.notEqual(rows[0]!.rootQuid, rows[1]!.rootQuid);
      for (const row of rows) {
        assert.equal(row.parent, initial.occurrences[0]!.lifetime);
        assert.equal(row.bindings.find(binding => binding.name === 'row')!.quid, row.rootQuid);
        assert.equal(row.bindings.find(binding => binding.name === 'root')!.quid, row.rootQuid);
      }
      const checkpoint = owner(map).captureSemanticCheckpoint(), resumed = restore(checkpoint);
      const left = checkpoint.libraries.find(library => library.name === 'page')!, right = owner(resumed).captureSemanticCheckpoint().libraries.find(library => library.name === 'page')!;
      assert.ok(left.scopes && right.scopes && left.css && right.css);
      assert.ok(scopedEqual({ root: left.root, scopes: left.scopes, css: left.css }, { root: right.root, scopes: right.scopes, css: right.css }));
      atomic(map, () => insert([blocks[0], { kind: 'absent', text: 'late' }]));
      atomic(map, () => map.batch(writer => {
        writer.doc.must('page').content.insert(target, 1, element(invocation(blocks)));
        writer.doc.must('page').content.insert(target, 2, element(invocation([{ kind: 'absent' }])));
      }));
      const children = { kind: 'path' as const, path: path([0, 0, 1, 0]) };
      page.document.content.move(children, 0, 1);
      assert.deepEqual(leaves(page.root()), ['Paragraph', 'Title']);
      assert.equal(scopes(map).occurrences[1]!.lifetime, rows[0]!.lifetime);
      page.document.content.remove(children, 1);
      assert.equal(scopes(map).occurrences.length, 2);
      assert.doesNotMatch(page.css.snapshot(), /color:blue/); assert.match(page.css.snapshot(), /color:red/);
      const replacement = element(invocation(blocks.slice(0, 1)));
      if (batch) map.batch(writer => writer.doc.must('page').content.replace(target, 1, replacement));
      else page.document.content.replace(target, 1, replacement);
      assert.equal(scopes(map).occurrences.length, 2);
      assert.ok(scopes(map).occurrences.every(scope => !initial.occurrences.some(previous => previous.lifetime === scope.lifetime)));
      assert.match(page.css.snapshot(), /color:blue/); assert.doesNotMatch(page.css.snapshot(), /color:red/);
      page.document.attrs.set({ kind: 'path', path: [0] }, 'title', 'edited');
      page.document.content.remove(target, 1);
      assert.equal(scopes(map).occurrences.length, 0); assert.equal(page.css.snapshot(), '');
      assert.ok(owner(map).captureSemanticCheckpoint().libraries.find(library => library.name === 'page')!.scopes);
      assert.match(page.hson(), /title="edited"/);
    });
    check('iteration: public writes retain nested ordinary iteration namespaces and leave flat writes flat', () => {
      const map = hsonLiveMap.fromLibraries({ parts: { parts: {
        list: part(`<main hson:part items:data="%{items}" <section ${kind === 'array' ? 'for:item' : 'per::item'}="^{items}" @:row <b for:item="^{item}" @:label "^{item}"/>/>/>`),
      } }, page: { document: '<aside <i/>/>' } });
      const page = doc(map), target = { kind: 'path' as const, path: path([0, 0]) };
      page.document.content.insert(target, 1, element('<em/>'));
      page.document.content.replace(target, 1, element('<strong/>'));
      page.document.content.remove(target, 1);
      assert.equal(scopes(map), undefined); assert.doesNotThrow(() => map.capture());
      page.document.content.insert(target, 1, element(invocation([['a', 'b'], ['c']])));
      const state = scopes(map);
      assert.equal(state.occurrences.length, 6);
      const rows = state.occurrences.filter(scope => scope.bindings.some(binding => binding.name === 'row'));
      const labels = state.occurrences.filter(scope => scope.bindings.some(binding => binding.name === 'label'));
      assert.equal(rows.length, 2); assert.equal(labels.length, 3);
      assert.equal(new Set(labels.map(scope => scope.rootQuid)).size, 3);
      assert.ok(labels.every(scope => rows.some(row => row.lifetime === scope.parent)));
      assert.deepEqual(leaves(page.root()), ['a', 'b', 'c']);
      assert.doesNotThrow(() => owner(map).captureSemanticCheckpoint());
    });
    check('iteration: public preparation discards identities after allocator or final Schema rejection', () => {
      const map = hsonLiveMap.fromLibraries({ parts: { parts: column }, page: { document: '<main <i/>/>' } });
      const authority = owner(map), target = { kind: 'path' as const, path: path([0, 0]) };
      let allocations = 0;
      allocator(authority.identityEpoch().owner, () => {
        if (++allocations === 3) throw new Error('public late allocator failure');
        return `e${allocations.toString(36).padStart(8, '0')}`;
      });
      try {
        atomic(map, () => doc(map).document.content.insert(target, 1, element(invocation(blocks))), /public late allocator failure/);
        assert.equal(allocations, 3);
      } finally { allocator(authority.identityEpoch().owner, undefined); }
      const schema = Hson.schema`<type "document" defs <Item <tag "i" content "empty">> tag "main" content <repeat <ref "Item"> count 1>>`;
      const constrained = hsonLiveMap.fromLibraries({ parts: { parts: column }, page: { document: '<main <i/>/>', schema } });
      atomic(constrained, () => doc(constrained).document.content.insert(target, 1, element(invocation(blocks))));
      assert.equal(scopes(constrained), undefined);
    });
    check("connector iteration: heterogeneous Column, one occurrence per selection, local QUADs and CSS retirement", () => {
      for (const items of [[], blocks.slice(0, 1)]) {
        const map = hsonLiveMap.fromLibraries({ parts: { parts: column }, page: { document: invocation(items) } });
        assert.equal(scopes(map).occurrences.length, items.length + 1);
        assert.deepEqual(leaves(doc(map).root()), items.map(item => item.text));
      }
      const map = columnMap(), before = scopes(map), p = doc(map);
      assert.equal(p.hson(), '<section\n  <h1 class="content" "Title"/>\n  <p class="content" "Paragraph"/>\n/>');
      assert.equal(before.occurrences.length, 3);
      const rows = before.occurrences.filter(occurrence => occurrence.bindings.some(binding => binding.name === 'row'));
      assert.equal(rows.length, 2);
      for (const row of rows) {
        assert.equal(row.bindings.find(binding => binding.name === 'root')!.quid, row.rootQuid);
        assert.equal(row.bindings.find(binding => binding.name === 'row')!.quid, row.rootQuid);
      }
      const initialCss = p.css.snapshot(); assert.match(initialCss, /color:blue/); assert.match(initialCss, /color:red/); assert.match(initialCss, /font-weight:bold/);
      assert.equal((initialCss.match(/@scope/g) ?? []).length, 3);
      const authority = owner(map), manager = {}, library = authority.libraries()[0]!;
      authority.claimManagement(manager);
      try {
        const transition = authority.prepareManaged(manager, [{ kind: 'graph', target: authority.target(library, [0, 0]),
          operation: { domain: 'graph', op: 'remove-content', target: { kind: 'path', path: path([0, 0]) }, index: 0 } }], true);
        assert.deepEqual(scopes(map), before, 'preparation cannot publish scopes or CSS');
        authority.accept(transition);
      } finally { authority.releaseManagement(manager); }
      assert.deepEqual(leaves(p.root()), ['Paragraph']);
      assert.doesNotMatch(p.css.snapshot(), /color:blue/); assert.match(p.css.snapshot(), /color:red/); assert.match(p.css.snapshot(), /font-weight:bold/);
      const after = scopes(map); assert.equal(after.occurrences.length, 2);
      assert.equal(after.occurrences[1]!.rootQuid, rows[1]!.rootQuid);
      assert.equal(after.occurrences[1]!.lifetime, rows[1]!.lifetime);
    });
    check("connector iteration: root aliases unify on the selected root and reject descendant collisions", () => {
      const definitions = { ...column, heading: { ...column.heading, document: column.heading.document.replace('@:root', '@:row') } };
      const map = hsonLiveMap.fromLibraries({ parts: { parts: definitions }, page: { document: invocation(blocks) } });
      assert.equal(scopes(map).occurrences[1]!.bindings.filter(binding => binding.name === 'row').length, 1);
      map.parts.parts.heading.replace({ ...column.heading, document: '<h1 hson:part block:data="%{block}" <b @:row "^{block.text}"/>/>' });
      atomic(map, () => map.addLibraries({ bad: { document: invocation(blocks) } }), /Conflicting structural root QUAD alias/);
      const optional = { ...column, heading: { ...column.heading, document: '<h1 hson:part part:optional block:data="%{block}" "^{block.missing}"/>' } };
      const omitted = hsonLiveMap.fromLibraries({ parts: { parts: optional }, page: { document: invocation(blocks) } });
      assert.equal(scopes(omitted).occurrences.length, 2); assert.deepEqual(leaves(doc(omitted).root()), ['Paragraph']);
    });
    check("connector iteration: late invalid selections, arguments, output Schema and allocator failures are atomic", () => {
      const map = columnMap(), aggregate = owner(map);
      let allocated = 0;
      allocator(aggregate.identityEpoch().owner, () => { allocated++; return `c${allocated.toString(36).padStart(8, '0')}`; });
      try {
        for (const late of [{ kind: 'absent', text: 'bad' }, { kind: 'text', text: {} }, { kind: 42, text: 'bad' }, { kind: 'a/b', text: 'bad' }]) {
          atomic(map, () => map.addLibraries({ bad: { document: invocation([blocks[0], late]) } }));
        }
        map.parts.parts.heading.replace({ ...column.heading, document: '<h1 hson:part "%{different}"/>' });
        atomic(map, () => map.addLibraries({ bad: { document: invocation([blocks[1], blocks[0]]) } }), /received unexpected|receiving interface/);
        map.parts.parts.heading.replace(column.heading);
        const schema = Hson.schema`<type "document" tag "aside" content "empty">`;
        atomic(map, () => map.addLibraries({ bad: { document: invocation(blocks), schema } }));
        assert.equal(allocated, 0, 'all semantic validation precedes QUID issuance');
      } finally { allocator(aggregate.identityEpoch().owner, undefined); }
      allocated = 0;
      allocator(aggregate.identityEpoch().owner, () => { if (++allocated === 3) throw new Error('late issuer failure'); return `d${allocated.toString(36).padStart(8, '0')}`; });
      try { atomic(map, () => map.addLibraries({ bad: { document: invocation(blocks) } }), /late issuer failure/); assert.equal(allocated, 3); }
      finally { allocator(aggregate.identityEpoch().owner, undefined); }
    });
    check("connector iteration: public write, same-batch hosted admission and portable scoped restoration", () => {
      const map = columnMap(), checkpoint = owner(map).captureSemanticCheckpoint(), resumed = restore(checkpoint);
      const left = checkpoint.libraries.find(library => library.name === 'page')!, right = owner(resumed).captureSemanticCheckpoint().libraries.find(library => library.name === 'page')!;
      assert.ok(left.scopes && right.scopes && left.css && right.css);
      assert.ok(scopedEqual({ root: left.root, scopes: left.scopes, css: left.css }, { root: right.root, scopes: right.scopes, css: right.css }));
      assert.doesNotMatch(JSON.stringify(left), /for:|per:|hson-part|#\{/);
      assert.notEqual(scopes(map).occurrences[1]!.rootQuid, scopes(resumed).occurrences[1]!.rootQuid);
      const connector = map.parts.parts.list.write({ items: Hson.data.from(kind === 'array' ? blocks : Object.fromEntries(blocks.map((value, index) => [`entry/${index}`, value]))) });
      assert.equal(connector, invocation(blocks));
      const hosted = hsonLiveMap.fromLibraries({}), authority = owner(hosted), manager = {};
      authority.claimManagement(manager);
      try {
        const before = authority.captureSemanticCheckpoint();
        const prepared = hostedAdd(hosted, manager, { page: { document: connector }, parts: { parts: column } });
        assert.deepEqual(authority.captureSemanticCheckpoint(), before);
        authority.accept(prepared.transition, 'isolate', prepared.afterInstall);
        assert.deepEqual(leaves(doc(hosted).root()), ['Title', 'Paragraph']);
        assert.equal(scopes(hosted).occurrences.length, 3);
        atomic(hosted, () => hostedAdd(hosted, manager, { bad: { document: invocation([blocks[0], { kind: 'absent' }]) } }));
      } finally { authority.releaseManagement(manager); }
    });
    check("iteration: static Schema evaluation runs the shared composer", () => {
      const collection = new Map([['parts', { list: part(`<ul hson:part items:data="%{items}" <li ${kind === 'array' ? 'for:item' : 'per::item'}="^{items}"/>/>`) }]]);
      const schema = compile_hson_schema('<type "document" defs <Item <tag "li" content "empty">> tag "ul" content <repeat <ref "Item"> count 2>>');
      assert.ok(schema.ok);
      assert.equal(evaluate_static_schema_candidate(schema.value, { family: 'document', source: invocation(['a', 'b']) }, collection).kind, 'valid');
      assert.equal(evaluate_static_schema_candidate(schema.value, { family: 'document', source: invocation(['a']) }, collection).kind, 'invalid');
      assert.equal(evaluate_static_schema_candidate(schema.value, { family: 'document', source: invocation([]) }, collection).kind, 'invalid');
    });
  }
}
