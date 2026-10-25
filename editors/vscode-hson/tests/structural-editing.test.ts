import assert from "node:assert/strict";

import { parse_hson } from "../../../src/api/transform/parsers/parse-hson.js";
import { parse_authored_document_library } from "../../../src/api/livemap/livemap.document.quad.js";
import { hsonLiveMap } from "../../../src/api/livemap/livemap.public.js";
import { formatting_target_is_current } from "../src/formatting-target.js";
import {
  StructuralDocumentEvidenceCache,
  structural_array_pair_for_bracket,
  structural_closer_for_less_than,
  structural_document_evidence,
  structural_formatting_edits,
  structural_newline_plan,
  structural_newline_plan_from_evidence,
  structural_regions,
  structural_region_at_evidence,
  structural_typing_snippet,
} from "../src/structural-editing.js";

let checks = 0;
const check = (name: string, run: () => void): void => {
  run();
  console.log(`ok ${++checks} - ${name}`);
};
const prefix = 'import { Hson } from "hson-live/hson";\nconst value = Hson.canonical`';
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
const arrayPair = (marked: string, language: "typescript" | "markdown" = "typescript"): boolean => {
  const offset = marked.indexOf("|");
  const text = marked.slice(0, offset) + marked.slice(offset + 1);
  return structural_array_pair_for_bracket(language === "markdown" ? "/workspace/readme.md" : "/workspace/source.ts", language, text, offset);
};


const typingSnippet = (marked: string, typed: "=" | "{"): string | undefined => {
  const cursor = marked.indexOf("|");
  const text = marked.slice(0, cursor) + marked.slice(cursor + 1);
  return structural_typing_snippet(structural_document_evidence("/workspace/source.ts", "typescript", text), cursor, typed);
};
const authored = (body: string, kind = "document"): string => prefix.replace("Hson.canonical", `Hson.${kind}`) + body + "`;";

const assertTypingResult = (marked: string, typed: "=" | "{", expected: string): void => {
  const snippet = typingSnippet(marked, typed);
  assert.equal(snippet, expected, marked);
  assert.ok(snippet !== undefined);
  const offset = marked.indexOf('|');
  const text = marked.replace('|', '');
  const insertion = snippet.replace('$0', '');
  const cursor = offset + snippet.indexOf('$0');
  assert.equal(text.slice(0, offset) + insertion + text.slice(offset), marked.replace('|', insertion));
  assert.equal(cursor, offset + (typed === '=' ? 2 : 1));
};

check("formatting preserves the exact LF/CRLF interpolation before a data closer", () => {
  for (const eol of ['\n', '\r\n']) {
    const host = 'import { Hson } from "hson-live/hson";' + eol + 'const value = Hson.data`';
    const hole = '${' + eol + '  1' + eol + '}';
    const input = host + '<value' + eol + hole + ' >`;';
    const expected = host + '<' + eol + '  value' + eol + '  ' + hole + eol + '>`;';
    const edits = structural_formatting_edits('/workspace/source.ts', 'typescript', input, { insertSpaces: true, tabSize: 2 });
    assert.equal(applyEdits(input, edits), expected, JSON.stringify(eol));
    assert.equal(format(expected), expected, 'safe formatting is idempotent');
    const region = structural_regions('/workspace/source.ts', 'typescript', input)[0]!;
    for (const edit of edits) for (const range of region.protectedRanges) {
      assert.ok(edit.start === edit.end ? edit.start <= range.start || edit.start >= range.end : edit.end <= range.start || edit.start >= range.end,
        `protected expression intersected by ${JSON.stringify(edit)}`);
    }
    assert.equal(applyEdits(input, edits).slice(expected.indexOf('${'), expected.indexOf('${') + hole.length), hole);
    const ranged = structural_formatting_edits('/workspace/source.ts', 'typescript', input, { insertSpaces: true, tabSize: 2 }, region.bodyRange);
    assert.equal(applyEdits(input, ranged), expected, 'Format Selection shares the protected edit invariant');
  }
});

check("formatting distinguishes real whitespace from multiple opaque JavaScript substitutions", () => {
  for (const eol of ['\n', '\r\n']) {
    const first = '${' + eol + '  (() => ({ label: "😀", nested: { list: [1, { ok: true }] } }))()' + eol + '}';
    const second = '${' + eol + '  fn({ value: { another: "🚀" } })' + eol + '}';
    const input = authored('<main   ' + first + '   <span   title="ok"/>   ' + second + '   />');
    const expected = input.replace('<main   ', '<main ').replace('<span   title=', '<span title=').replace('/>   ' + second, '/> ' + second);
    const edits = structural_formatting_edits('/workspace/source.ts', 'typescript', input, { insertSpaces: true, tabSize: 2 });
    const result = applyEdits(input, edits);
    assert.equal(result, expected);
    for (const hole of [first, second]) assert.equal(result.slice(result.indexOf(hole), result.indexOf(hole) + hole.length), hole);
    for (const range of structural_regions('/workspace/source.ts', 'typescript', input)[0]!.protectedRanges) {
      assert.ok(edits.every(edit => edit.start === edit.end ? edit.start <= range.start || edit.start >= range.end : edit.end <= range.start || edit.start >= range.end));
      // A selection containing only a protected expression must not acquire edits.
      assert.deepEqual(structural_formatting_edits('/workspace/source.ts', 'typescript', input, { insertSpaces: true, tabSize: 2 }, { start: range.start + 1, end: range.end - 1 }), []);
    }
  }
});

check("multiline substitutions retain later attribute and Part positions in UTF-16 for LF and CRLF", () => {
  for (const eol of ['\n', '\r\n']) {
    const hole = '${' + eol + '  fragment("😀", {' + eol + '    value: 1' + eol + '  })' + eol + '}';
    for (const [body, typed, snippet] of [
      ['<main ' + hole + ' <span title|/>/>', '=', '="$0"'],
      ['<main ' + hole + ' "Hello %|"/>', '{', '{$0}'],
      ['<main ' + hole + ' <span title="%|"/>/>', '{', '{$0}'],
      ['<main ' + hole + '<span data-title|/>/>', '=', '="$0"'],
      ['<main ' + hole + '"%|"/>', '{', '{$0}'],
      ['<span title="' + hole + '" data-title|/>', '=', '="$0"'],
      ['<span title="' + hole + '" data-next="%|"/>', '{', '{$0}'],
      ['<main $|' + hole + '/>', '{', '{$0}'],
      ['<main ' + hole + '$|/>', '{', '{$0}'],
    ] satisfies readonly (readonly [string, "=" | "{", string])[]) {
      const exact = '// 🚀' + eol + authored(body).replace(';\nconst', ';' + eol + 'const');
      assertTypingResult(exact, typed, snippet);
      const result = exact.replace('|', snippet.replace('$0', ''));
      assert.ok(result.includes(hole));
      assert.equal(result.slice(0, exact.indexOf('|')), exact.slice(0, exact.indexOf('|')));
      assert.equal(result.slice(exact.indexOf('|') + snippet.replace('$0', '').length), exact.slice(exact.indexOf('|') + 1));
    }
  }
});

check("multiline protection keeps JavaScript and malformed substitutions outside every gesture", () => {
  for (const body of ['<main ${\n fn("😀 title|")\n}/>', '<main ${\n ({ key: 1| })\n}/>',
    '<main ${\n fragment(\n} <span title|/>/>', '<main ${\n fragment\n <span title|/>/>',
    '<main @:same @:again ${\n fragment\n} <span title|/>/>']) {
    for (const typed of ['=', '{'] satisfies readonly ('=' | '{')[]) assert.equal(typingSnippet(authored(body), typed), undefined, body);
  }
  const hole = '${\r\n fragment("😀")\r\n}';
  const input = authored('\r\n<main   @:root\r\n' + hole + '\r\n<span   title="hello"/>\r\n/>\r\n');
  const evidence = structural_document_evidence('/workspace/source.ts', 'typescript', input);
  const protectedRange = evidence.regions[0]!.protectedRanges[0]!;
  const edits = structural_formatting_edits('/workspace/source.ts', 'typescript', input, { insertSpaces: true, tabSize: 2 });
  assert.ok(edits.length > 0);
  assert.ok(edits.every(edit => edit.end <= protectedRange.start || edit.start >= protectedRange.end));
  assert.ok(applyEdits(input, edits).includes(hole));
});

const nestedAuthoring = (inner: string, depth = 1): string => {
  let expression = inner;
  for (let level = 0; level < depth; level++) expression = 'Hson.document`<main ${' + expression + '}/>`';
  return 'import { Hson } from "hson-live/hson";\n// 😀\nconst page = ' + expression + ';';
};
check("innermost recognized templates retain all conveniences through multiple protected ancestors", () => {
  for (const depth of [1, 2, 3]) {
    for (const [inner, typed, expected] of [
      ['Hson.document`<span title|/>`', '=', '="$0"'],
      ['Hson.document`<span $|/>`', '{', '{$0}'],
      ['Hson.document`<span "%|"/>`', '{', '{$0}'],
      ['Hson.document`<span title="%|"/>`', '{', '{$0}'],
      ['Hson.document`<main ${fragment} <span title|/>/>`', '=', '="$0"'],
      ['Hson.document`<main ${\n fragment("😀")\n} <span title="%|"/>/>`', '{', '{$0}'],
      ['Hson.data`$|`', '{', '{$0}'],
      ['Hson.data`<value $|>`', '{', '{$0}'],
    ] satisfies readonly (readonly [string, "=" | "{", string])[]) {
      const marked = nestedAuthoring(inner, depth);
      assertTypingResult(marked, typed, expected);
      const text = marked.replace('|', '');
      const region = structural_region_at_evidence(structural_document_evidence('/workspace/source.ts', 'typescript', text), marked.indexOf('|'));
      assert.equal(text.slice(region!.bodyRange.start, region!.bodyRange.end), inner.slice(inner.indexOf('`') + 1, -1).replace('|', ''));
    }
  }
});
check("inner modes, unrelated nested templates, escapes and protected expressions remain authoritative", () => {
  for (const inner of ['Hson.data`<span title|/>`', 'Hson.schema`$|`', 'Hson.schema`<value "%|">`',
    'Hson.data`"%|"`', '`<span title|/>`', 'String.raw`<span "%|"/>`',
    'Hson.document`<span \\$|/>`', 'Hson.document`<span "\\%|"/>`',
    'Hson.document`<span ${fn("$|")}/>`', 'Hson.document`<span // %|\n/>`']) {
    for (const typed of ['=', '{'] satisfies readonly ('=' | '{')[]) assert.equal(typingSnippet(nestedAuthoring(inner, 2), typed), undefined, inner);
  }
  const marked = nestedAuthoring('Hson.document`<span title|/>`');
  const text = marked.replace('|', '');
  const evidence = structural_document_evidence('/workspace/source.ts', 'typescript', text);
  const inner = structural_region_at_evidence(evidence, marked.indexOf('|'))!;
  assert.equal(structural_region_at_evidence(evidence, inner.bodyRange.start), inner);
  assert.equal(structural_region_at_evidence(evidence, inner.bodyRange.end), inner);
  assert.equal(structural_region_at_evidence(evidence, inner.bodyRange.start - 1), undefined);
  assert.equal(structural_region_at_evidence(evidence, inner.bodyRange.end + 1), undefined);
  for (const offset of [-1, text.length + 1, NaN]) assert.equal(structural_region_at_evidence(evidence, offset), undefined);
  const sibling = nestedAuthoring('[Hson.data`1`, Hson.document`<span title|/>`, Hson.data`2`]');
  assertTypingResult(sibling, '=', '="$0"');
});

check("shared nested lookup also preserves closer, Enter, array and formatting consumers", () => {
  const marked = nestedAuthoring('Hson.document`<main @:inner |/>`', 2);
  const offset = marked.indexOf('|');
  const text = marked.replace('|', '');
  assert.equal(structural_closer_for_less_than('/workspace/source.ts', 'typescript', text.slice(0, offset) + '<' + text.slice(offset), offset + 1), '/>');
  assert.deepEqual(structural_newline_plan('/workspace/source.ts', 'typescript', text, offset, { insertSpaces: true, tabSize: 2 }, '\n'), { beforeCursor: '\n  ', afterCursor: '\n' });
  const data = nestedAuthoring('Hson.data`<values |>`', 2);
  assert.equal(arrayPair(data), true);
  const input = nestedAuthoring('Hson.document`<span   title="😀"/>`', 2);
  assert.equal(format(input), input.replace('<span   title=', '<span title='));
});

check("attribute assignment snippets use authored checkpoints and preserve exact source/cursor", () => {
  for (const body of ['<span title|/>', '<span data-title|/>', '<span title| />', '<span title |/>',
    '<span title| disabled/>', '<span id="one" title|/>', '<main @:main <span @:label title|/>/>',
    '<hson-part @:part lib| at="card"/>', '<hson-part lib="parts" at|/>', '<span title|>']) {
    const marked = authored(body);
    const snippet = typingSnippet(marked, "=");
    // A mismatched structural closer is rejected by the production parser.
    if (body.endsWith('|>')) { assert.equal(snippet, undefined); continue; }
    assert.equal(snippet, '="$0"', body);
    const cursor = marked.indexOf('|');
    const result = marked.replace('|', snippet!.replace('$0', '|'));
    assert.equal(result, marked.replace('|', '="|"'));
    assert.equal(result.indexOf('|'), cursor + 2);
  }
});
check("attribute assignment leaves existing values, syntax, protected source and other modes alone", () => {
  for (const body of ['<span title|="old"/>', '<span title| = "old"/>', '<span title=|"old"/>',
    '<span title|"text"/>', '<span title| "text"/>', '<span title| 42/>', '<span title|\n = "old"/>', '<span ti|tle/>',
    '<span "ti|tle"/>', '<span title="ti|tle"/>', '<span // title|\n/>', '<span ${fn("title|")} />',
    '<span "content" title|/>', '<span @:same @:again title|/>', '<span title|', '<span bad="\\q" title|/>']) {
    assert.equal(typingSnippet(authored(body), '='), undefined, body);
  }
  for (const kind of ['data', 'schema', 'canonical']) assert.equal(typingSnippet(authored('<span title|/>', kind), '='), undefined);
  for (const marked of ['let title|;', 'const x = `<span title|/>`;', 'const Hson = String.raw; const x = Hson.document`<span title|/>`;']) {
    assert.equal(typingSnippet(marked, '='), undefined, marked);
  }
  assert.equal(typingSnippet(authored('<span title|/>').slice(0, -2), '='), undefined, 'unterminated host template');
});
check("JavaScript interpolation pairs only scanner-proven content and quoted values", () => {
  for (const [body, kind] of [
    ['<span $|/>', 'document'], ['<span @:label $|/>', 'document'], ['<span title="$|"/>', 'document'],
    ['<span "$|"/>', 'document'], ['<span ${first} $|/>', 'document'], ['<span $|${last}/>', 'document'],
    ['<span "before $|"/>', 'document'], ['<span title="$|after"/>', 'document'],
    ['$|', 'data'], ['<value $|', 'data'], ['<value $|>', 'data'], ['«$|»', 'data'], ['"$|"', 'data'], ['$|', 'canonical'],
  ]) assert.equal(typingSnippet(authored(body!, kind), '{'), '{$0}', `${kind}: ${body}`);
  for (const [body, kind] of [['<span $|}/>', 'document'], ['$|}', 'data'], ['"$|}"', 'data'], ['<span $|name}/>', 'document'], ['<span $|fn({ value: 1 })}/>', 'document'], ['"$|name}"', 'data']]) {
    assert.equal(typingSnippet(authored(body!, kind), '{'), '{$0', `existing closer ${body}`);
  }
});
check("partial quoted gestures preserve surrounding source, quotes, closers and cursor positions", () => {
  for (const [body, kind, typed, inserted, delta] of [
    ['<span title="${first} partial" next|/>', 'document', '=', '=""', 2],
    ['<span "before $|"/>', 'document', '{', '{}', 1],
    ['<span title="$|after"/>', 'document', '{', '{}', 1],
    ['<span title="pre${first}$|suffix" next="fixed"/>', 'document', '{', '{}', 1],
    ['<label "pre$|suffix">', 'data', '{', '{}', 1],
    ['"pre$|suffix"', 'canonical', '{', '{}', 1],
    ['<span title="pre$|}suffix"/>', 'document', '{', '{', 1],
    ['<span title="pre$|name}suffix"/>', 'document', '{', '{', 1],
    ['<span "${first} %|"/>', 'document', '{', '{}', 1],
  ] satisfies readonly (readonly [string, string, "=" | "{", string, number])[]) {
    const marked = authored(body, kind), cursor = marked.indexOf('|'), before = marked.replace('|', '');
    const snippet = typingSnippet(marked, typed);
    assert.equal(snippet, inserted.slice(0, delta) + '$0' + inserted.slice(delta));
    assert.ok(snippet !== undefined);
    const after = before.slice(0, cursor) + snippet.replace('$0', '') + before.slice(cursor);
    assert.equal(after, authored(body.replace('|', inserted), kind));
    assert.equal(cursor + snippet.indexOf('$0'), cursor + delta);
    assert.equal(after.slice(0, cursor), before.slice(0, cursor));
    assert.equal(after.slice(cursor + inserted.length), before.slice(cursor));
    assert.equal((after.match(/"/g) ?? []).length, (before.match(/"/g) ?? []).length + (typed === '=' ? 2 : 0));
    if (typed === '{') assert.ok(after.endsWith(before.slice(before.lastIndexOf('"'))), 'authored closing quote and structural suffix survive');
    const complete = after.replace('${}', '${0}');
    const regions = structural_regions('/workspace/source.ts', 'typescript', complete);
    assert.equal(regions.length, 1);
    if (before.includes('${first}')) assert.ok(complete.includes('${first}'));
  }
});
check("interpolation pairing rejects names, comments, escapes, schema and JavaScript", () => {
  for (const [body, kind] of [
    ['<sp$|an/>', 'document'], ['<span ti$|tle/>', 'document'], ['<span title=$|/>', 'document'],
    ['<span // $|\n/>', 'document'], ['<span ${fn("$|")}/>', 'document'],
    ['<span \\$|/>', 'document'], ['<value \\$|>', 'data'], ['<value "\\$|">', 'data'],
    ['$|', 'schema'], ['<value $|>', 'schema'], ['<value +1 next $|>', 'data'],
  ]) assert.equal(typingSnippet(authored(body!, kind), '{'), undefined, `${kind}: ${body}`);
  for (const marked of ['const x = `$|`;', 'const x = $|;', '// $|', 'const x = `%|`;', 'const x = "%|";']) {
    assert.equal(typingSnippet(marked, '{'), undefined, marked);
  }
});
check("Part placeholders pair in quoted document text and ordinary attribute values", () => {
  for (const body of ['<span "%|"/>', '<span "Hello %|!"/>', '<span title="%|"/>', '<span title=%|/>', '<span title=prefix-%|/>', '<script src="%|"/>', '<style media="%|"/>',
    '<span @:label title="prefix %| suffix"/>', '<main <span "%{first}%|"/>/>',
    '<span ${fragment} "%|"/>', '<span "%|%{last}"/>', '<span "%{first}%|%{last}"/>', '<span title="%|}"/>', '<span "%|name}"/>']) {
    assert.equal(typingSnippet(authored(body), '{'), body.includes('%|}') || body.includes('%|name}') ? '{$0' : '{$0}', body);
  }
});
check("Part placeholder typing reuses decoded selector closers and preserves incomplete suffixes", () => {
  for (const reference of ['slide.title', 'slide.items[0].label', 'slide["odd.key"]', 'slide["brace}key"]',
    String.raw`slide["quote\"key"]`, String.raw`slide["slash\\key"]`]) {
    const value = JSON.stringify('%|' + reference + '}');
    for (const body of ['<span ' + value + '/>', '<span title=' + value + '/>']) {
      assertTypingResult(authored(body), '{', '{$0');
    }
  }
  assertTypingResult(authored('<span "%{first} %|slide.items[0].label} %{last}"/>'), '{', '{$0');
  assertTypingResult(authored('<span title=%|slide.title}/>'), '{', '{$0');
  assert.equal(typingSnippet(authored('<span title=%|slide.items[0].label}/>'), '{'), undefined);
  for (const suffix of ['slide.title', 'slide.items[0].', 'slide[0]', 'slide[-1]}']) {
    assertTypingResult(authored('<span ' + JSON.stringify('%|' + suffix) + '/>'), '{', '{$0}');
  }
  for (const body of ['<span "%{slide.%|title}"/>', '<span "%{slide.items[%|0]}"/>']) {
    assert.equal(typingSnippet(authored(body), '{'), undefined, body);
  }
});
check("Part placeholders exclude unsupported Part payloads and other template modes", () => {
  for (const body of ['<span %|/>', '<sp%|an/>', '<span style="color:%|"/>', '<span onClick="%|"/>',
    '<script "%|"/>', '<style <span "%|"/>/>', '<span ${fn("%|")}/>', '<span // %|\n/>',
    '<span "\\%|"/>', '<span "%|', '<span @:one @:two "%|"/>', '<span "%{par%|}"/>', '<span title="%{open %|"/>', '<main @:same <span @:same "%|"/>/>']) {
    assert.equal(typingSnippet(authored(body), '{'), undefined, body);
  }
  for (const kind of ['data', 'schema', 'canonical']) assert.equal(typingSnippet(authored('"%|"', kind), '{'), undefined, kind);
});

check("authored QUADs preserve closer and Enter plans, including nested declarations and slots", () => {
  const hostPrefix = prefix.replace("Hson.canonical", "Hson.document");
  for (const body of ['<main |/>', '<main @:main |/>', '<main <p @:label/> |/>', '<main @:main ${fragment} |/>']) {
    const offset = hostPrefix.length + body.indexOf("|");
    const text = hostPrefix + body.replace("|", "") + "`;";
    assert.deepEqual(structural_newline_plan('/workspace/source.ts', 'typescript', text, offset, { insertSpaces: true, tabSize: 2 }, '\n'),
      { beforeCursor: '\n  ', afterCursor: '\n' }, body);
    assert.equal(structural_closer_for_less_than('/workspace/source.ts', 'typescript', text.slice(0, offset) + '<' + text.slice(offset), offset + 1), '/>', body);
  }
});

check("authored gestures protect quotes, multiline content, comments, JavaScript, and canonical boundaries", () => {
  const hostPrefix = prefix.replace("Hson.canonical", "Hson.document");
  for (const body of ['<main @:main "te|xt"/>', '<main @:main "first\nse|cond"/>', '<main @:main // co|mment\n/>', '<main @:main ${fn("te|xt")} />', '<main @:same @:again |/>', '<main @:same <p @:same/> |/>']) {
    const offset = hostPrefix.length + body.indexOf('|');
    const text = hostPrefix + body.replace('|', '') + '`;';
    assert.equal(structural_newline_plan('/workspace/source.ts', 'typescript', text, offset, { insertSpaces: true, tabSize: 2 }, '\n'), undefined, body);
    assert.equal(structural_closer_for_less_than('/workspace/source.ts', 'typescript', text.slice(0, offset) + '<' + text.slice(offset), offset + 1), undefined, body);
    assert.equal(structural_array_pair_for_bracket('/workspace/source.ts', 'typescript', text, offset), false, body);
  }
  assert.equal(closer('<main @:main |/>'), undefined);
  const markdown = '```hson\n<main @:main />\n```';
  assert.equal(structural_newline_plan('/workspace/source.md', 'markdown', markdown, markdown.indexOf('/>'), { insertSpaces: true, tabSize: 2 }, '\n'), undefined);
});

check("authored document formatting preserves nested QUADs, connector admission, and exact text", () => {
  const bodies = [
    '\n<nav   @:navigation\n<a   @:next href="/next" "  Next  "/>\n<a @:previous href="/previous" "Previous"/>\n/>\n',
    '\n<html\n<head/>\n<body\n<main\n<hson-part   @:content lib="parts" at="content"/>\n/>\n/>\n/>\n',
    '\n<main @:main\n<p @:text "first\n  second\nthird"/>\n// comment @:untouched\n/>\n',
  ];
  for (const body of bodies) {
    const hostPrefix = prefix.replace("Hson.canonical", "Hson.document");
    const input = hostPrefix + body + "`;";
    const result = format(input);
    assert.notEqual(result, input, "valid authored source must actually format");
    assert.equal(format(result), result, "formatting must be idempotent");
    const formattedBody = result.slice(hostPrefix.length, -2);
    assert.deepEqual(parse_authored_document_library(formattedBody), parse_authored_document_library(body));
    const map = hsonLiveMap.fromLibraries({
      parts: { parts: { content: { kind: "document", document: '<article "Body"/>' } } },
      page: { document: formattedBody },
    });
    const page = map.doc.must("page");
    if (page.mode !== "document") throw new Error("Expected document Library");
    for (const declaration of parse_authored_document_library(body).declarations) assert.ok(page.q(declaration.name));
    assert.doesNotMatch(JSON.stringify(page.at([]).snap()), /\$_meta|@:|hson-part/);
  }
  const result = format(prefix.replace("Hson.canonical", "Hson.document") + bodies[0] + "`;");
  assert.ok(result.includes('\n  <a @:next href="/next" "  Next  "/>'));
});

check("authored formatting protects interpolation expressions and keeps declaration meaning", () => {
  const body = '\n<main   @:main\n${fragment}\n<p   @:label "${text}"/>\n${optional}\n/>\n';
  const input = prefix.replace("Hson.canonical", "Hson.document") + body + "`;";
  const result = format(input);
  assert.notEqual(result, input);
  assert.equal(format(result), result);
  for (const expression of ['${fragment}', '${text}', '${optional}']) assert.ok(result.includes(expression));
  assert.ok(result.includes('\n  <p @:label "${text}"/>'));
  assert.deepEqual(result.match(/@:[A-Za-z]+/g), input.match(/@:[A-Za-z]+/g));
});

check("formatting rejects malformed declarations and retains canonical context boundaries", () => {
  for (const body of ['<main @:bad-name  />', '<main @:same @:again  />', '<main @000000001  />', '<main @:same <p @:same/>  />']) {
    const text = prefix.replace("Hson.canonical", "Hson.document") + body + "`;";
    assert.deepEqual(structural_formatting_edits('/workspace/source.ts', 'typescript', text, { insertSpaces: true, tabSize: 2 }), []);
  }
  assert.equal(format(template('<main   @:main/>')), template('<main   @:main/>'));
});

check("a bracket gesture creates a canonical pair only at parser-owned Hson array positions", () => {
  assert.equal(arrayPair(template("|")), true);
  assert.equal(arrayPair(template("«|»")), true);
  assert.equal(arrayPair(template("<items | >")), true);
  assert.equal(arrayPair(template("\n<\n  items |\n>\n")), true);
  assert.equal(arrayPair('import { Hson as Alias } from "hson-live/hson"; const value = Alias.canonical`|`;'), true);
  assert.equal(arrayPair("Prose [link]\n```hson\n|\n```", "markdown"), true);
});
check("a bracket gesture defers to ordinary typing in strings, substitutions, and non-Hson text", () => {
  assert.equal(arrayPair(template('"|"')), false);
  assert.equal(arrayPair(template('"abc|')), false);
  assert.equal(arrayPair(template('"a\\"b|"')), false);
  assert.equal(arrayPair('import { Hson } from "hson-live/hson"; const value = Hson.canonical`<data ${[|1,2]}>`;'), false);
  assert.equal(arrayPair('const values = |;'), false);
  assert.equal(arrayPair('const value = `|`;'), false);
  assert.equal(arrayPair('const Hson = String.raw; const value = Hson.canonical`|`;'), false);
  assert.equal(arrayPair("Prose |\n```hson\n«1,2»\n```", "markdown"), false);
  assert.equal(arrayPair(template("<tag |/>")), false);
});

check("binding-recognized document context selects the element closer", () => assert.equal(closer("<main |/>"), "/>"));
check("all four semantic member tags share structural regions and formatting", () => {
  const text = 'import { Hson } from "hson-live";\n'
    + 'const a=Hson.canonical`<a  1>`;\n'
    + 'const b=Hson.data`<b  2>`;\n'
    + 'const c=Hson.document`<main/>`;\n'
    + 'const d=Hson.schema`<type "data" content <count "number">>`;\n';
  assert.equal(structural_regions("/workspace/source.ts", "typescript", text).length, 4);
  const formatted = format(text);
  assert.ok(formatted.includes('Hson.canonical`<a 1>`'));
  assert.ok(formatted.includes('Hson.data`<b 2>`'));
  const contextInvalid = 'import { Hson } from "hson-live"; Hson.data`<main  <p "x"/>/>`; Hson.document`<foo  1>`;';
  const stillFormatted = format(contextInvalid);
  assert.ok(stillFormatted.includes('Hson.data`<main <p "x"/>/>`'));
  assert.ok(stillFormatted.includes('Hson.document`<foo 1>`'));
});
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
  assert.deepEqual(structural_regions("/workspace/a.ts", "typescript", 'const Hson=String.raw; Hson.canonical`<x/>`;'), []);
  assert.deepEqual(structural_regions("/workspace/a.ts", "typescript", 'import { hson } from "hson-live"; hson.liveMap.fromHson(`<x/>`);'), []);
});
check("interpolation expressions are protected", () => {
  const text = 'import { Hson } from "hson-live"; const x=1; const value=Hson.canonical`<a ${x}>`;';
  const region = structural_regions("/workspace/a.ts", "typescript", text)[0]!;
  assert.equal(region.protectedRanges.length, 1);
  const offset = text.indexOf("x}>" as string);
  const prospective = text.slice(0, offset) + "<" + text.slice(offset);
  assert.equal(structural_closer_for_less_than("/workspace/a.ts", "typescript", prospective, offset + 1), undefined);
});
check("interpolation expressions remain protected during formatting", () => {
  for (const [kind, body] of [
    ["document", "\n <body\n ${example}\n />\n"],
    ["data", "\n <outer ${example}>\n"],
    ["document", "\n <p \"${example}\"/>\n"],
  ] as const) {
    const input = `import { Hson } from "hson-live"; const example = "";${"\n"}const value=Hson.${kind}\`${body}\`;`;
    const region = structural_regions("/workspace/source.ts", "typescript", input)[0]!;
    assert.equal(input.slice(region.protectedRanges[0]!.start, region.protectedRanges[0]!.end), "${example}");
    const formatted = format(input);
    assert.ok(formatted.includes("${example}"));
    assert.equal(format(formatted), formatted);
  }
});

check("quoted document interpolation does not suppress formatting of the enclosing Hson region", () => {
  const input = 'import { Hson } from "hson-live";\nconst pulsePage = "/pulse";\n'
    + 'const mainShell = Hson.document`\n<html\n<head\n<style ".pulse-mount{position:fixed;left:0;bottom:0}"/>\n/>\n'
    + '<body\n<iframe\nsrc="${pulsePage}"\ntitle="Pulse diagnostics"\n/>\n/>\n/>\n`;\nconst ordinary =  1;\nconst unrelated = `  untouched`;\n';
  const expected = input.replace(
    '\n<html\n<head\n<style ".pulse-mount{position:fixed;left:0;bottom:0}"/>\n/>\n<body\n<iframe\nsrc="${pulsePage}"\ntitle="Pulse diagnostics"\n/>\n/>\n/>\n',
    '\n<html\n  <head\n    <style ".pulse-mount{position:fixed;left:0;bottom:0}"/>\n  />\n  <body\n    <iframe\n      src="${pulsePage}"\n      title="Pulse diagnostics"\n    />\n  />\n/>\n',
  );
  assert.equal(structural_regions("/workspace/source.ts", "typescript", input).length, 1);
  assert.equal(format(input), expected);
  assert.equal(format(expected), expected);
});

check("document formatting repairs nesting without rewriting tokens", () => {
  const input = template('\n   <main\n<section\n       <p "hello"/>\n />\n      />\n');
  const expected = template('\n<main\n  <section\n    <p "hello"/>\n  />\n/>\n');
  assert.equal(format(input), expected);
  assert.equal(format(expected), expected);
});
check("data formatting follows object and array structure", () => {
  const input = template('\n <\nuser <\nname "Ada"\nitems [\n1,\n2\n]\n>\n>\n');
  const expected = template('\n<\n  user <\n    name "Ada"\n    items «\n      1,\n      2\n    »\n  >\n>\n');
  assert.equal(format(input), expected);
});
check("inline, multiline, nested, and object-member arrays use guillemets without changing layout", () => {
  const cases = [
    ["[1, 2]", "«1,2»"],
    ["[\n1,\n2\n]", "«\n  1,\n  2\n»"],
    ["[[1,2], [3,4]]", "««1,2»,«3,4»»"],
    ["<data [1,2]>", "<data «1,2»>"],
  ] as const;
  for (const [input, expected] of cases) {
    assert.equal(format(template(input)), template(expected));
    assert.equal(format(template(expected)), template(expected));
  }
});
check("array-like characters in strings and unrelated TypeScript stay unchanged", () => {
  const input = 'import { Hson } from "hson-live/hson";\nconst ordinary = [1, 2];\nconst text = "[outside]";\nconst value = Hson.canonical`["[inside]", [1,2]]`;';
  const expected = input.replace('["[inside]", [1,2]]', '«"[inside]",«1,2»»');
  assert.equal(format(input), expected);
  assert.equal(format(expected), expected);
});
check("TypeScript substitutions and Markdown prose keep their brackets", () => {
  const typeScript = 'import { Hson } from "hson-live/hson";\nconst value = Hson.canonical`<data [1,2] other ${[3,4]}>`;';
  assert.equal(format(typeScript), typeScript.replace("<data [1,2]", "<data «1,2»"));
  const markdown = "Prose [link](target) stays.\n```hson\n[1,2]\n```\n```js\n[3,4]\n```\n";
  const output = applyEdits(markdown, structural_formatting_edits("/workspace/readme.md", "markdown", markdown, { insertSpaces: true, tabSize: 2 }));
  assert.equal(output, markdown.replace("```hson\n[1,2]", "```hson\n«1,2»"));
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
  assert.equal(format(template("[\n1,\n2\n]")), template("«\n  1,\n  2\n»"));
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
check("host widths and tab policy do not change Hson's two-space structural levels", () => {
  const input = template('\n<main\n<section\n<p/>\n/>\n/>\n');
  for (const insertSpaces of [true, false]) for (const tabSize of [2, 4, 8]) {
    const output = format(input, insertSpaces, tabSize);
    assert.ok(output.includes("\n  <section\n    <p/>"));
    assert.equal(format(output, insertSpaces, tabSize), output);
    const close = input.indexOf('<p') + 2;
    assert.deepEqual(structural_newline_plan('/workspace/source.ts', 'typescript', input, close,
      { insertSpaces, tabSize }, '\n'), { beforeCursor: '\n      ', afterCursor: '\n    ' });
  }
});
check("host base tabs are preserved while selections and Markdown levels use spaces", () => {
  const input = 'import { Hson } from "hson-live/hson";\nfunction f() {\n\tconst value=Hson.data`\n<\na <\nb 1\n>\n>\n\t`;\n}';
  const start = input.indexOf('\n<') + 1, end = input.lastIndexOf('`');
  const options = { insertSpaces: false, tabSize: 8 };
  const edits = structural_formatting_edits('/workspace/source.ts', 'typescript', input, options, { start, end });
  const output = applyEdits(input, edits);
  assert.ok(output.includes('\n\t<\n\t  a <\n\t    b 1\n\t  >\n\t>'));
  assert.ok(output.includes('\n\tconst value='));
  const markdown = '   ```hson\n<\na <\nb 1\n>\n>\n   ```';
  const formatted = applyEdits(markdown, structural_formatting_edits('/workspace/source.md', 'markdown', markdown, options));
  assert.equal(formatted, '   ```hson\n   <\n     a <\n       b 1\n     >\n   >\n   ```');
});
check("comments, strings, escapes, and member order remain byte-stable", () => {
  const input = template('\n<\nsecond "a\\n\\\"b"\n// retained exactly\nfirst true\n>\n');
  const output = format(input);
  assert.ok(output.includes('second "a\\n\\\"b"'));
  assert.ok(output.includes("// retained exactly"));
  assert.ok(output.indexOf("second") < output.indexOf("first"));
});
check("multiple templates format while unrelated host and template text stay untouched", () => {
  const input = 'import { Hson } from "hson-live";\nconst ordinary=`  untouched`;\nconst a=Hson.canonical`\n <a\n<b/>\n/>\n`;\nconst host =  1;\nconst b=Hson.canonical`\n <\nx true\n>\n`;';
  const output = format(input);
  assert.ok(output.includes("ordinary=`  untouched`"));
  assert.ok(output.includes("const host =  1;"));
  assert.ok(output.includes("\n<a\n  <b/>\n/>"));
  assert.ok(output.includes("\n<\n  x true\n>"));
});
check("invalid Hson regions are skipped without preventing safe sibling formatting", () => {
  const input = 'import { Hson } from "hson-live";\nconst invalid=Hson.canonical`\n <data 1\n<data2 2>\n>\n`;\nconst valid=Hson.canonical`\n <data 1\ndata2 2\n>\n`;';
  const output = format(input);
  assert.ok(output.includes('invalid=Hson.canonical`\n <data 1\n<data2 2>\n>\n`'));
  assert.ok(output.includes('valid=Hson.canonical`\n<\n  data 1\n  data2 2\n>\n`'));
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
  const normalized = template("<'quoted name\\'s' «1,2,\"three  spaces\"»>");
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
  const input = 'import { Hson } from "hson-live";\nconst a=Hson.canonical`\n <a\n<b/>\n/>\n`;\nconst b=Hson.canonical`\n <b\n<c/>\n/>\n`;';
  const firstStart = input.indexOf("<a");
  const firstEnd = input.indexOf("`;", firstStart);
  const output = applyEdits(input, structural_formatting_edits("/workspace/source.ts", "typescript", input,
    { insertSpaces: true, tabSize: 2 }, { start: firstStart, end: firstEnd }));
  assert.ok(output.includes("\n<a\n  <b/>\n/>"));
  assert.ok(output.includes("\n <b\n<c/>\n/>"));
});
check("range formatting canonicalizes only array delimiters inside the selected Hson region", () => {
  const input = 'import { Hson } from "hson-live/hson";\nconst first = Hson.canonical`[1,2]`;\nconst second = Hson.canonical`[3,4]`;';
  const start = input.indexOf("[1,2]");
  const output = applyEdits(input, structural_formatting_edits("/workspace/source.ts", "typescript", input,
    { insertSpaces: true, tabSize: 2 }, { start, end: start + 5 }));
  assert.equal(output, input.replace("[1,2]", "«1,2»"));
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
  const interpolated = 'import { Hson } from "hson-live"; const value=1; const x=Hson.canonical`<a ${val|ue}>`;';
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
  const offset = text.indexOf("/>", text.indexOf("Hson.canonical`"));
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

check("multiline literals preserve every interior byte while surrounding structure formats", () => {
  for (const eol of ["\n", "\r\n"]) for (const insertSpaces of [true, false]) for (const tabSize of [2, 4, 8]) {
    const literal = '"' + eol + '    a' + eol + '  ' + eol + '\t  b // « [ >' + eol + '      "';
    const text = template('<' + eol + 'value   ' + literal + eol + 'list [1,  2]' + eol + '>');
    const output = format(text, insertSpaces, tabSize);
    assert.notEqual(output, text);
    assert.ok(output.includes(literal));
    const edits = structural_formatting_edits("/workspace/source.ts", "typescript", text, { insertSpaces, tabSize });
    const start = text.indexOf(literal), end = start + literal.length;
    assert.ok(edits.every(edit => edit.end <= start || edit.start >= end));
    const selected = structural_formatting_edits("/workspace/source.ts", "typescript", text,
      { insertSpaces, tabSize }, { start, end });
    assert.ok(applyEdits(text, selected).includes(literal));
    assert.deepEqual(parse_hson(output.slice(prefix.length, -2)), parse_hson(text.slice(prefix.length, -2)));
    assert.equal(format(output, insertSpaces, tabSize), output);
  }
  const zeroWidth = template('<text "\nfirst\n\n" other 1>');
  assert.ok(format(zeroWidth, false, 8).includes('"\nfirst\n\n"'));
  assert.equal(arrayPair(template('"\n a | b\n"')), false);
  assert.equal(arrayPair(template('"\n a |')), false);
  assert.equal(format(template('<a "\n unterminated >')), template('<a "\n unterminated >'));
});

check("standalone Hson is one empty-base region using the existing two-space formatter", () => {
  const input = '<\nslides «\n<\nid "intro"\n>\n»\n>';
  const expected = '<\n  slides «\n    <\n      id "intro"\n    >\n  »\n>';
  assert.deepEqual(structural_regions('/workspace/slides.hson', 'hson', input), [{
    kind: 'standalone', bodyRange: { start: 0, end: input.length },
    protectedRanges: [], baseIndentation: '', bodyStartsAtLineStart: true,
  }]);
  for (const tabSize of [2, 4, 8]) for (const insertSpaces of [true, false]) {
    const options = { tabSize, insertSpaces };
    const output = applyEdits(input, structural_formatting_edits('/workspace/slides.hson', 'hson', input, options));
    assert.equal(output, expected);
    assert.deepEqual(structural_formatting_edits('/workspace/slides.hson', 'hson', output, options), []);
    assert.equal(template(output), format(template(input), insertSpaces, tabSize));
    assert.deepEqual(parse_hson(output), parse_hson(input));
  }
});
check("standalone literal bytes, comments, selection boundaries, and invalid input retain shared protections", () => {
  const options = { tabSize: 8, insertSpaces: false };
  for (const eol of ['\n', '\r\n']) {
    const literal = '"' + eol + '        first' + eol + '            nested' + eol + '  ' + eol + '        third' + eol + '    "';
    const input = ['<', '// keep this comment', 'text ' + literal, 'child <', 'id 1', '>', '>'].join(eol);
    const output = applyEdits(input, structural_formatting_edits('/workspace/source.hson', 'hson', input, options));
    assert.ok(output.includes(literal));
    assert.ok(output.includes('// keep this comment'));
    assert.deepEqual(parse_hson(output), parse_hson(input));
    const start = input.indexOf('child <'), end = input.lastIndexOf('>');
    const edits = structural_formatting_edits('/workspace/source.hson', 'hson', input, options, { start, end });
    assert.ok(edits.length > 0);
    assert.ok(edits.every(edit => edit.start >= start && edit.end <= end));
    const selected = applyEdits(input, edits);
    assert.equal(selected.slice(0, start), input.slice(0, start));
    assert.ok(selected.includes(literal));
    assert.deepEqual(parse_hson(selected), parse_hson(input));
    const literalStart = input.indexOf(literal);
    const literalEdits = structural_formatting_edits('/workspace/source.hson', 'hson', input, options,
      { start: literalStart, end: literalStart + literal.length });
    assert.ok(applyEdits(input, literalEdits).includes(literal));
  }
  for (const invalid of ['<a 1', '<a "\n unclosed', '<a «1>', '<a 1> garbage']) {
    assert.deepEqual(structural_formatting_edits('/workspace/source.hson', 'hson', invalid, options), []);
  }
});

check("bare member/value opener adjacency normalizes to one space through all formatting regions", () => {
  for (const [body, expected] of [
    ['<content<id "intro"> blocks«1, 2»>', '<content <id "intro"> blocks «1,2»>'],
    ['<content<> blocks[1, 2]>', '<content <> blocks «1,2»>'],
    ['<type "data" content<array<ref "Item">>>', '<type "data" content <array <ref "Item">>>'],
  ]) {
    assert.equal(format(template(body)), template(expected));
    const standalone = applyEdits(body, structural_formatting_edits('/workspace/a.hson', 'hson', body, { tabSize: 8, insertSpaces: false }));
    assert.equal(standalone, expected);
    assert.deepEqual(parse_hson(body), parse_hson(standalone));
    assert.deepEqual(structural_formatting_edits('/workspace/a.hson', 'hson', standalone, { tabSize: 4, insertSpaces: true }), []);
    const markdown = '```hson\n' + body + '\n```';
    assert.equal(applyEdits(markdown, structural_formatting_edits('/workspace/a.md', 'markdown', markdown, { tabSize: 8, insertSpaces: false })),
      '```hson\n' + expected + '\n```');
  }
  const literal = '"\ncontent<\n  blocks«\n    "';
  const body = '<text ' + literal + ' content<id 1>>';
  assert.ok(format(template(body)).includes(literal));
  const comments = '<content<> // content< blocks«\nnext 1>';
  assert.ok(format(template(comments)).includes('// content< blocks«'));
  const input = '<first<> second«1»>';
  const edits = structural_formatting_edits('/workspace/a.hson', 'hson', input, { tabSize: 2, insertSpaces: true }, { start: 6, end: 8 });
  assert.equal(applyEdits(input, edits), '<first <> second«1»>');
});

check("local Part references pair through the production checkpoint and preserve structural formatting", () => {
  for (const body of ['<span "#|"/>', '<span title="#|"/>', '<hson-part #|/>', '<main c:doc="%{control}" <hson-part #|/>' , '<main <hson-part #|']) {
    assertTypingResult(authored(body), '{', '{$0}');
  }
  assertTypingResult(authored('<hson-part #|control}/>'), '{', '{$0');
  for (const body of ['<span #|/>', '<hson-part#|/>', '<hson-part lib="parts" at="x" #|/>', '<script "#|"/>', '<span // #|\n/>']) {
    assert.equal(typingSnippet(authored(body), '{'), undefined, body);
  }
  for (const sigil of ['%', '#']) for (const reference of ['model.items[0].label', 'model["odd}key"]']) {
    assertTypingResult(authored('<p ' + JSON.stringify(sigil + '|' + reference + '}') + '/>'), '{', '{$0');
  }
  const body = '<main c:doc="%{control}" d:data="%{payload}"\n<hson-part #{c}/>\n<p ' + JSON.stringify('#{d["odd}key"][0].label}') + '/>\n/>';
  const source = authored(body), formatted = format(source);
  assert.ok(formatted.includes('<hson-part #{c}/>'));
  assert.ok(formatted.includes(JSON.stringify('#{d["odd}key"][0].label}')));
  assert.deepEqual(parse_authored_document_library(formatted.slice(formatted.indexOf('<main'), formatted.lastIndexOf('`'))).root,
    parse_authored_document_library(body).root);
  assert.equal(format(formatted), formatted);
});
