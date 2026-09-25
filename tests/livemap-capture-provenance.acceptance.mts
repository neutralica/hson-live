// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson } from "../src/index.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_libraries } from "../src/internal/exact-runtime-node-admission.ts";
import { acquire_document_identity } from "./helpers/livemap-identity-internal.mts";
import type { LiveMapSnapshot } from "../src/types/livemap.types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.capture-provenance",
  title: "Portable registry capture provenance",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["capture", "restore", "identity", "registry", "externally-discoverable"]),
});

const events = create_test_event_emitter("livemap.capture-provenance");
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

const PageSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "item" content "empty">>>`;
function registry(source: string) {
  return admit_exact_runtime_livemap_libraries({ page: {
    document: parse_hson_exact_runtime(source, { allowTopLevelDocumentText: true }), schema: PageSchema,
  } });
}
const rootTarget = { kind: "path" as const, path: [0] };

check("ordinary capture carries the complete named registry and no local proof", () => {
  const source = registry('<main <item/>/>');
  const snapshot = source.capture();
  assert.equal(snapshot.libraries[0]?.name, "page");
  assert.equal(Reflect.get(snapshot, "identity"), undefined);
  assert.equal(JSON.stringify(snapshot).includes("issuedQuids"), false);
});

check("portable capture omits supplied and acquired QUID metadata", () => {
  const source = registry('<main @000000111 <item @000000112/>/>');
  acquire_document_identity(source.lib("page").document, rootTarget);
  const bytes = JSON.stringify(source.capture());
  assert.equal(bytes.includes('"quid"'), false);
  assert.equal(source.lib("page").document.byQuid("000000111")?.$_tag, "main");
});

check("structured cloning does not confer local identity authority", () => {
  const source = registry('<main @000000113 <item/>/>');
  const target = registry('<main <item/>/>');
  target.restore(structuredClone(source.capture()));
  assert.equal(target.lib("page").document.byQuid("000000113"), undefined);
  assert.equal(target.render(), source.render());
});

check("JSON serialization retains portable state but no runtime epoch", () => {
  const source = registry('<main <item/>/>');
  source.lib("page").at([]).asElement()!.attrs.set("state", "ready");
  const snapshot = JSON.parse(JSON.stringify(source.capture())) as LiveMapSnapshot;
  const target = registry('<main <item/>/>');
  target.restore(snapshot);
  assert.equal(target.rev, source.rev);
  assert.match(target.render(), /state="ready"/);
});

check("capture graph is detached from later source mutations", () => {
  const source = registry('<main <item/>/>');
  const snapshot = source.capture();
  source.lib("page").at([]).asElement()!.attrs.set("later", true);
  const target = registry('<main <item/>/>');
  target.restore(snapshot);
  assert.doesNotMatch(target.render(), /later/);
});

check("malformed portable capture rejects atomically", () => {
  const target = registry('<main <item/>/>');
  const before = target.capture();
  const invalid: LiveMapSnapshot = { ...before, registryDigest: "forged" };
  assert.throws(() => target.restore(invalid));
  assert.deepEqual(target.capture(), before);
});

check("portable restore retires prior local identity handles", () => {
  const target = registry('<main <item/>/>');
  const handle = acquire_document_identity(target.lib("page").document, rootTarget);
  const source = registry('<main <item/>/>');
  target.restore(source.capture());
  assert.equal(handle.active, false);
});

check("independent registries can restore equal portable bytes", () => {
  const source = registry('<main <item/>/>');
  const bytes = JSON.stringify(source.capture());
  const left = registry('<main <item/>/>');
  const right = registry('<main <item/>/>');
  left.restore(JSON.parse(bytes) as LiveMapSnapshot);
  right.restore(JSON.parse(bytes) as LiveMapSnapshot);
  assert.equal(left.render(), right.render());
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry capture provenance checks passed\n`);
