import assert from "node:assert/strict";
import { Hson, hsonLiveMap, type HsonAuthored } from "../../src/index.js";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.js";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.js";
import { parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.js";

const heading = { kind: "document", document: '<h1 "%{content}"/>' } as const;
const blank = { kind: "document", document: "<hr/>" } as const;
const definitions = { components: { parts: { heading, blank } }, ordinary: { data: { heading } } };

export async function parts_write_cases() {
  const map = hsonLiveMap.fromLibraries(definitions), parts = map.parts.components;
  const authority = internal_livemap_aggregate_authority(map);
  const before = authority.captureSemanticCheckpoint();
  const issued = enumerate_livemap_issued_quids(authority.identityEpoch().issued());
  let commits = 0, watches = 0;
  const off = map.commits.observe(() => commits++), unwatch = parts.heading.watch(() => watches++);
  const args = { content: '"/><script>evil</script>\\\n\t&%{untouched}😀' };
  const originalContent = args.content;
  const invocation = parts.heading.write(args);
  const parsed = parse_authored_document_library(invocation).root.$_content[0];
  assert.equal(typeof parsed, "object");
  if (typeof parsed !== "object" || parsed === null) throw Error("Expected connector");
  assert.deepEqual(parsed.$_attrs, { at: "heading", content: args.content, lib: "components" });
  assert.equal(invocation, parts.at(["heading"]).write(args));
  for (const member of [parts.heading.present()!, parts.heading.asObject()!, parts.heading.at([]),
    parts.at([]).at(["heading"]), parts.at([]).asObject()!.present()!.at(["heading"]).asObject()!.at([])]) {
    assert.equal(member.write(args), invocation);
  }
  assert.equal(Object.isFrozen(parts.heading), true);
  assert.equal(parts.at, Object.getOwnPropertyDescriptor(parts, "at")!.value);
  assert.equal(parts.at, parts.at);
  const frozenWrite = Object.getOwnPropertyDescriptor(parts.heading, "write")!;
  assert.equal(frozenWrite.writable, false); assert.equal(frozenWrite.configurable, false);
  args.content = "later";
  assert.equal(parts.blank.write(), Hson.document`<hson-part lib="components" at="blank"/>`);
  const nullRecord = Object.create(null);
  Object.defineProperty(nullRecord, "content", { value: "detached", enumerable: true });
  assert.equal(parts.heading.write(nullRecord), parts.heading.write({ content: "detached" }));
  for (const scalar of ["", " ", 0, -0, 0.25, Number.MAX_VALUE, true, false, null]) {
    const node = parse_authored_document_library(parts.heading.write({ content: scalar })).root.$_content[0];
    assert.ok(typeof node === "object" && node !== null);
    assert.equal(node.$_attrs?.content, String(scalar));
  }

  for (const value of [undefined, NaN, Infinity, -Infinity, {}, [], Symbol("bad"), 1n, () => "bad"]) {
    assert.throws(() => Reflect.apply(parts.heading.write, undefined, [{ content: value }]));
  }
  for (const value of [undefined, null, "text", 1, [], new Date(), Object.create({ inherited: "bad" })]) {
    assert.throws(() => Reflect.apply(parts.heading.write, undefined, [value]));
  }
  assert.throws(() => Reflect.apply(parts.heading.write, undefined, [{}, {}]));
  for (const name of ["", "bad name", "1bad", "x.y", "lib", "at", "style", "__proto__", "hson:quid", "_hson_attr_transit_x", "_hson_meta_attr_x"]) {
    assert.throws(() => parts.heading.write(Object.fromEntries([[name, "value"]])), name);
  }
  assert.throws(() => parts.heading.write({ [Symbol("bad")]: "value" }));
  assert.throws(() => parts.heading.write(Object.defineProperty({}, "content", { value: "hidden" })));
  let getterCalls = 0, coercions = 0;
  assert.throws(() => parts.heading.write({ get content() { getterCalls++; return "bad"; } }));
  assert.throws(() => Reflect.apply(parts.heading.write, undefined, [{ content: {
    toString() { coercions++; return "bad"; }, [Symbol.toPrimitive]() { coercions++; return "bad"; },
  } }]));
  assert.equal(getterCalls, 0); assert.equal(coercions, 0);
  // A nested invocation during descriptor capture is harmless and establishes no subscription.
  const recursive = new Proxy({ content: "outer" }, { getOwnPropertyDescriptor(target, key) {
    assert.equal(parts.blank.write(), parts.at(["blank"]).write());
    return Reflect.getOwnPropertyDescriptor(target, key);
  } });
  assert.equal(parts.heading.write(recursive), parts.heading.write({ content: "outer" }));
  assert.deepEqual(authority.captureSemanticCheckpoint(), before);
  assert.deepEqual(enumerate_livemap_issued_quids(authority.identityEpoch().issued()), issued);
  assert.equal(commits, 0); assert.equal(watches, 0); off(); unwatch();

  for (const location of [parts, parts.at([]), parts.heading.at(["document"]),
    map.data.ordinary, map.data.ordinary.at(["heading"])]) {
    assert.equal("write" in location, false);
  }
  assert.throws(() => parts.at(["heading", "css"] as never), /field access/);
  map.batch(writer => {
    assert.equal("write" in writer.parts.components, false);
    assert.equal("write" in writer.parts.components.heading, false);
    assert.equal("write" in writer.parts.components.at(["blank"]), false);
  });
  assert.throws(() => Reflect.get(parts, "unknown"), /Unknown Part member/);
  const unknown = parts.at(["unknown"]);
  assert.throws(() => unknown.write(), /Unknown Part member/);
  parts.at([]).object.setKey("unknown", blank);
  assert.equal(unknown.write(), parts.at(["unknown"]).write());
  const retained = parts.heading;
  retained.delete(); assert.throws(() => retained.write(), /Unknown Part member/);
  parts.at([]).object.setKey("heading", heading);
  assert.equal(retained.write({ content: "again" }), parts.heading.write({ content: "again" }));

  for (const trap of ["getPrototypeOf", "ownKeys", "getOwnPropertyDescriptor"] as const) {
    const hostile = new Proxy({ content: "outer" }, { [trap](target: object, key: PropertyKey) {
      parts.blank.replace({ kind: "document", document: `<hr title="${trap}"/>` });
      return trap === "getPrototypeOf" ? Reflect.getPrototypeOf(target)
        : trap === "ownKeys" ? Reflect.ownKeys(target) : Reflect.getOwnPropertyDescriptor(target, key);
    } });
    assert.throws(() => retained.write(hostile), /changed during capture/);
    assert.equal(parts.blank.snap()!.document, `<hr title="${trap}"/>`, "accepted inner work survives");
  }

  // Source is detached from both caller arguments and the originating definitions.
  retained.replace({ kind: "document", document: '<h3 "%{content}"/>' });
  const receiving = hsonLiveMap.fromLibraries({ components: { parts: {
    heading: { kind: "document", document: '<h2 title="%{content}" "%{content}"/>' }, blank,
    scalars: { kind: "document", document: '<p n="%{count}" enabled="%{enabled}" empty="%{empty}" "%{ExactCase}:%{count}:%{enabled}:%{empty}"/>' },
  } } });
  receiving.addLibraries({ page: { document: Hson.document`<section ${invocation} ${parts.blank.write()}/>` } });
  const pageText = JSON.stringify(receiving.doc.must("page").root());
  assert.equal(receiving.doc.must("page").at([0]).asElement()!.attrs.get("title"), originalContent);
  assert.ok(pageText.includes("h2")); assert.ok(pageText.includes("evil"));
  assert.ok(!pageText.includes('"$_tag":"script"')); assert.ok(!pageText.includes("later"));
  for (const parameters of [undefined, { content: "ok", extra: "bad" }]) {
    const source = parameters === undefined ? retained.write() : retained.write(parameters);
    assert.throws(() => receiving.addLibraries({ invalid: { document: source } }), /Missing Part parameter|Unknown Part parameter|Unused Part parameter/);
    assert.equal(receiving.doc("invalid"), undefined);
  }
  const scalarSource = receiving.parts.components.scalars.write({ ExactCase: "Mixed", count: 3, enabled: true, empty: null });
  receiving.addLibraries({ scalarPage: { document: scalarSource } });
  assert.match(JSON.stringify(receiving.doc.must("scalarPage").root()), /Mixed:3:true:null/);
  assert.throws(() => receiving.addLibraries({ wrongCase: { document: receiving.parts.components.scalars.write({
    exactcase: "wrong", count: 3, enabled: true, empty: null,
  }) } }), /Missing Part parameter/);
  const incompatible = hsonLiveMap.create();
  assert.throws(() => incompatible.addLibraries({ page: { document: invocation } }));
  assert.equal(incompatible.doc("page"), undefined);
  const oddLibrary = 'lib"\\<&\n', oddMember = 'part"\\<&\n';
  const odd = hsonLiveMap.fromLibraries({ [oddLibrary]: { parts: { [oddMember]: blank, "": blank } } });
  for (const member of [oddMember, ""]) {
    const source = odd.parts.must(oddLibrary).at([member]).write();
    const result = hsonLiveMap.fromLibraries({ [oddLibrary]: { parts: { [member]: blank } }, page: { document: source } });
    assert.match(JSON.stringify(result.doc.page.root()), /hr/);
  }

  let readWrite: (() => HsonAuthored) | undefined;
  const locus = hsonLiveMap.locus.create(definitions, { actions: { inspect(context) {
    const read = context.parts.components.blank;
    assert.equal("set" in read, false); assert.equal("delete" in read, false);
    readWrite = read.write;
    assert.equal(readWrite(), parts.blank.write());
    assert.equal(context.parts.components.at(["blank"]).write(), readWrite());
  } } });
  const locusWrite = locus.parts.components.blank.write;
  try {
    assert.equal(locusWrite(), parts.blank.write());
    assert.equal((await locus.dispatchAction({ type: "action", id: "write", name: "inspect" })).type, "ack");
    await locus.parts.components.blank.delete();
    assert.throws(locusWrite, /Unknown Part member/); assert.throws(readWrite!, /Unknown Part member/);
    await locus.parts.components.at([]).object.setKey("blank", blank);
    assert.equal(locusWrite(), readWrite!());
    await locus.stage(writer => assert.equal("write" in writer.parts.components.blank, false));
    const disposalArgs = new Proxy({}, { ownKeys() { locus.dispose(); return []; } });
    assert.throws(() => locus.parts.components.blank.write(disposalArgs), /disposed/i);
    assert.throws(locusWrite, /disposed/i); assert.throws(readWrite!, /disposed/i);
  } finally { locus.dispose(); }

  // Existing admission owns nested occurrence lifetimes, local QUADs, and CSS.
  const styled = hsonLiveMap.fromLibraries({ components: { parts: {
    leaf: { kind: "document", document: '<b @:root "leaf"/>', css: { color: "blue" } },
    panel: { kind: "document", document: '<article @:root <hson-part @:child at="leaf"/>/>', css: { color: "red" } },
  } } });
  const styledAuthority = internal_livemap_aggregate_authority(styled);
  const styledBefore = styledAuthority.captureSemanticCheckpoint();
  const styledIssued = enumerate_livemap_issued_quids(styledAuthority.identityEpoch().issued());
  const panel = styled.parts.components.panel.write();
  assert.deepEqual(styledAuthority.captureSemanticCheckpoint(), styledBefore);
  assert.deepEqual(enumerate_livemap_issued_quids(styledAuthority.identityEpoch().issued()), styledIssued);
  styled.addLibraries({ page: { document: Hson.document`<main ${panel} ${panel}/>` } });
  const occurrences = styledAuthority.documentScopes(styledAuthority.libraries()[1]!)!.occurrences;
  assert.equal(occurrences.length, 4);
  assert.equal(new Set(occurrences.map(item => item.lifetime)).size, 4);
  assert.equal(new Set(occurrences.map(item => item.rootQuid)).size, 4);
  assert.equal(new Set(occurrences.flatMap(item => item.bindings.filter(binding => binding.name === "root").map(binding => binding.quid))).size, 4);
  assert.equal(occurrences.filter(item => item.parent !== null).length, 2);
  assert.equal((styled.doc.must("page").css.snapshot().match(/@scope/g) ?? []).length, 4);
}
