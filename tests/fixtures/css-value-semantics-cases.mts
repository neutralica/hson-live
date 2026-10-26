import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { decode_portable_document_stylesheet, encode_portable_document_stylesheet, render_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { document_css_state_internal } from "../../src/api/livemap/livemap.libraries.ts";
import assert from 'node:assert/strict';
import { hsonLiveTree, hsonLiveMap, hsonMirror } from '../../src/index.ts';
import { normalize_css_map } from '../../src/core/css-map.ts';
import { create_livetree_runtime } from '../../src/api/livetree/runtime/livetree-runtime.ts';
import { create_staged_livetree_in_runtime } from '../../src/api/livetree/creation/create-livetree.ts';
import { structured_part_stylesheet } from '../../src/internal/css/structured-css.ts';
import { CssRuntimeManager } from '../../src/api/livetree/managers/css-manager.ts';
import { runtime_for_tree } from '../../src/api/livetree/runtime/livetree-runtime.ts';
import type { LiveMap } from '../../src/types/livemap.types.ts';
import type { AnimSpec } from '../../src/types/animate.types.ts';
import { assert_css_declaration_syntax } from '../../src/internal/css/declaration-syntax.ts';
import { CSS_DECLARATION_ESCAPES, CSS_CONTAINED_VALUES, CSS_CONTAINMENT_UNSUPPORTED, CSS_CONTENT_VALUES, CSS_URL_DEPTH_CASES } from './css-declaration-containment-values.mts';

export function css_value_semantics_cases(check: (name: string, run: () => void) => void): void {
  check('defined empty values survive local setters getters nested branches and final declarations', () => {
    const tree = hsonLiveTree.fromHson('<main/>', { isolated: true });
    try {
      for (const handle of [tree.css, tree.css.selector('& .empty'), tree.css.media('screen')]) {
        handle.setMany({ color: 'red' });
        handle.setMany({ color: '' });
        assert.equal(handle.get.color(), '');
        assert.equal(handle.getMany().color, '');
        const empty = tree.css.snapshot();
        assert.match(empty, /color:\s*;/);
        handle.setMany({}); handle.setMany({ color: '' });
        assert.equal(tree.css.snapshot(), empty);
        handle.setMany({ color: undefined });
        assert.equal(handle.get.color(), undefined);
        assert.equal(tree.css.snapshot(), '');
        handle.setMany({ __before: { color: '' } });
        const nested = tree.css.snapshot();
        assert.match(nested, /::before/); assert.match(nested, /color:\s*;/);
        handle.setMany({ __before: {} }); assert.equal(tree.css.snapshot(), nested);
        handle.setMany({ __before: { color: undefined } }); assert.equal(tree.css.snapshot(), '');
      }
      const global = tree.css.global.sel('.empty');
      global.setMany({ color: '' }); assert.match(tree.css.snapshot(), /\.empty\{color:;\}/);
      global.setMany({ color: undefined }); assert.equal(tree.css.snapshot(), '');
      tree.css.global.var.set('empty', ''); assert.equal(tree.css.global.var.value('empty'), '');
      tree.css.global.var.set('empty', undefined); assert.equal(tree.css.snapshot(), '');
    } finally { tree.remove(); }
    const runtime = create_livetree_runtime();
    const lazy = create_staged_livetree_in_runtime({ $_tag: 'main', $_content: [] }, runtime);
    try {
      lazy.css.setMany({ color: '' });
      assert.equal(runtime.issuedQuids.size, 1); assert.equal(lazy.css.get.color(), '');
      lazy.css.setMany({ color: undefined }); assert.equal(lazy.css.snapshot(), '');
    } finally { lazy.remove(); }
  });
  check('Document empty values preserve canonical rules codecs revisions and atomic rejection', () => {
    const map: LiveMap = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body/>/>' } });
    const page = map.doc.must('page'), rule = page.css.sel('.empty');
    for (const css of [{ color: '' }, { __before: { color: '' } }, { $media: { screen: { '& > a': { color: '' } } } }]) {
      const rev = map.rev;
      rule.setMany(css); assert.equal(map.rev, rev + 1);
      const record = encode_portable_document_stylesheet(document_css_state_internal(page));
      assert.equal(record.rules.length, 1); assert.deepEqual(record.rules[0]!.declarations, [['color', '']]);
      assert.deepEqual(encode_portable_document_stylesheet(decode_portable_document_stylesheet(JSON.parse(JSON.stringify(record)))), record);
      assert.match(page.css.snapshot(), /color:;/);
      const restored = install_libraries_snapshot(JSON.parse(JSON.stringify(map.capture()))).map.doc.must('page');
      assert.equal(restored.css.snapshot(), page.css.snapshot());
      rule.setMany({}); rule.setMany(css); assert.equal(map.rev, rev + 1);
      for (const invalid of [null, true, false]) {
        assert.throws(() => Reflect.apply(rule.setMany, rule, [{ color: '', '& > b': { color: invalid } }]));
        assert.equal(map.rev, rev + 1);
        assert.deepEqual(encode_portable_document_stylesheet(document_css_state_internal(page)), record);
      }
      const deletion = css.color !== undefined ? { color: undefined } : css.__before !== undefined
        ? { __before: { color: undefined } } : { $media: { screen: { '& > a': { color: undefined } } } };
      rule.setMany(deletion); assert.equal(map.rev, rev + 2);
      assert.equal(document_css_state_internal(page).rules.length, 0); assert.equal(page.css.snapshot(), '');
      rule.setMany(deletion); assert.equal(map.rev, rev + 2);
    }
  });
  check('empty keyframe declaration values survive the shared canonical codec', () => {
    const map: LiveMap = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body/>/>' } });
    const css = map.doc.must('page').css;
    css.keyframes.set({ name: 'empty', steps: { from: { color: '' } } });
    assert.equal(css.keyframes.get('empty')?.steps[0]?.decls.color, '');
    const record = encode_portable_document_stylesheet(document_css_state_internal(map.doc.must('page')));
    assert.deepEqual(record.keyframes[0]?.steps[0]?.declarations, [['color', '']]);
    assert.deepEqual(encode_portable_document_stylesheet(decode_portable_document_stylesheet(record)), record);
    assert.match(css.snapshot(), /color:\s*;/);
  });
  check('structured Part empty declarations retain authored and canonical values through serialization', () => {
    const css = { color: '', __before: { content: '' }, '@:label': { color: '' },
      $media: { screen: { '& > a': { color: '' } } }, opacity: undefined };
    const record = structured_part_stylesheet(css, new Set(['label']));
    assert.equal(record.rules.length, 4);
    assert.ok(record.rules.every(rule => rule.declarations.every(([, value]) => value === '')));
    const decoded = decode_portable_document_stylesheet(JSON.parse(JSON.stringify(record)));
    assert.deepEqual(encode_portable_document_stylesheet(decoded), record);
    assert.match(render_portable_document_stylesheet(decoded), /color:;/);
    const map: LiveMap = hsonLiveMap.fromLibraries({ parts: { parts: { sample: { kind: 'document', document: '<p @:label/>', css } } } });
    const authored = map.parts.must('parts').at(['sample']).snap()?.css;
    assert.deepEqual(authored, { color: '', __before: { content: '' }, '@:label': { color: '' },
      $media: { screen: { '& > a': { color: '' } } } });
    assert.deepEqual(JSON.parse(JSON.stringify(authored)), authored);
    const restored = install_libraries_snapshot(JSON.parse(JSON.stringify(map.capture()))).map;
    assert.deepEqual(restored.parts.must('parts').at(['sample']).snap()?.css, authored);
  });
  check('quoted URL components obey the same depth bound before any publication', () => {
    const runtime = create_livetree_runtime();
    const tree = create_staged_livetree_in_runtime({ $_tag: 'main', $_content: [] }, runtime);
    try {
      const manager = CssRuntimeManager.forRuntime(runtime);
      for (const { value } of CSS_URL_DEPTH_CASES.filter(item => item.depth > 128)) {
        assert.throws(() => tree.css.setMany({ color: 'red', '--depth': value }));
        assert.equal(runtime.issuedQuids.size, 0); assert.equal(tree.css.snapshot(), '');
      }
      const handles = [tree.style, tree.css, tree.css.media('screen'), tree.css.global.sel('.depth')];
      const issued = [...runtime.issuedQuids]; // Scoped capability acquisition may already demand identity.
      for (const { value } of CSS_URL_DEPTH_CASES.filter(item => item.depth > 128)) {
        assert.throws(() => assert_css_declaration_syntax('--depth', value), TypeError);
        for (const handle of handles) {
          assert.throws(() => handle.setMany({ color: 'red', '--depth': value }));
          assert.equal(tree.css.snapshot(), ''); assert.equal(tree.node.$_attrs?.style, undefined);
          assert.deepEqual([...runtime.issuedQuids], issued); assert.equal(Reflect.get(manager, 'nextRuleOrder'), 0);
          assert.equal(Reflect.get(manager, 'changed'), false);
        }
      }
      for (const { value } of CSS_URL_DEPTH_CASES.filter(item => item.depth <= 128)) {
        assert.doesNotThrow(() => assert_css_declaration_syntax('--depth', value));
        for (const handle of handles) {
          handle.setProp('--depth', value);
          assert.ok(tree.css.snapshot().includes(value)
            || Object.values(tree.node.$_attrs?.style ?? {}).includes(value));
          handle.setProp('--depth', undefined);
        }
      }
    } finally { tree.remove(); }
  });
  check('final content declarations retain authored expressions across runtime stylesheet receivers', () => {
    const tree = hsonLiveTree.fromHson('<main/>', { isolated: true });
    try {
      const handles = [tree.css, tree.css.selector('&::before'), tree.css.media('screen'),
        tree.css.global.sel('.content')];
      tree.css.global.sel('.neighbor').set.color('blue');
      for (const handle of handles) {
        for (const content of CSS_CONTENT_VALUES) {
          handle.setMany({ '--before': 'kept', content, '--after': 'kept' });
          const text = tree.css.snapshot();
          assert.match(text, /--before:\s*kept;/); assert.match(text, /--after:\s*kept;/);
          assert.match(text, /\.neighbor\{color:blue;\}/);
          // Comparing the complete declaration also catches quoting of a literal expression.
          assert.ok(text.includes(`content:${content};`) || text.includes(`content: ${content};`), JSON.stringify({ content, text }));
        }
        handle.setMany({ '--before': undefined, content: undefined, '--after': undefined });
      }
      assert.equal(tree.css.snapshot(), '.neighbor{color:blue;}');
    } finally { tree.remove(); }
  });
  check('authored declaration slots use a bounded containment language without a CSS parser oracle', () => {
    for (const value of [...CSS_DECLARATION_ESCAPES, ...CSS_CONTAINMENT_UNSUPPORTED]) {
      for (const property of ['animation-name', '--tokens']) {
        assert.throws(() => assert_css_declaration_syntax(property, value), TypeError, value);
      }
    }
    for (const [property, value] of CSS_CONTAINED_VALUES) {
      assert.doesNotThrow(() => assert_css_declaration_syntax(property, value));
      assert.equal(normalize_css_map({ [property]: value })[property], value);
    }
    for (const value of ['x'.repeat(4_000_001), '('.repeat(129) + ')'.repeat(129)]) {
      assert.throws(() => assert_css_declaration_syntax('--tokens', value), TypeError);
    }
    for (const value of ['x'.repeat(4_000_000), '('.repeat(128) + ')'.repeat(128)]) {
      assert.doesNotThrow(() => assert_css_declaration_syntax('--tokens', value));
    }
  });
  check('animation and direct manager containment reject before declarations order or publication change', () => {
    const tree = hsonLiveTree.fromHson('<main <span/>/>', { isolated: true });
    try {
      const runtime = runtime_for_tree(tree), manager = CssRuntimeManager.forRuntime(runtime), quid = tree.quid;
      const neighbor = tree.find.must.byTag('span');
      tree.css.global.sel('.before').set.color('gold');
      tree.css.setMany({ color: 'red', opacity: .5 });
      neighbor.css.set.width('1px');
      tree.css.media('screen').set.color('blue');
      tree.css.anim.begin({ name: 'kept', duration: '1s' });
      tree.css.global.sel('.after').set.color('silver');
      manager.syncNow();
      const state = () => ({ css: tree.css.snapshot(), declarations: Object.entries(tree.css.getMany()),
        neighbor: Object.entries(neighbor.css.getMany()), keys: tree.css.global.list(),
        owners: [...Reflect.get(manager, 'quidRuleOrder')],
        quids: [...runtime.issuedQuids], subjects: [...runtime.quidToNode.keys()],
        order: Reflect.get(manager, 'nextRuleOrder'), changed: Reflect.get(manager, 'changed'),
        scheduled: Reflect.get(manager, 'scheduled'), raf: Reflect.get(manager, 'rafId') });
      const before = state(), spec: AnimSpec = { name: 'new-name', duration: '2s' };
      const fields: readonly (keyof AnimSpec)[] = ['name', 'duration', 'timingFunction', 'delay',
        'iterationCount', 'direction', 'fillMode', 'playState'];
      const multi = manager.animForQuids([quid, neighbor.quid]);
      for (const payload of [...CSS_DECLARATION_ESCAPES, ...CSS_CONTAINMENT_UNSUPPORTED]) {
        const invalid = [() => tree.css.anim.beginName(payload), () => tree.css.anim.restartName(payload),
          () => Reflect.apply(tree.css.anim.setPlayState, tree.css.anim, [payload]),
          () => manager.setForQuid(quid, 'animationName', payload),
          () => manager.setManyForQuid(quid, { color: 'green', opacity: undefined, animationName: payload }),
          () => tree.css.setMany({ color: 'green', opacity: undefined, animationName: payload }),
          () => tree.css.selector('& .child').setMany({ color: 'green', animationName: payload }),
          () => tree.css.global.sel('.global-escape').setMany({ color: 'green', animationName: payload }),
          () => multi.beginName(payload), () => multi.restartName(payload)];
        for (const field of fields) {
          invalid.push(() => tree.css.anim.begin({ ...spec, [field]: payload }),
            () => tree.css.anim.restart({ ...spec, [field]: payload }),
            () => multi.begin({ ...spec, [field]: payload }),
            () => multi.restart({ ...spec, [field]: payload }));
        }
        for (const run of invalid) {
          assert.throws(run); assert.deepEqual(state(), before);
        }
      }
      tree.css.set.color('rgb(1, 2, 3)');
      tree.css.global.sel('.unrelated').set.color('purple');
      assert.doesNotMatch(tree.css.snapshot(), /escape/);
      assert.equal(tree.css.get.animationName(), 'kept');
      assert.equal(tree.css.get.color(), 'rgb(1, 2, 3)');
      assert.equal(neighbor.css.get.color(), undefined);
      const empty = hsonLiveTree.fromHson('<aside/>', { isolated: true });
      try {
        const fresh = CssRuntimeManager.forRuntime(runtime_for_tree(empty));
        for (const payload of [...CSS_DECLARATION_ESCAPES, ...CSS_CONTAINMENT_UNSUPPORTED]) {
          assert.throws(() => fresh.setForQuid(empty.quid, 'animationName', payload));
          assert.equal(empty.css.snapshot(), ''); assert.equal(Reflect.get(fresh, 'nextRuleOrder'), 0);
          assert.equal(Reflect.get(fresh, 'changed'), false); assert.equal(Reflect.get(fresh, 'scheduled'), false);
        }
      } finally { empty.remove(); }
    } finally { tree.remove(); }
  });
  check('rejected restart and batch operations preserve an already pending publication', () => {
    const tree = hsonLiveTree.fromHson('<main <span/>/>', { isolated: true });
    const descriptors = ['document', 'requestAnimationFrame', 'cancelAnimationFrame']
      .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    let requests = 0, cancellations = 0;
    try {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: {} });
      Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => ++requests });
      Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => ++cancellations });
      const manager = CssRuntimeManager.forRuntime(runtime_for_tree(tree)), quid = tree.quid;
      const neighbor = tree.find.must.byTag('span'), multi = manager.animForQuids([quid, neighbor.quid]);
      tree.css.set.color('red');
      const state = () => ({ css: tree.css.snapshot(), order: Reflect.get(manager, 'nextRuleOrder'),
        changed: Reflect.get(manager, 'changed'), scheduled: Reflect.get(manager, 'scheduled'),
        raf: Reflect.get(manager, 'rafId'), requests, cancellations });
      const before = state(); assert.equal(before.scheduled, true);
      for (const payload of [...CSS_DECLARATION_ESCAPES, ...CSS_CONTAINMENT_UNSUPPORTED]) {
        for (const run of [() => tree.css.anim.restartName(payload),
          () => multi.restart({ name: 'new', duration: '2s', playState: payload }),
          () => manager.setManyForQuid(quid, { color: undefined, opacity: '.5', animationName: payload })]) {
          assert.throws(run); assert.deepEqual(state(), before);
        }
      }
    } finally {
      tree.remove();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
  check('safe embedded punctuation remains stored and invalid maps issue no subject identity', () => {
    const runtime = create_livetree_runtime();
    const tree = create_staged_livetree_in_runtime({ $_tag: 'main', $_content: [] }, runtime);
    try {
      for (const value of [...CSS_DECLARATION_ESCAPES, ...CSS_CONTAINMENT_UNSUPPORTED]) {
        assert.throws(() => tree.css.setMany({ color: 'red', '--tokens': value }));
        assert.equal(runtime.issuedQuids.size, 0); assert.equal(tree.css.snapshot(), '');
      }
      for (const [property, value] of CSS_CONTAINED_VALUES) {
        tree.css.setProp(property, value);
        assert.deepEqual(Object.values(tree.css.getMany()), [value]);
        tree.css.remove(property);
      }
      assert.equal(tree.css.snapshot(), '');
    } finally { tree.remove(); }
  });
  check('original values and late inline or Part failures preserve linked revisions commits and identity', () => {
    const map: LiveMap = hsonLiveMap.fromLibraries({ page: { document: '<main <p/>/>' },
      parts: { parts: { sample: { kind: 'document', document: '<p/>', css: { color: 'blue' } } } } });
    const page = map.doc.must('page');
    if (page.mode !== 'document') throw new Error('Expected document library');
    const mirror = hsonMirror(page);
    const tree = mirror.tree.find.must.byTag('p'), runtime = runtime_for_tree(tree);
    const manager = CssRuntimeManager.forRuntime(runtime);
    let commits = 0;
    const off = map.commits.observe(() => commits++);
    const state = () => ({ capture: map.capture(), rev: map.rev, commits, node: tree.node,
      quids: [...runtime.issuedQuids], subjects: [...runtime.quidToNode.keys()], css: tree.css.snapshot(),
      order: Reflect.get(manager, 'nextRuleOrder'), dirty: Reflect.get(manager, 'changed'),
      scheduled: Reflect.get(manager, 'scheduled'), raf: Reflect.get(manager, 'rafId') });
    try {
      const before = state();
      // Trimming a terminal escaped newline first would hide the malformed escape.
      for (const value of [...CSS_DECLARATION_ESCAPES, ...CSS_CONTAINMENT_UNSUPPORTED, 'trailing\\\n']) {
        for (const handle of [tree.style, tree.css, tree.css.global.sel('.escape')]) {
          assert.throws(() => handle.setProp('--tokens', value));
          assert.throws(() => handle.setMany({ color: 'red', opacity: undefined, '--tokens': value }));
          assert.throws(() => handle.setProp('--tokens', { value, unit: '_' }));
          assert.deepEqual(state(), before);
        }
        assert.throws(() => tree.css.anim.restart({ name: 'safe', duration: '1s', playState: value }));
        assert.throws(() => tree.css.global.var.set('tokens', value));
        assert.throws(() => map.parts.must('parts').at(['sample']).replace({ kind: 'document', document: '<p/>',
          css: { color: 'red', __before: { '--tokens': value } } }));
        assert.deepEqual(state(), before);
      }
      for (const value of [null, true, false]) {
        assert.throws(() => manager.setForQuid('unused', 'color', value as never));
        assert.throws(() => manager.setManyForQuid('unused', { opacity: '.5', color: value } as never));
        assert.deepEqual(state(), before);
      }
      for (const property of ['color;bad', '--bad}:red;}.escape{color']) {
        assert.throws(() => manager.setManyForQuid('unused', { opacity: '.5', [property]: 'red' }));
        assert.deepEqual(state(), before);
      }
    } finally { off(); mirror.dispose(); mirror.tree.remove(); }
  });
  check('valid animation operations retain every specification field and dedicated clearing', () => {
    const tree = hsonLiveTree.fromHson('<main/>', { isolated: true });
    try {
      const animation = tree.css.anim;
      animation.beginName(' first '); assert.equal(tree.css.get.animationName(), 'first');
      animation.restartName('second'); assert.equal(tree.css.get.animationName(), 'second');
      const spec: AnimSpec = { name: 'pulse', duration: '250ms', timingFunction: 'steps(2, end)',
        delay: '50ms', iterationCount: '2', direction: 'alternate', fillMode: 'both', playState: 'running' };
      for (const run of [animation.begin, animation.restart]) {
        run(spec);
        assert.equal(tree.css.get.animationName(), 'pulse'); assert.equal(tree.css.get.animationDuration(), '250ms');
        assert.equal(tree.css.get.animationTimingFunction(), 'steps(2, end)'); assert.equal(tree.css.get.animationDelay(), '50ms');
        assert.equal(tree.css.get.animationIterationCount(), '2'); assert.equal(tree.css.get.animationDirection(), 'alternate');
        assert.equal(tree.css.get.animationFillMode(), 'both'); assert.equal(tree.css.get.animationPlayState(), 'running');
      }
      let reads = 0;
      animation.begin({ ...spec, get playState() {
        return ++reads === 1 ? 'paused' : CSS_DECLARATION_ESCAPES[0];
      } });
      assert.equal(reads, 1); assert.equal(tree.css.get.animationPlayState(), 'paused');
      const escaped = String.raw`kept\ `;
      animation.restart({ name: escaped, duration: escaped, timingFunction: escaped, delay: escaped,
        iterationCount: escaped, direction: escaped, fillMode: escaped, playState: escaped });
      assert.deepEqual(Object.values(tree.css.getMany()), Array(8).fill(escaped));
      animation.pause(); assert.equal(tree.css.get.animationPlayState(), 'paused');
      animation.resume(); assert.equal(tree.css.get.animationPlayState(), 'running');
      animation.setPlayState('paused'); assert.equal(tree.css.get.animationPlayState(), 'paused');
      animation.end(); assert.equal(tree.css.get.animationName(), 'none');
      animation.end('clear-all'); assert.deepEqual(Object.entries(tree.css.getMany()), [['animationName', 'none']]);
      tree.css.setMany({ animationName: undefined }); assert.equal(tree.css.snapshot(), '');
    } finally { tree.remove(); }
  });
  check('manager and animation admission never call CSS.supports for safe unknown values', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'CSS');
    try {
      for (const supports of [() => false, () => { throw new Error('CSS.supports must not be called'); }]) {
        Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { supports } });
        const tree = hsonLiveTree.fromHson('<main/>', { isolated: true });
        try {
          const manager = CssRuntimeManager.forRuntime(runtime_for_tree(tree));
          manager.setForQuid(tree.quid, 'color', 'future-color-token');
          tree.css.anim.begin({ name: 'future-animation', duration: 'future-duration-token', timingFunction: 'future-easing(1)' });
          assert.equal(tree.css.get.color(), 'future-color-token');
          assert.equal(tree.css.get.animationDuration(), 'future-duration-token');
          assert.equal(tree.css.get.animationTimingFunction(), 'future-easing(1)');
          tree.css.setMany({ color: undefined, animationDuration: '2s', opacity: .5 });
          assert.equal(tree.css.get.color(), undefined); assert.equal(tree.css.get.animationName(), 'future-animation');
          assert.equal(tree.css.get.animationDuration(), '2s'); assert.equal(tree.css.get.opacity(), '0.5');
        } finally { tree.remove(); }
      }
    } finally {
      if (original) Object.defineProperty(globalThis, 'CSS', original);
      else Reflect.deleteProperty(globalThis, 'CSS');
    }
  });
  check('normalization retains own deletion operations and validates their aliases', () => {
    const map = normalize_css_map({ backgroundColor: undefined, '--tone': undefined });
    assert.ok(Object.hasOwn(map, 'background-color'));
    assert.equal(map['background-color'], undefined);
    assert.ok(!Object.hasOwn(map, 'color'));
    for (const input of [{ backgroundColor: undefined, 'background-color': 'red' },
      { float: 'left', cssFloat: undefined }, { '--1foo': undefined, '--\\31 foo': 'red' }]) {
      assert.throws(() => normalize_css_map(input), /collision/);
    }
  });
  check('local inline base selector and scoped setters share atomic set/delete values', () => {
    const tree = hsonLiveTree.fromHson('<main/>', { isolated: true });
    try {
      const handles = [tree.style, tree.css, tree.css.selector('& .child'), tree.css.media('screen'),
        tree.css.supports('(display:grid)').layer('values')];
      for (const handle of handles) {
        handle.setMany({ color: 'red', backgroundColor: 'black' });
        handle.setMany({ opacity: .5 });
        assert.equal(handle.get.color(), 'red');
        handle.setMany({ color: undefined, backgroundColor: 'blue', width: { value: 2, unit: 'rem' }, '--tone': 'gold' });
        assert.equal(handle.get.color(), undefined);
        assert.equal(handle.get.backgroundColor(), 'blue');
        assert.equal(handle.get.width(), '2rem');
        assert.equal(handle.var.value('tone'), 'gold');
        for (const invalid of [null, true, false]) {
          const before = tree.css.snapshot(), node = tree.node;
          assert.throws(() => Reflect.apply(handle.setMany, handle, [{ color: 'green', opacity: undefined, width: invalid }]));
          assert.throws(() => Reflect.apply(handle.setProp, handle, ['color', invalid]));
          assert.equal(tree.css.snapshot(), before); assert.deepEqual(tree.node, node);
        }
        handle.setMany({ backgroundColor: undefined, opacity: undefined, width: undefined, '--tone': undefined });
        assert.deepEqual(Object.keys(handle.getMany()), []);
      }
      assert.equal(tree.css.snapshot(), '');
      tree.css.setMany({ color: 'future-color-token' });
      assert.equal(tree.css.get.color(), 'future-color-token');
      tree.css.setMany({ color: undefined });
      const global = tree.css.global.sel('.global-values');
      global.setMany({ color: 'red', opacity: '.5' });
      global.setMany({ color: undefined, width: '2rem' });
      assert.doesNotMatch(tree.css.snapshot(), /color:/);
      assert.match(tree.css.snapshot(), /width:2rem/);
      for (const invalid of [null, true, false]) {
        const before = tree.css.snapshot();
        assert.throws(() => Reflect.apply(global.setMany, global, [{ opacity: undefined, color: invalid }]));
        assert.throws(() => Reflect.apply(tree.css.global.var.set, tree.css.global.var, ['tone', invalid]));
        assert.equal(tree.css.snapshot(), before);
      }
      tree.css.global.var.set('tone', 'gold');
      tree.css.global.var.set('tone', undefined);
      assert.equal(tree.css.global.var.value('tone'), undefined);
      global.setMany({ opacity: undefined, width: undefined });
      assert.equal(tree.css.snapshot(), '');
    } finally { tree.remove(); }
  });
  check('deletion-only and empty recursive branches allocate neither rules nor subject identity', () => {
    const runtime = create_livetree_runtime();
    const tree = create_staged_livetree_in_runtime({ $_tag: 'main', $_content: [] }, runtime);
    try {
      tree.css.setMany({ color: undefined, __before: { content: undefined }, '& .child': { _hover: { color: undefined } }, __after: {} });
      assert.equal(tree.css.snapshot(), ''); assert.equal(runtime.issuedQuids.size, 0);
      assert.equal(tree.node.$_meta?.quid, undefined);
      for (const invalid of [null, true, false]) {
        assert.throws(() => tree.css.setMany({ color: 'red', _hover: { color: invalid } } as never));
        assert.equal(tree.css.snapshot(), ''); assert.equal(runtime.issuedQuids.size, 0);
      }
    } finally { tree.remove(); }
  });
  check('pseudo content changes only when explicitly authored across local global and scoped handles', () => {
    const tree = hsonLiveTree.fromHson('<main/>', { isolated: true });
    try {
      for (const handle of [tree.css, tree.css.selector('& .child'), tree.css.media('screen'), tree.css.global.sel('.pseudo')]) {
        handle.setMany({ __before: { content: '"kept"', color: 'red' } });
        handle.setMany({ __before: { color: 'blue' } });
        assert.match(tree.css.snapshot(), /content:\s*"kept"/);
        handle.setMany({ __before: { content: undefined } });
        assert.doesNotMatch(tree.css.snapshot(), /content:/);
        handle.setMany({ __before: { color: undefined }, __after: {} });
        assert.equal(tree.css.snapshot(), '');
        const before = tree.css.snapshot();
        for (const invalid of [null, true, false]) {
          assert.throws(() => handle.setMany({ color: 'red', _hover: { color: 'green' }, __before: { content: invalid } } as never));
          assert.equal(tree.css.snapshot(), before);
        }
      }
    } finally { tree.remove(); }
  });
  check('complete Part admission consumes deletion without markers or synthesized content', () => {
    const css = { color: undefined, __before: { content: undefined }, __after: {},
      '@:label': { color: undefined, width: { value: 2, unit: 'rem' } } };
    const sheet = structured_part_stylesheet(css, new Set(['label']));
    assert.equal(sheet.rules.length, 1); assert.deepEqual(sheet.rules[0]!.declarations, [['width', '2rem']]);
    assert.equal(structured_part_stylesheet({ __before: { content: '"explicit"' } }, new Set()).rules[0]!.declarations[0]![1], '"explicit"');
    const map: LiveMap = hsonLiveMap.fromLibraries({ parts: { parts: { sample: { kind: 'document', document: '<p @:label/>', css } } } });
    assert.deepEqual(map.parts.must('parts').at(['sample']).snap()?.css, { __before: {}, __after: {}, '@:label': { width: { value: 2, unit: 'rem' } } });
    const before = map.capture(), rev = map.rev;
    for (const invalid of [null, true, false]) {
      assert.throws(() => map.parts.must('parts').at(['sample']).replace({ kind: 'document', document: '<p @:label/>',
        css: { color: 'red', __before: { content: invalid } } } as never));
      assert.deepEqual(map.capture(), before); assert.equal(map.rev, rev);
    }
    assert.throws(() => map.parts.must('parts').at(['sample']).replace({ kind: 'document', document: '<p @:label/>',
      css: { backgroundColor: undefined, 'background-color': 'red' } } as never), /collision/);
    assert.deepEqual(map.capture(), before);
  });
}
