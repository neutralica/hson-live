import assert from 'node:assert/strict';
import { hsonLiveMap } from '../../src/api/livemap/index.ts';
import { hsonLiveTree } from '../../src/api/livetree/index.ts';
import type { LiveMap } from '../../src/types/livemap.types.ts';
import type { CssMap } from '../../src/types/css.types.ts';
import { install_libraries_snapshot } from '../../src/api/livemap/index.ts';
import { document_css_state_internal } from '../../src/api/livemap/livemap.libraries.ts';
import { lookup_document_quad_internal } from '../../src/api/livemap/livemap.document.quad.ts';

export async function universal_css_map_cases(check: (name: string, run: () => void | Promise<void>) => Promise<void>) {
  await check('async governed Document commands share CssMap media resolution deletion and no-op revisions', async () => {
    const locus = hsonLiveMap.locus.create({ page: { document: '<html <head/> <body <span @:label/>/>/>', access: 'shared' } });
    try {
      const page = locus.doc.must('page');
      const css: CssMap = { color: 'red', _hover: { '& > a': { color: 'blue' } },
        $media: { screen: { '@:label': { color: 'green' } } } };
      const rev = locus.rev;
      await page.css.sel('.row').setMany(css); assert.equal(locus.rev, rev + 1);
      await page.css.sel('.row').setMany(css); assert.equal(locus.rev, rev + 1);
      const before = page.css.snapshot();
      await assert.rejects(async () => Reflect.apply(page.css.sel('.row').setMany, undefined, [{ opacity: .5, '& > a': { color: false } }]));
      assert.equal(page.css.snapshot(), before); assert.equal(locus.rev, rev + 1);
      await page.css.sel('.row').setMany({ color: undefined, _hover: { '& > a': { color: undefined } },
        $media: { screen: { '@:label': { color: undefined } } } });
      assert.equal(locus.rev, rev + 2); assert.equal(page.css.snapshot(), '');
    } finally { locus.dispose(); }
  });
  await check('portable CssMap recurses through Document in one governed publication', () => {
    const map: LiveMap = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body <p @:label/>/>/>' } });
    const page = map.doc.must('page');
    let commits = 0; const off = map.commits.observe(() => commits++);
    const css: CssMap = { margin: '1px', marginLeft: '2px', color: 'red',
      _hover: { '& > a': { _focus: { color: 'blue', __before: { color: 'gold' } } } },
      $media: { screen: { '& > b': { color: 'green' }, '@:label': { opacity: .5 } } } };
    try {
      const rev = map.rev;
      page.css.sel('.row').setMany(css);
      assert.equal(map.rev, rev + 1); assert.equal(commits, 1);
      assert.match(page.css.snapshot(), /margin:1px;margin-left:2px;color:red/);
      assert.match(page.css.snapshot(), /\.row:hover>a:focus::before\{color:gold/);
      assert.doesNotMatch(page.css.snapshot(), /content:/);
      const subject = lookup_document_quad_internal(page, 'label'); assert.ok(subject);
      assert.ok(page.css.snapshot().includes(`[hson\\:quid="${subject.quid}"]{opacity:0.5;}`));
      const state = document_css_state_internal(page);
      page.css.sel('.row').setMany(css);
      assert.equal(map.rev, rev + 1); assert.equal(commits, 1);
      assert.equal(document_css_state_internal(page), state);
      page.css.sel('.row:hover > a:focus::before').setMany({ color: 'purple' });
      assert.equal(document_css_state_internal(page).rules.length, state.rules.length);
      assert.doesNotMatch(page.css.snapshot(), /color:gold/);
      const capture = map.capture(), before = map.rev;
      for (const input of [
        { color: 'black', _hover: { '& > a': { color: null } } },
        { color: 'black', '& > b': { _focus: { color: true } } },
        { color: 'black', '& > b, & > c': { color: 'red' } },
        { color: 'black', '@:missing': { color: 'red' } },
        { color: 'black', _hover: { '--escape': 'red;}.escape{color:red' } },
      ]) {
        assert.throws(() => Reflect.apply(page.css.sel('.row').setMany, undefined, [input]));
        assert.deepEqual(map.capture(), capture); assert.equal(map.rev, before);
      }
      const restored = install_libraries_snapshot(capture).map.doc.must('page');
      const restoredSubject = lookup_document_quad_internal(restored, 'label'); assert.ok(restoredSubject);
      assert.notEqual(restoredSubject.quid, subject.quid);
      assert.equal(restored.css.snapshot().replaceAll(restoredSubject.quid, subject.quid), page.css.snapshot());
      const restoredRevision = restored.rev, restoredRules = document_css_state_internal(restored).rules.length;
      restored.css.sel('.row').setMany({ $media: { screen: { '@:label': { opacity: .5 } } } });
      assert.equal(restored.rev, restoredRevision);
      restored.css.sel('.row').setMany({ $media: { screen: { '@:label': { opacity: .7 } } } });
      assert.equal(document_css_state_internal(restored).rules.length, restoredRules);
    } finally { off(); }
  });
  await check('Document deletion missing values empty branches and scopes use canonical rules', () => {
    const map: LiveMap = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } }); const page = map.doc.must('page');
    const scope = page.css.layer('theme').supports('(display:grid)').media('screen');
    scope.sel('.row').setMany({ '& > a': { _hover: { color: 'red', opacity: .5 } } });
    const count = document_css_state_internal(page).rules.length;
    scope.sel('.row > a:hover').setMany({ color: undefined });
    assert.equal(document_css_state_internal(page).rules.length, count);
    assert.match(page.css.snapshot(), /opacity:0.5/); assert.doesNotMatch(page.css.snapshot(), /color:/);
    scope.sel('.row').setMany({ '& > a': { _hover: { opacity: undefined } } });
    assert.equal(page.css.snapshot(), '');
    const rev = map.rev;
    scope.sel('.row').setMany({ __before: {}, '& > a': { color: undefined }, $media: { print: { opacity: undefined } } });
    assert.equal(map.rev, rev); assert.equal(page.css.snapshot(), '');
    page.css.sel('.row').setMany({ $media: { screen: { _hover: { color: 'red' } } } });
    page.css.media('screen').sel('.row:hover').setMany({ color: undefined });
    assert.equal(page.css.snapshot(), '');
    page.css.sel('.row').setMany({ $media: { '(min-width: 1px)': { _hover: { color: 'red' } } } });
    page.css.media({ minWidth: 1 }).sel('.row:hover').setMany({ color: undefined });
    assert.equal(page.css.snapshot(), '');
    map.batch(writer => writer.doc.must('page').css.sel('.row').setMany({ '@:missing': undefined, color: 'future-token' }));
    assert.match(page.css.snapshot(), /color:future-token/);
  });
  await check('all runtime stylesheet handles implement the portable map with media and canonical identity', () => {
    const tree = hsonLiveTree.fromHson('<main/>', { isolated: true });
    const css: CssMap = { color: 'red', '& > a': { _hover: { color: 'blue' } },
      $media: { screen: { '& > b': { __before: { color: 'gold' } } } } };
    try {
      for (const handle of [tree.css, tree.css.selector('& > section'), tree.css.media('print'),
        tree.css.supports('(display:grid)').layer('theme'), tree.css.global.sel('.global')]) {
        handle.setMany(css);
        assert.match(tree.css.snapshot(), /color:\s*gold/);
        const before = tree.css.snapshot();
        assert.throws(() => Reflect.apply(handle.setMany, handle, [{ color: 'black', _hover: { color: false } }]));
        assert.equal(tree.css.snapshot(), before);
      }
      const global = tree.css.global;
      global.sel('.canonical').setMany({ '& > a': { _hover: { color: 'red' } } });
      const count = global.list().length;
      global.sel('.canonical > a:hover').setMany({ color: 'blue' });
      assert.equal(global.list().length, count);
      global.sel('.canonical').setMany({ '& > a': { _hover: { color: undefined } } });
      assert.equal(global.has('sel:.canonical>a:hover'), false);
      for (const handle of [tree.css, tree.css.supports('(display:grid)').layer('nested')]) {
        handle.setMany({ $media: { '(min-width: 1px)': { '& > .canonical-media': { _hover: { color: 'red' } } } } });
        const keys = global.list().length;
        handle.media({ minWidth: 1 }).selector('& > .canonical-media:hover').setMany({ color: 'blue' });
        assert.equal(global.list().length, keys);
        handle.media('@media (min-width: 1px)').selector('& > .canonical-media:hover').setMany({ color: undefined });
        assert.equal(global.list().length, keys - 1);
      }
      const before = tree.css.snapshot();
      assert.throws(() => tree.css.setMany({ color: 'purple', '@:unavailable': { color: 'red' } }));
      assert.equal(tree.css.snapshot(), before);
    } finally { tree.remove(); }
  });
}
