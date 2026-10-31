import assert from "node:assert/strict";
import { resolve } from "node:path";
import { INITIAL } from "vscode-textmate";
import { hson_highlights, load_hson_grammar } from "../src/highlighting.js";
import { HSON_APPEARANCE, hsonTokenDefinitions, hsonTokenModifierDefinitions, hsonTokenScopes, type HsonTokenType } from "../src/appearance.js";
import { parse_authored_document_library } from "../../../src/api/livemap/livemap.document.quad.js";
import { part_coordinates } from "../../../src/internal/part-coordinates.js";
import { analyze_part_definition } from "../../../src/internal/part-definition.js";

async function run() {
  const grammar = await load_hson_grammar(resolve(__dirname, '..'));
  const observedModifiers = new Set<string>();
  for (const extension of ['ts', 'tsx']) {
    const wrap = (body: string) => 'import { Hson } from "hson-live";\r\nexport const parts = { card: Hson.document`' + body + '` };';
    for (const [name, type] of [
      ['hson:part', 'hsonDeclaration'], ['part:optional', 'hsonDirective'], ['for:block', 'hsonIteration'],
      ['data:block', 'hsonReceiving'], ['data:blocks', 'hsonReceiving'], ['block:data', 'hsonSending'],
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
    const body = '<section title="😀" data:blocks="%{blocks}" <hson-part at="^{block.kind[0]}"/> <list [1,2]> />';
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
  for (const extension of ['ts', 'tsx']) {
    for (const body of ['<hson-part lib=components at=foo/>', '<hson-part lib="components" at="foo"/>',
      '<hson-part at="components/foo"/>', '<hson-part at=components/foo/>', '<hson-part at=foo/>']) {
      const text = 'import { Hson } from "hson-live";Hson.document`' + body + '`;';
      const tokens = hson_highlights(grammar, `/workspace/selectors.${extension}`, text);
      const at = (needle: string) => tokens.find(token => token.range.start === text.indexOf(needle));
      for (const name of ['lib', 'at'].filter(name => body.includes(name + '='))) assert.equal(at(name + '=')?.type, 'hsonPartSystemAttribute');
      if (body.includes('components')) assert.equal(at('components')?.type, 'hsonPartLibrary');
      assert.equal(at('foo')?.type, 'hsonPartMember', 'qualified and unqualified members have one classification');
      if (body.includes('components/foo')) assert.equal(at('/foo')?.type, 'hsonPartSeparator');
    }
    for (const [library, member] of [['组件 库', '名. ♥'], ['odd "library', 'a\\b'], [' spaced ', '😀']]) {
      assert.deepEqual(part_coordinates(undefined, library + '/' + member), { library, member, qualified: true });
      const body = '<hson-part at=' + JSON.stringify(library + '/' + member) + '/>';
      const text = 'import { hson } from "hson-live";hson.fromHson(' + JSON.stringify(body) + ');';
      const tokens = hson_highlights(grammar, `/workspace/quoted.${extension}`, text);
      assert.ok(tokens.some(token => token.type === 'hsonPartLibrary'));
      assert.ok(tokens.some(token => token.type === 'hsonPartMember'));
      assert.ok(tokens.some(token => token.type === 'hsonPartSeparator'));
    }
    for (const value of ['^{each.kind[0]}', '"components/%{member}"', '"components/${member}"', '${member}']) {
      const text = 'import { Hson } from "hson-live";Hson.document`<hson-part at=' + value + '/>`;';
      const tokens = hson_highlights(grammar, `/workspace/dynamic.${extension}`, text);
      assert.ok(tokens.some(token => token.type === 'hsonPartSystemAttribute'));
      assert.ok(!tokens.some(token => ['hsonPartLibrary', 'hsonPartMember', 'hsonPartSeparator'].includes(token.type)), value);
      if (value.includes('${')) {
        const start = text.indexOf('${'), end = text.indexOf('}', start) + 1;
        assert.ok(!tokens.some(token => token.range.start < end && token.range.end > start), 'native TS owns the entire interpolation');
        assert.ok(tokens.some(token => token.type === 'hsonDelimiter' && text.slice(token.range.start, token.range.end) === '>'), 'a masked bare hole cannot consume the following tag');
      }
    }
  }
  // JavaScript line breaks inside holes must not terminate Hson attributes.
  for (const extension of ['ts', 'tsx']) for (const newline of ['\n', '\r\n']) {
    for (const hole of ['${' + newline + '  member' + newline + '}', '${' + newline + '  ' + newline + '\tmember' + newline + '}']) {
      const cases = [
        '<hson-part at="' + hole + '" lib="components"/>',
        '<hson-part at="😀' + hole + hole + '" lib="components"/>',
        '<div title="' + hole + '" class="after" <hson-part at="components/foo"/>/>',
        '<div "before" ' + hole + ' <hson-part lib="components" at="foo"/>/>',
        '<section data:row="%{row}" <hson-part at="' + hole + '" lib="components"/> <hson-part at=^{row.kind}/>/>'
      ];
      for (const body of cases) {
        const text = 'import { Hson } from "hson-live";Hson.document`' + body + '`;';
        const tokens = hson_highlights(grammar, `/workspace/multiline.${extension}`, text);
        const incomplete = text.slice(0, -2);
        // Discovery conservatively leaves unterminated host templates native.
        assert.deepEqual(hson_highlights(grammar, `/workspace/multiline.${extension}`, incomplete), []);
        // Compare every literal segment to a single-line expression at identical
        // UTF-16 offsets; only JavaScript's physical lines differ.
        const flattened = text.replaceAll(hole, hole.replace(/[\r\n]/g, ' '));
        assert.deepEqual(tokens, hson_highlights(grammar, `/workspace/multiline.${extension}`, flattened));
        for (const token of tokens) assert.ok(!/[\r\n]/.test(text.slice(token.range.start, token.range.end)));
        for (const match of text.matchAll(/lib="components"/g)) {
          assert.equal(tokens.find(t => t.range.start === match.index)?.type, 'hsonPartSystemAttribute');
          assert.equal(tokens.find(t => t.range.start === match.index + 5)?.type, 'hsonPartLibrary');
        }
        if (body.includes('class="after"')) {
          assert.equal(tokens.find(t => t.range.start === text.indexOf('class='))?.type, 'hsonProperty');
          assert.equal(tokens.find(t => t.range.start === text.indexOf('after'))?.type, 'hsonString');
        }
        assert.equal(tokens.find(t => t.range.start === text.lastIndexOf('>'))?.type, 'hsonDelimiter');
      }
    }
    // Real literal newlines still recover malformed attributes at the next line.
    const malformed = 'import { Hson } from "hson-live";Hson.document`<div title="unterminated' + newline + '<hson-part lib="components" at="foo"/>`;';
    const recovered = hson_highlights(grammar, `/workspace/recovery.${extension}`, malformed);
    assert.equal(recovered.find(t => t.range.start === malformed.indexOf('lib='))?.type, 'hsonPartSystemAttribute');
    const outside = 'const text = `plain ${' + newline + 'member' + newline + '} text`;';
    assert.deepEqual(hson_highlights(grammar, `/workspace/outside.${extension}`, outside), []);
  }
  // Literal Hson interpolation is separate from TypeScript template holes.
  const staticText = 'import { hson } from "hson-live";hson.fromHson(\'<p "${value}"/>\');';
  const dollar = hson_highlights(grammar, '/workspace/static.ts', staticText).find(token => token.range.start === staticText.indexOf('$'));
  assert.deepEqual(dollar?.modifiers, ['hsonInterpolationSigil']);
  observedModifiers.add('hsonInterpolationSigil');
  assert.deepEqual([...observedModifiers].sort(), Object.keys(hsonTokenModifierDefinitions).sort(), 'exercise the complete Hson modifier legend');
  const body = '<section hson:part data:slide="%{slide}" data:data="x" part:optional for:row="^{rows}" per:entry="%{entries}" title="Readable text" @:deck>\n<hson-part data:data="^{local}" body:doc="%{body}"/>\n<value 42 true null>\n// comment\n<\'quoted name\'/>\n</section>';
  for (const extension of ['ts', 'tsx']) {
    const text = 'import { Hson } from "hson-live/hson";\nconst document = Hson.document`' + body + '`;';
    const tokens = hson_highlights(grammar, `/workspace/house.${extension}`, text);
    const at = (offset: number) => tokens.find(token => token.range.start === offset);
    for (const [needle, type] of [['^', 'hsonLocalReferenceSigil'], ['%', 'hsonIncomingReferenceSigil']] as const) {
      for (const match of text.matchAll(new RegExp('\\' + needle + '\\{', 'g'))) {
        assert.equal(at(match.index)?.type, type);
        assert.deepEqual(at(match.index)?.range, { start: match.index, end: match.index + 1 });
        assert.equal(at(match.index + 1)?.type, 'hsonInterpolationDelimiter');
        assert.equal(at(match.index + 2)?.type, match[0].startsWith('%') ? 'hsonIncomingReference' : 'hsonReference');
      }
    }
    for (const [needle, type] of [['hson:', 'hsonDeclaration'], ['data:', 'hsonReceiving'], ['part:', 'hsonDirective'],
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
      ['per:key:value', 'hsonIteration'], ['data:blocks', 'hsonReceiving'], ['block:data', 'hsonSending']];
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
    const analysis = analyzeExample('<section data:currentSlide=%{slide} ' + example.code + '/>');
    assert.deepEqual(analysis.uses.map(use => [use.context, use.reference.namespace, use.binding?.kind]),
      [['forwarding', 'local', 'data']]);
  }
  for (const example of iteration.name.examples) {
    const analysis = analyzeExample('<section data:rows=%{rows} data:items=%{items} ' + example.code + '/>');
    assert.equal(analysis.iterators.size, 1);
    assert.ok(analysis.uses.every(use => use.context === 'iteration'
      && use.reference.namespace === 'local' && use.binding?.kind === 'data'));
  }
  for (const entry of [reference.incoming.marker, reference.local.marker, reference.local.content, reference.member,
    reference.separator, reference.selectorOpen, reference.selectorClose, punctuation.referenceOpen, punctuation.referenceClose]) {
    for (const example of entry.examples) {
      const analysis = analyzeExample('<section data:slide=%{payload} data:slides=%{collection} ' + example.code + '/>');
      assert.ok(analysis.uses.length > 0, entry.label);
      for (const use of analysis.uses) {
        if (use.reference.path.length) assert.equal(use.reference.namespace, 'local', entry.label);
      }
    }
  }
  for (const extension of ['ts', 'tsx']) for (const [name, type] of [
    ['for:data', 'hsonIteration'], ['for:doc', 'hsonIteration'], ['for:item:doc', 'hsonIteration'],
    ['per:doc', 'hsonIteration'], ['per:key:doc', 'hsonIteration'],
    ['one:data', 'hsonSending'], ['only:data', 'hsonSending'], ['onload:doc', 'hsonSending'],
  ]) {
    const text = 'import {Hson} from "hson-live/hson"; const p=Hson.document`<hson-part at=leaf ' + name + '=^{local}/>`;';
    const start = text.indexOf(name!), end = start + name!.length;
    const pieces = hson_highlights(grammar, `/workspace/direction.${extension}`, text).filter(token => start <= token.range.start && token.range.end <= end);
    assert.ok(pieces.length > 0, name);
    assert.ok(pieces.every(token => token.type === (text.slice(token.range.start, token.range.end) === ':' ? 'hsonColon' : type)), `${extension}/${name}`);
  }
  console.log('ok - receiving, sending, iteration and reference catalog examples satisfy existing Part contracts');
  console.log('ok - House exact TS/TSX sigil, colon, role, quote and standalone scope/range parity');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
