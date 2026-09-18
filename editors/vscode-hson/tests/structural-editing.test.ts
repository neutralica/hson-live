import assert from "node:assert/strict";

import {
  structural_closer_for_less_than,
  structural_formatting_edits,
  structural_newline_plan,
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
  const expected = template('\n<data 1\n  data2 2\n  data3 <\n    data4 4\n    data5 5\n  >\n>\n');
  assert.equal(format(input), expected);
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
  assert.ok(output.includes('valid=Hson`\n<data 1\n  data2 2\n>\n`'));
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
check("non-Hson Markdown fences remain visual-only and untouched", () => {
  const text = "```Hson\n <x/>\n```\n```hson-extra\n <y/>\n```";
  assert.deepEqual(structural_regions("/workspace/readme.md", "markdown", text), []);
  assert.deepEqual(structural_formatting_edits("/workspace/readme.md", "markdown", text, { insertSpaces: true, tabSize: 2 }), []);
});
