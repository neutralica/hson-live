// @hson-live-external-test
import assert from "node:assert/strict";
import {
  DocumentSsrError,
  encode_ssr_bootstrap,
  hsonLiveMap,
  render_document,
  type DocumentLiveMap,
} from "../src/index.ts";
import { set_document_ssr_hook_for_tests } from "../src/api/ssr/ssr.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_node } from "../src/internal/exact-runtime-node-admission.ts";

const target = (...parts: number[]) => Object.freeze({
  kind: "path" as const,
  path: Object.freeze([0, ...parts]),
});

function document_map(source: string): DocumentLiveMap {
  const map = admit_exact_runtime_livemap_node(parse_hson_exact_runtime(source, { allowTopLevelDocumentText: true }));
  if (map.mode !== "document") throw new Error("Expected a document map.");
  return map;
}

{
  const map = document_map(`<main <p @000005001 "before"/>/>`);
  let captures = 0;
  const counted: DocumentLiveMap = Object.freeze({
    ...map,
    capture: (): ReturnType<DocumentLiveMap["capture"]> => {
      captures += 1;
      return map.capture();
    },
  });
  set_document_ssr_hook_for_tests((point) => {
    if (point === "local-after-capture") {
      map.document.attrs.set(target(0, 0), "data-cut", "after");
    }
  });
  const result = render_document({ map: counted });
  set_document_ssr_hook_for_tests(undefined);
  assert.equal(captures, 1);
  assert.equal(result.bootstrap.rev, 0);
  assert.equal(map.rev, 1);
  assert.doesNotMatch(result.html, /data-cut/);
  assert.doesNotMatch(result.html, /hson:quid|000005001/);
  assert.deepEqual(result.bootstrap, document_map(`<main <p @000005001 "before"/>/>`).capture({ identity: "strip" }));
}

{
  const map = document_map(`<main "old"/>`);
  const before = render_document({ map });
  map.document.attrs.set(target(), "data-version", "new");
  const after = render_document({ map });
  assert.equal(before.bootstrap.rev, 0);
  assert.equal(after.bootstrap.rev, 1);
  assert.doesNotMatch(before.html, /data-version/);
  assert.match(after.html, /data-version="new"/);
}

for (const source of [
  `<main <p "a" "" "b"/>/>`,
  `<main <p @000005002 "quid"/>/>`,
  `<main <p "no quid"/>/>`,
  `<html <head <title "Page"/>/> <body <main "whole"/>/>/>`,
]) {
  const map = document_map(source);
  const first = render_document({ map });
  const second = render_document({ map });
  assert.equal(first.html, second.html);
  assert.deepEqual(first.bootstrap, second.bootstrap);
  assert.equal(map.rev, 0);
}

{
  const paired = render_document({ map: document_map(`<main <p "a" "" "b"/>/>`) });
  assert.match(paired.html, /hson-boundary:v1:/);
  assert.equal(JSON.stringify(paired.bootstrap).includes("hson-boundary"), false);
  const identityClaimed = render_document({ map: document_map(`<main @000005099 <p @000005100 "a" "" "b"/>/>`) });
  assert.equal(identityClaimed.html, paired.html);
  assert.doesNotMatch(identityClaimed.html, /hson:quid|000005099|000005100/);
  assert.doesNotMatch(JSON.stringify(identityClaimed.bootstrap), /000005099|000005100|"quid"/);
}

{
  const full = render_document({ map: document_map(`<html <head/> <body <main "whole"/>/>/>`) });
  assert.match(full.html, /^<!doctype html><html>/);
  assert.equal(full.bootstrap.root.$_content.some((item) => typeof item === "string" && /doctype/i.test(item)), false);
  const application = render_document({ map: document_map(`<main "application"/>`) });
  assert.equal(application.html.startsWith("<!doctype"), false);
}

{
  const map = document_map(`<p <div "direct DOM only"/>/>`);
  const before = map.capture();
  assert.throws(
    () => render_document({ map }),
    (cause) => cause instanceof DocumentSsrError
      && cause.phase === "realize"
      && cause.cause instanceof Error
      && cause.cause.name === "BrowserRealizationIncompatibilityError"
      && /canonical path/i.test(`${cause.cause.message} canonical path`),
  );
  assert.deepEqual(map.capture(), before);
  assert.equal(map.rev, 0);
}

const emptyDocument = hsonLiveMap.fromHson("");
if (emptyDocument.mode !== "document") throw new Error("Expected an empty document map.");
for (const map of [emptyDocument, document_map(`<main/> <aside/>`)]) {
  assert.throws(
    () => render_document({ map }),
    (cause) => cause instanceof DocumentSsrError
      && cause.phase === "realize"
      && cause.cause instanceof Error
      && /exactly one ordinary canonical document root/.test(cause.cause.message),
  );
}

{
  const map = document_map(`<main "capture failure"/>`);
  const failing: DocumentLiveMap = Object.freeze({
    ...map,
    capture: (): never => { throw new Error("capture-fault"); },
  });
  assert.throws(
    () => render_document({ map: failing }),
    (cause) => cause instanceof DocumentSsrError
      && cause.phase === "capture"
      && cause.cause instanceof Error
      && cause.cause.message === "capture-fault",
  );
}

assert.throws(
  () => render_document(null as unknown as Readonly<{ map: DocumentLiveMap }>),
  TypeError,
);

{
  const map = document_map(`<main <p @000005401 "before"/>/>`);
  assert.equal("cut" in map, false);
  const rendered = render_document({ map });
  assert.deepEqual(Object.keys(rendered).sort(), ["bootstrap", "html"]);
  assert.equal(rendered.bootstrap.rev, 0);
  assert.deepEqual(rendered.bootstrap, map.capture({ identity: "strip" }));
  assert.doesNotMatch(JSON.stringify(rendered), /000005401|hson:quid|"quid"/);
  const encoded = encode_ssr_bootstrap(rendered.bootstrap);
  assert.equal(typeof encoded, "string");
  map.document.attrs.set(target(0, 0), "data-cut", "after");
  assert.equal(map.rev, 1);
  assert.doesNotMatch(rendered.html, /data-cut/);
  assert.match(render_document({ map }).html, /data-cut="after"/);
}

process.stdout.write("Document SSR acceptance passed.\n");
