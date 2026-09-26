// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_libraries } from "../src/internal/exact-runtime-node-admission.ts";
import type { LiveMapSnapshot } from "../src/types/livemap.types.ts";
import { install_libraries_snapshot } from "../src/api/livemap/index.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-install",
  title: "Registry document snapshot restoration",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "registry", "restore", "capture", "externally-discoverable"]),
});

const events = create_test_event_emitter("livemap.document-install");
let checks = 0;
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : String(error));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

const PageSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "item" content "string">>>`;
function registry(source: string) {
  return admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime(source, { allowTopLevelDocumentText: true }), schema: PageSchema },
  });
}
function text(map: ReturnType<typeof registry>): string {
  return map.render("page");
}

check("portable registry restore replaces document content and captured revision", () => {
  const source = registry('<main <item "new"/>/>');
  source.lib("page").at([0]).asElement()?.attrs.set("state", "ready");
  const target = registry('<main <item "old"/>/>');
  target.restore(source.capture());
  assert.equal(target.rev, source.rev);
  assert.match(text(target), /new/);
  assert.match(text(target), /state="ready"/);
});

check("one-library registries use the same capture shape as multi-library registries", () => {
  const capture = registry('<main <item "one"/>/>').capture();
  assert.equal(capture.libraries.length, 1);
  assert.equal(capture.libraries[0]?.name, "page");
});

check("a detached snapshot can be restored after serialization", () => {
  const source = registry('<main <item "portable"/>/>');
  const bytes = JSON.stringify(source.capture());
  const target = registry('<main <item "before"/>/>');
  target.restore(JSON.parse(bytes) as LiveMapSnapshot);
  assert.match(text(target), /portable/);
});

check("restoration is atomic on malformed snapshot metadata", () => {
  const target = registry('<main <item "before"/>/>');
  const before = target.capture();
  const invalid: LiveMapSnapshot = { ...before, registryDigest: "wrong" };
  assert.throws(() => target.restore(invalid));
  assert.deepEqual(target.capture(), before);
});

check("foreign registry Schema requires fresh installation", () => {
  const target = registry('<main <item "before"/>/>');
  const other = hsonLiveMap.fromLibraries({
    page: { document: '<main "other"/>', schema: Hson.schema`<type "document" tag "main" content "string">` },
  });
  const oldPage = target.lib("page");
  const before = target.capture();
  assert.throws(() => target.restore(other.capture()), /current Library topology/);
  assert.deepEqual(target.capture(), before);
  assert.equal(target.lib("page"), oldPage);
  const installed = install_libraries_snapshot(other.capture()).map;
  assert.deepEqual(installed.capture(), other.capture());
  assert.match(installed.render("page"), /other/);
});

check("portable capture excludes supplied runtime QUIDs", () => {
  const source = registry('<main @00000000a <item @00000000b "value"/>/>');
  const capture = source.capture();
  assert.equal(JSON.stringify(capture).includes('"quid"'), false);
  const target = registry('<main <item "before"/>/>');
  target.restore(capture);
  assert.equal(target.lib("page").document.byQuid("00000000a"), undefined);
  assert.equal(target.lib("page").document.byQuid("00000000b"), undefined);
});

check("restored state is detached from later source changes", () => {
  const source = registry('<main <item "value"/>/>');
  const target = registry('<main <item "before"/>/>');
  target.restore(source.capture());
  source.lib("page").at([0]).asElement()?.attrs.set("later", true);
  assert.doesNotMatch(text(target), /later/);
});

check("data libraries have no document snapshot method", () => {
  const map = hsonLiveMap.fromLibraries({ state: {
    data: { value: 1 }, schema: Hson.schema`<type "data" content <value "number">>`,
  } });
  assert.equal(Reflect.get(map.lib("state"), "install"), undefined);
  assert.equal(Reflect.get(map.lib("state"), "restore"), undefined);
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry restoration checks passed\n`);
