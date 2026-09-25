// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, DocumentSsrError, encode_ssr_bootstrap, hsonLiveMap, render_document } from "../src/index.ts";
import { set_document_ssr_hook_for_tests } from "../src/api/ssr/ssr.ts";

const PageSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "p" attrs <props <data-cut <optional "string">>> content "string">]>>`;
const pageMap = () => hsonLiveMap.fromLibraries({ page: { document: `<main <p "before"/>/>`, schema: PageSchema } });
const paragraph = { kind: "path" as const, path: [0, 0, 0] };

{
  const map = pageMap();
  set_document_ssr_hook_for_tests((point) => {
    if (point === "local-libraries-after-capture") {
      map.lib("page").document.attrs.set(paragraph, "data-cut", "after");
    }
  });
  const result = render_document({ map });
  set_document_ssr_hook_for_tests(undefined);
  assert.equal(result.bootstrap.revision, 0);
  assert.equal(map.rev, 1);
  assert.doesNotMatch(result.html, /data-cut/);
  assert.match(render_document({ map }).html, /data-cut="after"/);
}

{
  const map = pageMap();
  const first = render_document({ map });
  const second = render_document({ map });
  assert.equal(first.html, second.html);
  assert.deepEqual(first.bootstrap, second.bootstrap);
  assert.equal(first.html, map.render());
  assert.equal(first.document, "page");
  assert.equal(first.bootstrap.revision, 0);
  assert.equal(typeof encode_ssr_bootstrap(first.bootstrap), "string");
  assert.equal("cut" in map, false);
}

{
  const FullSchema = Hson.schema`<type "document" tag "html" content <sequence [<tag "head" content "empty">, <tag "body" content <sequence [<tag "main" content "string">]>>]>>`;
  const full = hsonLiveMap.fromLibraries({ page: { document: `<html <head/> <body <main "whole"/>/>/>`, schema: FullSchema } });
  assert.match(full.render(), /^<!doctype html><html>/);
  assert.equal(pageMap().render().startsWith("<!doctype"), false);
}

{
  const IncompatibleSchema = Hson.schema`<type "document" tag "p" content <sequence [<tag "div" content "string">]>>`;
  const map = hsonLiveMap.fromLibraries({ page: { document: `<p <div "direct DOM only"/>/>`, schema: IncompatibleSchema } });
  const before = map.capture();
  assert.throws(() => render_document({ map }), (cause) => cause instanceof DocumentSsrError && cause.phase === "realize");
  assert.deepEqual(map.capture(), before);
  assert.equal(map.rev, 0);
}

assert.throws(() => render_document(null as unknown as Readonly<{ map: ReturnType<typeof pageMap> }>), TypeError);
process.stdout.write("Document SSR acceptance passed.\n");
