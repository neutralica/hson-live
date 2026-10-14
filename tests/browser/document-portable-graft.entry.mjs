import { hsonTransform } from "../../src/api/transform/transform.facade.ts";
import { restore_portable_document_receiver_internal as restore } from "../../src/api/livemap/livemap.libraries.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { lookup_document_quad_internal as lookup } from "../../src/api/livemap/livemap.document.quad.ts";
import { continue_document, continue_portable_document_internal as graft } from "../../src/api/continuation/continue-document.ts";
import { get_node_for_el } from "../../src/api/livetree/utils/node-map-helpers.ts";
import { set_document_adoption_fault_hook_for_tests as fault } from "../../src/api/continuation/continuation.adopt.ts";
import { runtime_for_tree } from "../../src/api/livetree/runtime/livetree-runtime.ts";

const assert = (condition, message) => { if (!condition) throw Error(message); };
const equal = (a, b, message) => assert(JSON.stringify(a) === JSON.stringify(b), `${message}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
function rejects(run, message) { let threw = false; try { run(); } catch { threw = true; } assert(threw, message); }
const marker = '[data-hson-managed-document-css]';
function visual(doc) {
  const computed = element => { const style = doc.defaultView.getComputedStyle(element); return [style.color, style.borderTopWidth, style.paddingLeft, style.backgroundColor]; };
  return [computed(doc.documentElement), ...["first", "second", "first-child", "second-child", "anonymous-one", "anonymous-two", "unrelated", "ordinary"].map(id => computed(doc.getElementById(id)))];
}
async function page(html, libs) {
  const frame = document.createElement("iframe");
  frame.srcdoc = html;
  const loaded = new Promise(resolve => frame.onload = resolve);
  document.body.append(frame); await loaded;
  const doc = frame.contentDocument, root = doc.documentElement;
  const receiver = restore(structuredClone(libs)), aggregate = owner(receiver.map), library = aggregate.libraries()[0];
  const selected = receiver.map.lib(libs.libraries[0].name), handoff = aggregate.preparePortableDocumentHandoff(library, receiver.correspondence);
  return { frame, doc, root, ...receiver, aggregate, library, selected, handoff,
    run: () => graft({ map: receiver.map, document: selected, root }, handoff) };
}
function snapshot(node) {
  return node.nodeType === 1 ? { name: node.localName, namespace: node.namespaceURI,
    attrs: [...node.attributes].map(attr => [attr.name, attr.value]).sort((a,b) => a[0].localeCompare(b[0])),
    children: [...node.childNodes].map(snapshot) } : { type:node.nodeType, value:node.nodeValue };
}
function unchanged(f, before, elements) {
  equal(snapshot(f.root), before, "DOM/CSS rollback is exact");
  equal([...f.root.querySelectorAll('*')].length, elements.length, "same Element inventory");
  elements.forEach((element, index) => assert(f.root.querySelectorAll('*')[index] === element, "original Element retained"));
  assert(get_node_for_el(f.root) === undefined, "no partial native root mapping");
}
globalThis.runPortableGraftAcceptance = async ({ html, libs, sourceQuids, composed }) => {
  let passed = 0;
  async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
  await check("fresh receiving QUIDs, authored/disposable names, original Elements, CSS authority and lifecycle", async () => {
    const f = await page(html, libs), before = visual(f.doc), elements = [f.root, ...f.root.querySelectorAll('*')];
    const style = f.doc.querySelector(marker), authoredStyle = f.doc.querySelector('head style');
    const unrelated = f.doc.getElementById('unrelated'), unrelatedHtml = unrelated.outerHTML;
    let quidsBeforeStyleSwitch = false, allCarriersAtStyleSwitch = false;
    const text = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    Object.defineProperty(style, 'textContent', { configurable: true, get() { return text.get.call(this); }, set(value) {
      if (value === f.handoff.receivingCss) {
        quidsBeforeStyleSwitch = f.correspondence.associations.every(entry => f.root.querySelector(`[hson\\:quid="${entry.quid}"]`) || f.root.getAttribute('hson:quid') === entry.quid);
        allCarriersAtStyleSwitch = f.doc.querySelectorAll('[hson\\:quad]').length === 7;
        equal(visual(f.doc), before, 'style flush before switch stays portable');
      }
      text.set.call(this, value);
      if (value === f.handoff.receivingCss) equal(visual(f.doc), before, 'style flush after switch uses receiving identities');
    } });
    const elementPrototype = f.doc.defaultView.Element.prototype;
    const originalRemove = elementPrototype.removeAttribute;
    let synchronousFlushes = 0;
    elementPrototype.removeAttribute = function(name) { originalRemove.call(this, name);
      if (this.ownerDocument === f.doc && name === 'hson:quad') { synchronousFlushes++; equal(visual(f.doc), before, 'flush during carrier consumption'); } };
    let continued;
    try { continued = f.run(); } finally { elementPrototype.removeAttribute = originalRemove; delete style.textContent; }
    assert(quidsBeforeStyleSwitch && allCarriersAtStyleSwitch && synchronousFlushes === 7, 'ordered coherent transition');
    assert(continued.tree.dom.el() === f.root, 'borrowed root retained');
    elements.forEach((element, index) => assert([f.root, ...f.root.querySelectorAll('*')][index] === element, 'original Element identity'));
    assert(f.doc.querySelectorAll('[hson\\:quad]').length === 0, 'all carriers consumed');
    for (const entry of f.correspondence.associations) {
      assert(!sourceQuids.includes(entry.quid), 'foreign payload never grants runtime identity');
      assert(f.aggregate.documentOverlay(f.library).quidAtPath(entry.path) === entry.quid, 'owner path correspondence');
      assert(runtime_for_tree(continued.tree).quidToNode.has(entry.quid), 'existing runtime registry linked');
      if (entry.disposition === 'disposable') assert(lookup(f.selected, entry.name) === undefined, 'disposable never authored');
      else assert(lookup(f.selected, entry.name)?.quid === entry.quid, 'authored name remains authored');
    }
    assert(lookup(f.selected, '_987654321'), 'underscore authored name remains authored');
    equal(visual(f.doc), before, 'computed styles preserved');
    equal(unrelated.outerHTML, unrelatedHtml, 'unrelated node unchanged');
    assert(f.doc.querySelector(marker) === style && f.doc.querySelectorAll(marker).length === 1, 'one original managed style');
    assert(style.previousElementSibling === authoredStyle && style.parentElement === f.doc.head, 'managed placement and order');
    equal(style.textContent, f.selected.css.snapshot(), 'native style is receiving Library realization');
    f.selected.css.sel('.ordinary').setProp('color', 'rgb(21, 22, 23)');
    assert(f.doc.defaultView.getComputedStyle(f.doc.getElementById('ordinary')).color === 'rgb(21, 22, 23)', 'bound CSS updates');
    const anonymous = f.doc.getElementById('anonymous-one'), anonId = anonymous.getAttribute('hson:quid');
    f.selected.at([1, 0]).move(1, 0);
    assert(f.doc.getElementById('anonymous-one') === anonymous && anonymous.getAttribute('hson:quid') === anonId, 'movement preserves Element and identity');
    assert(f.doc.defaultView.getComputedStyle(anonymous).color === 'rgb(70, 80, 90)', 'movement retains CSS');
    f.selected.at([1, 0, 0]).attrs.set('title', 'updated');
    assert(anonymous.getAttribute('title') === 'updated', 'document update retains correspondence');
    const firstId = lookup(f.selected, 'first').quid;
    f.selected.document.content.replace({ kind: 'path', path: [0,0,1,0] }, 0,
      hsonTransform.fromHson('<section id="first" <p id="anonymous-one"/> <p id="first-child"/>/>').toNode().$_content[0],
      [{ source:[], destination:[] }, { source:[0,0], destination:[0,0] }, { source:[0,1], destination:[0,1] }]);
    assert(lookup(f.selected, 'first')?.quid === firstId, 'legitimate replacement lineage retains authored identity');
    assert(f.doc.getElementById('first').getAttribute('hson:quid') === firstId, 'replacement metadata agrees');
    rejects(() => f.selected.at([1, 1]).delete(), 'remaining identity CSS rejects retirement');
    f.map.batch(draft => {
      const selected = draft.lib(libs.libraries[0].name);
      selected.content.remove({ kind:'path', path:[0,0,1,0] }, 1);
      selected.css.stylesheet('.ordinary{color:rgb(21,22,23)}');
    });
    assert(!f.doc.getElementById('second') && !lookup(f.selected, 'second'), 'removal retires correspondence');
    assert(continued.mirror.status === 'active', 'Mirror remains active through lifecycle');
    continued.dispose(); assert(continued.mirror.status === 'disposed', 'Mirror disposed');
    assert(f.doc.querySelectorAll(marker).length === 1, 'disposal adds no duplicate style');
    f.frame.remove();
  });
  for (const kind of ['missing', 'extra', 'duplicate', 'wrong-path', 'malformed', 'unexpected-quid', 'mixed']) {
    await check(`${kind} carrier rejects before authority publication`, async () => {
      const f = await page(html, libs), first = f.doc.getElementById('first'), second = f.doc.getElementById('second');
      if (kind === 'missing') first.removeAttribute('hson:quad');
      if (kind === 'extra') f.doc.getElementById('unrelated').setAttribute('hson:quad', 'extra');
      if (kind === 'duplicate') second.setAttribute('hson:quad', 'first');
      if (kind === 'wrong-path') { first.setAttribute('hson:quad', 'second'); second.setAttribute('hson:quad', 'first'); }
      if (kind === 'malformed') first.setAttribute('hson:quad', '@:first');
      if (kind === 'unexpected-quid' || kind === 'mixed') first.setAttribute('hson:quid', '012345678');
      const before = snapshot(f.root), elements = [...f.root.querySelectorAll('*')], capture = JSON.stringify(f.map.capture());
      rejects(f.run, 'carrier must reject'); unchanged(f, before, elements);
      equal(JSON.stringify(f.map.capture()), capture, 'no authoritative publication'); f.frame.remove();
    });
  }
  await check('wrong Library and CSS failure reject without native or authoritative partial changes', async () => {
    const f = await page(html, libs), other = await page(html, libs), before = snapshot(f.root), elements = [...f.root.querySelectorAll('*')];
    rejects(() => graft({map: f.map, document: f.selected, root: f.root}, other.handoff), 'wrong Library token');
    rejects(() => graft({map: f.map, document: other.selected, root: f.root}, f.handoff), 'wrong selected Library');
    unchanged(f, before, elements);
    const broken = structuredClone(libs); broken.libraries[0].css.rules[0].selector = '[hson\\:quad="absent"]';
    rejects(() => restore(broken), 'unresolved CSS rejects before receiving publication');
    unchanged(f, before, elements);
    f.frame.remove(); other.frame.remove();
  });
  for (const kind of ['metadata', 'wrong-metadata', 'style', 'silent-style', 'carrier-removal', 'silent-removal', 'adoption', 'late-interaction']) await check(`${kind} native failure rolls back and permits safe retry`, async () => {
    const f = await page(html, libs), before = snapshot(f.root), elements = [...f.root.querySelectorAll('*')], computed = visual(f.doc);
    const style = f.doc.querySelector(marker), element = f.doc.getElementById('second-child');
    let once = false;
    const set = element.setAttribute, remove = element.removeAttribute, text = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    if (kind === 'metadata') element.setAttribute = function(name, value) { set.call(this, name, value); if (!once && name === 'hson:quid') { once = true; throw Error('metadata write fault'); } };
    if (kind === 'wrong-metadata') element.setAttribute = function(name, value) { set.call(this, name, name === 'hson:quid' ? '000000000' : value); };
    if (kind === 'silent-removal') element.removeAttribute = function(name) { if (name !== 'hson:quad') remove.call(this, name); };
    if (kind === 'silent-style') Object.defineProperty(style, 'textContent', { configurable:true, get() {return text.get.call(this);}, set(_value) {} });
    if (kind === 'carrier-removal') element.removeAttribute = function(name) { remove.call(this, name); if (!once && name === 'hson:quad') { once = true; throw Error('carrier removal fault'); } };
    if (kind === 'style') Object.defineProperty(style, 'textContent', { configurable:true, get() {return text.get.call(this);}, set(value) { text.set.call(this,value); if (!once) { once=true; throw Error('style realization fault'); } } });
    if (kind === 'adoption') fault(point => { if (point === 'after-links') throw Error('adoption fault'); });
    try { rejects(kind === 'late-interaction' ? () => graft({map:f.map,document:f.selected,root:f.root,interactions:{local:{}}}, f.handoff) : f.run, 'injected fault must reject'); }
    finally { delete element.setAttribute; delete element.removeAttribute; delete style.textContent; fault(undefined); }
    unchanged(f, before, elements); equal(visual(f.doc), computed, 'rollback preserves usable styling');
    equal(f.selected.css.snapshot(), f.handoff.receivingCss, 'accepted CSS authority retained');
    f.correspondence.assertCurrent();
    f.handoff.assertCurrent(); const retry = f.run(); equal(visual(f.doc), computed, 'retry styles preserved'); retry.dispose(); f.frame.remove();
  });
  await check('two independent browser receivers keep separate anonymous identities and styles', async () => {
    const one = await page(html, libs), two = await page(html, libs);
    const first = one.run(), second = two.run();
    const ids = new Set(one.correspondence.associations.map(entry => entry.quid));
    for (const entry of two.correspondence.associations) assert(!ids.has(entry.quid), 'independent QUIDs');
    equal(visual(one.doc), visual(two.doc), 'independent equal styles');
    const oneAnonymous = one.doc.getElementById('anonymous-one'), twoAnonymous = two.doc.getElementById('anonymous-one');
    assert(oneAnonymous !== twoAnonymous && oneAnonymous.getAttribute('hson:quid') !== twoAnonymous.getAttribute('hson:quid'), 'separate anonymous subjects');
    first.dispose(); second.dispose(); one.frame.remove(); two.frame.remove();
  });
  await check('final-only styled Parts graft synchronously and recur after live edits', async () => {
    const f = await page(composed.html, composed.libs), sections = [...f.doc.querySelectorAll('section')];
    const visual = doc => [...doc.querySelectorAll('section'),doc.getElementById('unrelated')].map(element => {
      const css=doc.defaultView.getComputedStyle(element),label=doc.defaultView.getComputedStyle(element.querySelector('span'));
      return [css.borderTopWidth,label.color,label.paddingLeft];
    });
    const before = visual(f.doc), elements = [f.root,...f.root.querySelectorAll('*')], style=f.doc.querySelector(marker);
    equal(before, [...Array(3).fill(['3px','rgb(10, 20, 30)','7px']),['0px','rgb(0, 0, 0)','0px']], 'Part-owned CSS before graft');
    rejects(() => f.map.lib('parts'), 'no source Part collection'); rejects(() => f.map.lib('layout'), 'no source layout Library');
    const text=Object.getOwnPropertyDescriptor(Node.prototype,'textContent'),prototype=f.doc.defaultView.Element.prototype,remove=prototype.removeAttribute;
    let switches=0,removals=0;
    Object.defineProperty(style,'textContent',{configurable:true,get(){return text.get.call(this);},set(value){
      if(value===f.handoff.receivingCss){
        switches++;
        assert(f.doc.querySelectorAll('[hson\\:quad]').length===6,'all portable carriers remain at switch');
        assert(f.correspondence.associations.every(entry=>f.doc.querySelector(`[hson\\:quid="${entry.quid}"]`)),'receiving QUIDs written before switch');
        equal(visual(f.doc),before,'synchronous pre-switch computed styles');
      }
      text.set.call(this,value);
      if(value===f.handoff.receivingCss) equal(visual(f.doc),before,'synchronous post-switch computed styles');
    }});
    prototype.removeAttribute=function(name){remove.call(this,name);if(name==='hson:quad'){removals++;equal(visual(f.doc),before,'synchronous carrier removal style flush');}};
    let continued;
    try {continued=f.run();} finally {prototype.removeAttribute=remove;delete style.textContent;}
    assert(switches===1&&removals===6,'one synchronous CSS handoff consumes all six carriers');
    elements.forEach((element,index)=>assert([f.root,...f.root.querySelectorAll('*')][index]===element,'all original Elements retained'));
    assert(f.doc.querySelector(marker)===style&&f.doc.querySelectorAll(marker).length===1,'one original managed style retained');
    const ids=new Set(f.correspondence.associations.map(entry=>entry.quid));assert(ids.size===6,'six distinct sparse receiving subjects');
    f.correspondence.associations.forEach(entry=>{
      assert(!composed.sourceQuids.includes(entry.quid),'source QUID has no authority');
      assert(f.aggregate.documentOverlay(f.library).quidAtPath(entry.path)===entry.quid,'exact destination ownership');
      if(entry.disposition==='disposable') assert(!lookup(f.selected,entry.name),'disposable remains anonymous');
      else assert(lookup(f.selected,entry.name)?.quid===entry.quid,'receiving authored QUAD retained');
    });
    assert(!lookup(f.selected,'root')&&!lookup(f.selected,'label'),'Part-local names never promoted');
    assert(lookup(f.selected,'slot0')&&lookup(f.selected,'slot1')&&lookup(f.selected,'caption'),'shell and explicit q promotions retained');
    const rootEntry=f.correspondence.associations.find(entry=>entry.name==='slot0'),label=sections[0].querySelector('span'),labelId=label.getAttribute('hson:quid');
    f.selected.document.attrs.set({kind:'path',path:rootEntry.path},'title','Edited');
    assert(sections[0].getAttribute('title')==='Edited','live local attribute edit');
    f.selected.document.content.move({kind:'path',path:[...rootEntry.path,0]},0,1);
    assert(sections[0].children[1]===label,'live move retains original label Element');
    equal(visual(f.doc),before,'subject styling survives move');
    assert(label.getAttribute('hson:quid')===labelId,'move retains subject identity');
    f.selected.css.sel(`[hson\\:quid="${rootEntry.quid}"]`).setProp('--tone','rgb(42, 43, 44)');
    assert(f.doc.defaultView.getComputedStyle(label).color==='rgb(42, 43, 44)','live CSS binding updates synchronously');
    rejects(()=>f.selected.document.content.remove({kind:'path',path:[...rootEntry.path,0]},1),'subject CSS strict retirement');
    const recut=f.map.cut({data:[],documents:['page'],html:'page'}),after=visual(f.doc),again=await page(recut.html,recut.libs);
    equal(visual(again.doc),after,'final-only portable restore first paint after edits');
    assert(again.correspondence.associations.every(entry=>!ids.has(entry.quid)),'recurring restoration issues fresh identities');
    const retained=[again.root,...again.root.querySelectorAll('*')],regraft=again.run();
    retained.forEach((element,index)=>assert([again.root,...again.root.querySelectorAll('*')][index]===element,'restored original Elements retained'));
    equal(visual(again.doc),after,'restored graft after edits preserves styling');
    assert(again.doc.querySelectorAll(marker).length===1,'restored graft has one managed style');
    regraft.dispose();again.frame.remove();continued.dispose();f.frame.remove();
  });
  await check('ordinary carrier-free SSR uses the unchanged exact continuation path', async () => {
    const receiver = restore(structuredClone(libs)), selected = receiver.map.lib('page'); selected.css.clearAll();
    const frame = document.createElement('iframe'); frame.srcdoc = selected.render(); const loaded = new Promise(resolve => frame.onload = resolve); document.body.append(frame); await loaded;
    const root = frame.contentDocument.documentElement;
    const continued = continue_document({map: receiver.map, document:selected, root}); assert(continued.tree.dom.el() === root, 'ordinary root retained'); continued.dispose(); frame.remove();
  });
  return { passed };
};
