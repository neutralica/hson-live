import assert from "node:assert/strict";
import { resolve } from "node:path";
import { load_hson_grammar } from "../src/highlighting.js";
import { AppearanceSpanCache, appearanceColor, type AppearanceRole } from "../src/appearance-spans.js";

async function run() {
  const grammar = await load_hson_grammar(resolve(__dirname, ".."));
  const cache = new AppearanceSpanCache();
  const body = '<p data:input="%{input}" title="attribute 😀"\r\n "content text ^{input}" <hson-part at="library/member"/>/>';
  for (const [languageId, fileName, text] of [
    ["hson", "/appearance.hson", body],
    ["markdown", "/appearance.md", '# Outside "native"\r\n```hson\r\n' + body + '\r\n```'],
    ["typescript", "/appearance.ts", 'import { Hson } from "hson-live/hson";\r\nHson.document`' + body + '`;'],
    ["typescriptreact", "/appearance.tsx", 'import { Hson } from "hson-live/hson";\r\nHson.document`' + body + '`;'],
  ]) {
    const document = { uri: fileName!, fileName: fileName!, languageId: languageId!, version: 1, text: text! };
    const spans = cache.get(grammar, document);
    const at = (needle: string) => spans.find(span => span.range.start <= text!.indexOf(needle) && span.range.end > text!.indexOf(needle));
    for (const [needle, role] of [["attribute 😀", "attributeString"], ["content text", "contentString"],
      ['"attribute', "attributeQuotes"], ['"content', "contentQuotes"]]) assert.equal(at(needle!)?.role, role, languageId);
    for (const needle of ["data:input", "%{input}", "^{input}", "library/member", "<p", "/>"])
      assert.equal(at(needle), undefined, "other owner: " + needle);
    assert.equal(cache.get(grammar, document), spans, "color-only reuse");
    const edited = { ...document, version: 2, text: text!.replace('title="attribute 😀"', 'title=^{input}') };
    const changed = cache.get(grammar, edited);
    assert.notEqual(changed, spans, "source edits invalidate");
    assert.ok(!changed.some(span => span.role === "attributeString"));
    for (const span of spans) assert.ok(!/[\r\n]/.test(text!.slice(span.range.start, span.range.end)), "physical UTF-16 ranges");
  }
  const text = 'import { Hson, hson } from "hson-live"; const native = "outside";\n'
    + 'Hson.document`<p title="before ${native.toUpperCase()} after" "text ${native}"/>`;\n'
    + 'hson.fromHson("<p title=\\"mapped\\" \\"cooked\\"/>");';
  const document = { uri: "/mapped.ts", fileName: "/mapped.ts", languageId: "typescript", version: 1, text };
  const spans = cache.get(grammar, document);
  for (const match of text.matchAll(/\$\{[^}]*\}/g)) assert.ok(!spans.some(span => span.range.start < match.index + match[0].length && span.range.end > match.index), "native hole is wholly excluded");
  for (const [needle, role] of [["before ", "attributeString"], [" after", "attributeString"], ["mapped", "attributeString"], ["cooked", "contentString"]] satisfies [string, AppearanceRole][])
    assert.ok(spans.some(span => span.range.start === text.indexOf(needle) && span.role === role), needle);
  assert.ok(!spans.some(span => span.range.start <= text.indexOf("outside") && span.range.end > text.indexOf("outside")));
  const shadow = 'const Hson = { document: String.raw }; Hson.document`<p title="native" "native"/>`;';
  assert.equal(cache.get(grammar, { ...document, version: 2, text: shadow }).length, 0, "unrecognized host tag stays native");
  for (const value of ["#000", "#0000", "#101820", "#10182000", "#ffffff"]) assert.ok(appearanceColor(value));
  for (const value of ["red", "#12345", "", 1, null]) assert.equal(appearanceColor(value), undefined);
  console.log("ok - four contextual appearance roles, native/binding ownership, mapped UTF-16 ranges, source invalidation and unrestricted color values");
}
void run();
