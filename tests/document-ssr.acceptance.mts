// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, DocumentSsrError, encode_ssr_bootstrap, hsonLiveMap } from "../src/index.ts";
import { install_libraries_snapshot } from "../src/api/livemap/index.ts";

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
  const map = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body/>/>' } });
  const page = map.lib("page");
  page.css.sel("body").set.color("blue");
  const captured = map.cut().libs;
  const capturedHtml = page.render();
  const encode = TextEncoder.prototype.encode;
  let mutated = false;
  // The existing aggregate-bound check runs on detached libs after capture and
  // immediately before HTML realization. No production hook is needed.
  TextEncoder.prototype.encode = function (input) {
    if (!mutated && input?.startsWith('{"format":"hson-livemap-libraries-snapshot"')) {
      assert.deepEqual(JSON.parse(input), captured);
      mutated = true;
      TextEncoder.prototype.encode = encode;
      page.at([]).at([1]).asElement()!.attrs.set("data-cut", "after");
      page.css.sel("body").set.color("red");
    }
    return encode.call(this, input);
  };
  try {
    const result = map.cut({ html: "page" });
    assert.equal(mutated, true, "Source mutation must occur between capture and realization.");
    assert.deepEqual(result.libs, captured);
    assert.equal(result.html, capturedHtml);
    const installed = install_libraries_snapshot(result.libs).map.lib("page");
    if (installed.mode !== "document") throw new Error("Expected selected document.");
    assert.equal(installed.render(), result.html);
    assert.doesNotMatch(result.html, /data-cut|color:red/);
    assert.match(result.html, /color:blue/);
    assert.match(page.render(), /data-cut="after"/);
    assert.match(page.render(), /color:red/);
    assert.equal(map.rev, captured.revision + 2);
  } finally {
    TextEncoder.prototype.encode = encode;
  }
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
