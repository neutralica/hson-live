import { hsonLiveMap } from '../../src/api/livemap/index.ts';
import type { LiveMap } from '../../src/types/livemap.types.ts';
import { hsonLiveTree } from '../../src/api/livetree/index.ts';
import { continue_document } from '../../src/api/continuation/continue-document.ts';
import { CssRuntimeManager } from '../../src/api/livetree/managers/css-manager.ts';
import { project_livetree } from '../../src/api/livetree/creation/project-live-tree.ts';
import { runtime_for_tree, subject_for_tree } from '../../src/api/livetree/runtime/livetree-runtime.ts';

type Check = { name: string; pass: boolean };
/** Native targeting oracles run inside the existing stylesheet ingress Chrome harness. */
export async function css_selector_browser_cases(): Promise<Check[]> {
  const checks: Check[] = [];
  const frame = document.createElement('iframe'); document.body.append(frame);
  const doc = frame.contentDocument!, win = frame.contentWindow!;
  const tree = hsonLiveTree.fromHson('<main <button id=a class="scope a&b escaped,comma" data-x="a&b"/> <button id=b disabled=true class=scope/>/>', { isolated: true });
  const runtime = runtime_for_tree(tree);
  const flushRuntime = async () => { await Promise.resolve(); CssRuntimeManager.forRuntime(runtime).syncNow(); };
  try {
    doc.body.append(project_livetree(subject_for_tree(tree), 'html', runtime, doc));
    const outsider = doc.createElement('button'); outsider.disabled = true; outsider.className = 'scope'; doc.body.append(outsider);
    const a = tree.find.must.byId('a'), b = tree.find.must.byId('b');
    const ae = doc.querySelector('#a')!, be = doc.querySelector('#b')!;
    const color = (el: Element, pseudo?: string) => win.getComputedStyle(el, pseudo).color;
    const css = a.css;
    css.selector(':enabled,:disabled').set.color('red');
    tree.css.global.sel('.scope').set.color('blue');
    await flushRuntime();
    checks.push({ name: 'native singleton-QUID lists preserve direct specificity and exclude neighboring subjects',
      pass: color(ae) === 'rgb(255, 0, 0)' && color(be) === 'rgb(0, 0, 255)' && color(outsider) === 'rgb(0, 0, 255)' });
    css.clear(); tree.css.global.clearAll();
    for (const [pattern, name] of [
      [String.raw`[data-x="a&b"]`, 'quoted literal ampersand'],
      [String.raw`.a\&b`, 'escaped literal ampersand'],
      [String.raw`.escaped\,comma`, 'escaped comma'],
    ]) {
      a.css.selector(pattern).set.color('green');
      await flushRuntime();
      checks.push({ name: `native separate ${name} targeting`, pass: color(ae) === 'rgb(0, 128, 0)' });
      a.css.clear();
      await flushRuntime();
    }
    css.media('screen').selector(':enabled,:disabled').setMany({ __before: { color: 'purple' }, __after: { color: 'orange' } });
    await flushRuntime();
    checks.push({ name: 'native scoped singleton list pseudo-elements apply only to their subject', pass:
      color(ae, '::before') === 'rgb(128, 0, 128)' && color(ae, '::after') === 'rgb(255, 165, 0)'
      && win.getComputedStyle(be, '::before').content === 'none'
      && win.getComputedStyle(outsider, '::before').content === 'none' });
    css.media('screen').clear();
    css.selector('&:is(:enabled,:disabled),&.scope').setMany({ _focus: { __before: { color: 'red' } } });
    (ae as HTMLElement).focus(); await flushRuntime();
    checks.push({ name: 'native anchored functional lists and recursive pseudos keep pseudo-elements scoped',
      pass: color(ae, '::before') === 'rgb(255, 0, 0)' && win.getComputedStyle(outsider, '::before').content === 'none' });
    const before = tree.css.snapshot();
    let rejected = 0;
    for (const pattern of [':enabled,', ',:disabled', '&.scope,.escape', '[data-x="broken]', '.a >']) {
      try { css.selector(pattern).set.color('gold'); } catch { rejected++; }
    }
    await flushRuntime();
    checks.push({ name: 'native invalid selector publication leaves scoped stylesheet unchanged', pass: rejected === 5 && tree.css.snapshot() === before });
    css.clear();
    tree.css.global.media('screen').sel('#a,#b').setMany({ _focus: { color: 'green', __before: { color: 'purple' } }, __after: { color: 'orange' } });
    await flushRuntime();
    checks.push({ name: 'native runtime global grouped lists compose recursive pseudos and both pseudo-elements', pass:
      color(ae) === 'rgb(0, 128, 0)' && color(ae, '::before') === 'rgb(128, 0, 128)'
      && win.getComputedStyle(be, '::before').content === 'none'
      && [ae, be].every(el => color(el, '::after') === 'rgb(255, 165, 0)') });
    css.clear(); tree.css.global.clearAll();
    for (const pattern of [':is(:enabled,:disabled)', ':where(:enabled,:disabled)', ':not(:disabled)', ':has(+ button)', ':nth-child(1 of button,span)']) {
      css.selector(pattern).set.color('red'); await flushRuntime();
      checks.push({ name: `native functional internal commas keep one subject: ${pattern}`, pass:
        color(ae) === 'rgb(255, 0, 0)' && color(be) !== 'rgb(255, 0, 0)' && color(outsider) !== 'rgb(255, 0, 0)' });
      css.clear(); await flushRuntime();
    }
    const main = doc.querySelector('main')!;
    main.classList.add('host');
    const shadow = main.attachShadow({ mode: 'open' });
    const label = doc.createElement('span'); label.part.add('label'); shadow.append(label);
    const literal = doc.createElement('span'); literal.part.add('a&b', 'a,b'); shadow.append(literal);
    tree.css.global.sel('.host::part(label)').set.color('gold');
    tree.css.global.media('screen').sel(String.raw`.host::part(a\&b)`).set.color('green');
    await flushRuntime();
    checks.push({ name: 'native runtime global ::part(label) targets a real shadow part', pass: color(label) === 'rgb(255, 215, 0)' });
    checks.push({ name: 'native opaque escaped ampersand part argument targets literally', pass: color(literal) === 'rgb(0, 128, 0)' });
    tree.css.media('screen').selector('::part(label)').set.color('orange');
    await flushRuntime();
    checks.push({ name: 'native scoped singleton ::part(label) targets its shadow part', pass: color(label) === 'rgb(255, 165, 0)' });
    const structuralBefore = tree.css.snapshot(), ids = JSON.stringify([...runtime.issuedQuids]);
    const style = doc.querySelector('style'), text = style?.textContent;
    let structuredRejected = 0;
    for (const pattern of ['& .a,& .b', '& + &', '&:future(&)', '&:future(:scope)']) {
      try { css.setMany({ color: 'red', [pattern]: { color: 'blue' } } as never); } catch { structuredRejected++; }
    }
    await flushRuntime();
    checks.push({ name: 'native unsupported structured composition publishes no CSS or identity', pass:
      structuredRejected === 4 && tree.css.snapshot() === structuralBefore && JSON.stringify([...runtime.issuedQuids]) === ids
      && doc.querySelector('style') === style && style?.textContent === text });
  } finally { tree.remove(); frame.remove(); }

  // Document and continued global facades share the governed command path.
  for (const bound of [false, true]) {
    const frame = document.createElement('iframe'); document.body.append(frame);
    const doc = frame.contentDocument!, win = frame.contentWindow!;
    const map: LiveMap = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body <button id=a class="a a&b escaped,comma" data-x="a&b"/> <button id=b class=b/>/>/>' } });
    const page = map.doc.must('page');
    page.css.sel('button').set.color('black');
    doc.open(); doc.write(page.render()); doc.close();
    const adopted = bound ? continue_document({ map, document: page, root: doc.documentElement }) : undefined;
    const css = adopted?.tree.css.global ?? page.css;
    const flush = () => { if (!bound) doc.head.querySelector('style')!.textContent = page.css.snapshot(); };
    const native = doc.head.querySelector('style');
    try {
      css.media('screen').sel('.a,.b').setMany({ _focus: { color: 'red' }, __before: { color: 'purple' }, __after: { content: '"tail"', color: 'orange' } });
      flush();
      const a = doc.querySelector<HTMLElement>('#a')!, b = doc.querySelector<HTMLElement>('#b')!;
      checks.push({ name: `${bound ? 'bound global' : 'Document'} native list pseudos do not style an unfocused first arm`, pass: win.getComputedStyle(a).color === 'rgb(0, 0, 0)' });
      a.focus();
      checks.push({ name: `${bound ? 'bound global' : 'Document'} native list pseudo applies when first arm matches`, pass: win.getComputedStyle(a).color === 'rgb(255, 0, 0)' });
      b.focus();
      checks.push({ name: `${bound ? 'bound global' : 'Document'} native second arm focus and both pseudo-elements`, pass:
        win.getComputedStyle(b).color === 'rgb(255, 0, 0)' && win.getComputedStyle(a).color === 'rgb(0, 0, 0)'
        && [a, b].every(el => win.getComputedStyle(el, '::before').color === 'rgb(128, 0, 128)' && win.getComputedStyle(el, '::after').content === '"tail"') });
      css.sel(String.raw`:is(.a,.b),[data-x="a&b"],.a\&b,.escaped\,comma`).setMany({ __before: { color: 'green' } });
      flush();
      checks.push({ name: `${bound ? 'bound global' : 'Document'} native functional escaped literal lists compose`, pass: [a, b].every(el => win.getComputedStyle(el, '::before').color === 'rgb(0, 128, 0)') });
      const host = doc.createElement('div'); host.id = 'shadow-host'; doc.body.append(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const label = doc.createElement('span'); label.part.add('label'); shadow.append(label);
      css.media('screen').sel('#shadow-host::part(label)').set.color('gold');
      css.sel('.host:state(open)').set.color('purple');
      css.sel(String.raw`#shadow-host::part(a\,b a\&b),.host:state(a\&b)`).set.color('green');
      flush();
      checks.push({ name: `${bound ? 'bound global' : 'Document'} native ::part(label) shadow targeting and opaque :state admission`,
        pass: win.getComputedStyle(label).color === 'rgb(255, 215, 0)' && page.css.snapshot().includes('.host:state(open)') });
      const before = JSON.stringify(map.capture()), rev = map.rev, text = native!.textContent;
      let rejected = 0;
      for (const pattern of ['.a,', ',.b', '.a,,.b', '[data-x="broken]', '.a >']) {
        try { css.sel(pattern).setMany({ color: 'red', _hover: { color: 'blue' } }); } catch { rejected++; }
      }
      checks.push({ name: `${bound ? 'bound global' : 'Document'} malformed input has no publication`, pass:
        rejected === 5 && map.rev === rev && JSON.stringify(map.capture()) === before
        && doc.head.querySelector('style') === native && native!.textContent === text });
    } finally { adopted?.dispose(); frame.remove(); }
  }
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  return checks;
}
