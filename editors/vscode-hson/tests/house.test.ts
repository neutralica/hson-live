import assert from "node:assert/strict";
import { resolve } from "node:path";
import { INITIAL } from "vscode-textmate";
import { hson_highlights, load_hson_grammar } from "../src/highlighting.js";
import { HSON_APPEARANCE, hsonTokenDefinitions, hsonTokenModifierDefinitions, hsonTokenScopes, type HsonTokenType } from "../src/appearance.js";
import { parse_authored_document_library } from "../../../src/api/livemap/livemap.document.quad.js";
import { analyze_part_definition } from "../../../src/internal/part-definition.js";

async function run() {
  const grammar = await load_hson_grammar(resolve(__dirname, '..'));
  const observedModifiers = new Set<string>();
  for (const extension of ['ts', 'tsx']) {
    const wrap = (body: string) => 'import { Hson } from "hson-live";\r\nexport const parts = { card: Hson.document`' + body + '` };';
    for (const [name, type] of [
      ['hson:part', 'hsonDeclaration'], ['part:optional', 'hsonDirective'], ['for:block', 'hsonIteration'],
      ['block:data', 'hsonReceiving'], ['blocks:data', 'hsonReceiving'], ['data:block', 'hsonSending'],
      ['metadata:row', 'hsonProperty'], ['foo:part:optional', 'hsonProperty'],
    ]) {
      const flag = name === 'hson:part' || name === 'part:optional';
      const body = '<section ' + name + (flag ? '' : '="%{blocks}"') + ' <hson-part at="^{block.kind}"/>/>';
      const text = wrap(body), start = text.indexOf(name!);
      const tokens = hson_highlights(grammar, `/workspace/taxonomy.${extension}`, text);
      const pieces = tokens.filter(token => token.range.start >= start && token.range.end <= start + name!.length);
      let offset = start;
      const expected = name!.split(/(:)/).map((value, index) => {
        const result = { range: { start: offset, end: offset + value.length }, type: value === ':' ? 'hsonColon' : type,
          modifiers: value === ':' ? [] : [index === 0 ? 'hsonQualifier' : 'hsonLocalName'] };
        offset += value.length; return result;
      });
      assert.deepEqual(pieces.map(({ range, type, modifiers }) => ({ range, type, modifiers })), expected, name);
      for (const token of pieces) {
        for (const modifier of token.modifiers) observedModifiers.add(modifier);
        const selector = [token.type, ...token.modifiers].join('.');
        assert.ok(hsonTokenScopes[selector], selector);
      }
    }
    const body = '<section title="😀" blocks:data="%{blocks}" <hson-part at="^{block.kind[0]}"/> <list [1,2]> />';
    const text = wrap(body), tokens = hson_highlights(grammar, `/workspace/delimiters.${extension}`, text);
    const expect = (needle: string, offset: number, value: string, type: string, modifier: string) => {
      const start = text.indexOf(needle) + offset;
      const actual = tokens.find(token => token.range.start === start);
      assert.deepEqual(actual && { range: actual.range, type: actual.type, modifiers: actual.modifiers },
        { range: { start, end: start + value.length }, type, modifiers: [modifier] }, needle);
      assert.equal(text.slice(start, actual!.range.end), value);
      observedModifiers.add(modifier);
    };
    expect('<section', 0, '<', 'hsonDelimiter', 'hsonTagOpen');
    expect('/>', 0, '/', 'hsonDelimiter', 'hsonSelfClosing');
    expect('/>', 1, '>', 'hsonDelimiter', 'hsonTagClose');
    expect('[1,2]', 0, '[', 'hsonDelimiter', 'hsonArrayOpen');
    expect('[1,2]', 4, ']', 'hsonDelimiter', 'hsonArrayClose');
    expect('[1,2]', 2, ',', 'hsonDelimiter', 'hsonSequenceSeparator');
    expect('at=', 2, '=', 'hsonOperator', 'hsonAssignment');
    expect('^{block.kind[0]}', 1, '{', 'hsonInterpolationDelimiter', 'hsonInterpolationOpen');
    expect('^{block.kind[0]}', 15, '}', 'hsonInterpolationDelimiter', 'hsonInterpolationClose');
    expect('block.kind', 5, '.', 'hsonReference', 'hsonReferenceSeparator');
    expect('block.kind', 6, 'kind', 'hsonReference', 'hsonMember');
    expect('[0]', 0, '[', 'hsonReference', 'hsonSelectorOpen');
    expect('[0]', 2, ']', 'hsonReference', 'hsonSelectorClose');
    assert.ok(tokens.every((token, index) => token.range.start < token.range.end
      && (!index || tokens[index - 1]!.range.end <= token.range.start)
      && !/[\r\n]/.test(text.slice(token.range.start, token.range.end))));
    assert.ok(tokens.every(token => token.range.start >= text.indexOf(body) && token.range.end <= text.indexOf(body) + body.length), 'host object braces and keys stay native');
    // Incomplete names retain positional syntax without inventing a binding role.
    for (const name of ['blocks:', 'data:', 'hson:pa', 'part:opt', 'foo:part:optional']) {
      const text = wrap('<p ' + name + '\r\n<next enabled/>');
      const tokens = hson_highlights(grammar, `/workspace/partial.${extension}`, text);
      const start = text.indexOf(name);
      const pieces = tokens.filter(token => token.range.start >= start && token.range.end <= start + name.length);
      assert.equal(pieces.map(token => text.slice(token.range.start, token.range.end)).join(''), name);
      assert.ok(pieces.every(token => token.type === 'hsonFlag' || token.type === 'hsonColon'));
      assert.deepEqual(pieces[0]?.modifiers, ['hsonQualifier']);
      assert.equal(tokens.find(token => token.range.start === text.indexOf('next'))?.type, 'hsonType');
    }
  }
  // Literal Hson interpolation is separate from TypeScript template holes.
  const staticText = 'import { hson } from "hson-live";hson.fromHson(\'<p "${value}"/>\');';
  const dollar = hson_highlights(grammar, '/workspace/static.ts', staticText).find(token => token.range.start === staticText.indexOf('$'));
  assert.deepEqual(dollar?.modifiers, ['hsonInterpolationSigil']);
  observedModifiers.add('hsonInterpolationSigil');
  assert.deepEqual([...observedModifiers].sort(), Object.keys(hsonTokenModifierDefinitions).sort(), 'exercise the complete Hson modifier legend');
  const body = '<section hson:part slide:data="%{slide}" data:data="x" part:optional for:row="^{rows}" per:entry="%{entries}" title="Readable text" @:deck>\n<hson-part data:data="^{local}" doc:body="%{body}"/>\n<value 42 true null>\n// comment\n<\'quoted name\'/>\n</section>';
  for (const extension of ['ts', 'tsx']) {
    const text = 'import { Hson } from "hson-live/hson";\nconst document = Hson.document`' + body + '`;';
    const tokens = hson_highlights(grammar, `/workspace/house.${extension}`, text);
    const at = (offset: number) => tokens.find(token => token.range.start === offset);
    for (const [needle, type] of [['^', 'hsonLocalReferenceSigil'], ['%', 'hsonIncomingReferenceSigil']] as const) {
      for (const match of text.matchAll(new RegExp('\\' + needle + '\\{', 'g'))) {
        assert.equal(at(match.index)?.type, type);
        assert.deepEqual(at(match.index)?.range, { start: match.index, end: match.index + 1 });
        assert.equal(at(match.index + 1)?.type, 'hsonInterpolationDelimiter');
        assert.equal(at(match.index + 2)?.type, 'hsonReference');
      }
    }
    for (const [needle, type] of [['hson:', 'hsonDeclaration'], ['slide:', 'hsonReceiving'], ['part:', 'hsonDirective'],
      ['for:', 'hsonIteration'], ['per:', 'hsonIteration'], ['title=', 'hsonProperty']] as const) {
      const start = text.indexOf(needle);
      assert.equal(at(start)?.type, type);
      assert.equal(at(start + needle.length - 1)?.type, needle.endsWith(':') ? 'hsonColon' : 'hsonOperator');
    }
    const ordinary = text.indexOf('data:data'), connector = text.lastIndexOf('data:data');
    assert.equal(at(ordinary)?.type, 'hsonReceiving');
    assert.equal(at(connector)?.type, 'hsonSending');
    assert.equal(at(text.indexOf('"Readable'))?.type, 'hsonQuote');
    assert.equal(at(text.indexOf('Readable'))?.type, 'hsonString');
    assert.equal(at(text.indexOf("'quoted"))?.type, 'hsonQuote');
    assert.equal(at(text.indexOf('quoted name'))?.type, 'hsonType');
    // Every standalone lexical range must have exactly the same embedded scope
    // and range, including compound colons, braces and quote delimiters.
    let stack = INITIAL, offset = text.indexOf(body);
    for (const line of body.split('\n')) {
      const standalone = grammar.tokenizeLine(line, stack); stack = standalone.ruleStack;
      for (const token of standalone.tokens) {
        const end = Math.min(token.endIndex, line.length);
        if (token.startIndex >= end || token.scopes.length === 1) continue;
        const embedded = at(offset + token.startIndex);
        assert.deepEqual(embedded?.scopes, token.scopes);
        assert.equal(embedded?.range.end, offset + end);
      }
      offset += line.length + 1;
    }
  }
  for (const extension of ['ts', 'tsx']) {
    for (const tag of ['p', 'hson-part']) for (const name of ['metadata:row', 'xpart:optional', 'xfor:row', 'foo:part:optional']) {
      const text = 'import { Hson } from "hson-live";Hson.document`<' + tag + ' ' + name + '="x"/>`;';
      const start = text.indexOf(name), end = start + name.length;
      const tokens = hson_highlights(grammar, `/workspace/ordinary.${extension}`, text)
        .filter(token => token.range.start >= start && token.range.end <= end);
      assert.equal(tokens.map(token => text.slice(token.range.start, token.range.end)).join(''), name);
      for (const token of tokens) assert.equal(token.type, text.slice(token.range.start, token.range.end) === ':' ? 'hsonColon' : 'hsonProperty', name);
    }
    const names: readonly [string, HsonTokenType][] = [['part:optional', 'hsonDirective'], ['for:block', 'hsonIteration'],
      ['per:key:value', 'hsonIteration'], ['blocks:data', 'hsonReceiving'], ['data:block', 'hsonSending']];
    for (const [name, type] of names) {
      const text = 'import { Hson } from "hson-live";Hson.document`<p ' + name + '="x"/>`;';
      const start = text.indexOf(name), end = start + name.length;
      const tokens = hson_highlights(grammar, `/workspace/roles.${extension}`, text)
        .filter(token => token.range.start >= start && token.range.end <= end);
      assert.equal(tokens.map(token => text.slice(token.range.start, token.range.end)).join(''), name);
      for (const token of tokens) assert.equal(token.type, text.slice(token.range.start, token.range.end) === ':' ? 'hsonColon' : type, name);
    }
    for (const newline of ['\n', '\r', '\r\n']) {
      const body = '<long\\' + newline + 'Name title="😀 hel\\' + newline + 'lo \\u{1f600}"/>';
      const text = 'import { hson } from "hson-live";hson.fromHson(\'' + body + '\');';
      const tokens = hson_highlights(grammar, `/workspace/continued.${extension}`, text);
      assert.deepEqual(tokens.filter(token => token.type === 'hsonType').map(token => text.slice(token.range.start, token.range.end)), ['long\\', 'Name']);
      assert.deepEqual(tokens.filter(token => token.type === 'hsonString').map(token => text.slice(token.range.start, token.range.end)), ['😀 hel\\', 'lo \\u{1f600}']);
      for (const token of tokens) assert.doesNotMatch(text.slice(token.range.start, token.range.end), /[\r\n]/);
    }
  }
  assert.notEqual(hsonTokenDefinitions.hsonLocalReferenceSigil.role, hsonTokenDefinitions.hsonIncomingReferenceSigil.role);
  for (const mode of ['dark', 'light'] as const) {
    const { punctuation, reference } = HSON_APPEARANCE.syntax.hson;
    assert.deepEqual([punctuation.assignment.house[mode].intensity, punctuation.colon.house[mode].intensity,
      punctuation.quoteOpen.house[mode].intensity, reference.local.marker.house[mode].intensity], [.75, .75, .6, .75]);
  }
  // Check these catalog illustrations with the existing Part contracts, supplying
  // surrounding declarations where a local reference or descendant is required.
  const { part, iteration, reference, punctuation } = HSON_APPEARANCE.syntax.hson;
  const analyzeExample = (code: string) => analyze_part_definition(parse_authored_document_library(code).root);
  for (const entry of [part.receivingArgument, part.receivingKind, punctuation.colon]) {
    for (const example of entry.examples) {
      const receiving = analyzeExample(example.code).receiving;
      assert.deepEqual(receiving.map(local => [local.name, local.kind, local.receiving.reference.namespace]),
        [['slide', 'data', 'incoming']], entry.label);
    }
  }
  for (const example of part.sendingArgument.examples) {
    const analysis = analyzeExample('<section slide:data=%{slide} ' + example.code + '/>');
    assert.deepEqual(analysis.uses.map(use => [use.context, use.reference.namespace, use.binding?.kind]),
      [['forwarding', 'local', 'data']]);
  }
  for (const example of iteration.name.examples) {
    const analysis = analyzeExample('<section rows:data=%{rows} items:data=%{items} ' + example.code + '/>');
    assert.equal(analysis.iterators.size, 1);
    assert.ok(analysis.uses.every(use => use.context === 'iteration'
      && use.reference.namespace === 'local' && use.binding?.kind === 'data'));
  }
  for (const entry of [reference.incoming.marker, reference.local.marker, reference.content, reference.member,
    reference.separator, reference.selectorOpen, reference.selectorClose, punctuation.referenceOpen, punctuation.referenceClose]) {
    for (const example of entry.examples) {
      const analysis = analyzeExample('<section slide:data=%{payload} slides:data=%{collection} ' + example.code + '/>');
      assert.ok(analysis.uses.length > 0, entry.label);
      for (const use of analysis.uses) {
        if (use.reference.path.length) assert.equal(use.reference.namespace, 'local', entry.label);
      }
    }
  }
  console.log('ok - receiving, sending, iteration and reference catalog examples satisfy existing Part contracts');
  console.log('ok - House exact TS/TSX sigil, colon, role, quote and standalone scope/range parity');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
