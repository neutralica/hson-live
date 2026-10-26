import { encode_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { css_value_semantics_cases } from './css-value-semantics-cases.mts';
import assert from "node:assert/strict";
import { hsonLiveTree, hsonLiveMap } from "../../src/index.ts";
import type { LiveMap } from "../../src/types/livemap.types.ts";
import { parse_style_selector, relative_css_selector } from "../../src/internal/css/relative-selector.ts";
import { create_livetree_runtime, runtime_for_tree } from "../../src/api/livetree/runtime/livetree-runtime.ts";
import { create_staged_livetree_in_runtime } from "../../src/api/livetree/creation/create-livetree.ts";
import { structured_css_fixture } from "../helpers/structured-css-fixture.mts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { structured_part_stylesheet } from "../../src/internal/css/structured-css.ts";
import { bound_document_css_api } from "../../src/api/livetree/managers/bound-document-css.ts";

const rules = (text: string) => structured_css_fixture(text).rules;
const selectors = (text: string) => rules(text).map(rule => rule.selector);
const subject = (quid: string) => `[hson\\:quid="${quid}"]`;
const invalid = ["", " ", ",.a", ".a,", ".a,,.b", '[data-x="broken]', '.a >', '.a > + .b', ':is(.a,)', ':future(mark'];
const unsupported = ['& .a,& .b', '& .a,.escape', ':is(&,.escape)', '& + &', '&:is(&,.a)',
  '&:future(&)', '&:future(:scope)', String.raw`&:future(:\73 cope)`,
  String.raw`&:future([hson\:quad="label"])`, String.raw`&:future([hson\:quid="000000rt1"])`,
  String.raw`&:future([ns|hson\:quad="label"])`, String.raw`&:future([hson\3a quad="label"])`];
const safe = [':has(> .a, > .b)', ':is(.a,#b)', ':where(.a,.b)', ':not(.a,.b)', ':nth-child(2n + 1 of .a,.b)',
  ':future(mark,inner(a,b))', String.raw`:f\75ture("a&b",[data-x="a,b"],.a\&b)`,
  String.raw`::part(a\,b a\&b)`, String.raw`:future("[hson\:quad='x'] :scope &",/* & :scope */.a\&b)`, ':future(a,,b)', ':future(initial default *)'];

export function css_selector_cases(check: (name: string, run: () => void) => void): void {
  css_value_semantics_cases(check);
  check("structured selectors preserve balanced functions without a pseudo grammar policy", () => {
    for (const suffix of safe) {
      const result = structured_part_stylesheet({ [`&${suffix}`]: { color: 'red', _hover: { color: 'blue' } } }, new Set());
      assert.equal(result.rules.length, 2);
      assert.equal(result.rules[0]!.selector, selectors(`:scope${suffix}{color:red}`)[0]);
      assert.equal(result.rules[1]!.selector, selectors(`:scope${suffix}:hover{color:blue}`)[0]);
    }
    const escaped = String.raw`& .a\,b[data-x="a,b&c"]`;
    assert.equal(relative_css_selector(escaped, ':scope'), String.raw`:scope .a\,b[data-x="a,b&c"]`);
    for (const key of unsupported) assert.throws(() => structured_part_stylesheet({ [key]: { color: 'red' } }, new Set()), key);
  });

  check("unsupported structured composition rejects whole definitions before publication or identity", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
    const before = map.capture(), rev = map.rev;
    let commits = 0;
    const off = map.commits.observe(() => commits++);
    try {
      for (const key of unsupported) {
        assert.throws(() => map.addLibraries({ parts: { parts: { sample: { kind: 'document', document: '<main/>',
          css: { color: 'red', '& .valid': { color: 'green' }, [key]: { color: 'blue' } } as never } } } }), key);
        assert.deepEqual(map.capture(), before); assert.equal(map.rev, rev); assert.equal(commits, 0);
      }
    } finally { off(); }
  });

  check("textual lists and nested Parts retain ownership, opaque arguments and correspondence", () => {
    const map = hsonLiveMap.fromLibraries({ parts: { parts: {
      child: { kind: 'document', document: '<button @:label/>',
        css: { '@:label': { '&:future("a&b",inner(a,b))': { color: 'red' } } } },
      outer: { kind: 'document', document: '<main <hson-part at="child"/>/>', stylesheet: '.a,#b { & > .child {opacity:.5} }' },
    } }, page: { document: '<html <head/> <body <hson-part lib="parts" at="outer"/> <hson-part lib="parts" at="outer"/>/>/>' } });
    const page = map.doc.must('page'), snapshot = page.css.snapshot();
    assert.equal(encode_portable_document_stylesheet(authority(map).stylesheet(authority(map).libraries().at(-1)!)).rules.filter(rule => rule.selector.includes(':future(')).length, 2);
    assert.ok(snapshot.includes('.a,#b { & > .child {opacity:.5} }'));
    assert.doesNotMatch(page.render(), /hson:quid/);
    const runtime = authority(map), ledger = runtime.identityEpoch().issued(), before = map.parts.must('parts').snap(), rev = map.rev;
    assert.doesNotThrow(() => map.parts.must('parts').at(['child']).replace({ kind: 'document', document: '<button/>',
      stylesheet: String.raw`.x:future([hson\:quad="label"]){color:red}` }));
    assert.notDeepEqual(map.parts.must('parts').snap(), before); assert.equal(page.css.snapshot(), snapshot);
    assert.equal(map.rev, rev + 1); assert.equal(runtime.identityEpoch().issued().size, ledger.size);
    const plain = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } }).doc.must('page');
    plain.css.stylesheet('.a,.b{color:green}.x:future(&,:scope){color:red}');
    assert.equal(plain.css.snapshot(), '.a,.b{color:green}.x:future(&,:scope){color:red}');
  });

  check("runtime structured keys reject lists and hidden transforms before any earlier writes", () => {
    const tree = hsonLiveTree.fromHson('<main/>', { isolated: true });
    try {
      const handles = [tree.css, tree.css.media('screen'), tree.css.supports('(display:grid)').layer('components'),
        tree.css.selector('& .child'), tree.css.global.sel('.a,.b'), tree.css.global.media('screen').sel('.a,.b')];
      const runtime = runtime_for_tree(tree), ids = [...runtime.issuedQuids], node = tree.node;
      tree.css.global.sel('.existing').set.color('gold');
      const before = tree.css.snapshot(), keys = tree.css.global.list();
      for (const handle of handles) for (const key of unsupported) {
        assert.throws(() => handle.setMany({ color: 'red', _hover: { color: 'green' }, [key]: { color: 'blue' } } as never), key);
        assert.equal(tree.css.snapshot(), before); assert.deepEqual(tree.css.global.list(), keys);
        assert.deepEqual([...runtime.issuedQuids], ids); assert.deepEqual(tree.node, node);
      }
    } finally { tree.remove(); }
  });

  check("global direct lists retain recursive per-arm pseudos and native parent specificity", () => {
    const tree = hsonLiveTree.fromHson('<main/>', { isolated: true });
    try {
      const handle = tree.css.global.sel('.a,#b');
      handle.setMany({ color: 'black', _hover: { color: 'red', _focus: { opacity: .5 } },
        __before: { color: 'blue' }, '& > .child': { color: 'green' } });
      assert.deepEqual(selectors(tree.css.snapshot()), ['.a,#b', '.a:hover,#b:hover',
        '.a:hover:focus,#b:hover:focus', '.a::before,#b::before', ':is(.a,#b)>.child']);
      assert.deepEqual(rules(tree.css.snapshot())[3]!.declarations, [['color', 'blue']]);
      handle.clear(); handle.set.color('black');
      assert.equal(selectors(tree.css.snapshot()).at(-1), '.a,#b');
      const scoped = tree.css.global.media('screen').supports('(display:grid)').layer('components');
      scoped.rule('scoped', '.a,.b').setMany({ _hover: { color: 'purple' } });
      assert.deepEqual(rules(tree.css.snapshot()).at(-1)!.scopes, ['@media screen', '@supports (display:grid)', '@layer components']);
      scoped.sel('.a:hover,.b:hover').drop();
      assert.equal(selectors(tree.css.snapshot()).at(-1), '.a,#b');
    } finally { tree.remove(); }
  });

  check("direct node selectors retain lists, QUID specificity, literal ampersands and pseudo-elements", () => {
    const tree = hsonLiveTree.fromHson('<main/>', { isolated: true });
    try {
      const q = subject(tree.quid);
      const pattern = String.raw`:hover,:focus,:is(.a,.b),[data-x="a&b"],.a\&b,.escaped\,comma,::before`;
      const handle = tree.css.selector(pattern);
      handle.set.color('red');
      assert.deepEqual(selectors(tree.css.snapshot()), [String.raw`${q}:hover,${q}:focus,${q}:is(.a,.b),${q}[data-x="a&b"],${q}.a\&b,${q}.escaped\,comma,${q}::before`]);
      assert.equal(tree.css.selector(pattern).get.color(), 'red');
      handle.clear(); assert.equal(tree.css.snapshot(), '');
      tree.css.selector('&:hover,&:focus').setMany({ __after: { color: 'blue' } });
      assert.equal(selectors(tree.css.snapshot())[0], `${q}:hover::after,${q}:focus::after`);
      for (const suffix of safe) {
        tree.css.selector(suffix).set.color('green');
        const branch: Record<`&${string}`, { color: string }> = { [`&${suffix}`]: { color: 'blue' } };
        tree.css.media('screen').setMany(branch);
      }
    } finally { tree.remove(); }
  });

  check("explicit selector handles compose mixed relative and pseudo branches from their receiver", () => {
    const tree = hsonLiveTree.fromHson('<main/>', { isolated: true });
    try {
      const q = subject(tree.quid), parent = `${q}>.card`;
      const handle = tree.css.selector('& > .card');
      assert.equal(handle.setMany({ color: 'black',
        _hover: { opacity: .5, '& > .label': { __before: { color: 'gold' } } },
        '& > .item': { color: 'blue', _focus: { '& + .badge': { color: 'green' } }, __after: { color: 'purple' } },
      }), tree);
      assert.deepEqual(selectors(tree.css.snapshot()), [parent, `${parent}:hover`,
        `${parent}:hover>.label::before`, `${parent}>.item`, `${parent}>.item:focus+.badge`, `${parent}>.item::after`]);
      const pseudoRules = rules(tree.css.snapshot()).filter(rule => /::(?:before|after)$/.test(rule.selector));
      assert.equal(pseudoRules.length, 2);
      assert.ok(pseudoRules.every(rule => rule.declarations.every(([key]) => key !== 'content')));
      const item = tree.css.selector('& > .card > .item');
      assert.equal(item.get.color(), 'blue');
      const keys = tree.css.global.list();
      item.set.color('red');
      assert.deepEqual(tree.css.global.list(), keys);
      assert.equal(rules(tree.css.snapshot()).find(rule => rule.selector === `${parent}>.item`)!.declarations[0]![1], 'red');
      tree.css.clear();
      assert.equal(tree.css.snapshot(), '');
    } finally { tree.remove(); }
  });

  check("recursive and explicit handles share canonical keys at every depth and scope", () => {
    const tree = hsonLiveTree.fromHson('<main/>', { isolated: true });
    try {
      const q = subject(tree.quid), leaf = `${q}>.a>.b>.c`;
      const contexts = [
        { css: tree.css, scopes: [] },
        { css: tree.css.media('screen'), scopes: ['@media screen'] },
        { css: tree.css.supports('(display:grid)'), scopes: ['@supports (display:grid)'] },
        { css: tree.css.layer('components'), scopes: ['@layer components'] },
        { css: tree.css.media('screen').supports('(display:grid)').layer('components'),
          scopes: ['@media screen', '@supports (display:grid)', '@layer components'] },
      ];
      tree.css.global.sel('.before').set.color('black');
      for (const { css, scopes } of contexts) {
        const recursive = css.selector('& > .a'), explicit = css.selector('& > .a > .b > .c');
        recursive.setMany({ '& > .b': { '& > .c': { color: 'red',
          _hover: { '& > .d': { __before: { color: 'gold' } } } } } });
        assert.equal(explicit.get.color(), 'red');
        const pseudo = css.selector('& > .a > .b > .c:hover > .d::before');
        assert.equal(pseudo.get.color(), 'gold'); assert.equal(pseudo.get.content(), undefined);
        tree.css.global.sel('.after').set.color('black');
        const keys = tree.css.global.list(), order = rules(tree.css.snapshot()).map(rule => [rule.selector, rule.scopes]);
        explicit.set.color('blue');
        recursive.setMany({ '& > .b': { '& > .c': { color: 'green' } } });
        assert.deepEqual(Object.entries(explicit.getMany()), [['color', 'green']]);
        css.setMany({ '& > .a': { '& > .b': { '& > .c': { color: 'purple' } } } });
        assert.equal(explicit.get.color(), 'purple');
        explicit.set.color('orange');
        assert.equal(explicit.get.color(), 'orange');
        assert.deepEqual(tree.css.global.list(), keys);
        assert.deepEqual(rules(tree.css.snapshot()).map(rule => [rule.selector, rule.scopes]), order);
        const matches = rules(tree.css.snapshot()).filter(rule => rule.selector === leaf && JSON.stringify(rule.scopes) === JSON.stringify(scopes));
        assert.equal(matches.length, 1); assert.deepEqual(matches[0]!.declarations, [['color', 'orange']]);
        const before = tree.css.snapshot();
        assert.throws(() => recursive.setMany({ color: 'blue', '& > .b': { color: 'red',
          '& > .c': { color: 'green', _hover: { '& + &': { color: 'gold' } } } } }));
        assert.equal(tree.css.snapshot(), before); assert.deepEqual(tree.css.global.list(), keys);
      }
      tree.css.clear(); assert.deepEqual(tree.css.global.list(), ['sel:.after', 'sel:.before']);
    } finally { tree.remove(); }
  });

  check("deep and shallow relative writes on direct lists keep one rule and specificity", () => {
    const tree = hsonLiveTree.fromHson('<main/>', { isolated: true });
    try {
      const q = subject(tree.quid), handle = tree.css.selector('.a,#b');
      handle.setMany({ '& > .item': { '& > .leaf': { color: 'red' } } });
      const keys = tree.css.global.list();
      handle.setMany({ '& > .item > .leaf': { color: 'blue' } });
      assert.deepEqual(tree.css.global.list(), keys);
      handle.setMany({ '& > .item': { '& > .leaf': { color: 'green' } } });
      assert.deepEqual(tree.css.global.list(), keys);
      const rendered = rules(tree.css.snapshot());
      assert.equal(rendered.length, 1); assert.equal(rendered[0]!.selector, `:is(${q}.a,${q}#b)>.item>.leaf`);
      assert.deepEqual(rendered[0]!.declarations, [['color', 'green']]);
    } finally { tree.remove(); }
  });

  check("explicit selector recursion keeps direct lists and parent specificity", () => {
    const tree = hsonLiveTree.fromHson('<main/>', { isolated: true });
    try {
      const q = subject(tree.quid), parent = `${q}.a,${q}#b`;
      tree.css.selector('.a,#b').setMany({ color: 'black', _hover: { '& > .label': { color: 'red' } },
        '& > .item': { color: 'green', _focus: { __before: { color: 'blue' } } } });
      assert.deepEqual(selectors(tree.css.snapshot()), [parent,
        `:is(${q}.a:hover,${q}#b:hover)>.label`, `:is(${parent})>.item`, `:is(${parent})>.item:focus::before`]);
    } finally { tree.remove(); }
  });

  check("scoped explicit recursion retains keys, wrappers and owner cleanup", () => {
    const tree = hsonLiveTree.fromHson('<main <span/>/>', { isolated: true });
    try {
      const child = tree.find.must.byTag('span');
      tree.css.global.sel('.sentinel').set.color('gold');
      tree.css.selector('& > .card').set.color('black');
      child.css.media('screen').selector('& > .child').setMany({ '& > .leaf': { color: 'purple' } });
      const scoped = tree.css.media('screen').supports('(display:grid)').layer('components');
      scoped.selector('& > .card').setMany({ color: 'blue', '& > .item': { color: 'red', _hover: { __before: { color: 'green' } } } });
      const owned = rules(tree.css.snapshot()).filter(rule => rule.scopes.length === 3);
      assert.equal(owned.length, 3);
      assert.ok(owned.every(rule => JSON.stringify(rule.scopes) === JSON.stringify(['@media screen', '@supports (display:grid)', '@layer components'])));
      assert.equal(scoped.selector('& > .card > .item').get.color(), 'red');
      assert.equal(tree.css.selector('& > .card').get.color(), 'black');
      const keep = rules(tree.css.snapshot()).filter(rule => rule.scopes.length !== 3);
      scoped.clear();
      assert.deepEqual(rules(tree.css.snapshot()), keep);
      assert.equal(child.css.media('screen').selector('& > .child > .leaf').get.color(), 'purple');
      tree.css.clear();
      assert.equal(rules(tree.css.snapshot()).length, 2);
      child.css.clear();
      assert.deepEqual(tree.css.global.list(), ['sel:.sentinel']);
    } finally { tree.remove(); }
  });

  check("explicit recursion preflights invalid and oversized later branches without publication", () => {
    const runtime = create_livetree_runtime();
    const tree = create_staged_livetree_in_runtime({ $_tag: 'main', $_content: [] }, runtime);
    try {
      const handle = tree.css.selector('.card');
      assert.equal(runtime.issuedQuids.size, 1);
      handle.set.color('navy');
      const before = tree.css.snapshot(), keys = tree.css.global.list(), node = tree.node;
      for (const branch of unsupported) {
        assert.throws(() => handle.setMany({ color: 'red', '& > .valid': { color: 'green' },
          _focus: { [branch]: { color: 'blue' } } } as never));
        assert.equal(tree.css.snapshot(), before); assert.deepEqual(tree.css.global.list(), keys);
        assert.deepEqual(tree.node, node); assert.equal(runtime.issuedQuids.size, 1);
      }
      const deep = ':is('.repeat(128) + '.a' + ')'.repeat(128);
      const large = tree.css.media('screen').selector(`${deep},.b`);
      assert.throws(() => large.setMany({ color: 'red', _hover: { color: 'green' }, '& > .late': { color: 'blue' } }), /resource limit/);
      assert.equal(tree.css.snapshot(), before); assert.deepEqual(tree.css.global.list(), keys);
      assert.deepEqual(tree.node, node); assert.equal(runtime.issuedQuids.size, 1);
      handle.setMany({ '& > .valid': { color: 'green' } });
      assert.equal(tree.css.selector('.card > .valid').get.color(), 'green');
    } finally { tree.remove(); }
  });

  check("singleton getters, rule keys, update order, scoped clear and recreation remain stable", () => {
    const tree = hsonLiveTree.fromHson('<main <span class=child/>/>', { isolated: true });
    try {
      tree.css.set.color('red'); tree.css.var.set('accent', 'teal');
      assert.equal(tree.css.get.color(), 'red'); assert.equal(tree.css.var.value('accent'), 'teal');
      const copy = tree.css.getMany(); Reflect.set(copy, 'color', 'wrong'); assert.equal(tree.css.get.color(), 'red');
      const relative = tree.css.selector('& > .child'); relative.set.color('green');
      tree.css.global.sel('.sentinel').set.color('gold');
      const keys = tree.css.global.list(), order = selectors(tree.css.snapshot());
      relative.set.color('blue'); assert.deepEqual(tree.css.global.list(), keys);
      assert.deepEqual(selectors(tree.css.snapshot()), order);
      assert.equal(tree.css.selector('&>.child').get.color(), 'blue');
      relative.setMany({ __before: { color: 'purple' } });
      const media = tree.css.media('screen'), supports = tree.css.supports('(display: grid)'), layer = tree.css.layer('components');
      media.set.display('grid'); supports.set.opacity('.75'); layer.set.zIndex(2);
      assert.equal(media.get.display(), 'grid'); assert.equal(supports.get.opacity(), '.75'); assert.equal(layer.get.zIndex(), '2');
      media.clear(); assert.equal(media.get.display(), undefined); media.set.display('grid'); assert.equal(media.get.display(), 'grid');
      relative.clear(); assert.equal(relative.get.color(), undefined); relative.set.color('blue');
      assert.equal(selectors(tree.css.snapshot()).at(-1), `${subject(tree.quid)}>.child`);
      tree.css.clear(); assert.deepEqual(tree.css.global.list(), ['sel:.sentinel']);
    } finally { tree.remove(); }
  });

  check("public TreeSelector broadcasts independent base, pseudo and relative writes and retirement", () => {
    const tree = hsonLiveTree.fromHson('<main <span/> <span/>/>', { isolated: true });
    try {
      const selection = tree.findAll.must.byTag('span'), [first, second] = selection.array();
      assert.ok(first && second);
      selection.css.setMany({ color: 'gold', _hover: { color: 'green' }, '& > .child': { color: 'blue' } });
      for (const item of [first, second]) {
        assert.equal(item.css.get.color(), 'gold'); assert.equal(item.css.selector('&:hover').get.color(), 'green');
        assert.equal(item.css.selector('&>.child').get.color(), 'blue');
      }
      assert.equal(selectors(tree.css.snapshot()).some(selector => selector.includes(',')), false);
      const retired = subject(first.quid);
      first.remove(); assert.equal(selectors(tree.css.snapshot()).some(selector => selector.includes(retired)), false);
      assert.ok(selectors(tree.css.snapshot()).includes(subject(second.quid)));
      second.css.clear(); assert.equal(tree.css.snapshot(), '');
    } finally { tree.remove(); }
  });

  check("malformed selectors and opaque transforms leave runtime CSS and identity unchanged", () => {
    const runtime = create_livetree_runtime();
    const tree = create_staged_livetree_in_runtime({ $_tag: 'main', $_content: [] }, runtime);
    try {
      const node = tree.node;
      for (const pattern of [...invalid, ':future(&)', ':future(:scope)', String.raw`:future([hson\:quad="x"])`]) {
        assert.throws(() => tree.css.global.sel(pattern).set.color('red'), pattern);
        assert.equal(tree.css.snapshot(), ''); assert.deepEqual(tree.node, node);
        assert.throws(() => tree.css.selector(pattern).set.color('red'), pattern);
        assert.equal(runtime.issuedQuids.size, 0); assert.equal(runtime.quidToNode.size, 0);
      }
      for (const key of unsupported) {
        assert.throws(() => tree.css.setMany({ color: 'red', [key]: { color: 'blue' } } as never));
        assert.equal(tree.css.snapshot(), ''); assert.deepEqual(tree.node, node);
        assert.equal(runtime.issuedQuids.size, 0); assert.equal(runtime.pendingQuidClaims.size, 0);
      }
      assert.equal(tree.css.setMany({ color: 'green' }), tree);
      assert.equal(runtime.issuedQuids.size, 1); assert.equal(tree.css.get.color(), 'green');
    } finally { tree.remove(); }
  });

  check("actual composed output bounds preflight all siblings and nested branches", () => {
    const nested = (depth: number, leaf: string) => ':is('.repeat(depth) + leaf + ')'.repeat(depth);
    assert.doesNotThrow(() => parse_style_selector(nested(128, '.a')));
    assert.throws(() => parse_style_selector(nested(129, '.a')), /resource limit/);
    const tree = hsonLiveTree.fromHson('<main/>', { isolated: true });
    try {
      const handle = tree.css.global.sel(`${nested(128, '.a')},.b`);
      const before = tree.css.snapshot(), keys = tree.css.global.list();
      assert.throws(() => handle.setMany({ color: 'red', _hover: { color: 'green' }, '& .child': { color: 'blue' } }), /resource limit/);
      assert.equal(tree.css.snapshot(), before); assert.deepEqual(tree.css.global.list(), keys);
      const large = tree.css.selector('.' + 'a'.repeat(4_000_000 - subject(tree.quid).length - 1));
      assert.throws(() => large.setMany({ color: 'red', _hover: { color: 'blue' } }), /resource limit/);
      assert.equal(tree.css.snapshot(), before);
    } finally { tree.remove(); }
  });

  check("bound global forwarding uses recursive CssMap and one governed transition", () => {
    const map: LiveMap = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body/>/>' } });
    const page = map.doc.must('page'), binding = { document: page, hosted: false, active: true };
    const bound = bound_document_css_api(binding).media('screen').sel('.card');
    let commits = 0; const stop = map.commits.observe(() => commits++);
    try {
      const rev = map.rev;
      bound.setMany({ color: 'red', width: { value: 2, unit: 'rem' }, '--tone': 'gold',
        _hover: { color: 'blue' }, __before: { color: 'purple' } });
      assert.equal(map.rev, rev + 1); assert.equal(commits, 1);
      assert.deepEqual(selectors(page.css.snapshot()), ['.card', '.card:hover', '.card::before']);
      assert.ok(rules(page.css.snapshot()).every(rule => JSON.stringify(rule.scopes) === JSON.stringify(['@media screen'])));
      bound.setMany({ color: undefined, _hover: { color: undefined } });
      assert.deepEqual(rules(page.css.snapshot())[0]!.declarations, [['width', '2rem'], ['--tone', 'gold']]);
      assert.deepEqual(selectors(page.css.snapshot()), ['.card', '.card::before']);
      const before = page.css.snapshot(), count = commits, currentRev = map.rev;
      bound.setMany({ '& > .child': { _hover: { _focus: { color: 'blue' } } } });
      assert.equal(map.rev, currentRev + 1); assert.equal(commits, count + 1);
      assert.match(page.css.snapshot(), /\.card>\.child:hover:focus\{color:blue/);
      const recursive = page.css.snapshot();
      assert.throws(() => Reflect.apply(bound.setMany, bound, [{ color: 'green', _hover: { _focus: { color: null } } }]));
      assert.equal(page.css.snapshot(), recursive); assert.equal(map.rev, currentRev + 1); assert.equal(commits, count + 1);
      binding.active = false;
      assert.throws(() => bound.setMany({ color: 'green' }), /disposed/);
      assert.equal(page.css.snapshot(), recursive);
    } finally { stop(); }
  });

  check("Document maps share declaration qualification and explicit undefined deletion", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body/>/>' } });
    const css = map.doc.must('page').css, handle = css.sel('.card');
    handle.setMany({ color: 'navy', '--tone': 'gold', width: { value: 2, unit: 'rem' },
      _hover: { color: 'red', '--tone': 'green' }, __before: { color: 'blue', content: '"custom"' } });
    assert.deepEqual(rules(css.snapshot())[0]!.declarations, [['color', 'navy'], ['--tone', 'gold'], ['width', '2rem']]);
    const before = map.capture();
    for (const value of [null, true, false]) {
      assert.throws(() => Reflect.apply(handle.setMany, handle, [{ color: 'red', _hover: { color: value } }]));
      assert.throws(() => Reflect.apply(handle.setProp, handle, ['color', value]));
      assert.deepEqual(map.capture(), before);
    }
    handle.setMany({ color: undefined, '--tone': undefined, _hover: { color: undefined, '--tone': undefined },
      __before: { color: undefined, content: undefined } });
    assert.deepEqual(selectors(css.snapshot()), ['.card']);
    assert.deepEqual(rules(css.snapshot())[0]!.declarations, [['width', '2rem']]);
    handle.remove('width'); assert.equal(css.snapshot(), '');
  });

  check("Document direct lists retain pseudo placement, atomic revisions, values and deletion", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body/>/>' } });
    const css = map.doc.must('page').css, handle = css.media('screen').sel('.a,.b');
    let commits = 0; const off = map.commits.observe(() => commits++);
    try {
      const rev = map.rev;
      handle.setMany({ color: 'black', _hover: { color: 'red' }, __before: { color: 'blue' } });
      assert.equal(map.rev, rev + 1); assert.equal(commits, 1);
      assert.deepEqual(selectors(css.snapshot()), ['.a,.b', '.a:hover,.b:hover', '.a::before,.b::before']);
      handle.setMany({ color: undefined, _hover: { color: undefined } });
      assert.deepEqual(selectors(css.snapshot()), ['.a::before,.b::before']);
      const before = map.capture(), count = commits;
      for (const pattern of invalid) {
        assert.throws(() => css.sel(pattern).setMany({ color: 'red', _hover: { color: 'blue' } }));
        assert.deepEqual(map.capture(), before); assert.equal(commits, count);
      }
      for (const suffix of safe) css.sel(`.host${suffix},.other${suffix}`).setMany({ _focus: { color: 'green' } });
    } finally { off(); }
  });
}
