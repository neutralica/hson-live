import { part_collection_definition_internal as collection } from "../../src/api/livemap/livemap.parts.ts";
import { document_q_cases } from "./livemap-document-q-cases.mts";
import assert from "node:assert/strict";
import { ANY_DOCUMENT, Hson, hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { make_livemap_from_authored_libraries_internal as authored, compose_livemap_document_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { lookup_document_quad_internal as lookup, authored_quad_for_quid_internal as reverse,
  parse_authored_document_library, resolve_document_quad, make_document_quad_bindings } from "../../src/api/livemap/livemap.document.quad.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { is_persisted_quid } from "../../src/core/hson-node-quid.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import type { HsonNode } from "../../src/core/types.ts";
import type { HsonCanonical } from "../../src/api/transform/transform.types.ts";
import type { LiveMap, LiveMapDocumentLibrary, LiveMapDocumentRequestTarget } from "../../src/types/livemap.types.ts";
import { admit_public_livemap_root } from "../../src/api/livemap/livemap.node-admission.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../../src/api/livemap/livemap.document.registration.ts";
import { build_livemap_document_identity_overlay } from "../../src/api/livemap/livemap.document.identity.ts";
import { capture_internal_document } from "../helpers/document-capture.mts";
import { acquire_document_identity } from "../helpers/livemap-identity-internal.mts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { read_transform_error_details } from "../../src/core/errors.ts";
import { tokenize_authored_document_library, scan_hson_template_segments, hson_interpolation_roles } from "../../src/api/transform/parsers/tokenize-hson.ts";
import { reject_portable_quid_tokens } from "../../src/api/transform/parsers/parse-hson-source.ts";
import { parse_tokens } from "../../src/api/transform/parsers/parse-tokens.ts";

const target = (...path: number[]): LiveMapDocumentRequestTarget => ({ kind: "path", path });
const doc = (map: LiveMap, name = "page"): LiveMapDocumentLibrary => {
  const result = map.lib(name); if (result.mode !== "document") throw Error("Expected document"); return result;
};
const fixture = () => authored({ page: { document: '<main @:page <button @:confirm "Confirm"/> <aside/>/>' } });
const subject = (owner: object, name: string) => {
  const result = lookup(owner, name); if (result === undefined) throw Error(`Missing QUAD ${name}`); return result;
};
function unchanged(map: LiveMap, run: () => unknown, pattern?: RegExp): void {
  const aggregate = internal_livemap_aggregate_authority(map);
  const before = aggregate.inspect();
  const identities = aggregate.libraries();
  const overlays = identities.map(identity => aggregate.documentOverlay(identity));
  const issued = enumerate_livemap_issued_quids(aggregate.identityEpoch().issued());
  let commits = 0; const stop = map.commits.observe(() => commits++);
  try { if (pattern) assert.throws(run, pattern); else assert.throws(run); }
  finally { stop(); }
  assert.deepEqual(aggregate.inspect(), before);
  assert.deepEqual(aggregate.libraries(), identities);
  assert.deepEqual(enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()), issued);
  identities.forEach((identity, index) => assert.equal(aggregate.documentOverlay(identity), overlays[index]));
  assert.equal(commits, 0);
}

export function document_quad_cases(check: (name: string, run: () => void) => void): void {
  check("public authored fragments preserve declarations and issue identity only at governed admission", () => {
    const crypto = globalThis.crypto;
    const descriptor = Object.getOwnPropertyDescriptor(crypto, "getRandomValues");
    Object.defineProperty(crypto, "getRandomValues", { configurable: true, value: () => { throw Error("Authoring attempted identity issuance"); } });
    let source: ReturnType<typeof Hson.document>;
    try {
      const next = Hson.document`<a @:next href="${"/next"}" "${"Next < > @:literal"}"/>`;
      const previous = Hson.document`<a @:previous href="/previous"/>`;
      const navigation = Hson.document`<nav @:navigation ${next} ${undefined} ${previous}/>`;
      source = Hson.document`<html <head/> <body ${navigation}/>/>`;
      assert.equal(typeof source, "string");
      assert.match(source, /@:navigation/); assert.match(source, /@:next/); assert.match(source, /@:previous/);
      assert.doesNotMatch(source, /@[0-9]{9}|undefined/);
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(crypto, "getRandomValues");
      else Object.defineProperty(crypto, "getRandomValues", descriptor);
    }
    const page = doc(hsonLiveMap.fromLibraries({ page: { document: source } }));
    for (const name of ["navigation", "next", "previous"]) {
      assert.ok(page.q(name)); assert.ok(is_persisted_quid(subject(page, name).quid));
    }
    assert.equal(page.q("literal"), undefined);
    assert.doesNotMatch(JSON.stringify(page.root()), /\$_meta|"quad"|"quid"/);
    assert.match(page.render(), /Next &lt; > @:literal/);
  });
  check("composed duplicate names reject atomically with retained declaration locations", () => {
    const fragment = Hson.document`<button @:same/>`;
    const source = Hson.document`<main ${fragment} ${undefined} ${fragment}/>`;
    const map = fixture();
    unchanged(map, () => map.addLibraries({ incoming: { document: source } }), /duplicate.*QUAD/i);
    assert.throws(() => hsonLiveMap.fromLibraries({ page: { document: source } }), error => {
      const details = read_transform_error_details(error);
      assert.equal(details?.code, "HSON_LIBRARY_QUAD_DUPLICATE");
      assert.equal(details?.source?.index, source.lastIndexOf("@:same"));
      assert.equal(details?.related?.[0]?.source.index, source.indexOf("@:same"));
      return true;
    });
    unchanged(map, () => map.addLibraries({ incoming: { document: '<main @:bad-name/>' } }));
    assert.throws(() => Hson.document`<main ${'<p @:bad-name/>'}/>`, error => {
      const details = read_transform_error_details(error);
      assert.equal(details?.code, "HSON_INTERPOLATION_CANDIDATE_INVALID");
      assert.equal(details?.path, "$slot[0]");
      assert.equal(details?.source?.index, 6);
      assert.equal(read_transform_error_details(error instanceof Error ? error.cause : undefined)?.source?.index, 3);
      return true;
    });
    for (const source of ['<p @000000001/>', '<p @:named @000000001/>']) {
      assert.throws(() => Hson.document`<main ${source}/>`);
    }
    const canonical = ANY_DOCUMENT.certify(Hson.document`<main/>`);
    assert.equal(Hson.document.fromHson(canonical), canonical);
  });
  check("authored template scanning retains declaration evidence without canonical qualification", () => {
    const substitutions = ["text", undefined];
    const template = scan_hson_template_segments(['<main @:main "', '" <p @:child/> ', '/>'], substitutions);
    const tokens = tokenize_authored_document_library(template.source, undefined, { slots: template.slots, substitutions });
    assert.deepEqual(tokens.flatMap(token => token.kind === "OPEN" && token.quad !== undefined ? [token.quad.value] : []), ['main', 'child']);
    assert.deepEqual(hson_interpolation_roles(template.source, "document", template.slots), ['quoted-string', 'document-content']);
    assert.throws(() => parse_tokens(tokens), /require.*Library admission/);
    const forbidden = scan_hson_template_segments(['<main @:main @000000001 "', '"/>'], ['text']);
    assert.throws(() => reject_portable_quid_tokens(tokenize_authored_document_library(forbidden.source, undefined,
      { slots: forbidden.slots, substitutions: ['text'] })), /generated runtime QUID.*invalid/);
    for (const segments of [['<main @:bad-name "', '"/>'], ['<main "', '" <p @:bad-name/>/>']]) {
      const invalid = scan_hson_template_segments(segments, ['text']);
      assert.throws(() => tokenize_authored_document_library(invalid.source, undefined,
        { slots: invalid.slots, substitutions: ['text'] }), error => read_transform_error_details(error)?.code === 'HSON_LIBRARY_QUAD_INVALID');
    }
  });
  check("public governed admission retains nested authored names and complete HTML connector ownership", () => {
    const source = Hson.document`<nav @:navigation <a @:next href="/next" "Next"/> <a @:previous href="/previous" "Previous"/>/>`;
    const page = doc(hsonLiveMap.fromLibraries({ page: { document: source } }));
    for (const name of ['navigation', 'next', 'previous']) assert.ok(page.q(name));
    const connector = Hson.document`<hson-part @:content lib="parts" at="content"/>`;
    const shell = Hson.document`<html <head/> <body <main ${connector}/>/>/>`;
    const html = doc(hsonLiveMap.fromLibraries({
      parts: collection({ content: { kind: 'document', document: Hson.document`<article @:article "Body"/>` } }),
      page: { document: shell },
    }));
    assert.ok(html.q('content'));
    assert.doesNotMatch(JSON.stringify(html.at([]).snap()), /\$_meta|@:|hson-part/);
    assert.throws(() => hsonTransform.fromHson(shell).toNode());
  });
  document_q_cases(check);
  check("authored addresses bind genuine sparse QUIDs without graph revisions", () => {
    const map = fixture(), page = doc(map);
    const aggregate = internal_livemap_aggregate_authority(map), identity = aggregate.libraries()[0]!;
    const main = subject(page, "page"), button = subject(page, "confirm");
    assert.ok(is_persisted_quid(main.quid)); assert.ok(is_persisted_quid(button.quid));
    assert.notEqual(main.quid, button.quid);
    assert.deepEqual(main.path, [0]); assert.deepEqual(button.path, [0, 0, 0]);
    assert.equal(aggregate.documentOverlay(identity).size, 2);
    assert.equal(aggregate.identityEpoch().issued().size, 2);
    assert.equal(aggregate.identityEpoch().current(), 0);
    assert.equal(map.rev, 0); assert.equal(aggregate.telemetry().aggregatePublications, 0);
    assert.equal(aggregate.documentOverlay(identity).quidAtPath(validate_document_path([0, 0, 1])), undefined);
    assert.deepEqual(reverse(page, button.quid), button);
    assert.deepEqual(lookup(page.document, "confirm"), button);
    assert.equal(page.document.byQuid(button.quid)?.$_tag, "button");
    const before = page.root(); let commits = 0;
    const stop = map.commits.observe(() => commits++);
    acquire_document_identity(page.document, target(...button.path));
    lookup(page, "confirm"); reverse(page, button.quid); stop();
    assert.equal(commits, 0); assert.equal(map.rev, 0); assert.deepEqual(page.root(), before);
    assert.equal(aggregate.identityEpoch().issued().size, 2);
    assert.equal(Reflect.get(page.document, "byQuad"), undefined);
    assert.equal(Reflect.get(page, "quad"), undefined);
  });
  check("ROOT elements nested elements and empty elements are addressable ordinary subjects", () => {
    const map = authored({ page: { document: '<main @:root <section @:nested <button @:empty/>/>/>' } });
    const page = doc(map);
    assert.deepEqual(subject(page, "root").path, [0]);
    assert.deepEqual(subject(page, "nested").path, [0, 0, 0]);
    assert.deepEqual(subject(page, "empty").path, [0, 0, 0, 0, 0]);
    assert.deepEqual(page.document.byQuid(subject(page, "empty").quid)?.$_content, []);
  });
  check("names are Library-local case-sensitive Map keys", () => {
    const map = authored({ one: { document: '<main @:same <a @:Same/> <b @:__proto__/> <c @:constructor/> <d @:toString/>/>' }, two: { document: '<aside @:same/>' } });
    const one = doc(map, "one"), two = doc(map, "two");
    assert.notEqual(subject(one, "same").quid, subject(two, "same").quid);
    assert.notEqual(subject(one, "same").quid, subject(one, "Same").quid);
    for (const name of ["__proto__", "constructor", "toString"]) assert.ok(is_persisted_quid(subject(one, name).quid));
    assert.equal(lookup(one, "SAME"), undefined);
    assert.equal(reverse(two, subject(one, "same").quid), undefined);
  });
  check("ASCII identifier bounds include dollar underscore and exactly 128 characters", () => {
    for (const name of ["$", "_", "$confirm_2", "A".repeat(128)]) {
      const map = authored({ page: { document: `<button @:${name}/>` } });
      assert.equal(subject(doc(map), name).name, name);
    }
    for (const name of ["", "2start", "a-b", "a.b", "é", "a:b", "'quoted'", "a=" , "A".repeat(129)]) {
      assert.throws(() => authored({ page: { document: `<button @:${name}/>` } }), /QUAD|QUID|token|character/i);
    }
    assert.throws(() => authored({ page: { document: '<button "Text" @:late/>' } }), /after content/);
  });
  check("duplicate subjects and duplicate declarations report original source positions", () => {
    const source = '<main\n <button @:same/>\n <button @:same/>/>';
    assert.throws(() => authored({ page: { document: source } }), error => {
      const details = read_transform_error_details(error);
      assert.equal(details?.code, "HSON_LIBRARY_QUAD_DUPLICATE");
      assert.equal(details?.source?.line, 3);
      assert.equal(details?.related?.[0]?.source.line, 2);
      assert.equal(details?.source?.index, source.lastIndexOf("@:same"));
      return true;
    });
    assert.throws(() => authored({ page: { document: '<button @:a @:b/>' } }), /duplicate.*QUAD/i);
  });
  check("virtual ROOT text and structural carriers cannot declare addresses", () => {
    for (const source of ['<_hson_root @:root/>', '<_hson_elem @:carrier/>', '<_hson_str @:text "Text"/>', '<_hson_arr @:array/>', '"Text" @:text', '«@:array»', '<value @:member "x">']) {
      assert.throws(() => authored({ page: { document: source } }));
    }
    const map = authored({ page: { document: '<main "literal @:text"/> "trailing"' } });
    assert.equal(internal_livemap_aggregate_authority(map).identityEpoch().issued().size, 0);
    assert.equal(lookup(doc(map), "text"), undefined);
  });
  check("declarations disappear before exact graph qualification and HTML realization", () => {
    const map = fixture(), page = doc(map);
    const encoded = JSON.stringify(page.root());
    assert.equal(encoded.includes("quad"), false); assert.equal(encoded.includes("quid"), false);
    assert.equal(encoded.includes("@:"), false);
    assert.doesNotThrow(() => admit_public_livemap_root(page.root(), "document", "QUAD candidate"));
    assert.match(page.render(), /<button>Confirm<\/button>/);
    assert.equal(page.render().includes("@:"), false);
    assert.equal(page.render().includes("quad="), false);
    assert.throws(() => admit_public_livemap_root({ $_tag: "_hson_root", $_content: [
      { $_tag: "button", $_meta: { quad: "confirm" }, $_content: [] },
    ] }, "document", "undeclared QUAD metadata"));
  });
  check("Transform keeps its grammar while authored Library admission accepts document QUADs", () => {
    const source = '<button @:confirm "Confirm"/>';
    assert.throws(() => hsonTransform.fromHson(source).toNode());
    assert.throws(() => Hson.document.fromHson(source as HsonCanonical));
    assert.equal(Hson.document`<button @:confirm "Confirm"/>`, source);
    assert.throws(() => ANY_DOCUMENT.certify(Hson.document`<button @:confirm "Confirm"/>`));
    assert.throws(() => Hson.canonical`${Hson.document`<button @:confirm/>`}`);
    const schema = Hson.schema`<type "document" tag "button" content "string">`;
    const governed = hsonLiveMap.fromLibraries({ page: { document: Hson.document`<button @:confirm "Confirm"/>`, schema } });
    assert.ok(governed.lib("page").q("confirm"));
    assert.ok(lookup(doc(hsonLiveMap.fromLibraries({ page: { document: source } })), "confirm"));
    const normal = hsonLiveMap.create();
    normal.addLibraries({ page: { document: source } });
    assert.ok(lookup(doc(normal), "confirm"));
    assert.throws(() => parse_tokens(tokenize_authored_document_library(source)), /require.*Library admission/);
    assert.equal(JSON.stringify(hsonTransform.fromHson('<button "Confirm"/>').toNode()).includes("Confirm"), true);
  });
  check("authored admission never grants foreign generated-QUID authority", () => {
    for (const source of ['<button @000009001/>', '<button @:confirm @000009001/>', '<button @000009001 @:confirm/>']) {
      assert.throws(() => authored({ page: { document: source } }), /generated runtime QUID.*invalid/);
    }
    assert.throws(() => authored({ page: { document: { $_tag: "_hson_root", $_content: [{ $_tag: "button", $_meta: { quid: "000009001" }, $_content: [] }] } } }), /runtime QUID.*invalid/);
  });
  check("invalid admission publishes no map or bindings and never changes another owner", () => {
    const existing = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
    const before = existing.capture();
    const schema = Hson.schema`<type "document" tag "aside" content "empty">`;
    for (const inputs of [
      { good: { document: '<button @:good/>' }, bad: { document: '<a @:same/> <b @:same/>' } },
      { good: { document: '<button @:good/>' }, bad: { document: '<main @:bad/>', schema } },
    ]) {
      let exposed: LiveMap | undefined;
      assert.throws(() => { exposed = authored(inputs); });
      assert.equal(exposed, undefined);
      assert.deepEqual(existing.capture(), before);
    }
  });
  check("allocator exhaustion during provisional admission exposes no partially bound map", () => {
    const crypto = globalThis.crypto;
    const descriptor = Object.getOwnPropertyDescriptor(crypto, "getRandomValues");
    Object.defineProperty(crypto, "getRandomValues", { configurable: true, value: (bytes: Uint8Array) => { bytes.fill(0); return bytes; } });
    let exposed: LiveMap | undefined;
    try {
      assert.throws(() => { exposed = authored({ page: { document: '<main @:one <button @:two/>/>' } }); }, /available document QUID|secure attempts/);
      assert.equal(exposed, undefined);
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(crypto, "getRandomValues");
      else Object.defineProperty(crypto, "getRandomValues", descriptor);
    }
    assert.ok(is_persisted_quid(subject(doc(fixture()), "confirm").quid));
  });
  check("moves and ordinary attribute or text edits preserve subject correspondence", () => {
    const map = fixture(), page = doc(map), initial = subject(page, "confirm");
    page.document.attrs.set(target(...initial.path), "title", "Ready");
    page.document.content.replace(target(0, 0, 0, 0), 0, { $_tag: "_hson_str", $_content: ["Proceed"] });
    page.at([]).asElement()!.move(0, 1);
    const moved = subject(page, "confirm");
    assert.equal(moved.quid, initial.quid); assert.deepEqual(moved.path, [0, 0, 1]);
    assert.equal(page.document.byQuid(moved.quid)?.$_attrs?.title, "Ready");
    assert.deepEqual(reverse(page, moved.quid), moved);
    assert.equal(map.rev, 3);
    assert.ok(Object.isFrozen(moved)); assert.ok(Object.isFrozen(moved.path));
  });
  check("removal retires bindings before observers and copied reinsertion does not resurrect them", () => {
    const map = fixture(), page = doc(map), initial = subject(page, "confirm");
    const copy = parse_authored_document_library('<button "Copy"/>').root.$_content[0];
    if (!is_Node(copy)) throw Error("Expected copy");
    map.commits.observe(() => { assert.equal(lookup(page, "confirm"), undefined); });
    page.document.content.remove(target(0, 0), 0);
    assert.equal(lookup(page, "confirm"), undefined); assert.equal(reverse(page, initial.quid), undefined);
    assert.equal(page.document.byQuid(initial.quid), undefined);
    page.at([]).asElement()!.insert(0, copy);
    assert.equal(lookup(page, "confirm"), undefined);
    acquire_document_identity(page.document, target(0, 0, 0));
    assert.equal(lookup(page, "confirm"), undefined);
    assert.ok(internal_livemap_aggregate_authority(map).identityEpoch().issued().has(initial.quid));
  });
  check("ordinary replacement retires addresses while precise mutations retain them", () => {
    const map = fixture(), page = doc(map), initial = subject(page, "confirm");
    page.document.attrs.set(target(0, 0, 0), "title", "updated");
    assert.equal(subject(page, "confirm").quid, initial.quid);
    assert.equal(page.document.byQuid(initial.quid)?.$_tag, "button");
    page.document.content.replace(target(0, 0), 0, { $_tag: "button", $_content: [] });
    assert.equal(lookup(page, "confirm"), undefined); assert.equal(reverse(page, initial.quid), undefined);
    assert.ok(lookup(page, "page"));
  });

  check("stale bindings never fall back to an element occupying the former path", () => {
    const map = fixture(), page = doc(map), initial = subject(page, "confirm");
    const oldBindings = make_document_quad_bindings([{ name: "confirm", quid: initial.quid }]);
    page.document.content.replace(target(0, 0), 0, { $_tag: "button", $_attrs: { id: "replacement" }, $_content: [] });
    const authority = internal_livemap_aggregate_authority(map), id = authority.libraries()[0]!;
    assert.equal(resolve_document_quad(authority.root(id), authority.documentOverlay(id), oldBindings, "confirm", undefined), undefined);
    assert.equal(lookup(page, "confirm"), undefined);
    const blank = build_livemap_document_identity_overlay({ $_tag: "_hson_root", $_content: [] }, "document");
    assert.equal(resolve_document_quad(page.root(), blank, oldBindings, undefined, initial.quid), undefined);
  });
  check("failed graph mutations preserve every binding and the issued ledger", () => {
    const schema = Hson.schema`<type "document" tag "main" content <repeat <tag "button" content "empty">>>`;
    const map = authored({ page: { document: '<main @:page <button @:confirm/>/>', schema } }), page = doc(map);
    const before = subject(page, "confirm");
    unchanged(map, () => page.document.content.replace(target(0, 0), 0, { $_tag: "aside", $_content: [] }), /schema/i);
    assert.deepEqual(subject(page, "confirm"), before);
  });
  check("existing allocator rejects active and retired collisions without inventing QUAD identities", () => {
    const map = fixture(), page = doc(map), initial = subject(page, "confirm");
    set_livemap_document_quid_candidate_source_for_tests(page.document, () => initial.quid);
    try { unchanged(map, () => acquire_document_identity(page.document, target(0, 0, 1)), /secure attempts/); }
    finally { set_livemap_document_quid_candidate_source_for_tests(page.document, undefined); }
    page.document.content.remove(target(0, 0), 0);
    set_livemap_document_quid_candidate_source_for_tests(page.document, () => initial.quid);
    try { unchanged(map, () => acquire_document_identity(page.document, target(0, 0, 0)), /secure attempts/); }
    finally { set_livemap_document_quid_candidate_source_for_tests(page.document, undefined); }
  });
  check("raw foreign identity and bindings cannot bypass authority checks", () => {
    const map = fixture(), aggregate = internal_livemap_aggregate_authority(map), id = aggregate.libraries()[0]!;
    unchanged(map, () => aggregate.installInitialDocumentQuads(id, [{ name: "foreign", quid: "000009001" }]));
    unchanged(map, () => map.batch(batch => {
      const page = batch.lib("page"); if (page.mode !== "document") throw Error("Expected document");
      page.graph({ domain: "graph", op: "ensure-quid", target: target(0), quid: "000009001" } as never);
    }), /identity|QUID/i);
    const manager = {}; aggregate.claimManagement(manager); aggregate.releaseManagement(manager);
    const plain = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
    const owner = {}, ordinary = internal_livemap_aggregate_authority(plain), identity = ordinary.libraries()[0]!;
    ordinary.claimManagement(owner);
    try { unchanged(plain, () => ordinary.installInitialDocumentQuads(identity, []), /exclusive|controlled/i); }
    finally { ordinary.releaseManagement(owner); }
  });
  check("Library envelopes carry addresses and detached view-state captures retain an explicit fence", () => {
    const map = fixture(), aggregate = internal_livemap_aggregate_authority(map);
    for (const capture of [map.capture(), map.cut().libs, aggregate.captureHosted(), aggregate.captureSemanticCheckpoint()]) {
      assert.equal(capture.libraries[0]?.quads?.length, 2);
    }
    for (const options of [undefined, { identity: "strip" as const }, { identity: "same-epoch" as const }]) {
      unchanged(map, () => capture_internal_document(map, "page", options), /QUAD-bearing.*unsupported/);
    }
    assert.ok(lookup(doc(map), "confirm"));
  });
  check("ordinary restoration and replay replace or preserve registry state through their owner", () => {
    const map = fixture(), aggregate = internal_livemap_aggregate_authority(map);
    const plain = hsonLiveMap.fromLibraries({ page: { document: '<main <button "Confirm"/> <aside/>/>' } });
    const addition = plain.addLibraries({ next: { document: '<aside/>' } });
    map.replay(addition);
    assert.ok(lookup(doc(map), "confirm"));
    internal_livemap_aggregate_authority(fixture()).setInitialHostedAuthority({ logicalMapId: "map", incarnationId: "run" });
  });
  check("recursive Part composition preserves shell QUADs and leaves Part addresses local", () => {
    const map = authored({ layout: { document: '<main @:page <hson-part lib="parts" at="header"/> <hson-part lib="parts" at="header"/>/>' },
      parts: collection({ header: { kind: "document", document: '<header @:header <hson-part at="button"/>/>' }, button: { kind: "document", document: '<button @:button "Go"/>' } }) });
    const source = subject(doc(map, "layout"), "page"), original = map.lib("parts").root();
    const ledger = enumerate_livemap_issued_quids(internal_livemap_aggregate_authority(map).identityEpoch().issued());
    const page = compose_livemap_document_internal(map, "layout", "result");
    assert.equal(JSON.stringify(page.root()).includes("quid"), false);
    assert.equal(JSON.stringify(page.root()).includes("hson-part"), false);
    assert.ok(lookup(page, "page")); assert.equal(lookup(page, "button"), undefined);
    assert.equal(reverse(page, source.quid), undefined);
    assert.deepEqual(map.lib("parts").root(), original);
    assert.equal(internal_livemap_aggregate_authority(map).identityEpoch().issued().size, ledger.length + 1);
    const first = acquire_document_identity(page.document, target(0, 0, 0, 0, 0));
    const second = acquire_document_identity(page.document, target(0, 0, 1, 0, 0));
    assert.notEqual(first.snap()?.$_meta?.quid, source.quid);
    assert.notEqual(first.snap()?.$_meta?.quid, second.snap()?.$_meta?.quid);
    const cut = map.cut({ data: [], documents: ["result"], html: "result" });
    const received = install_libraries_snapshot(cut.libs).map;
    assert.deepEqual(doc(received, "result").root(), page.root());
    assert.equal(lookup(doc(received, "result"), "button"), undefined);
    assert.throws(() => map.capture(), /Echo\/checkpoint/);
    assert.equal(internal_livemap_aggregate_authority(map).scopedDocumentState(internal_livemap_aggregate_authority(map).libraries()[0]!).scopes.occurrences.length, 4);
  });
  check("after all addressed subjects retire QUAD-free capture behaves normally", () => {
    const map = authored({ page: { document: '<main <button @:only/>/> ' } }), page = doc(map);
    page.document.content.remove(target(0), 0);
    assert.equal(lookup(page, "only"), undefined);
    const captured = map.capture();
    assert.deepEqual(install_libraries_snapshot(captured).map.capture(), captured);
  });
  check("QUAD-free private authored admission preserves ordinary data capture and replay", () => {
    const map = authored({ page: { document: '<main/>' }, state: { data: { count: 1 } } });
    const captured = map.capture();
    assert.deepEqual(install_libraries_snapshot(captured).map.capture(), captured);
    assert.equal(internal_livemap_aggregate_authority(map).identityEpoch().issued().size, 0);
    const commit = map.addLibraries({ next: { document: '<aside/>' } });
    const replica = install_libraries_snapshot(captured).map;
    replica.replay(commit);
    assert.deepEqual(replica.capture(), map.capture());
  });
}
