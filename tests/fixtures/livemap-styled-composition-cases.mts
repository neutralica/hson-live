import assert from "node:assert/strict";
import { hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { compose_livemap_document_internal as compose, make_livemap_from_authored_libraries_internal as authored,
  read_livemap_part_internal as read, prepare_hosted_livemap_library_add_internal as hostedAdd } from "../../src/api/livemap/livemap.libraries.ts";
import { part_collection_definition_internal as collection } from "../../src/api/livemap/livemap.parts.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { lookup_document_quad_internal as lookup } from "../../src/api/livemap/livemap.document.quad.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { document_css_subject_identities } from "../../src/internal/css/css-identity-translation.ts";
import { encode_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { encode_ssr_bootstrap, decode_ssr_bootstrap } from "../../src/api/ssr/index.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { mint_hson_node_quid } from "../../src/core/hson-node-quid.ts";
import { make_portable_aggregate_commit, type HostedAggregateCommit } from "../../src/api/livemap/livemap.hosted.ts";
import { durable_aggregate_commit } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import type { HsonNode } from "../../src/core/types.ts";
import type { LiveMap, LiveMapCommit } from "../../src/types/livemap.types.ts";

const part = (document: string, css: string) => ({ kind: "document", document, css });
const local = (name: string) => `[hson\\:quad="${name}"]`;
const runtime = (quid: string) => `[hson\\:quid="${quid}"]`;
const target = (coordinate: readonly number[]) => ({ kind: "path" as const, path: path(coordinate) });
function page(map: LiveMap) {
  const selected = map.lib("page"); if (selected.mode !== "document") throw Error("document"); return selected;
}
function identity(map: LiveMap) {
  const aggregate = owner(map), index = aggregate.hostedRegistry().libraries.findIndex(entry => entry.name === "page");
  return aggregate.libraries()[index]!;
}
function coordinate(root: HsonNode, id: string): readonly number[] {
  const visit = (node: HsonNode, segments: readonly number[]): readonly number[] | undefined => {
    if (node.$_attrs?.id === id) return segments;
    for (let i = 0; i < node.$_content.length; i++) {
      const child = node.$_content[i]; if (!is_Node(child)) continue;
      const found = visit(child, [...segments, i]); if (found) return found;
    }
  };
  const result = visit(root, []); if (!result) throw Error(`Missing ${id}`); return result;
}
function quid(map: LiveMap, id: string) {
  const result = owner(map).documentOverlay(identity(map)).quidAtPath(path(coordinate(page(map).root(), id)));
  assert.ok(result, `issued ${id}`); assert.ok(owner(map).identityEpoch().issued().has(result)); return result;
}
const css = `${local("root")}{border:3px solid rgb(1,2,3);--tone:rgb(10,20,30)}
${local("root")} > ${local("label")}:is(span):not(.off), ${local("label")}:where(.label){color:var(--tone)}
@layer base{} @layer base{@media screen{@supports (display:grid){@scope (${local("root")}) {${local("label")}{padding-left:7px}}}}}
::part(hson\\:quid){background:blue}.hson\\:quad{background:red}
[data-note="hson:quad"]{font-weight:700}`;
export function styled_fixture(count = 3) {
  const connectors = Array.from({ length: count }, (_, i) => `<hson-template ${i < 2 ? `@:slot${i}` : ""} lib="parts" at="button" id="instance${i}"/>`).join(" ");
  return authored({ layout: { document: `<html <head/> <body <main ${connectors}/> <aside id="unrelated" <span class="label" "Unrelated"/>/>/>/>` },
    parts: collection({ button: part('<section @:root id="original" <span @:label class="label" "Label"/> <i @:unused/>/>', css),
      unvisited: part('<i/>', '@property --ignored{syntax:"*";inherits:false}@keyframes ignored{from{opacity:0}}') }) });
}
function atomic(map: LiveMap, run: () => unknown, reason?: RegExp) {
  const before = map.capture(), aggregate = owner(map), ledger = aggregate.identityEpoch().issued();
  let events = 0, positions = 0;
  const off = map.commits.observe(() => events++), stop = aggregate.observeAuthorityPosition(() => positions++);
  try { if (reason) assert.throws(run, reason); else assert.throws(run); } finally { off(); stop(); }
  assert.deepEqual(map.capture(), before); assert.equal(aggregate.identityEpoch().issued(), ledger);
  assert.equal(events, 0); assert.equal(positions, 0); assert.throws(() => map.lib("bad"));
}

export function styled_composition_cases(check: (name: string, run: () => void) => void) {
  check("public q edits styled shell and promoted subjects without importing Part-local landmarks", () => {
    const map = styled_fixture(), result = compose(map, "layout", "page", {
      configuration: { at: { slot0: { at: { label: { as: "caption" } } } } },
    });
    assert.equal("q" in map.lib("parts"), false);
    assert.equal(result.q("root"), undefined); assert.equal(result.q("label"), undefined); assert.equal(result.q("unused"), undefined);
    const shell = result.q("slot0")!, caption = result.q("caption")!;
    assert.equal(shell.attrs.get("id"), "instance0"); assert.equal(caption.at([0]).snap(), "Label");
    const beforeCss = result.css.snapshot(), ledger = owner(map).identityEpoch().issued();
    shell.attrs.set("title", "shell"); caption.at([0]).replace("Changed"); caption.attrs.set("title", "caption");
    assert.equal(result.at(shell.path()).asElement()!.attrs.get("title"), "shell");
    assert.equal(caption.at([0]).snap(), "Changed"); assert.equal(result.css.snapshot(), beforeCss);
    const oldPath = shell.path();
    result.at(oldPath.slice(0, -1)).asElement()!.move(0, 1);
    assert.notDeepEqual(shell.path(), oldPath); shell.attrs.set("title", "moved shell");
    assert.equal(shell.attrs.get("title"), "moved shell"); assert.equal(caption.at([0]).snap(), "Changed");
    assert.equal(result.css.snapshot(), beforeCss);
    assert.equal(owner(map).identityEpoch().issued().size, ledger.size);
    const afterLedger = owner(map).identityEpoch().issued();
    const before = map.capture(); let published = 0; const off = map.commits.observe(() => published++);
    try { assert.throws(() => shell.delete()); } finally { off(); }
    assert.deepEqual(map.capture(), before); assert.equal(owner(map).identityEpoch().issued(), afterLedger); assert.equal(published, 0);
    const restored = install_libraries_snapshot(map.cut({ documents: ["page"], data: [] }).libs).map;
    assert.equal(page(restored).q("caption")!.at([0]).snap(), "Changed");
    assert.notEqual(lookup(page(restored), "caption")!.quid, lookup(result, "caption")!.quid);
    page(restored).q("caption")!.attrs.set("title", "restored"); assert.equal(caption.attrs.get("title"), "caption");
  });
  check("styled one/repeated occurrences publish one complete ordinary Library with sparse destination subjects", () => {
    for (const count of [1, 2, 3]) {
      const map = styled_fixture(count), before = map.capture(), oldSize = owner(map).identityEpoch().issued().size;
      const commits: LiveMapCommit[] = [];
      const stop = map.commits.observe(commit => {
        commits.push(commit); assert.match(page(map).css.snapshot(), /padding-left:7px/);
        assert.equal(owner(map).documentOverlay(identity(map)).size, count * 2);
      });
      try { compose(map, "layout", "page", { configuration: { at: { slot0: { at: { label: { as: "caption" } } } } } }); }
      finally { stop(); }
      assert.equal(commits.length, 1); assert.equal(commits[0]!.operations.length, 1);
      assert.equal(map.rev, before.revision + 1); assert.equal(owner(map).identityEpoch().issued().size, oldSize + count * 2);
      assert.deepEqual(map.capture().libraries.slice(0, before.libraries.length), before.libraries);
      const record = encode_portable_document_stylesheet(owner(map).stylesheet(identity(map)));
      const demanded = document_css_subject_identities(record, "outbound");
      assert.equal(demanded.length, count * 2); assert.equal(new Set(demanded).size, count * 2);
      for (let i = 0; i < count; i++) {
        const rootPath = coordinate(page(map).root(), `instance${i}`), rootId = quid(map, `instance${i}`);
        const labelId = owner(map).documentOverlay(identity(map)).quidAtPath(path([...rootPath, 0, 0]));
        assert.ok(labelId); assert.ok(demanded.includes(rootId)); assert.ok(demanded.includes(labelId));
        assert.ok(record.rules.some(rule => rule.selector.includes(rootId) && rule.selector.includes(labelId)));
        assert.ok(record.rules.some(rule => rule.scopes.some(scope => scope.includes(rootId)) && rule.selector.includes(labelId)));
        assert.equal(owner(map).documentOverlay(identity(map)).quidAtPath(path([...rootPath, 0, 1])), undefined);
        if (i < 2) assert.equal(lookup(page(map), `slot${i}`)?.quid, rootId);
      }
      assert.equal(lookup(page(map), "caption")?.quid, owner(map).documentOverlay(identity(map)).quidAtPath(path([...coordinate(page(map).root(), "instance0"), 0, 0])));
      for (const name of ["root", "label", "unused"]) assert.equal(lookup(page(map), name), undefined);
      assert.doesNotMatch(page(map).css.snapshot(), /ignored/);
      assert.match(page(map).css.snapshot(), /::part\(hson\\:quid\)/);
      const ledger = owner(map).identityEpoch().issued();
      allocator(owner(map).identityEpoch().owner, () => { throw Error("Observational reads must not allocate"); });
      try { for (let i = 0; i < 3; i++) { read(map, "parts", "button"); map.capture(); page(map).render(); } }
      finally { allocator(owner(map).identityEpoch().owner, undefined); }
      assert.equal(owner(map).identityEpoch().issued(), ledger);
      assert.equal(owner(map).projectedOverlay(owner(map).libraries()[1]!).size, 0);
    }
  });
  check("styled nested same/cross collection configured use selects whole stylesheets in preorder", () => {
    const map = authored({ layout: { document: '<main <hson-template @:slot lib="parts" at="outer"/>/>' },
      parts: collection({ outer: part('<section @:root <hson-template @:child at="inner"/> <hson-template at="inner"/>/>', `${local("child")}{color:red}@layer outer{.ordinary{--order:outer}}`),
        inner: part('<b @:root/>', `${local("root")}{color:blue}@layer inner{.ordinary{--order:inner}}`),
        unused: part('<b/>', '.ordinary{--order:unvisited}') }),
      other: collection({ cross: part('<i @:root/>', `${local("root")}{color:green}@layer cross{.ordinary{--order:cross}}`) }) });
    compose(map, "layout", "page", { configuration: { at: { slot: { at: { child: { use: { lib: "other", at: "cross" } } } } } } });
    const snapshot = page(map).css.snapshot();
    assert.ok(snapshot.indexOf("--order:outer") < snapshot.indexOf("--order:cross"));
    assert.ok(snapshot.indexOf("--order:cross") < snapshot.indexOf("--order:inner"));
    assert.doesNotMatch(snapshot, /unvisited/); assert.equal(lookup(page(map), "child"), undefined);
    const record = encode_portable_document_stylesheet(owner(map).stylesheet(identity(map)));
    assert.equal(record.rules[0]!.selector, record.rules[2]!.selector, "parent connector CSS and selected child root share the same subject");
    assert.notEqual(record.rules[2]!.selector, record.rules[4]!.selector);
    assert.equal(owner(map).documentOverlay(identity(map)).size, 3);
  });
  check("styled identity syntax and unresolved/anonymous claims reject without destination publication", () => {
    for (const invalid of [local("absent"), '[hson\\:quid="123456789"]', '[hson\\:quad]', '[hson\\:quad^="label"]',
      '[hson\\:quad="label" i]', '[x|hson\\:quad="label"]', ':future([hson\\:quad="label"])']) {
      const map = hsonLiveMap.fromLibraries({ layout: { document: '<hson-template lib="parts" at="styled"/>' },
        parts: collection({ styled: part('<p @:label/>', invalid + '{color:red}') }) });
      atomic(map, () => compose(map, "layout", "bad")); assert.equal(owner(map).identityEpoch().issued().size, 0);
    }
  });
  check("styled escaped identities and supports syntax tests retain exact selector meaning", () => {
    const map = hsonLiveMap.fromLibraries({ layout: { document: '<main <hson-template lib="parts" at="styled"/> <hson-template lib="parts" at="styled"/>/>' },
      parts: collection({ styled: part('<section @:root <span @:label/>/>', String.raw`
        [hson\3a quad="root"]:has(>${local("label")}),${local("label")}:not([data-look="hson:quid"]){--literal:"hson:quad"}
        @supports selector([hson\:quad="syntaxOnly"]) {${local("root")}{display:block}}
        @media screen{@scope (${local("root")}) to (.stop){${local("label")}{color:red}}}`) }) });
    compose(map, "layout", "page");
    const record = encode_portable_document_stylesheet(owner(map).stylesheet(identity(map)));
    assert.equal(document_css_subject_identities(record, "outbound").length, 4);
    assert.notEqual(record.rules[0]!.selector, record.rules[3]!.selector);
    assert.equal(record.rules[1]!.scopes[0], '@supports selector([hson\\:quad="syntaxOnly"])');
    assert.deepEqual(record.rules[0]!.declarations, [["--literal", '"hson:quad"']]);
    const next = install_libraries_snapshot(map.cut({ data: [], documents: ["page"] }).libs).map;
    const restored = encode_portable_document_stylesheet(owner(next).stylesheet(identity(next)));
    assert.equal(document_css_subject_identities(restored, "outbound").length, 4);
    assert.equal(restored.rules[1]!.scopes[0], record.rules[1]!.scopes[0]);
  });
  check("duplicate global definitions reject late and retain no issued candidate identities", () => {
    for (const globals of ['@keyframes repeated{from{opacity:0}to{opacity:1}}', '@property --repeated{syntax:"*";inherits:false}']) {
      const map = hsonLiveMap.fromLibraries({ layout: { document: '<main <hson-template lib="parts" at="styled"/> <hson-template lib="parts" at="styled"/>/>' },
        parts: collection({ styled: part('<p @:root/>', `${local("root")}{color:red}${globals}`) }) });
      let calls = 0;
      allocator(owner(map).identityEpoch().owner, () => { calls++; return mint_hson_node_quid(); });
      try { atomic(map, () => compose(map, "layout", "bad"), /Duplicate @/); }
      finally { allocator(owner(map).identityEpoch().owner, undefined); }
      assert.equal(calls, 0); assert.equal(owner(map).identityEpoch().issued().size, 0);
    }
    const map = styled_fixture();
    atomic(map, () => compose(map, "layout", "bad", { configuration: { at: { slot1: { use: { at: "missing" } } } } }));
    allocator(owner(map).identityEpoch().owner, () => "000000000");
    try { atomic(map, () => compose(map, "layout", "bad"), /No available/); }
    finally { allocator(owner(map).identityEpoch().owner, undefined); }
  });
  check("source-free styled A to B to C restoration preserves correspondence with fresh sparse QUIDs", () => {
    let map: LiveMap = styled_fixture(); compose(map, "layout", "page");
    const prior = new Set<string>();
    for (let cycle = 0; cycle < 3; cycle++) {
      const aggregate = owner(map), demanded = document_css_subject_identities(encode_portable_document_stylesheet(aggregate.stylesheet(identity(map))), "outbound");
      assert.equal(demanded.length, 6); for (const id of demanded) { assert.ok(!prior.has(id)); prior.add(id); }
      const cut = map.cut({ data: [], documents: ["page"], html: "page" });
      assert.deepEqual(cut.libs.registry.libraries.map(entry => entry.name), ["page"]);
      assert.doesNotMatch(cut.html, /<[^>]*hson:quid=/);
      assert.equal(document_css_subject_identities(cut.libs.libraries[0]!.css!, "inbound").length, 6);
      assert.equal(cut.libs.libraries[0]!.quads?.length, 6);
      assert.equal(cut.libs.libraries[0]!.quads?.filter(entry => entry.disposition === "disposable").length, 4);
      const decoded = decode_ssr_bootstrap(encode_ssr_bootstrap(cut.libs)); assert.equal(decoded.kind, "libraries");
      if (decoded.kind !== "libraries") throw Error("libraries");
      const next = install_libraries_snapshot(decoded.bootstrap).map;
      assert.deepEqual(page(next).root(), page(map).root()); assert.equal(lookup(page(next), "label"), undefined);
      assert.throws(() => next.lib("parts")); assert.throws(() => next.lib("layout"));
      const rootId = quid(next, "instance2"); assert.match(page(next).css.snapshot(), new RegExp(rootId));
      map = next;
    }
  });
  check("composed CSS respects moves legitimate lineage strict retirement and atomic graph/CSS editing", () => {
    const map = styled_fixture(1); compose(map, "layout", "page");
    const document = page(map), root = coordinate(document.root(), "instance0"), parent = root.slice(0, -1), rootId = quid(map, "instance0");
    document.document.content.replace(target(parent), root.at(-1)!, hsonTransform.fromHson('<section id="instance0" <span class="label" "New"/> <i/>/>').toNode().$_content[0]!,
      [{ source: path([]), destination: path([]) }, { source: path([0, 0]), destination: path([0, 0]) }]);
    assert.equal(quid(map, "instance0"), rootId);
    const labelId = owner(map).documentOverlay(identity(map)).quidAtPath(path([...root, 0, 0])); assert.ok(labelId);
    document.document.content.move(target([...root, 0]), 0, 1);
    assert.equal(owner(map).documentOverlay(identity(map)).quidAtPath(path([...root, 0, 1])), labelId);
    atomic(map, () => document.document.content.remove(target(parent), root.at(-1)!));
    atomic(map, () => document.document.content.replace(target(parent), root.at(-1)!, { $_tag: "i", $_content: [] }));
    for (const first of [false, true]) {
      const next = install_libraries_snapshot(map.cut({ data: [], documents: ["page"] }).libs).map;
      let commits = 0; const stop = next.commits.observe(() => commits++);
      try { next.batch(draft => {
        const selected = draft.lib("page"); if (selected.mode !== "document") throw Error("document");
        if (first) selected.css.stylesheet("body{color:blue}");
        selected.content.replace(target(parent), root.at(-1)!, { $_tag: "i", $_content: [] });
        if (!first) selected.css.stylesheet("body{color:blue}");
      }); } finally { stop(); }
      assert.equal(commits, 1); assert.equal(owner(next).documentOverlay(identity(next)).size, 0);
    }
  });
  check("styled reentrant admission keeps accepted inner work and rejects the outer candidate", () => {
    for (const styled of [false, true]) {
      const map = styled_fixture(1), aggregate = owner(map); let entered = false, after: ReturnType<LiveMap["capture"]> | undefined;
      allocator(aggregate.identityEpoch().owner, () => {
        if (!entered) { entered = true;
          if (styled) compose(map, "layout", "inner"); else map.addLibraries({ inner: { data: { accepted: true } } });
          after = map.capture();
        }
        return mint_hson_node_quid();
      });
      try { assert.throws(() => compose(map, "layout", "bad"), /changed during capture|stale/); }
      finally { allocator(aggregate.identityEpoch().owner, undefined); }
      assert.ok(entered); assert.equal(map.lib("inner").mode, styled ? "document" : "data-object"); assert.throws(() => map.lib("bad"));
      assert.equal(map.rev, 1); assert.equal(aggregate.identityEpoch().issued().size, styled ? 3 : 1);
      assert.deepEqual(map.capture(), after);
    }
  });
  check("styled source capture fences end at coherent detachment and retain independently accepted source edits", () => {
    for (const detached of [false, true]) {
      const map = styled_fixture(1), parts = map.lib("parts"); if (parts.mode === "document") throw Error("data");
      const descriptor = Object.getOwnPropertyDescriptor(Object, "freeze")!, freeze = Object.freeze;
      let entered = false;
      Object.defineProperty(Object, "freeze", { ...descriptor, value<T>(value: T): Readonly<T> {
        if (!entered && typeof value === "object" && value !== null && (detached
          ? Reflect.get(value, "name") === "page" && Object.hasOwn(value, "hsonSchema")
          : Reflect.get(value, "key") === "button" && Object.hasOwn(value, "css"))) {
          entered = true; parts.at(["button", "css"]).set(`${local("root")}{color:purple}`);
        }
        return freeze(value);
      } });
      try {
        if (detached) compose(map, "layout", "page");
        else assert.throws(() => compose(map, "layout", "bad"), /changed during capture/);
      } finally { Object.defineProperty(Object, "freeze", descriptor); }
      assert.ok(entered); assert.match(String(parts.snap(["button", "css"])), /purple/);
      assert.equal(map.rev, detached ? 2 : 1);
      if (detached) { assert.match(page(map).css.snapshot(), /padding-left:7px/); assert.doesNotMatch(page(map).css.snapshot(), /purple/); }
      else assert.throws(() => map.lib("bad"));
    }
  });
  check("newly composed subject CSS rejects incremental hosted and durable transport before publication", () => {
    const map = styled_fixture(1); let commit: HostedAggregateCommit | undefined;
    const stop = owner(map).observe(value => { commit = value.hosted; });
    try { compose(map, "layout", "page"); } finally { stop(); }
    assert.ok(commit);
    assert.throws(() => make_portable_aggregate_commit(commit!), /subject-owned CSS/);
    assert.throws(() => durable_aggregate_commit(commit!, [{ name: "page", ownership: "shared" }]), /subject-owned CSS/);
  });
  check("styled composition preserves public management and incomplete-identity guards; hosted subject additions reject", () => {
    const map = styled_fixture(1), aggregate = owner(map), manager = {};
    aggregate.claimManagement(manager);
    try { atomic(map, () => compose(map, "layout", "bad"), /exclusive/); } finally { aggregate.releaseManagement(manager); }
    const id = aggregate.libraries()[0]!;
    atomic(map, () => aggregate.acquireLocalDocumentIdentity(id, path([0]), mint_hson_node_quid(), {
      preflight() { compose(map, "layout", "bad"); return { apply() {}, rollback() {}, release() {} }; },
      realize() {}, rollbackRealization() {},
    }), /incomplete identity/);
    compose(map, "layout", "page");
    const selected = map.cut({ data: [], documents: ["page"] }).libs.libraries[0]!;
    const hosted = hsonLiveMap.fromLibraries({}), hosting = owner(hosted), hostManager = {};
    hosting.claimManagement(hostManager);
    try { atomic(hosted, () => hostedAdd(hosted, hostManager, { bad: { document: page(map).root() } }, { bad: selected.css! }), /correspond|subject|CSS/); }
    finally { hosting.releaseManagement(hostManager); }
  });
}
