import assert from "node:assert/strict";

import { parse_hson } from "../../../src/api/transform/parsers/parse-hson.js";
import { formatting_target_is_current } from "../src/formatting-target.js";
import {
  StructuralDocumentEvidenceCache,
  structural_closer_for_less_than,
  structural_document_evidence,
  structural_formatting_edits,
  structural_newline_plan,
  structural_newline_plan_from_evidence,
  structural_regions,
} from "../src/structural-editing.js";

let checks = 0;
const check = (name: string, run: () => void): void => {
  run();
  console.log(`ok ${++checks} - ${name}`);
};
const prefix = 'import { Hson } from "hson-live/hson";\nconst value = Hson`';
const template = (body: string): string => prefix + body + "`;";
const closer = (markedBody: string): ">" | "/>" | undefined => {
  const cursor = markedBody.indexOf("|");
  const body = markedBody.replace("|", "");
  const before = template(body);
  const hostOffset = prefix.length + cursor;
  const after = before.slice(0, hostOffset) + "<" + before.slice(hostOffset);
  return structural_closer_for_less_than("/workspace/source.ts", "typescript", after, hostOffset + 1);
};
const applyEdits = (text: string, edits: readonly Readonly<{ start: number; end: number; text: string }>[]): string => {
  let result = text;
  for (const edit of [...edits].reverse()) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
};
const format = (text: string, insertSpaces = true, tabSize = 2): string => applyEdits(text,
  structural_formatting_edits("/workspace/source.ts", "typescript", text, { insertSpaces, tabSize }));

check("binding-recognized document context selects the element closer", () => assert.equal(closer("<main |/>"), "/>"));
check("an awaited host formatter cannot redirect the Hson phase to a newly focused editor", () => {
  const originalDocument = { isClosed: false };
  const originalEditor = { document: originalDocument };
  const otherEditor = { document: { isClosed: false } };
  assert.equal(formatting_target_is_current(originalEditor, originalDocument, originalEditor), true);
  assert.equal(formatting_target_is_current(originalEditor, originalDocument, otherEditor), false);
  originalDocument.isClosed = true;
  assert.equal(formatting_target_is_current(originalEditor, originalDocument, originalEditor), false);
});
check("binding-recognized data context selects the object closer", () => assert.equal(closer("<a true b |>"), ">"));
check("an empty template has no guessed structural mode", () => assert.equal(closer("|"), undefined));
check("nested document context retains document mode", () => assert.equal(closer("<main <section |/>/>"), "/>"));
check("strings and comments do not acquire structural completion", () => {
  assert.equal(closer('"text|"'), undefined);
  assert.equal(closer("<a true // comment | here\nb false>"), undefined);
});
check("a closer already belonging to the new construct is reused", () => assert.equal(closer("|/>"), undefined));
check("context is recomputed after surrounding edits", () => {
  assert.equal(closer("<main |/>"), "/>");
  assert.equal(closer("<a true b |>"), ">");
});
check("local Hson spellings and fromHson strings are outside structural regions", () => {
  assert.deepEqual(structural_regions("/workspace/a.ts", "typescript", 'const Hson=String.raw; Hson`<x/>`;'), []);
  assert.deepEqual(structural_regions("/workspace/a.ts", "typescript", 'import { hson } from "hson-live"; hson.liveMap.fromHson(`<x/>`);'), []);
});
check("interpolation expressions are protected", () => {
  const text = 'import { Hson } from "hson-live"; const x=1; const value=Hson`<a ${x}>`;';
  const region = structural_regions("/workspace/a.ts", "typescript", text)[0]!;
  assert.equal(region.protectedRanges.length, 1);
  const offset = text.indexOf("x}>" as string);
  const prospective = text.slice(0, offset) + "<" + text.slice(offset);
  assert.equal(structural_closer_for_less_than("/workspace/a.ts", "typescript", prospective, offset + 1), undefined);
});

check("document formatting repairs nesting without rewriting tokens", () => {
  const input = template('\n   <main\n<section\n       <p "hello"/>\n />\n      />\n');
  const expected = template('\n<main\n  <section\n    <p "hello"/>\n  />\n/>\n');
  assert.equal(format(input), expected);
  assert.equal(format(expected), expected);
});
check("data formatting follows object and array structure", () => {
  const input = template('\n <\nuser <\nname "Ada"\nitems [\n1,\n2\n]\n>\n>\n');
  const expected = template('\n<\n  user <\n    name "Ada"\n    items [\n      1,\n      2\n    ]\n  >\n>\n');
  assert.equal(format(input), expected);
});
check("object sibling indentation follows containers rather than member sequence", () => {
  const input = template('\n<data 1\n       data2 2\n data3 <\n           data4 4\n  data5 5\n >\n>\n');
  const expected = template('\n<\n  data 1\n  data2 2\n  data3 <\n    data4 4\n    data5 5\n  >\n>\n');
  assert.equal(format(input), expected);
});
check("multiline data objects move the first member below the opener and are idempotent", () => {
  const input = template("\n<data 1\n  data2 2\n  data3 3\n>\n");
  const expected = template("\n<\n  data 1\n  data2 2\n  data3 3\n>\n");
  assert.equal(format(input), expected);
  assert.equal(format(expected), expected);
});
check("single-line data objects and document element heads remain inline", () => {
  assert.equal(format(template("<data 1>")), template("<data 1>"));
  assert.equal(format(template("[\n1,\n2\n]")), template("[\n  1,\n  2\n]"));
  const document = template('\n<article class="note"\n  <h1 "Hello"/>\n  <p "Text"/>\n/>\n');
  assert.equal(format(document), document);
});
check("nested multiline objects move only their own first member", () => {
  const input = template("\n<data 1\n  nested <a 1\n    b 2\n  >\n>\n");
  const expected = template("\n<\n  data 1\n  nested <\n    a 1\n    b 2\n  >\n>\n");
  assert.equal(format(input), expected);
});
check("nested inline objects stay inline while multiline nested siblings normalize independently", () => {
  const inline = template("\n<data 1\n  nested <a 1>\n>\n");
  assert.equal(format(inline), template("\n<\n  data 1\n  nested <a 1>\n>\n"));
  const siblings = template("\n<left <  a 1\n b 2\n>\nright < c 3\n d 4\n>\n>\n");
  const expected = template("\n<\n  left <\n    a 1\n    b 2\n  >\n  right <\n    c 3\n    d 4\n  >\n>\n");
  assert.equal(format(siblings), expected);
});
check("balanced inline objects use the enclosing depth active at the line's first content", () => {
  const input = template("\n <\n a <\nb    <c   1>>\nd 2\n>\n");
  const expected = template("\n<\n  a <\n    b <c 1>\n  >\n  d 2\n>\n");
  const output = format(input);
  assert.equal(output, expected);
  assert.equal(format(output), output);
  assert.deepEqual(parse_hson(output.slice(prefix.length, -2)), parse_hson(input.slice(prefix.length, -2)));
});
check("later inline closers do not dedent earlier content and nested siblings stay aligned", () => {
  const input = template("\n<\na <\nb <c 1 d 2>\ne 3\n>\nf 4\n>\n");
  const expected = template("\n<\n  a <\n    b <c 1 d 2>\n    e 3\n  >\n  f 4\n>\n");
  assert.equal(format(input), expected);
});
check("multiple trailing closers update the depth only for following lines", () => {
  const input = template("\n<\na <\nb <c <d 1>>>\nf 4\n>\n");
  const expected = template("\n<\n  a <\n    b <c <d 1>>\n  >\n  f 4\n>\n");
  assert.equal(format(input), expected);
});
check("each parser-owned multiline object closer receives its own structural line", () => {
  const input = template("\n<\n  a <\n    b <\n      c <\n        value 1>>>\n  d 2\n>\n");
  const expected = template("\n<\n  a <\n    b <\n      c <\n        value 1\n      >\n    >\n  >\n  d 2\n>\n");
  const output = format(input);
  assert.equal(output, expected);
  assert.equal(format(output), output);
  assert.deepEqual(parse_hson(output.slice(prefix.length, -2)), parse_hson(input.slice(prefix.length, -2)));
});
check("single-line nested objects stay compact while multiline owners detach only their closers", () => {
  const input = template('\n<\n  data <no "way" jose "!">\n  nested <\n    no "way" jose "!">>\n');
  const expected = template('\n<\n  data <no "way" jose "!">\n  nested <\n    no "way" jose "!"\n  >\n>\n');
  assert.equal(format(input), expected);
});
check("a leading closer still dedents at its own token position", () => {
  const input = template("\n<\na <\nb 1\n>\nc 2\n>\n");
  const expected = template("\n<\n  a <\n    b 1\n  >\n  c 2\n>\n");
  assert.equal(format(input), expected);
});
check("safe comments are preserved and an opening-line comment conservatively skips layout", () => {
  const safe = template("\n<a 1\n// retained between members\nb 2\n>\n");
  assert.equal(format(safe), template("\n<\n  a 1\n  // retained between members\n  b 2\n>\n"));
  const ambiguous = template("\n<a 1 // remains attached on the opening line\nb 2\n>\n");
  assert.equal(format(ambiguous), template("\n<a 1 // remains attached on the opening line\n  b 2\n>\n"));
});
check("layout preserves the parser's canonical Hson value", () => {
  const source = "<data 1\n  nested <  a \"kept\"\n    b [1, 2]\n  >\n  tail false\n>";
  const formattedHost = format(template(source));
  const formatted = formattedHost.slice(prefix.length, -2);
  assert.deepEqual(parse_hson(formatted), parse_hson(source));
});
check("layout preserves the authored line-ending convention", () => {
  const input = template("\r\n<data 1\r\ndata2 2\r\n>\r\n");
  assert.equal(format(input), template("\r\n<\r\n  data 1\r\n  data2 2\r\n>\r\n"));
});
check("tabs and tab size are honored", () => {
  const input = template('\n<main\n<section\n<p/>\n/>\n/>\n');
  assert.ok(format(input, false, 8).includes("\n\t<section\n\t\t<p/>"));
  assert.ok(format(input, true, 4).includes("\n    <section\n        <p/>"));
});
check("comments, strings, escapes, and member order remain byte-stable", () => {
  const input = template('\n<\nsecond "a\\n\\\"b"\n// retained exactly\nfirst true\n>\n');
  const output = format(input);
  assert.ok(output.includes('second "a\\n\\\"b"'));
  assert.ok(output.includes("// retained exactly"));
  assert.ok(output.indexOf("second") < output.indexOf("first"));
});
check("multiple templates format while unrelated host and template text stay untouched", () => {
  const input = 'import { Hson } from "hson-live";\nconst ordinary=`  untouched`;\nconst a=Hson`\n <a\n<b/>\n/>\n`;\nconst host =  1;\nconst b=Hson`\n <\nx true\n>\n`;';
  const output = format(input);
  assert.ok(output.includes("ordinary=`  untouched`"));
  assert.ok(output.includes("const host =  1;"));
  assert.ok(output.includes("\n<a\n  <b/>\n/>"));
  assert.ok(output.includes("\n<\n  x true\n>"));
});
check("invalid Hson regions are skipped without preventing safe sibling formatting", () => {
  const input = 'import { Hson } from "hson-live";\nconst invalid=Hson`\n <data 1\n<data2 2>\n>\n`;\nconst valid=Hson`\n <data 1\ndata2 2\n>\n`;';
  const output = format(input);
  assert.ok(output.includes('invalid=Hson`\n <data 1\n<data2 2>\n>\n`'));
  assert.ok(output.includes('valid=Hson`\n<\n  data 1\n  data2 2\n>\n`'));
});
check("fromHson literals remain untouched by formatting", () => {
  const input = 'import { hson } from "hson-live";\nhson.fromHson(`\n <data 1\ndata2 2\n>\n`);';
  assert.equal(format(input), input);
});
check("horizontal token trivia follows canonical Hson adjacency without touching lexical content", () => {
  const input = template('<p       class  =  "x  y" enabled\t\t"a  b"\t\t""   ""   />');
  const expected = template('<p class="x  y" enabled "a  b" "" ""/>');
  assert.equal(format(input), expected);
  assert.equal(format(expected), expected);

  const namesAndArrays = template("<   'quoted name\\'s'    [  1  ,\t2   ,  \"three  spaces\"  ]   >");
  const normalized = template("<'quoted name\\'s' [1,2,\"three  spaces\"]>");
  assert.equal(format(namesAndArrays), normalized);
  assert.deepEqual(parse_hson(normalized.slice(prefix.length, -2)), parse_hson(namesAndArrays.slice(prefix.length, -2)));
});
check("horizontal normalization preserves comments and vertical trivia", () => {
  const input = template('\n<main\n  <h1    "Deck"\n\n\n  />\n\n  <p   "Deck is running."   />\n  // comment   content remains exact\n/>\n');
  const expected = template('\n<main\n  <h1 "Deck"\n\n\n  />\n\n  <p "Deck is running."/>\n  // comment   content remains exact\n/>\n');
  assert.equal(format(input), expected);
  assert.ok(format(input).includes('comment   content remains exact'));
});
check("range formatting applies object layout only when the selection includes the object", () => {
  const input = template("\n<data 1\ndata2 2\n>\n");
  const objectStart = input.indexOf("<data");
  const objectEnd = input.indexOf(">", objectStart) + 1;
  const output = applyEdits(input, structural_formatting_edits("/workspace/source.ts", "typescript", input,
    { insertSpaces: true, tabSize: 2 }, { start: objectStart, end: objectEnd }));
  assert.equal(output, template("\n<\n  data 1\n  data2 2\n>\n"));
});
check("range formatting changes only intersecting Hson regions", () => {
  const input = 'import { Hson } from "hson-live";\nconst a=Hson`\n <a\n<b/>\n/>\n`;\nconst b=Hson`\n <b\n<c/>\n/>\n`;';
  const firstStart = input.indexOf("<a");
  const firstEnd = input.indexOf("`;", firstStart);
  const output = applyEdits(input, structural_formatting_edits("/workspace/source.ts", "typescript", input,
    { insertSpaces: true, tabSize: 2 }, { start: firstStart, end: firstEnd }));
  assert.ok(output.includes("\n<a\n  <b/>\n/>"));
  assert.ok(output.includes("\n <b\n<c/>\n/>"));
});
check("newline between a pair creates an inner line and dedented closer", () => {
  const text = template("<main/>");
  const offset = text.indexOf("/>");
  assert.deepEqual(structural_newline_plan("/workspace/a.ts", "typescript", text, offset, { insertSpaces: true, tabSize: 2 }, "\n"), {
    beforeCursor: "\n  ", afterCursor: "\n",
  });
  const objectText = template("<data 1 child <>>");
  const objectOffset = objectText.indexOf(">", objectText.indexOf("child <"));
  assert.deepEqual(structural_newline_plan("/workspace/a.ts", "typescript", objectText, objectOffset,
    { insertSpaces: true, tabSize: 2 }, "\n"), {
    beforeCursor: "\n    ", afterCursor: "\n  ",
  });
});
check("smart newline fails closed for invalid and non-structural cursor contexts", () => {
  const plan = (body: string, marker: string): ReturnType<typeof structural_newline_plan> => {
    const text = template(body);
    const offset = text.indexOf(marker) + marker.indexOf("|");
    return structural_newline_plan("/workspace/a.ts", "typescript", text.replace("|", ""), offset,
      { insertSpaces: true, tabSize: 2 }, "\n");
  };
  assert.equal(plan("<data 1|", "|"), undefined);
  assert.equal(plan("<data 1\n  <data2 2|>\n>", "2|"), undefined);
  assert.equal(plan('<a "bad\\q"|>', "|"), undefined);
  assert.equal(plan('<a "te|xt">', "te|"), undefined);
  assert.equal(plan("<a 1 // no|te\nb 2>", "no|"), undefined);
  const interpolated = 'import { Hson } from "hson-live"; const value=1; const x=Hson`<a ${val|ue}>`;';
  const interpolationOffset = interpolated.indexOf("|");
  assert.equal(structural_newline_plan("/workspace/a.ts", "typescript", interpolated.replace("|", ""), interpolationOffset,
    { insertSpaces: true, tabSize: 2 }, "\n"), undefined);
});

check("canonical Markdown fences use the same formatter and auto-close authority", () => {
  const input = "Before\n```hson\n <main\n<section\n/>\n />\n```\nAfter\n```json\n  untouched\n```";
  const output = applyEdits(input, structural_formatting_edits("/workspace/readme.md", "markdown", input, { insertSpaces: true, tabSize: 2 }));
  assert.equal(output, "Before\n```hson\n<main\n  <section\n  />\n/>\n```\nAfter\n```json\n  untouched\n```");
  const marked = "```hson\n<main |/>\n```";
  const cursor = marked.indexOf("|");
  const clean = marked.replace("|", "");
  const prospective = clean.slice(0, cursor) + "<" + clean.slice(cursor);
  assert.equal(structural_closer_for_less_than("/workspace/readme.md", "markdown", prospective, cursor + 1), "/>");
});
check("canonical Markdown hson fences use the multiline object layout", () => {
  const input = "```hson\n<data 1\ndata2 2\n>\n```";
  const output = applyEdits(input, structural_formatting_edits("/workspace/readme.md", "markdown", input, { insertSpaces: true, tabSize: 2 }));
  assert.equal(output, "```hson\n<\n  data 1\n  data2 2\n>\n```");
});
check("Markdown structural regions share delimiter kind and width lifetime with highlighting", () => {
  const cases = [
    ["````hson\n```\n<x/>\n`````\nAfter", "<x/>", "After"],
    ["~~~~hson\n```\n<x/>\n~~~~\nAfter", "<x/>", "After"],
    ["```hson\n~~~~\n<x/>\n````\nAfter", "<x/>", "After"],
  ] as const;
  for (const [text, bodyToken, afterToken] of cases) {
    const region = structural_regions("/workspace/readme.md", "markdown", text)[0]!;
    assert.ok(text.indexOf(bodyToken) >= region.bodyRange.start && text.indexOf(bodyToken) < region.bodyRange.end);
    assert.ok(text.indexOf(afterToken) >= region.bodyRange.end);
  }
});
check("non-Hson Markdown fences remain visual-only and untouched", () => {
  const text = "```Hson\n <x/>\n```\n```hson-extra\n <y/>\n```";
  assert.deepEqual(structural_regions("/workspace/readme.md", "markdown", text), []);
  assert.deepEqual(structural_formatting_edits("/workspace/readme.md", "markdown", text, { insertSpaces: true, tabSize: 2 }), []);
});

check("unchanged large-document position queries reuse bounded binding evidence and edits invalidate it", () => {
  let analyses = 0;
  const cache = new StructuralDocumentEvidenceCache(2, (fileName, languageId, text) => {
    analyses += 1;
    return structural_document_evidence(fileName, languageId, text);
  });
  const filler = Array.from({ length: 10_000 }, (_, index) => `const filler${index} = ${index};`).join("\n");
  const text = `import { Hson } from "hson-live";\n${filler}\nconst value = Hson\`<main/>\`;`;
  const offset = text.indexOf("/>", text.indexOf("Hson`"));
  const evidence = cache.get("file:///large.ts", 1, "/workspace/large.ts", "typescript", text);
  for (let index = 0; index < 100; index += 1) {
    const reused = cache.get("file:///large.ts", 1, "/workspace/large.ts", "typescript", text);
    assert.equal(reused, evidence);
    structural_newline_plan_from_evidence(reused, offset, { insertSpaces: true, tabSize: 2 }, "\n");
  }
  assert.equal(analyses, 1);
  const edited = text.replace("<main/>", "<main><child/></>");
  cache.get("file:///large.ts", 2, "/workspace/large.ts", "typescript", edited);
  assert.equal(analyses, 2);
  cache.invalidate("file:///large.ts");
  cache.get("file:///large.ts", 2, "/workspace/large.ts", "typescript", edited);
  assert.equal(analyses, 3);
  cache.clear();
  cache.get("file:///large.ts", 2, "/workspace/large.ts", "typescript", edited);
  assert.equal(analyses, 4);
});
