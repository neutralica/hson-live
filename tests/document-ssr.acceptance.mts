// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, DocumentSsrError, encode_ssr_bootstrap, hsonLiveMap } from "../src/index.ts";

const PageSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "p" attrs <props <data-cut <optional "string">>> content "string">]>>`;
const pageMap = () => hsonLiveMap.fromLibraries({ page: { document: `<main <p "before"/>/>`, schema: PageSchema } });
const paragraph = { kind: "path" as const, path: [0, 0, 0] };

{
  const map = pageMap();
  const result = map.cut({ html: "page" });
  map.lib("page").document.attrs.set(paragraph, "data-cut", "after");
  assert.equal(result.libs.revision, 0);
  assert.equal(map.rev, 1);
  assert.doesNotMatch(result.html, /data-cut/);
  assert.match(map.cut({ html: "page" }).html, /data-cut="after"/);
}

{
  const map = pageMap();
  const first = map.cut({ html: "page" });
  const second = map.cut({ html: "page" });
  assert.equal(first.html, second.html);
  assert.deepEqual(first.libs, second.libs);
  assert.equal(first.html, map.lib("page").render());
  assert.equal(first.document, "page");
  assert.equal(first.libs.revision, 0);
  assert.equal(typeof encode_ssr_bootstrap(first.libs), "string");
}

{
  const FullSchema = Hson.schema`<type "document" tag "html" content <sequence [<tag "head" content "empty">, <tag "body" content <sequence [<tag "main" content "string">]>>]>>`;
  const full = hsonLiveMap.fromLibraries({ page: { document: `<html <head/> <body <main "whole"/>/>/>`, schema: FullSchema } });
  assert.match(full.lib("page").render(), /^<!doctype html><html>/);
  assert.equal(pageMap().lib("page").render().startsWith("<!doctype"), false);
}

{
  const IncompatibleSchema = Hson.schema`<type "document" tag "p" content <sequence [<tag "div" content "string">]>>`;
  const map = hsonLiveMap.fromLibraries({ page: { document: `<p <div "direct DOM only"/>/>`, schema: IncompatibleSchema } });
  const before = map.capture();
  assert.throws(() => map.lib("page").render(), (cause) => cause instanceof DocumentSsrError && cause.phase === "realize");
  assert.deepEqual(map.capture(), before);
  assert.equal(map.rev, 0);
}

process.stdout.write("Document SSR acceptance passed.\n");
