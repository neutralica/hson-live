import assert from 'node:assert/strict';
import Module from 'node:module';
import type { AppearanceScratchpads as Pads } from '../src/scratchpads.js';

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const source = '<p @:title "Retained 😀 é"/>\r\n';
const newer = '<p @:title "NEWER 😀"/>\r\n';
const seed = () => ['Document', 'Data', 'Interpolation'].flatMap(example => ['dark', 'light'].map(mode => ({
  example, family: example === 'Document' ? 'document' : example === 'Data' ? 'data' : 'all',
  mode, target: 'palette:source', uri: `untitled:${example}-${mode}.hson`, text: source + example + mode,
})));
async function run() {
  const listeners: Record<string, (event: any) => void> = {};
  const acknowledgements: ReturnType<typeof deferred>[] = [], errors: string[] = [];
  class Emitter {
    listeners = new Set<()=>void>();
    event = (listener:()=>void) => {this.listeners.add(listener);return {dispose:()=>this.listeners.delete(listener)};};
    fire() {for(const listener of this.listeners)listener();}
    dispose() {this.listeners.clear();}
  }
  const api = {EventEmitter:Emitter,ConfigurationTarget: {Global: 1, Workspace: 2}, workspace: {textDocuments: [],
    onDidChangeTextDocument: (fn: any) => { listeners.change = fn; return {dispose() {}}; },
    onDidOpenTextDocument: (fn: any) => { listeners.open = fn; return {dispose() {}}; },
    onDidCloseTextDocument: (fn: any) => { listeners.close = fn; return {dispose() {}}; }},
    commands: {getCommands: () => { const ack = deferred(); acknowledgements.push(ack); return ack.promise; }},
    window: {showErrorMessage: async (message: string) => { errors.push(message); return undefined; }}};
  const load = Reflect.get(Module, '_load');
  Reflect.set(Module, '_load', function(this: unknown, name: string, ...args: unknown[]) {
    return name === 'vscode' ? api : Reflect.apply(load, this, [name, ...args]);
  });
  const {AppearanceScratchpads} = await import('../src/scratchpads.js');
  const {HsonAppearanceEditor} = await import('../src/appearance-editor.js');
  const {initialAppearance} = await import('../src/appearance-model.js');
  Reflect.set(Module, '_load', load);
  async function ack() {
    await tick();
    for (const acknowledgement of acknowledgements.splice(0)) acknowledgement.resolve();
    await tick();
  }
  function fixture(records = seed()) {
    let durable = structuredClone(records), text = records[0]?.text ?? '';
    const attempts: typeof records[] = [];
    const plans: ((value: typeof records) => Promise<void>)[] = [];
    const storage: any = {get: () => structuredClone(durable), update: async (_key: string, value: typeof records) => {
      attempts.push(structuredClone(value));
      await plans.shift()?.(value);
      durable = structuredClone(value);
    }};
    const pads = new AppearanceScratchpads(storage);
    const document: any = {uri: {toString: () => records[0]!.uri}, version: 1, isClosed: false, getText: () => text};
    const change = (next: string) => {
      const before = text; text = next; document.version++;
      listeners.change!({document, contentChanges: [{rangeOffset: 0, rangeLength: before.length, text: next}]});
    };
    return {pads, document, storage, attempts, plans, durable: () => durable,
      commitThenReject(value: typeof records) { durable = structuredClone(value); return Promise.reject(new Error('write acknowledgement failed')); },
      accepted: () => Reflect.get(pads.context(document)!, 'text'), change,
      close() { document.isClosed = true; listeners.close!(document); }};
  }
  let checks = 0;
  const check = async (name: string, action: () => Promise<void>) => { await action(); console.log(`ok ${++checks} - ${name}`); };
  await check('original corrective-write failure cannot erase a retained native buffer', async () => {
    const f=fixture(), retained=f.accepted();
    f.plans.push(async()=>{},async()=>{},async()=>{throw new Error('corrective write failed');});
    f.change(retained.replace(/\r\n/g,'\n')); f.change(''); f.close(); await ack(); await f.pads.flush();
    assert.deepEqual(f.attempts,[],'teardown requires no compensating durable write');
    assert.equal(f.durable()[0]!.text,retained); f.pads.dispose();
    const restarted=new AppearanceScratchpads(f.storage);
    assert.equal(Reflect.get(restarted.context(f.document)!,'text'),retained); restarted.dispose();
  });
  await check('native reset snapshots never reach storage, including rejected pending writes', async () => {
    const f = fixture(), write = deferred(); let notices=0; f.pads.onDidChange(()=>notices++); f.plans.push(() => write.promise);
    f.change(newer); await ack(); assert.equal(f.attempts.length, 1);
    f.change(newer.replace(/\r\n/g, '\n')); f.change(''); f.close(); await ack();
    write.reject(new Error('disk rejected authored write'));
    await assert.rejects(f.pads.flush(), /disk rejected/);
    assert.ok(notices>0,'an open controller is notified of the failed save');
    assert.equal(f.attempts.length, 1, 'no corrective write or durable teardown values');
    assert.equal(f.durable()[0]!.text, seed()[0]!.text);
    assert.equal(f.accepted(), newer);
    const restarted = new AppearanceScratchpads(f.storage);
    assert.equal(Reflect.get(restarted.context(f.document)!, 'text'), seed()[0]!.text, 'restart restores preceding authored snapshot');
    restarted.dispose(); await f.pads.recover(); assert.equal(f.durable()[0]!.text, newer); f.pads.dispose();
  });
  await check('unobserved startup emptiness cannot overwrite retained source', async () => {
    const f = fixture();
    listeners.open!({...f.document, getText:()=>''}); await ack(); await f.pads.flush();
    assert.equal(f.attempts.length,0); assert.equal(f.durable()[0]!.text,seed()[0]!.text);
    listeners.open!({...f.document,version:7,getText:()=>''}); await ack(); await f.pads.flush();
    assert.equal(f.durable()[0]!.text,'','an edited live model may author empty source across a host restart'); f.pads.dispose();
  });
  await check('immediate edits and intentional clears survive unacknowledged native close', async () => {
    for (const text of [newer, '']) {
      const f = fixture(); f.change(text);
      if (text) f.change(text.replace(/\r\n/g, '\n'));
      f.change(''); f.close(); await ack(); await f.pads.flush();
      assert.equal(f.durable()[0]!.text, text);
      assert.ok(f.attempts.every(value => value[0]!.text === text)); f.pads.dispose();
    }
  });
  await check('acknowledgement reversal, rejection and language close preserve ordering', async () => {
    const f = fixture(); f.change('first'); f.change(newer); await tick();
    const [first, second] = acknowledgements.splice(0); second!.resolve(); await tick(); first!.resolve(); await f.pads.flush();
    assert.equal(f.durable()[0]!.text, newer);
    f.change(''); await tick(); acknowledgements.shift()!.reject(new Error('RPC rejected'));
    await assert.rejects(f.pads.flush(), /acknowledgement failed/);
    assert.equal(f.durable()[0]!.text, newer);
    listeners.close!(f.document); // language change: document still live
    const recovery = f.pads.recover(); await ack(); await recovery;
    assert.equal(f.durable()[0]!.text, ''); assert.equal(f.pads.error, ''); f.pads.dispose();
  });
  await check('moving all six records preserves source, URI, family and mode; collisions are atomic', async () => {
    const f = fixture(); await f.pads.reassign('palette:source', 'palette:destination');
    assert.deepEqual(f.durable(), seed().map(record => ({...record, target: 'palette:destination'})));
    await assert.rejects(f.pads.reassign('palette:destination', 'palette:destination'), /matching/);
    const occupied = fixture([...seed(), {...seed()[0]!, target: 'palette:destination', uri: 'untitled:occupied', text: 'destination source'}]);
    await assert.rejects(occupied.pads.reassign('palette:source', 'palette:destination'), /matching/);
    assert.equal(occupied.attempts.length, 0); occupied.pads.dispose(); f.pads.dispose();
  });
  for (const failure of ['none', 'move', 'concurrent-edit', 'rollback', 'ambiguous-write'] as const) {
    await check(`move boundary ${failure}: newer source and both ownership guards`, async () => {
      const f = fixture(), gate = deferred();
      f.plans.push(async value => { await gate.promise; if (failure === 'ambiguous-write') await f.commitThenReject(value);
        if (failure === 'move' || failure === 'rollback') throw new Error('move failed'); });
      f.plans.push(async () => { if (failure === 'concurrent-edit' || failure === 'ambiguous-write') throw new Error('edit write failed'); });
      if (failure === 'rollback' || failure === 'ambiguous-write') f.plans.push(async () => { throw new Error('rollback failed'); });
      const moving = f.pads.reassign('palette:source', 'palette:destination').then(() => undefined, error => error);
      await tick(); f.change(newer); await ack();
      assert.ok(f.pads.references('palette:source').length); assert.ok(f.pads.references('palette:destination').length);
      assert.equal(f.pads.context(f.document)!.target, 'palette:source', 'owner changes only after write success');
      gate.resolve(); const error = await moving;
      assert.equal(f.accepted(), newer);
      if (failure === 'rollback' || failure === 'ambiguous-write') {
        assert.match(String(error), /recovery is pending/);
        assert.ok(f.pads.references('palette:destination').length); assert.ok(f.pads.references('palette:source').length);
        assert.match(f.pads.error, /ownership recovery/);
        await assert.rejects(f.pads.reassign('palette:source','palette:another'), /Retry Scratchpad Save/);
        const config = initialAppearance();
        config.palettes = ['source','destination'].map(id => ({id, name: id, roles: {}, blendBackground: {dark:'#000000',light:'#ffffff'}}));
        const protectedController = controller(f.pads, config).value;
        for (const id of ['source','destination']) {
          protectedController.editTarget = 'palette:' + id;
          await assert.rejects(protectedController.receive({type:'delete'}), /Retained scratchpads/);
        }
        const restarted = new AppearanceScratchpads(f.storage);
        assert.ok(restarted.targets().includes(f.durable()[0]!.target), 'restart retains the durable owner'); restarted.dispose();
        f.plans.push(async () => { throw new Error('explicit retry failed'); });
        await assert.rejects(f.pads.recover(), /explicit retry failed/);
        assert.ok(f.pads.references('palette:source').length); assert.ok(f.pads.references('palette:destination').length);
        assert.equal(f.accepted(),newer);
        await f.pads.recover();
      } else if (failure === 'move') assert.match(String(error), /move failed/);
      else assert.equal(error, undefined);
      const target = ['none', 'concurrent-edit'].includes(failure) ? 'palette:destination' : 'palette:source';
      assert.equal(f.durable()[0]!.text, newer); assert.equal(f.durable()[0]!.target, target);
      assert.deepEqual(f.pads.references(target === 'palette:source' ? 'palette:destination' : 'palette:source'), []);
      assert.equal(f.pads.error, '');
      const config = initialAppearance();
      config.palettes = ['source','destination'].map(id => ({id, name:id, roles:{}, blendBackground:{dark:'#000000',light:'#ffffff'}}));
      const deletion = controller(f.pads, config);
      deletion.value.editTarget = target === 'palette:source' ? 'palette:destination' : 'palette:source';
      await deletion.value.receive({type:'delete'}); await deletion.value.receive({type:'save'});
      assert.ok(deletion.persisted().palettes.some(palette => 'palette:' + palette.id === target));
      f.pads.dispose();
    });
  }
  await check('newer edits during delayed rollback are durable before guards release', async () => {
    const f = fixture(), rollback = deferred(), started = deferred();
    f.plans.push(async () => { throw new Error('move failed'); });
    f.plans.push(async () => { started.resolve(); await rollback.promise; });
    const moving = f.pads.reassign('palette:source', 'palette:destination').then(() => undefined, error => error);
    await started.promise;
    await assert.rejects(f.pads.open('Document', 'palette:destination', 'light', 'Destination'), /ownership recovery/);
    f.change(newer); await ack();
    assert.ok(f.pads.references('palette:destination').length);
    rollback.resolve(); assert.match(String(await moving), /move failed/);
    assert.equal(f.durable()[0]!.text, newer); assert.equal(f.durable()[0]!.target, 'palette:source');
    assert.deepEqual(f.pads.references('palette:destination'), []); f.pads.dispose();
  });
  function controller(pads: Pads, saved = initialAppearance()) {
    let persisted = structuredClone(saved);
    const result: any = Object.assign(Object.create(HsonAppearanceEditor.prototype), {
      scratchpads: pads, saved: structuredClone(saved), draft: structuredClone(saved), editTarget: 'palette:house',
      role: 'value.string', activeExample: 'Document', mode: 'dark', destination: 'user',
      undoStack: [], redoStack: [], revision: 0, draftRevision: 0, rejectedInputs: [], inputRevision: 0,
      inputSequence: 0, confirmRevert: async () => true, renderer: {refresh: async () => {}, setAppearance: async () => {}},
      configuration: () => ({inspect: () => ({globalValue: persisted}), update: async (_key: string, value: typeof saved) => { persisted = structuredClone(value); }}),
    });
    return {value: result, external(value: typeof saved) { persisted = structuredClone(value); result.configurationChanged(); }, persisted: () => persisted};
  }
  await check('unsaved creation, Revert, Undo/Redo, Delete and external replacement preserve reachability', async () => {
    const f = fixture([]), c = controller(f.pads).value;
    await c.receive({type: 'new', name: 'Unsaved'});
    await assert.rejects(c.receive({type: 'open-scratchpad'}), /Save this palette/);
    assert.equal(f.attempts.length, 0); await c.receive({type: 'save'});
    assert.doesNotThrow(() => c.requireDurablePalette('Document'));
    const config = initialAppearance(); config.palettes.push({id: 'source', name: 'Source', blendBackground: {dark: '#000000', light: '#ffffff'}, roles: {}});
    const retained = fixture(), host = controller(retained.pads, config), live = host.value;
    live.editTarget = 'palette:source';
    await assert.rejects(live.receive({type: 'delete'}), /Retained scratchpads/);
    for (const type of ['undo', 'redo']) {
      const stack = live[type + 'Stack']; stack.push({state: initialAppearance(), target: 'palette:house', revision: 0});
      await assert.rejects(live.receive({type}), /Retained scratchpads/); assert.equal(stack.length, 1); stack.pop();
    }
    host.external(initialAppearance());
    assert.equal(live.draft.palettes[0].id, 'source'); assert.equal(live.conflict, true);
    await assert.rejects(live.receive({type: 'revert'}), /Retained scratchpads/);
    const startup = controller(retained.pads);
    const available = initialAppearance(); available.palettes.push({id:'other',name:'Other',roles:{'value.string':{dark:{foreground:'#123456'}}},blendBackground:{dark:'#000000',light:'#ffffff'}});
    startup.external(available);
    assert.deepEqual(startup.value.draft,available,'missing retained IDs cannot suppress other saved palettes at startup');
    const fresh = controller(retained.pads, initialAppearance()).value;
    assert.equal(fresh.validTarget('palette:source'), true, 'retained identity selectable after restart');
    await retained.pads.reassign('palette:source', 'palette:house');
    await live.receive({type: 'revert'}); assert.deepEqual(live.draft.palettes, []);
    live.editTarget = 'palette:house'; await live.receive({type: 'restore'}); // built-in identity remains valid
    retained.pads.dispose(); f.pads.dispose();
  });
  assert.ok(errors.length, 'failures are reported visibly');
  console.log(`ok - ${checks} deterministic scratchpad durability and palette ownership checks passed`);
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
