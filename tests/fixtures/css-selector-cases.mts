import assert from "node:assert/strict";
import { hsonLiveTree, hsonLiveMap } from "../../src/index.ts";
import { parse_style_selector, relative_css_selector } from "../../src/internal/css/relative-selector.ts";
import { create_livetree_runtime, runtime_for_tree } from "../../src/api/livetree/runtime/livetree-runtime.ts";
import { create_staged_livetree_in_runtime } from "../../src/api/livetree/creation/create-livetree.ts";
import { parse_document_stylesheet } from "../../src/internal/css/parse-document-stylesheet.ts";
import { parse_part_stylesheet } from "../../src/internal/css/part-stylesheet.ts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { structured_part_stylesheet } from "../../src/internal/css/structured-css.ts";

const rules = (text: string) => parse_document_stylesheet(text, []).rules;
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
    const textual = parse_part_stylesheet('.a,#b { & > .child {color:red} }');
    assert.equal(textual.rules.length, 1);
    assert.equal(textual.rules[0]!.selector, ':is(.a,#b)>.child');
    assert.equal(parse_part_stylesheet('.a,#b { > .child {color:red} }').rules[0]!.selector, textual.rules[0]!.selector);
    const map = hsonLiveMap.fromLibraries({ parts: { parts: {
      child: { kind: 'document', document: '<button @:label/>',
        css: { '@:label': { '&:future("a&b",inner(a,b))': { color: 'red' } } } },
      outer: { kind: 'document', document: '<main <hson-part at="child"/>/>', stylesheet: '.a,#b { & > .child {opacity:.5} }' },
    } }, page: { document: '<html <head/> <body <hson-part lib="parts" at="outer"/> <hson-part lib="parts" at="outer"/>/>/>' } });
    const page = map.doc.must('page'), snapshot = page.css.snapshot();
    assert.equal(rules(snapshot).filter(rule => rule.selector.includes(':future(')).length, 2);
    assert.ok(rules(snapshot).every(rule => rule.scopes.some(scope => scope.startsWith('@scope '))));
    assert.doesNotMatch(page.render(), /hson:quid/);
    const runtime = authority(map), ledger = runtime.identityEpoch().issued(), before = map.parts.must('parts').snap(), rev = map.rev;
    assert.throws(() => map.parts.must('parts').at(['child']).replace({ kind: 'document', document: '<button/>',
      stylesheet: String.raw`.x:future([hson\:quad="label"]){color:red}` }));
    assert.deepEqual(map.parts.must('parts').snap(), before); assert.equal(page.css.snapshot(), snapshot);
    assert.equal(map.rev, rev); assert.equal(runtime.identityEpoch().issued(), ledger);
    const plain = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } }).doc.must('page');
    plain.css.stylesheet('.a,.b{color:green}.x:future(&,:scope){color:red}');
    assert.equal(rules(plain.css.snapshot()).length, 2);
    assert.equal(rules(plain.css.snapshot())[0]!.selector, '.a,.b');
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
      assert.deepEqual(rules(tree.css.snapshot())[3]!.declarations, [['color', 'blue'], ['content', '""']]);
      handle.clear(); handle.set.color('black');
      assert.equal(selectors(tree.css.snapshot()).at(-1), '.a,#b');
      const scoped = tree.css.global.media('screen').supports('(display:grid)').layer('components');
      scoped.rule('scoped', '.a,.b').setMany({ _hover: { color: 'purple' } });
      assert.deepEqual(rules(tree.css.snapshot()).at(-1)!.scopes, ['@media screen', '@supports (display:grid)', '@layer components']);
      tree.css.global.drop('scoped:hover');
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

  check("Document direct lists retain pseudo placement, atomic revisions, values and deletion", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body/>/>' } });
    const css = map.doc.must('page').css, handle = css.media('screen').sel('.a,.b');
    let commits = 0; const off = map.commits.observe(() => commits++);
    try {
      const rev = map.rev;
      handle.setMany({ color: 'black', _hover: { color: 'red' }, __before: { color: 'blue' } });
      assert.equal(map.rev, rev + 1); assert.equal(commits, 1);
      assert.deepEqual(selectors(css.snapshot()), ['.a,.b', '.a:hover,.b:hover', '.a::before,.b::before']);
      handle.setMany({ color: undefined, _hover: { color: null } });
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
