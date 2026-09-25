// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { _create_livetree_runtime_test_handle, _reflect_document_for_runtime_test } from "../src/_tests/diagnostics-internal.ts";
import { LiveMapDocumentAttributeNotFoundError, LiveMapDocumentMutationError } from "../src/api/livemap/livemap.error.ts";
import type { LiveMapDocumentLibrary, LiveMapDocumentRequestTarget } from "../src/types/livemap.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-location-attrs",
  title: "Document location attrs convergence",
  category: "LiveMap",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "path", "mutation", "attrs", "proxy", "reflection", "public-api", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.document-location-attrs");
let checks = 0;
const check = (name: string, run: () => void): void => {
  testEvents.case_begin(name, name);
  try {
    run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  } checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`); };
const EmptyMain = Hson.schema`<type "document" tag "main" content "empty">`;
const TextMain = Hson.schema`<type "document" tag "main" content "string">`;
const ButtonMain = Hson.schema`<type "document" tag "main" content <sequence [<tag "button" content "empty">]>>`;
const SectionMain = Hson.schema`<type "document" tag "main" content <sequence [<tag "section" content <sequence [<tag "button" content "empty">]>>]>>`;
const registry = (source: string) => {
  const schema = source.includes("<section") ? SectionMain : source.includes("<button") ? ButtonMain : source.includes('"text"') ? TextMain : EmptyMain;
  return hsonLiveMap.fromLibraries({ page: { document: source, schema } });
};
const element = (source: string) => registry(source).lib("page");
const target = (...path: number[]): LiveMapDocumentRequestTarget => ({ kind: "path", path });
const code = (run: () => unknown, expected: LiveMapDocumentMutationError["code"]): void => assert.throws(run, (error: unknown) => error instanceof LiveMapDocumentMutationError && error.code === expected);
const equivalent = (
  source: string,
  byLocation: (map: LiveMapDocumentLibrary) => unknown,
  byDocument: (map: LiveMapDocumentLibrary) => unknown,
): void => {
  const left = element(source);
  const right = element(source);
  assert.deepEqual(byLocation(left), byDocument(right));
  assert.deepEqual(left.root(), right.root());
};

check("get reads detached ordinary attrs", () => { assert.equal(element(`<main id="root"/>`).at([]).asElement()!.attrs.get("id"), "root"); });
check("has preserves falsey values", () => { const map = element(`<main/>`); map.at([]).asElement()!.attrs.set("hidden", false); assert.equal(map.at([]).asElement()!.attrs.has("hidden"), true); });
check("keys preserves canonical sorted ordering", () => { const map = element(`<main/>`); map.at([]).asElement()!.attrs.replace({ zeta: 1, alpha: 2 }); assert.deepEqual(map.at([]).asElement()!.attrs.keys(), ["alpha", "zeta"]); });
check("must.get returns existing values", () => { const attrs = element(`<main id="root"/>`).at([]).asElement()!.attrs; assert.equal(attrs.must.get("id"), "root"); assert.equal(attrs.must, attrs.must); assert.equal(Object.isFrozen(attrs.must), true); });
check("must.get preserves missing-attribute error", () => { assert.throws(() => element(`<main/>`).at([]).asElement()!.attrs.must.get("id"), LiveMapDocumentAttributeNotFoundError); });
check("set delegates one canonical set-attr", () => { const map = element(`<main/>`); const commit = map.at([]).asElement()!.attrs.set("title", "hello"); assert.equal(commit.operations[0]?.operation.op, "set-attr"); assert.equal(map.at([]).asElement()!.attrs.get("title"), "hello"); });
check("setMany delegates canonical replace-attrs", () => { const map = element(`<main id="old"/>`); const commit = map.at([]).asElement()!.attrs.setMany({ class: "ready", count: 2 }); assert.equal(commit.operations[0]?.operation.op, "replace-attrs"); assert.deepEqual(map.at([]).asElement()!.attrs.keys(), ["class", "count", "id"]); });
check("drop delegates one canonical remove-attr", () => { const map = element(`<main id="root"/>`); assert.equal(map.at([]).asElement()!.attrs.drop("id").operations[0]?.operation.op, "remove-attr"); assert.equal(map.at([]).asElement()!.attrs.has("id"), false); });
check("dropMany delegates canonical replace-attrs", () => { const map = element(`<main/>`); map.at([]).asElement()!.attrs.replace({ a: 1, b: 2, c: 3 }); assert.equal(map.at([]).asElement()!.attrs.dropMany(["a", "c"]).operations[0]?.operation.op, "replace-attrs"); assert.deepEqual(map.at([]).asElement()!.attrs.keys(), ["b"]); });
check("replace installs one exact public bag", () => { const map = element(`<main id="old"/>`); map.at([]).asElement()!.attrs.replace({ role: "main", enabled: true }); assert.deepEqual(map.at([]).asElement()!.attrs.keys(), ["enabled", "role"]); });
check("clear preserves canonical empty bag behavior", () => { const map = element(`<main id="old"/>`); assert.equal(map.at([]).asElement()!.attrs.clear().operations[0]?.operation.op, "replace-attrs"); assert.deepEqual(map.at([]).asElement()!.attrs.keys(), []); });
check("invalid names preserve attrs validation", () => { code(() => element(`<main/>`).at([]).asElement()!.attrs.set("bad name", "x"), "INVALID_DOCUMENT_ATTRIBUTE_NAME"); code(() => element(`<main/>`).at([]).asElement()!.attrs.get("hson:quid"), "PROTECTED_DOCUMENT_METADATA"); });
check("nested element attrs lower through hidden carriers", () => { const map = element(`<main <section <button/>/>/>`); map.at([0, 0]).asElement()!.attrs.set("id", "submit"); assert.equal(map.at([0, 0]).asElement()!.attrs.get("id"), "submit"); });
check("primitive attrs reject as non-elements", () => { code(() => element(`<main "text"/>`).document.attrs.get(target(0, 0), "id"), "DOCUMENT_TARGET_KIND"); });
check("missing attrs locations reject strictly", () => { code(() => element(`<main/>`).document.attrs.set(target(0, 0), "id", "x"), "DOCUMENT_PATH_OUT_OF_RANGE"); });
check("every attrs write exactly equals the document API", () => {
  equivalent(`<main id="old"/>`, (map) => map.at([]).asElement()!.attrs.set("title", "Hello"), (map) => map.document.attrs.set(target(0), "title", "Hello"));
  equivalent(`<main id="old"/>`, (map) => map.at([]).asElement()!.attrs.drop("id"), (map) => map.document.attrs.drop(target(0), "id"));
  equivalent(`<main id="old"/>`, (map) => map.at([]).asElement()!.attrs.setMany({ class: "ready" }), (map) => map.document.attrs.setMany(target(0), { class: "ready" }));
  equivalent(`<main id="old" title="Hello"/>`, (map) => map.at([]).asElement()!.attrs.dropMany(["id", "missing"]), (map) => map.document.attrs.dropMany(target(0), ["id", "missing"]));
  equivalent(`<main id="old"/>`, (map) => map.at([]).asElement()!.attrs.replace({ role: "main" }), (map) => map.document.attrs.replace(target(0), { role: "main" }));
  equivalent(`<main id="old"/>`, (map) => map.at([]).asElement()!.attrs.clear(), (map) => map.document.attrs.clear(target(0)));
});
check("proxy escape exposes the identical attrs capability", () => { const map = element(`<main <button/>/>`); assert.equal(map.proxy([0]).$_, map.at([0])); map.proxy([0]).$_.asElement()!.attrs.set("id", "submit"); assert.equal(map.at([0]).asElement()!.attrs.get("id"), "submit"); });
check("attrs commits restore without special cases", () => { const source = registry(`<main/>`); const receiver = registry(`<main/>`); source.lib("page").at([]).asElement()!.attrs.replace({ class: "ready", title: "Hello" }); receiver.restore(source.capture()); assert.deepEqual(receiver.lib("page").root(), source.lib("page").root()); });
check("Reflection consumes location attrs commits", () => { const map = element(`<main/>`); const binding = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), map); map.at([]).asElement()!.attrs.set("title", "Hello"); const main = binding.tree.node.$_content[0]; assert.equal(typeof main === "object" && main !== null ? main.$_attrs?.title : undefined, "Hello"); binding.dispose(); });
check("attrs never extend the logical coordinate", () => { const map = element(`<main <button/>/>`); const location = map.at([0]); const before = location.path(); location.asElement()!.attrs.set("id", "submit"); assert.deepEqual(location.path(), before); assert.equal(location, map.at([0])); });
check("attrs capability acquisition is frozen and non-minting", () => { const map = element(`<main/>`); const attrs = map.at([]).asElement()!.attrs; assert.equal(Object.isFrozen(attrs), true); assert.equal(JSON.stringify(map.root()).includes("quid"), false); assert.equal(map.rev, 0); });
check("attrs vocabulary has no synonyms or structural traversal", () => { const attrs = element(`<main/>`).at([]).asElement()!.attrs; assert.deepEqual(Object.keys(attrs).sort(), ["clear", "drop", "dropMany", "get", "has", "keys", "must", "replace", "set", "setMany"].sort()); assert.equal("delete" in attrs, false); assert.equal("at" in attrs, false); });

process.stdout.write(`# ${checks} document location attrs checks passed\n`);
testEvents.terminal("pass");
