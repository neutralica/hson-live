import { hsonLiveMap } from '../../src/api/livemap/index.ts';
import type { LiveMap } from '../../src/types/livemap.types.ts';
import { hsonLiveTree } from '../../src/api/livetree/index.ts';
import { continue_document } from '../../src/api/continuation/continue-document.ts';
import { CssRuntimeManager } from '../../src/api/livetree/managers/css-manager.ts';
import { project_livetree } from '../../src/api/livetree/creation/project-live-tree.ts';
import { create_livetree_runtime, runtime_for_tree, subject_for_tree } from '../../src/api/livetree/runtime/livetree-runtime.ts';
import { reflect_document_in_runtime } from '../../src/api/mirror/mirror.document.ts';
import { normalize_css_key } from '../../src/api/transform/utils/attrs-utils/normalize-css.ts';
import { CSS_DECLARATION_ESCAPES, CSS_CONTAINED_VALUES, CSS_CONTAINMENT_UNSUPPORTED, CSS_CONTENT_VALUES, CSS_URL_DEPTH_CASES } from './css-declaration-containment-values.mts';

type Check = { name: string; pass: boolean };
/** Native targeting oracles run inside the existing stylesheet ingress Chrome harness. */
export async function css_selector_browser_cases(): Promise<Check[]> {
  const checks: Check[] = [];
  const frame = document.createElement('iframe'); document.body.append(frame);
  const doc = frame.contentDocument!, win = frame.contentWindow!;
  const tree = hsonLiveTree.fromHson('<main <button id="a" class="scope a&b escaped,comma" data-x="a&b"/> <button id="b" disabled="true" class="scope"/>/>', { isolated: true });
  const runtime = runtime_for_tree(tree);
  const flushRuntime = async () => { await Promise.resolve(); CssRuntimeManager.forRuntime(runtime).syncNow(); };
  try {
    doc.body.append(project_livetree(subject_for_tree(tree), 'html', runtime, doc));
    const outsider = doc.createElement('button'); outsider.disabled = true; outsider.className = 'scope escape'; doc.body.append(outsider);
    const a = tree.find.must.byId('a'), b = tree.find.must.byId('b');
    const ae = doc.querySelector('#a')!, be = doc.querySelector('#b')!;
    const color = (el: Element, pseudo?: string) => win.getComputedStyle(el, pseudo).color;
    const css = a.css;
    const manager = CssRuntimeManager.forRuntime(runtime), animation = css.anim;
    const depthState = () => JSON.stringify({ node: a.node, inline: ae.getAttribute('style'), css: css.snapshot(),
      native: doc.head.innerHTML, ids: [...runtime.issuedQuids], changed: Reflect.get(manager, 'changed'),
      scheduled: Reflect.get(manager, 'scheduled') });
    for (const handle of [a.style, css, css.media('screen'), tree.css.global.sel('#a')]) {
      for (const { depth, value } of CSS_URL_DEPTH_CASES) {
        if (depth > 128) {
          const before = depthState();
          let rejected = false;
          try { handle.setMany({ '--before': 'changed', '--depth': value }); } catch { rejected = true; }
          checks.push({ name: 'native URL depth 129 rejects before publication', pass: rejected && before === depthState() });
          if (!rejected) handle.setMany({ '--before': undefined, '--depth': undefined });
        } else {
          handle.setMany({ '--before': 'kept', '--depth': value, '--after': 'kept' });
          await flushRuntime();
          checks.push({ name: `native URL depth ${depth} preserves surrounding declarations`, pass:
            (Object.values(a.node.$_attrs?.style ?? {}).includes(value) || css.snapshot().includes(value))
            && win.getComputedStyle(ae).getPropertyValue('--before').trim() === 'kept'
            && win.getComputedStyle(ae).getPropertyValue('--after').trim() === 'kept' });
          handle.setMany({ '--before': undefined, '--depth': undefined, '--after': undefined });
        }
      }
    }
    const oracle = doc.createElement('button'), oracleStyle = doc.createElement('style');
    oracle.id = 'content-oracle'; oracle.setAttribute('data-label', 'label'); ae.setAttribute('data-label', 'label');
    doc.body.append(oracle); doc.head.append(oracleStyle);
    tree.css.global.sel('#b').set.color('rgb(7, 8, 9)');
    const supportsBefore = Object.getOwnPropertyDescriptor(CSS, 'supports');
    try {
      Object.defineProperty(CSS, 'supports', { configurable: true, value: () => { throw Error('Unexpected CSS.supports'); } });
      for (const [handle, pseudo] of [[css, undefined], [css.selector('&::before'), '::before'],
        [css.media('screen'), undefined], [tree.css.global.sel('#a::before'), '::before']] as const) {
        for (const content of CSS_CONTENT_VALUES) {
          const source = `--message:"resolved";counter-reset:item 3;content:${content};--before:kept;--after:kept;opacity:.5;`;
          oracle.setAttribute('style', source); oracleStyle.textContent = `#content-oracle::before{${source}}`;
          handle.setMany({ '--message': '"resolved"', counterReset: 'item 3', content,
            '--before': 'kept', '--after': 'kept', opacity: .5 });
          await flushRuntime();
          const text = css.snapshot(), actual = win.getComputedStyle(ae, pseudo);
          const sheet = doc.querySelector<HTMLStyleElement>('hson-_style style')?.sheet;
          checks.push({ name: `native final content ${pseudo ?? 'element'}: ${JSON.stringify(content)}`, pass:
            (text.includes(`content:${content};`) || text.includes(`content: ${content};`))
            && actual.content === win.getComputedStyle(oracle, pseudo).content
            && actual.getPropertyValue('--before').trim() === 'kept'
            && actual.getPropertyValue('--after').trim() === 'kept'
            && actual.opacity === '0.5' && color(be) === 'rgb(7, 8, 9)' && sheet?.cssRules.length === 2 });
        }
        handle.setMany({ '--message': undefined, counterReset: undefined, content: undefined,
          '--before': undefined, '--after': undefined, opacity: undefined });
      }
    } finally {
      if (supportsBefore) Object.defineProperty(CSS, 'supports', supportsBefore); else Reflect.deleteProperty(CSS, 'supports');
      oracle.remove(); oracleStyle.remove(); tree.css.global.clearAll();
    }
    css.setMany({ color: 'navy', opacity: '.4' }); animation.begin({ name: 'kept', duration: '1s' });
    await flushRuntime();
    const multi = manager.animForQuids([a.quid, b.quid]);
    const state = () => JSON.stringify({ css: css.snapshot(), a: css.getMany(), b: b.css.getMany(),
      order: Reflect.get(manager, 'nextRuleOrder'), owners: [...Reflect.get(manager, 'quidRuleOrder')],
      changed: Reflect.get(manager, 'changed'), scheduled: Reflect.get(manager, 'scheduled'), raf: Reflect.get(manager, 'rafId'),
      quids: [...runtime.issuedQuids], subjects: [...runtime.quidToNode.keys()],
      targeting: [ae.getAttribute('hson:quid'), be.getAttribute('hson:quid'), outsider.getAttribute('hson:quid')],
      inline: a.node.$_attrs?.style, native: doc.head.innerHTML });
    const coldFrame = document.createElement('iframe'); document.body.append(coldFrame);
    const coldDoc = coldFrame.contentDocument!;
    const coldRuntime = create_livetree_runtime();
    const coldMap: LiveMap = hsonLiveMap.fromLibraries({ page: { document: '<aside/>' } });
    const coldMirror = reflect_document_in_runtime(coldMap.doc.must('page'), coldRuntime);
    const cold = coldMirror.tree.find.must.byTag('aside');
    const coldElement = project_livetree(subject_for_tree(coldMirror.tree), 'html', coldRuntime, coldDoc);
    coldDoc.body.append(coldElement);
    const coldBefore = coldDoc.head.innerHTML;
    let coldAtomic = true;
    try {
      for (const value of [...CSS_DECLARATION_ESCAPES, ...CSS_URL_DEPTH_CASES.filter(item => item.depth > 128).map(item => item.value)]) {
        const writes = [() => cold.css.setProp('--tokens', value), () => cold.css.set.color(value),
          () => cold.css.setMany({ color: 'red', _hover: { '--tokens': value } }),
          () => cold.css.var.set('tokens', value), () => cold.css.anim.beginName(value),
          () => cold.css.anim.restartName(value),
          () => cold.css.anim.restart({ name: 'safe', duration: '1s', playState: value })];
        for (const write of writes) {
          let rejected = false; try { write(); } catch { rejected = true; }
          coldAtomic = rejected && coldRuntime.issuedQuids.size === 0 && coldRuntime.quidToNode.size === 0
            && cold.node.$_meta?.quid === undefined && coldDoc.head.innerHTML === coldBefore && coldAtomic;
        }
      }
      checks.push({ name: 'native cold setter and animation rejection issues no identity or stylesheet', pass: coldAtomic });
    } finally { coldMirror.dispose(); coldMirror.tree.remove(); coldFrame.remove(); }
    const beforeAnimation = state(), nativeBefore = doc.head.innerHTML, outsiderBefore = color(outsider);
    let animationAtomic = true;
    for (const payload of [...CSS_DECLARATION_ESCAPES, ...CSS_CONTAINMENT_UNSUPPORTED]) {
      const invalidAnimations = [
        () => a.style.setProp('--tokens', payload),
        () => a.style.setMany({ color: 'red', '--tokens': payload }),
        () => css.setProp('--tokens', payload),
        () => css.setProp('--tokens', { value: payload, unit: '_' }),
        () => css.media('screen').setMany({ color: 'red', _hover: { '--tokens': payload } }),
        () => tree.css.global.var.set('tokens', payload),() => animation.beginName(payload), () => animation.restartName(payload),
        () => Reflect.apply(animation.setPlayState, animation, [payload]),
        () => manager.setForQuid(a.quid, 'animationName', payload),
        () => manager.setManyForQuid(a.quid, { color: 'red', opacity: undefined, animationName: payload }),
        () => css.setMany({ color: 'red', opacity: undefined, animationName: payload }),
        () => css.selector('& .child').setMany({ color: 'red', animationName: payload }),
        () => tree.css.global.sel('.global-escape').setMany({ color: 'red', animationName: payload }),
        () => multi.beginName(payload), () => multi.restartName(payload)];
      for (const field of ['name', 'duration', 'timingFunction', 'delay', 'iterationCount', 'direction', 'fillMode', 'playState']) {
        const spec = { name: 'changed', duration: '2s', [field]: payload };
        invalidAnimations.push(() => animation.begin(spec), () => animation.restart(spec),
          () => multi.begin(spec), () => multi.restart(spec));
      }
      for (const run of invalidAnimations) {
        let rejected = false; try { run(); } catch { rejected = true; }
        animationAtomic = rejected && state() === beforeAnimation && animationAtomic;
      }
    }
    checks.push({ name: 'animation containment rejects every field before model order or publication changes', pass:
      animationAtomic && state() === beforeAnimation });
    await flushRuntime();
    checks.push({ name: 'animation rejection publishes no independent native CSS rule', pass:
      [...doc.styleSheets].every(sheet => [...sheet.cssRules].every(rule => !rule.cssText.includes('.escape')))
      && doc.head.innerHTML === nativeBefore });
    // Reinsert color after animation-name: a retained escape would now absorb it.
    css.remove('color'); css.set.color('rgb(1, 2, 3)');
    tree.css.global.sel('.unrelated').set.color('purple');
    await flushRuntime();
    checks.push({ name: 'rejected escape cannot capture later declarations or unrelated managed rules or target a non-QUID outsider', pass:
      color(ae) === 'rgb(1, 2, 3)' && color(be) !== 'rgb(1, 2, 3)' && color(outsider) === outsiderBefore
      && outsider.getAttribute('hson:quid') === null && css.snapshot().includes('.unrelated')
      && [...doc.styleSheets].every(sheet => [...sheet.cssRules].every(rule => !rule.cssText.includes('.escape'))) });
    tree.css.global.clearAll();
    let containedStored = true;
    for (const [property, value] of CSS_CONTAINED_VALUES) {
      css.setProp(property, value);
      await flushRuntime();
      containedStored = manager.getForQuid(a.quid, normalize_css_key(property)) === value
        && (doc.head.textContent ?? '').includes(value) && color(outsider) === outsiderBefore
        && [...doc.styleSheets].every(sheet => [...sheet.cssRules].every(rule => !rule.cssText.includes('.escape')))
        && containedStored;
      css.remove(property);
    }
    await flushRuntime();
    checks.push({ name: 'native manager preserves quoted escaped nested and custom-property punctuation without escaping ownership', pass:
      containedStored && color(outsider) === outsiderBefore
      && [...doc.styleSheets].every(sheet => [...sheet.cssRules].every(rule => !rule.cssText.includes('.escape'))) });
    // Each safe slot is surrounded by declarations and a neighboring contribution.
    // Native CSSOM/computed styles, not another parser, determine containment.
    let nativeSlots = true;
    tree.css.global.sel('#b').set.color('rgb(7, 8, 9)');
    for (const [property, value] of CSS_CONTAINED_VALUES) {
      css.setProp('--before', 'kept'); css.setProp(property, value); css.setProp('--after', 'kept');
      await flushRuntime();
      const native = [...doc.styleSheets].flatMap(sheet => [...sheet.cssRules]);
      const isStyle = (rule: CSSRule): rule is CSSStyleRule => 'selectorText' in rule && 'style' in rule;
      const own = native.find(rule => isStyle(rule) && rule.selectorText.includes(a.quid));
      nativeSlots = nativeSlots && native.length === 2 && own !== undefined && isStyle(own)
        && own.style.getPropertyValue('--before').trim() === 'kept'
        && own.style.getPropertyValue('--after').trim() === 'kept'
        && color(be) === 'rgb(7, 8, 9)' && color(outsider) === outsiderBefore
        && manager.getForQuid(a.quid, normalize_css_key(property)) === value
        && (doc.head.textContent ?? '').includes(value);
      css.remove(property);
    }
    checks.push({ name: 'native CSSOM keeps safe slots and neighboring contributions intact', pass: nativeSlots });
    css.remove('--before'); css.remove('--after'); tree.css.global.clearAll();
    animation.beginName('valid'); animation.restartName('valid-restart');
    animation.begin({ name: 'pulse', duration: '250ms', timingFunction: 'linear', delay: '50ms',
      iterationCount: '2', direction: 'alternate', fillMode: 'both', playState: 'running' });
    animation.pause(); animation.resume(); animation.setPlayState('paused');
    checks.push({ name: 'valid browser animation operations retain names specifications and play state', pass:
      css.get.animationName() === 'pulse' && css.get.animationDuration() === '250ms'
      && css.get.animationTimingFunction() === 'linear' && css.get.animationPlayState() === 'paused' });
    const supports = Object.getOwnPropertyDescriptor(CSS, 'supports');
    try {
      Object.defineProperty(CSS, 'supports', { configurable: true, value: () => { throw Error('Unexpected CSS.supports'); } });
      animation.restart({ name: 'future-animation', duration: 'future-duration-token' });
      css.set.color('future-color-token');
      checks.push({ name: 'browser manager retains safe unsupported values without consulting CSS.supports', pass:
        css.get.animationDuration() === 'future-duration-token' && css.get.color() === 'future-color-token' });
    } finally {
      if (supports) Object.defineProperty(CSS, 'supports', supports); else Reflect.deleteProperty(CSS, 'supports');
    }
    animation.end('clear-all'); css.clear(); await flushRuntime();
    for (const handle of [a.style, css, css.media('screen')]) {
      handle.setMany({ color: 'red', opacity: '.5' });
      handle.setMany({ width: { value: 2, unit: 'rem' } });
      const missingKeeps = handle.get.color() === 'red';
      handle.setMany({ color: undefined, width: undefined, opacity: '.7' });
      const deletes = handle.get.color() === undefined && handle.get.width() === undefined && handle.get.opacity() === '.7';
      const before = css.snapshot(), node = JSON.stringify(a.node);
      let rejected = 0;
      for (const value of [null, true, false]) {
        try { Reflect.apply(handle.setMany, handle, [{ color: 'blue', opacity: undefined, width: value }]); } catch { rejected++; }
        try { Reflect.apply(handle.setProp, handle, ['color', value]); } catch { rejected++; }
      }
      checks.push({ name: 'native set/delete missing values and atomic invalid siblings', pass:
        missingKeeps && deletes && rejected === 6 && css.snapshot() === before && JSON.stringify(a.node) === node });
      handle.setMany({ opacity: undefined });
    }
    css.setMany({ color: 'future-color-token' });
    checks.push({ name: 'browser stores syntax-contained declarations independently of CSS.supports',
      pass: !CSS.supports('color', 'future-color-token') && css.get.color() === 'future-color-token' });
    css.setMany({ color: undefined, __before: { content: undefined }, __after: {} });
    checks.push({ name: 'browser deletion-only pseudo branches synthesize no content or rules', pass: css.snapshot() === '' });
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
    css.clear(); tree.css.global.clearAll();
    css.media('screen').selector(':enabled,#unmatched').setMany({
      '&:focus': { '&': { __before: { color: 'red' }, __after: { color: 'purple' } } },
    });
    tree.css.global.sel('#a::before').set.color('blue');
    await flushRuntime();
    checks.push({ name: 'native explicit relative recursion retains maximum list specificity, absent content and scope', pass:
      color(ae, '::before') === 'rgb(255, 0, 0)' && color(ae, '::after') === 'rgb(128, 0, 128)'
      && win.getComputedStyle(ae, '::before').content === 'none'
      && win.getComputedStyle(be, '::before').content === 'none'
      && win.getComputedStyle(outsider, '::before').content === 'none' });
    css.media('screen').clear(); tree.css.global.clearAll();
    await flushRuntime();
    checks.push({ name: 'native explicit recursive rules retire with their scoped owner', pass:
      win.getComputedStyle(ae, '::before').content === 'none' && win.getComputedStyle(ae, '::after').content === 'none' });
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
    const map: LiveMap = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body <button id="a" class="a a&b escaped,comma" data-x="a&b"/> <button id="b" class="b"/>/>/>' } });
    const page = map.doc.must('page');
    page.css.sel('button').set.color('black');
    doc.open(); doc.write(page.render()); doc.close();
    const adopted = bound ? continue_document({ map, document: page, root: doc.documentElement }) : undefined;
    const css = adopted?.tree.css.global ?? page.css;
    const flush = () => { if (!bound) doc.head.querySelector('style')!.textContent = page.css.snapshot(); };
    const native = doc.head.querySelector('style');
    try {
      const pseudos = { _focus: { color: 'red' }, __before: { color: 'purple' }, __after: { content: '"tail"', color: 'orange' } };
      if (adopted) adopted.tree.css.global.media('screen').sel('.a,.b').setMany(pseudos);
      else page.css.media('screen').sel('.a,.b').setMany(pseudos);
      flush();
      const a = doc.querySelector<HTMLElement>('#a')!, b = doc.querySelector<HTMLElement>('#b')!;
      checks.push({ name: `${bound ? 'bound global' : 'Document'} native list pseudos do not style an unfocused first arm`, pass: win.getComputedStyle(a).color === 'rgb(0, 0, 0)' });
      a.focus();
      checks.push({ name: `${bound ? 'bound global' : 'Document'} native list pseudo applies when first arm matches`, pass: win.getComputedStyle(a).color === 'rgb(255, 0, 0)' });
      b.focus();
      checks.push({ name: `${bound ? 'bound global' : 'Document'} native second arm focus and both pseudo-elements`, pass:
        win.getComputedStyle(b).color === 'rgb(255, 0, 0)' && win.getComputedStyle(a).color === 'rgb(0, 0, 0)'
        && [a, b].every(el => win.getComputedStyle(el, '::before').color === 'rgb(128, 0, 128)' && win.getComputedStyle(el, '::after').content === '"tail"') });
      const literalPattern = String.raw`:is(.a,.b),[data-x="a&b"],.a\&b,.escaped\,comma`;
      const beforeDeclarations = { __before: { color: 'green' } };
      if (adopted) adopted.tree.css.global.sel(literalPattern).setMany(beforeDeclarations);
      else page.css.sel(literalPattern).setMany(beforeDeclarations);
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
        try {
          const declarations = { color: 'red', _hover: { color: 'blue' } };
          if (adopted) adopted.tree.css.global.sel(pattern).setMany(declarations);
          else page.css.sel(pattern).setMany(declarations);
        } catch { rejected++; }
      }
      checks.push({ name: `${bound ? 'bound global' : 'Document'} malformed input has no publication`, pass:
        rejected === 5 && map.rev === rev && JSON.stringify(map.capture()) === before
        && doc.head.querySelector('style') === native && native!.textContent === text });
    } finally { adopted?.dispose(); frame.remove(); }
  }
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  return checks;
}
