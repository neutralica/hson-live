import assert from "node:assert/strict";
import { resolve } from "node:path";
import { HsonBindingCache, binding_definition_at, binding_highlights, overlay_binding_highlights } from "../src/binding-intelligence.js";
import { hson_highlights, load_hson_grammar } from "../src/highlighting.js";
import { hsonTokenDefinitions } from "../src/appearance-internals.js";
import { produce_document_diagnostics } from "../src/document-diagnostics.js";
import { AppearanceSpanCache } from "../src/appearance-spans.js";

import { canonical, iteratorColumn, ordinarySibling, invalidSibling, malformedQuotedSibling, escapedControlSibling, receivingPart,
  invalidOperandDocument, malformedContentDocument, conflictingPart } from "./fixtures/bindings.js";
import { analyze_part_definition } from "../../../src/internal/part-definition.js";
import { parse_part_binding_source } from "../../../src/internal/editor-introspection/part-bindings.js";
export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "editor.part-bindings", title: "Shared Part binding intelligence", category: "Tooling", runtime: "node", tags: Object.freeze(["parts", "editor", "navigation", "highlighting", "provenance"]) });

async function run() {
const cache = new HsonBindingCache();
let checks = 0;
function check(name: string, run: () => void) { run(); console.log(`ok ${++checks} - ${name}`); }
function snapshot(text: string, languageId = "hson", version = 1, uri = "untitled:binding-fixture") {
  const ext = languageId === "typescript" ? "ts" : languageId === "typescriptreact" ? "tsx" : languageId === "markdown" ? "md" : "hson";
  return cache.get({ uri, fileName: `/workspace/binding.${ext}`, languageId, version, text });
}
const wrap = (body: string) => 'import { Hson } from "hson-live/hson";\nconst doc = Hson.document`' + body + '`;';
const grammar = await load_hson_grammar(resolve(__dirname, ".."));
for (const language of ["hson", "markdown", "typescript", "typescriptreact"]) {
  const text = language === "hson" ? canonical : language === "markdown" ? '# Heading\n```hson\n' + canonical + '\n```\nOrdinary Markdown ^{blocks}' : wrap(canonical);
  const result = snapshot(text, language);
  check(`${language}: complete canonical references, origins, source URI and root ranges`, () => {
    assert.equal(result.sources.length, 1);
    const { declarations, references } = result.sources[0]!;
    assert.deepEqual(declarations.map(d => [d.name, d.origin]), [["blocks", "receiving"], ["each", "iteration-value"]]);
    assert.deepEqual(references.map(r => [r.reference.name, r.resolution]), [["someBlocks", "unavailable"], ["blocks", "resolved"], ["each", "resolved"], ["each", "resolved"]]);
    for (const ref of references) {
      assert.equal(text.slice(ref.root.start, ref.root.end), ref.reference.name);
      assert.equal(text.slice(ref.location.start, ref.location.end), (ref.reference.namespace === "local" ? "^" : "%") + '{' + ref.reference.reference + '}');
      const definition = binding_definition_at(result, ref.root.start);
      if (ref.reference.namespace === "incoming") { assert.equal(definition, undefined); continue; }
      assert.equal(definition?.uri, 'untitled:binding-fixture');
      assert.equal(text.slice(definition!.target.start, definition!.target.end), ref.reference.name);
      assert.equal(definition!.target.start, (ref.reference.name === "blocks" ? text.indexOf('data:blocks') + 5 : text.indexOf('each=')) );
      assert.ok(ref.scope && ref.scope.start <= ref.root.start && ref.root.end <= ref.scope.end);
    }
    const member = references.find(r => r.reference.path.length)!;
    assert.deepEqual(member.reference.path, ['kind']);
    assert.equal(binding_definition_at(result, text.indexOf('kind')), undefined);
    assert.equal(member.declaration?.elementOf?.declaration, declarations[0], 'iteration origin retains the receiving identity for future Schema work');
  });
  check(`${language}: semantic receiving/iteration parity and member independence`, () => {
    const roots = binding_highlights(result);
    for (const ref of result.sources[0]!.references.filter(r => r.declaration)) {
      const use = roots.find(t => t.range.start === ref.root.start)!;
      const declaration = roots.find(t => t.range.start === ref.declaration!.location.start)!;
      assert.equal(use.type, declaration.type);
      assert.deepEqual(use.modifiers, declaration.modifiers);
    }
    assert.ok(roots.every(token => ['blocks', 'each'].includes(text.slice(token.range.start, token.range.end))));
    if (language.startsWith('typescript')) {
      const tokens = overlay_binding_highlights(hson_highlights(grammar, result.document.fileName, text, result), roots);
      assert.equal(tokens.find(t => t.range.start === text.indexOf('someBlocks'))?.type, 'hsonIncomingReference');
      assert.equal(tokens.find(t => t.range.start === text.indexOf('kind'))?.type, 'hsonReference');
      assert.deepEqual(tokens.find(t => t.range.start === text.indexOf('kind'))?.modifiers, ['hsonMember']);
      assert.equal(tokens.find(t => t.range.start === text.indexOf('block:data'))?.type, 'hsonSending');
      assert.ok(tokens.some(t => t.type === 'hsonLocalReferenceSigil'));
      assert.ok(tokens.some(t => t.type === 'hsonIncomingReferenceSigil'));
      assert.ok(tokens.every((t, i) => !i || tokens[i - 1]!.range.end <= t.range.start));
    }
  });
}
check('shadowing follows identities, including source reads before the iterator aliases', () => {
  for (const name of ['row', 'renamed']) {
    const text = `<main hson:part data:${name}=%{input} <section for:${name}:index=^{${name}} <i per:key:${name}=^{${name}.children} title=^{${name}.kind} data-i=^{index} data-k=^{key}/> <b title=^{${name}}/>/> <p title=^{${name}}/>/>`;
    const result = snapshot(text), refs = result.sources[0]!.references.filter(r => r.reference.namespace === 'local');
    const declarations = result.sources[0]!.declarations;
    const receiving = declarations.find(d => d.origin === 'receiving')!;
    const outer = declarations.find(d => d.origin === 'iteration-value' && d.elementOf?.declaration === receiving)!;
    const inner = declarations.find(d => d.origin === 'iteration-value' && d.elementOf?.declaration === outer)!;
    assert.equal(refs[0]!.declaration, receiving);
    assert.equal(refs[1]!.declaration, outer);
    assert.equal(refs[2]!.declaration, inner);
    assert.equal(refs[3]!.declaration?.origin, 'iteration-index');
    assert.equal(refs[4]!.declaration?.origin, 'iteration-key');
    assert.equal(refs[5]!.declaration, outer);
    assert.equal(refs[6]!.declaration, receiving);
    for (const ref of refs) assert.equal(binding_definition_at(result, ref.root.start)?.target, ref.declaration!.location);
  }
});
check('iterator declaration, roots and member retain independent appearance in adjacent Part examples', () => {
  const nested = '<section hson:part data:each=%{rows} <hson-part for:each=^{each} at=outer <hson-part per:key:each=^{each.children} at=^{each.kind} block:data=^{each}/> <hson-part at=^{each.outer}/>/> <p title=^{each.end}/>/>\n';
  const appearance = new AppearanceSpanCache(cache);
  for (const body of [iteratorColumn, '<aside/>\n' + iteratorColumn + '\n' + nested + '<p title=^{each}/>']) {
    for (const language of ['hson','markdown','typescript','typescriptreact']) {
      const text = language === 'hson' ? body : language === 'markdown' ? '```hson\n' + body + '\n```' : wrap(body);
      const result = snapshot(text, language), tokens = binding_highlights(result), spans = appearance.get(grammar, result.document);
      const roleAt = (at: number) => spans.find(span => span.range.start <= at && at < span.range.end)?.role;
      const verify = (use: string, declaration: string, iteration: boolean, region = 0) => {
        const at = text.indexOf(use, region) + 2;
        const target = text.indexOf(declaration, region) + declaration.lastIndexOf(':') + 1;
        assert.equal(binding_definition_at(result, at)?.target.start, target, language + ' ' + use);
        for (const start of [at, target]) {
          const token = tokens.find(token => token.range.start === start);
          assert.equal(token?.type, iteration ? 'hsonIteration' : 'hsonReceiving');
          assert.deepEqual(token.modifiers, ['hsonLocalName']);
          assert.equal(roleAt(start), iteration ? 'iteration.name' : 'part.receivingArgument');
        }
      };
      verify('^{blocks}', 'data:blocks', false);
      verify('^{each.kind}', 'for:each', true);
      verify('^{each}', 'for:each', true);
      assert.equal(roleAt(text.indexOf('kind}')), 'reference.member');
      if (body.includes(nested)) {
        const region = text.indexOf(nested);
        verify('^{each}', 'data:each', false, region);
        verify('^{each.children}', 'for:each', true, region);
        verify('^{each.kind}', 'per:key:each', true, region);
        verify('^{each}', 'per:key:each', true, text.indexOf('per:key:each', region));
        verify('^{each.outer}', 'for:each', true, region);
        verify('^{each.end}', 'data:each', false, region);
        const outside = text.lastIndexOf('^{each}') + 2;
        assert.equal(binding_definition_at(result, outside), undefined);
        assert.equal(roleAt(outside), 'reference.local.content');
      }
    }
  }
});
check('ordinary siblings keep lexical color and have no declaration regardless of a neighboring flag', () => {
  const appearance = new AppearanceSpanCache(cache);
  for (const prefix of ['', '<main data-flag/>\n', '<main hson:part/>\n']) {
    for (const language of ['hson', 'typescript']) {
      const body = prefix + ordinarySibling, text = language === 'hson' ? body : wrap(body);
      const result = snapshot(text, language), at = text.indexOf('^{x}') + 2;
      if (language === 'hson' && prefix === '<main data-flag/>\n') assert.equal(at, 55);
      assert.equal(binding_definition_at(result, at), undefined);
      assert.ok(!binding_highlights(result).some(token => token.range.start === at));
      const spans = appearance.get(grammar, result.document);
      assert.equal(spans.find(span => span.range.start === at)?.role, 'reference.local.content');
    }
  }
});
check('a closed malformed quote keeps its diagnostic without hiding the next Part', () => {
  const trivia = '\r\n// 😀 <ignored/>\r\n';
  const bad = malformedQuotedSibling.replace('\n', '\r\n');
  const later = '<aside title="c\r\nd <fake/>"/>';
  const body = [bad, receivingPart, later, receivingPart, '<aside title="unclosed', receivingPart].join(trivia);
  for (const language of ['hson', 'typescript', 'typescriptreact']) {
    const text = language === 'hson' ? body : wrap(body);
    const result = snapshot(text, language);
    const [diagnostic] = produce_document_diagnostics(result.document);
    assert.equal(diagnostic?.code, 'HSON_STRING_CONTROL_UNESCAPED');
    assert.equal(diagnostic.range.start, text.indexOf('\r\n', text.indexOf(bad)));
    const roots = [...text.matchAll(/<main hson:part/g)].map(match => match.index);
    const reference = roots.map(start => text.indexOf('^{x}', start) + 2);
    const declarations = result.sources[0]!.declarations;
    assert.equal(declarations.length, 2);
    for (const [index, declaration] of declarations.entries()) {
      const at = reference[index]!, target = text.indexOf('data:x', roots[index]) + 5;
      const definition = binding_definition_at(result, at);
      assert.ok(definition);
      assert.equal(declaration.origin, 'receiving');
      assert.deepEqual(definition.origin, { file: result.document.fileName, start: at, end: at + 1, precision: 'exact' });
      assert.equal(definition.target, declaration.location);
      assert.deepEqual([definition.target.start, definition.target.end], [target, target + 1]);
      assert.equal(binding_highlights(result).find(token => token.range.start === at)?.type, 'hsonReceiving');
    }
    assert.equal(binding_definition_at(result, reference[2]!), undefined);
  }
});
check('definitions and Appearance follow the proven operand and content boundaries in original UTF-16', () => {
  const appearance = new AppearanceSpanCache(cache);
  const trivia = '// 😀\r\n';
  for (const language of ['hson', 'typescript', 'typescriptreact']) {
    const gaps = [invalidOperandDocument, malformedContentDocument, '<aside a=^{bad[/> ' + receivingPart + ' ]/>' + receivingPart];
    if (language !== 'hson') gaps.push(
      "<aside a=^{bad['${child}/>" + receivingPart + "']/>" + receivingPart,
      '"bad\\q${child}\\"' + receivingPart + '"' + receivingPart,
    );
    for (const gap of gaps) {
      const body = trivia + gap + '\r\n"unfinished ' + receivingPart;
      const text = language === 'hson' ? body : wrap(body);
      const result = snapshot(text, language), spans = appearance.get(grammar, result.document);
      const start = text.indexOf(gap) + gap.length - receivingPart.length;
      const target = start + 21, use = start + 39;
      assert.deepEqual(binding_highlights(result).map(t => [t.range.start, t.range.end, t.type, t.modifiers]), [
        [target, target + 1, 'hsonReceiving', ['hsonLocalName']], [use, use + 1, 'hsonReceiving', ['hsonLocalName']],
      ]);
      for (const match of text.matchAll(/\^\{x\}/g)) {
        const at = match.index + 2, definition = binding_definition_at(result, at);
        const role = spans.find(span => span.range.start <= at && at < span.range.end)?.role;
        if (at === use) {
          assert.deepEqual([definition?.origin.start, definition?.origin.end, definition?.target.start, definition?.target.end],
            [use, use + 1, target, target + 1]);
          assert.equal(role, 'part.receivingArgument');
        } else {
          assert.equal(definition, undefined);
          assert.notEqual(role, 'part.receivingArgument');
        }
      }
    }
  }
});
check('conflicting receivers retain distinct contracts and no local identity in either order', () => {
  const appearance = new AppearanceSpanCache(cache);
  for (const reversed of [false, true]) {
    const part = conflictingPart(reversed).replace('  <p', '  data:y=%{rows}\n  <i for:x=^{y} title=^{x.name}/>\n  <p');
    const {root} = parse_part_binding_source(part);
    const message = 'Conflicting Part local binding "x".';
    assert.throws(() => analyze_part_definition(root), { message });
    const issues: string[] = [];
    const analysis = analyze_part_definition(root, issue => {
      assert.equal(issue.attribute, reversed ? 'data:x' : 'doc:x');
      issues.push(issue.message);
    });
    assert.deepEqual(issues, [message]);
    assert.deepEqual(analysis.receiving.map(d => [d.kind, d.name, d.receiving.reference.name]).sort(), [
      ['data','x','a'], ['data','y','rows'], ['doc','x','b'],
    ]);
    for (const language of ['hson','typescript']) {
      const body = '// 😀\r\n' + part + '\n' + receivingPart + '\n' + ordinarySibling;
      const text = language === 'hson' ? body : wrap(body);
      const result = snapshot(text, language), spans = appearance.get(grammar, result.document);
      const roleAt = (at: number) => spans.find(span => span.range.start <= at && at < span.range.end)?.role;
      const tokens = binding_highlights(result);
      for (const attr of ['data:x','doc:x']) {
        assert.ok(tokens.every(token => token.range.start !== text.indexOf(attr) + attr.indexOf(':') + 1));
      }
      const ambiguous = text.indexOf('^{x}') + 2;
      assert.equal(binding_definition_at(result, ambiguous), undefined);
      assert.equal(roleAt(ambiguous), 'reference.local.content');
      for (const [at, target, role] of [
        [text.indexOf('^{y}') + 2, text.indexOf('data:y') + 5, 'part.receivingArgument'],
        [text.indexOf('^{x.name}') + 2, text.indexOf('for:x') + 4, 'iteration.name'],
        [text.indexOf(receivingPart) + 39, text.indexOf(receivingPart) + 21, 'part.receivingArgument'],
      ] as const) {
        const definition = binding_definition_at(result, at);
        assert.deepEqual([definition?.target.start, definition?.target.end], [target, target + 1]);
        assert.equal(roleAt(at), role);
      }
      assert.equal(binding_definition_at(result, text.lastIndexOf('^{x}') + 2), undefined);
    }
  }
  const triple = '<p hson:part data:x=%{a} doc:x=%{b} str:x=%{c} title=^{x} alt=%{c}/>';
  const result = snapshot(triple);
  assert.deepEqual(result.sources[0]!.declarations, []);
  assert.deepEqual(binding_highlights(result), []);
  assert.equal(binding_definition_at(result, triple.indexOf('^{x}') + 2), undefined);
});
check('bounded lexical errors preserve only the identities of independently admitted Parts', () => {
  const badPart = escapedControlSibling.replace('<aside ', '<aside hson:part data:x=%{x} ref=^{x} ');
  const trivia = '\r\n// 😀 <ignored/>\r\n';
  for (const language of ['hson', 'typescript']) {
    const gaps = [badPart, 'stray words', '01'];
    if (language === 'typescript') gaps.push('/${child}/ note', '/${child}*');
    for (const gap of gaps) {
      const body = receivingPart + trivia + gap + ' ' + receivingPart + trivia + ordinarySibling
        + '<aside title="unclosed ' + receivingPart;
      const text = language === 'hson' ? body : wrap(body);
      const result = snapshot(text, language);
      const starts = [text.indexOf(receivingPart), text.indexOf(receivingPart, text.indexOf(gap) + gap.length)];
      const targets = starts.map(start => start + receivingPart.indexOf('data:x') + 5);
      const uses = starts.map(start => start + receivingPart.indexOf('^{x}') + 2);
      assert.deepEqual(result.sources[0]!.declarations.map(d => d.location.start), targets);
      const tokens = binding_highlights(result);
      assert.deepEqual(tokens.map(t => [t.range.start, t.range.end, t.type, t.modifiers]),
        starts.flatMap((_, i) => [targets[i]!, uses[i]!].map(at => [at, at + 1, 'hsonReceiving', ['hsonLocalName']])));
      for (const match of text.matchAll(/\^\{x\}/g)) {
        const at = match.index + 2, target = targets[uses.indexOf(at)];
        const definition = binding_definition_at(result, at);
        if (target === undefined) assert.equal(definition, undefined);
        else assert.deepEqual([definition?.target.start, definition?.target.end], [target, target + 1]);
      }
    }
  }
});
check('completed Parts keep original UTF-16 ranges through sibling errors, holes and edits', () => {
  const appearance = new AppearanceSpanCache(cache);
  const trivia = '\r\n// 😀 <fake hson:part/>\r\n';
  for (const language of ['hson','typescript','typescriptreact']) {
    const siblings = [invalidSibling, '<aside "quoted <x/>"/>'];
    if (language !== 'hson') siblings.push('<aside ${child}/>', '${child}');
    for (const sibling of siblings) for (const suffix of ['', '<aside attr="', invalidSibling]) {
      const definitions = [iteratorColumn, iteratorColumn.replace('column"', 'other"')];
      const body = [sibling, ...definitions, suffix].join(trivia);
      const text = language === 'hson' ? body : wrap(body);
      const result = snapshot(text, language), spans = appearance.get(grammar, result.document);
      assert.equal(result.sources[0]!.declarations.length, 4);
      for (const element of definitions) {
        const start = text.indexOf(element);
        for (const [ref, decl, role] of [['^{blocks}', 'data:blocks', 'part.receivingArgument'],
          ['^{each.kind}', 'for:each', 'iteration.name'], ['^{each}', 'for:each', 'iteration.name']] as const) {
          const at = text.indexOf(ref, start) + 2, target = text.indexOf(decl, start) + decl.indexOf(':') + 1;
          const definition = binding_definition_at(result, at);
          assert.equal(definition?.target.start, target);
          assert.equal(definition?.target.end, target + decl.length - decl.indexOf(':') - 1);
          assert.equal(spans.find(span => span.range.start === at)?.role, role);
        }
        const member = text.indexOf('kind}', start);
        assert.equal(binding_definition_at(result, member), undefined);
        assert.equal(spans.find(span => span.range.start === member)?.role, 'reference.member');
      }
      const hole=text.indexOf('${child}');
      if(hole>=0) assert.ok(spans.every(span=>span.range.end<=hole || span.range.start>=hole+8));
    }
  }
});
check('an unfinished parent never promotes a nested Part, and errors keep their document offsets', () => {
  const prefix = '// 😀\r\n';
  for (const language of ['hson', 'typescript']) {
    const unfinished = prefix + '<aside\r\n' + canonical;
    const text = language === 'hson' ? unfinished : wrap(unfinished);
    const result = snapshot(text, language);
    assert.deepEqual(binding_highlights(result), []);
    assert.equal(binding_definition_at(result, text.indexOf('^{each.kind}') + 2), undefined);
  }
  const text = canonical + '\r\n' + prefix + invalidSibling;
  const result = snapshot(text);
  assert.equal(binding_definition_at(result, text.indexOf('^{each.kind}') + 2)?.target.start, text.indexOf('for:each') + 4);
  const [diagnostic] = produce_document_diagnostics(result.document);
  assert.equal(diagnostic?.code, 'HSON_PART_DECLARATION_INVALID');
  assert.equal(diagnostic.range.start, text.indexOf('hson:part="invalid"'));
});
check('unsupported and quoted host slots are decided within their own Part', () => {
  const unsupported = iteratorColumn.replace('class="column"', '${child}');
  const quoted = iteratorColumn.replace('class="column"', 'class="before ${label} after"');
  for (const body of [unsupported + quoted, quoted + unsupported]) {
    const text = wrap(body), result = snapshot(text, 'typescript');
    const accepted = text.indexOf(quoted), rejected = text.indexOf(unsupported);
    const at = (start: number) => text.indexOf('^{each.kind}', start) + 2;
    assert.equal(binding_definition_at(result, at(accepted))?.target.start, text.indexOf('for:each', accepted) + 4);
    assert.equal(binding_definition_at(result, at(rejected)), undefined);
    for (const match of text.matchAll(/\$\{(?:label|child)\}/g)) {
      assert.ok(binding_highlights(result).every(token => token.range.end <= match.index || token.range.start >= match.index + match[0].length));
    }
  }
});
check('bare/quoted operands, optional references, escaped roots, quoted keys and CRLF offsets', () => {
  for (const value of ['^{item.kind?}', '"^{item.kind?}"', '^{item["odd}key"][0]?}', String.raw`"^{item[\"odd}key\"][0]?}"`, String.raw`"^{\u0069tem.kind}"`]) {
    const text = '<main hson:part data:item="%{input}"\r\n <p title=' + value + '/>/>';
    const result = snapshot(text), use = result.sources[0]!.references.find(r => r.reference.namespace === 'local')!;
    assert.ok(use, value); assert.equal(use.resolution, 'resolved');
    assert.equal(binding_definition_at(result, use.root.start)?.target.start, text.indexOf('data:item') + 5);
    assert.ok(use.location.start > text.indexOf('\r\n'));
  }
});
check('separate Part authoring regions and invalid nested declarations cannot leak bindings', () => {
  const other = '<main hson:part <p title=^{each}/>/>';
  for (const text of ['```hson\n' + canonical + '\n```\n```hson\n' + other + '\n```', wrap(canonical) + '\nconst other = Hson.document`'+other+'`;']) {
    const result = snapshot(text, text.startsWith('```') ? 'markdown' : 'typescript');
    assert.equal(binding_definition_at(result, text.lastIndexOf('each')), undefined);
    assert.equal(result.sources.at(-1)?.references[0]?.resolution, 'unresolved');
  }
  assert.equal(snapshot('<main hson:part data:d=%{x} <p hson:part title=^{d}/>/>' ).sources[0]?.references.length, 0, 'nested Part definitions are rejected by the authoritative rules');
});
check('version/text/language changes invalidate snapshots; unresolved names remain lexical', () => {
  const first = snapshot(canonical);
  assert.equal(snapshot(canonical), first);
  assert.notEqual(snapshot(canonical, 'hson', 2), first);
  const changed = snapshot(canonical.replace('data:blocks', 'data:renamed'));
  assert.notEqual(changed, first);
  assert.equal(changed.sources[0]!.references.find(r => r.reference.name === 'blocks')?.resolution, 'unresolved');
  assert.equal(binding_definition_at(changed, changed.document.text.indexOf('^{blocks}') + 2), undefined);
  cache.forget(first.document.uri);
  assert.notEqual(snapshot(canonical), first);
  cache.clear();
});
check('TypeScript substitutions and ordinary host identifiers stay outside binding navigation', () => {
  const text = wrap(canonical.replace('class="column"', 'class="${hostValue}"'));
  const result = snapshot(text, 'typescript');
  assert.equal(result.sources[0]!.declarations.length, 2);
  assert.equal(binding_definition_at(result, text.indexOf('hostValue')), undefined);
  assert.ok(binding_highlights(result).every(t => t.range.end <= text.indexOf('${') || t.range.start > text.indexOf('}') ));
  const unavailable = snapshot(wrap(canonical.replace('class="column"', '${attributes}')), 'typescript');
  assert.equal(binding_highlights(unavailable).length, 0);
});
check('text, structural Document references and nested templates retain their own provenance', () => {
  const body = '<main hson:part data:model=%{payload} doc:control=%{content} "^{model.title}" <hson-part ^{control}/>/>';
  for (const language of ['hson', 'markdown', 'typescript', 'typescriptreact']) {
    const text = language === 'hson' ? body : language === 'markdown' ? '```hson\n' + body + '\n```' : wrap(body);
    const result = snapshot(text, language);
    for (const name of ['model', 'control']) {
      const use = result.sources[0]!.references.find(ref => ref.reference.namespace === 'local' && ref.reference.name === name)!;
      assert.equal(use.resolution, 'resolved');
      assert.equal(binding_definition_at(result, use.root.start)?.target.start, text.indexOf(':' + name + '=') + 1);
    }
  }
  const inner = '<p hson:part data:inner=%{payload} title=^{inner.title}/>';
  const nested = wrap('<main hson:part data:outer=%{payload} ${Hson.document`' + inner + '`} title=^{outer.title}/>');
  const result = snapshot(nested, 'typescript');
  assert.equal(binding_definition_at(result, nested.indexOf('^{inner.title}') + 2)?.target.start, nested.indexOf('data:inner') + 5);
  assert.equal(binding_definition_at(result, nested.indexOf('^{outer.title}') + 2), undefined, 'opaque structural substitution withholds outer proof');
});
check('static fromHson strings compose both JavaScript and Hson source correspondence', () => {
  const text = 'import {hson} from "hson-live"; const p=hson.fromHson(' + JSON.stringify(canonical) + ');';
  const result = snapshot(text, 'typescript');
  const each = result.sources[0]!.references.find(r => r.reference.path.length)!;
  assert.equal(each.resolution, 'resolved');
  assert.equal(text.slice(each.root.start, each.root.end), 'each');
  assert.equal(text.slice(each.declaration!.location.start, each.declaration!.location.end), 'each');
});
check('iterator suffix names preserve receiving navigation and iteration semantic identities', () => {
  for (const form of ['for:data', 'for:doc', 'per:doc']) for (const language of ['hson', 'typescript']) {
    const alias = form.slice(4);
    const body = `<main hson:part data:rows=%{payload} <hson-part ${form}=^{rows} at=leaf value=^{${alias}}/>/>`;
    const text = language === 'hson' ? body : wrap(body), result = snapshot(text, language);
    const receiving = result.sources[0]!.declarations.find(declaration => declaration.origin === 'receiving')!;
    const iterator = result.sources[0]!.declarations.find(declaration => declaration.name === alias)!;
    assert.equal(receiving.location.start, text.indexOf('data:rows') + 5);
    assert.equal(iterator.location.start, text.indexOf(form) + 4);
    assert.equal(binding_definition_at(result, text.indexOf('^{rows}') + 2)?.target.start, receiving.location.start);
    assert.equal(binding_definition_at(result, text.indexOf(`^{${alias}}`) + 2)?.target.start, iterator.location.start);
    const highlights = overlay_binding_highlights(hson_highlights(grammar, result.document.fileName, text, result), binding_highlights(result));
    assert.equal(highlights.find(token => token.range.start === receiving.location.start)?.type, 'hsonReceiving');
    assert.equal(highlights.find(token => token.range.start === iterator.location.start)?.type, 'hsonIteration');
  }
});
check('active themes receive standard categories without a House palette override', () => {
  assert.equal(hsonTokenDefinitions.hsonReceiving.superType, 'parameter');
  assert.equal(hsonTokenDefinitions.hsonIteration.superType, 'variable');
  assert.equal(hsonTokenDefinitions.hsonIncomingReference.superType, 'parameter');
});
console.log(`# ${checks} binding intelligence checks passed`);

}
void run().catch(error => { console.error(error); process.exitCode = 1; });
