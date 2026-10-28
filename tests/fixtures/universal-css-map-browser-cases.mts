import { hsonLiveMap } from '../../src/api/livemap/index.ts';
import { continue_portable_document_internal } from '../../src/api/continuation/continue-document.ts';
import { document_css_state_internal, cut_document_ssr_internal, restore_portable_document_receiver_internal } from '../../src/api/livemap/livemap.libraries.ts';
import { internal_livemap_aggregate_authority } from '../../src/api/livemap/livemap.internal.ts';
import { lookup_document_quad_internal } from '../../src/api/livemap/livemap.document.quad.ts';
import type { CssMap } from '../../src/types/css.types.ts';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const rejects = (run: () => unknown) => { try { run(); return false; } catch { return true; } };

export async function universal_css_map_browser_cases() {
  const checks: { name: string; pass: boolean }[] = [];
  const frame = document.createElement('iframe'); document.body.append(frame);
  const doc = frame.contentDocument!, win = frame.contentWindow!;
  const raw = '/* exact raw */ .row { --raw: kept; } /* unclosed';
  const source = hsonLiveMap.fromLibraries({ page: {
    document: '<html <head/> <body <section class="row" <span @:label class="label"/>/>/>/>', stylesheet: raw,
  } });
  const cut = cut_document_ssr_internal(source, { html: 'page' }, [lookup_document_quad_internal(source.doc.must('page'), 'label')!.quid]);
  const receiver = restore_portable_document_receiver_internal(cut.libs), map = receiver.map;
  const page = map.doc.must('page'), authority = internal_livemap_aggregate_authority(map);
  const handoff = authority.preparePortableDocumentHandoff(authority.libraries()[cut.libs.libraries.findIndex(item => item.name === 'page')]!, receiver.correspondence);
  doc.open(); doc.write(cut.html); doc.close();
  const continuation = continue_portable_document_internal({ map, document: page, root: doc.documentElement }, handoff);
  let commits = 0; const commitCount = () => commits; const off = map.commits.observe(() => commits++);
  const global = continuation.tree.css.global;
  const rule = global.sel('.row');
  const css: CssMap = { color: 'rgb(20, 30, 40)', padding: '1px', paddingLeft: '7px',
    __before: { color: 'purple' }, '& > .label': { _hover: { _focus: { color: 'red' } } },
    '@:label': { fontWeight: 700 }, $media: { screen: { '& > .label': { color: 'rgb(4, 5, 6)' } } } };
  try {
    const rev = map.rev;
    rule.setMany(css);
    assert(map.rev === rev + 1 && commitCount() === 1, 'Bound recursive map must publish one transition.');
    const label = doc.querySelector('.label')!, row = doc.querySelector('.row')!;
    assert(win.getComputedStyle(label).color === 'rgb(4, 5, 6)' && win.getComputedStyle(label).fontWeight === '700', 'Media and named subjects must target native elements.');
    assert(win.getComputedStyle(row).paddingLeft === '7px', 'Authored shorthand/longhand order must survive.');
    assert(win.getComputedStyle(row, '::before').content === 'none', 'Pseudo-elements must not synthesize content.');
    const carriers = [...doc.querySelectorAll<HTMLStyleElement>('style[data-hson-managed-document-css]')];
    assert(carriers[0]?.textContent === raw && carriers.length > 1, 'Raw and structured contributions retain separate ordered carriers.');
    rule.setMany(css); assert(map.rev === rev + 1 && commitCount() === 1, 'A semantic no-op must not revise.');
    const before = JSON.stringify(map.capture()), texts = carriers.map(style => style.textContent);
    assert(rejects(() => Reflect.apply(rule.setMany, rule, [{ color: 'red', '& > .label': { _hover: { color: false } } }])), 'Late invalid branch must reject.');
    assert(JSON.stringify(map.capture()) === before && texts.every((text, index) => carriers[index]?.textContent === text), 'Rejection must preserve canonical state and exact carriers.');
    checks.push({ name: 'bound CssMap publishes recursive media subjects order and atomic no-ops natively', pass: true });

    const asyncRule = continuation.tree.async.css.global.sel('.row');
    await asyncRule.setMany({ color: undefined, '& > .label': { __after: { color: 'green' } }, $media: { print: { color: 'black' } } });
    assert(map.rev === rev + 2 && commitCount() === 2, 'One async map must publish one transition.');
    await asyncRule.setMany({ color: undefined, '& > .label': { __after: { color: 'green' } }, $media: { print: { color: 'black' } } });
    assert(map.rev === rev + 2 && commitCount() === 2, 'Async no-op must not revise.');
    const asyncBefore = JSON.stringify(map.capture()); let invalid = false;
    try { await Reflect.apply(asyncRule.setMany, asyncRule, [{ opacity: .5, _focus: { color: null } }]); } catch { invalid = true; }
    assert(invalid && JSON.stringify(map.capture()) === asyncBefore, 'Async invalid maps must remain atomic.');
    checks.push({ name: 'async bound CssMap prepares one complete governed batch and rejects atomically', pass: true });

    const emptyRule = global.sel('.empty-value');
    const emptyAsync = continuation.tree.async.css.global.sel('.empty-value');
    for (const css of [{ color: '' }, { __before: { color: '' } }, { $media: { screen: { '& > a': { color: '' } } } }]) {
      const revision = map.rev;
      await emptyAsync.setMany(css);
      assert(map.rev === revision + 1, 'Async empty value must publish.');
      const state = document_css_state_internal(page);
      assert(state.rules.some(rule => Object.values(rule.declarations).includes('')), 'Canonical empty declaration must survive.');
      assert(page.css.snapshot().includes('color:;'), 'Serialized empty declaration must survive.');
      assert([...doc.querySelectorAll('style[data-hson-managed-document-css]')].some(style => style.textContent?.includes('color:;')), 'Native carrier must retain empty text.');
      emptyRule.setMany({}); emptyRule.setMany(css); await emptyAsync.setMany(css);
      assert(map.rev === revision + 1, 'Absent and repeated empty values must be no-ops.');
      for (const invalid of [null, true, false]) {
        const capture = JSON.stringify(map.capture());
        assert(rejects(() => Reflect.apply(emptyRule.setMany, emptyRule, [{ color: '', '& > b': { color: invalid } }])), 'Invalid bound value must reject.');
        let rejected = false;
        try { await Reflect.apply(emptyAsync.setMany, emptyAsync, [{ color: invalid }]); } catch { rejected = true; }
        assert(rejected && JSON.stringify(map.capture()) === capture, 'Async rejection must be atomic.');
      }
      const deletion = css.color !== undefined ? { color: undefined } : css.__before !== undefined
        ? { __before: { color: undefined } } : { $media: { screen: { '& > a': { color: undefined } } } };
      emptyRule.setMany(deletion);
      assert(map.rev === revision + 2, 'Undefined must delete the final empty declaration.');
      await emptyAsync.setMany(deletion); assert(map.rev === revision + 2, 'Repeated deletion must be a no-op.');
    }
    checks.push({ name: 'bound and async empty declarations survive canonical publication and native carriers', pass: true });

    continuation.dispose();
    const revoked = map.rev;
    assert(rejects(() => rule.setMany(css)), 'Retained bound handles must reject after disposal.');
    let asyncRevoked = false; try { await asyncRule.setMany(css); } catch { asyncRevoked = true; }
    assert(asyncRevoked && map.rev === revoked, 'Disposed async binding cannot publish.');
    assert(doc.querySelectorAll('style[data-hson-managed-document-css]').length === 0, 'Disposal retires all owned carriers.');
    checks.push({ name: 'sync and async recursive handles reject revoked bindings without fallback', pass: true });

  } finally { off(); continuation.dispose(); frame.remove(); }
  return checks;
}
