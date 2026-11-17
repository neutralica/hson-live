import assert from 'node:assert/strict';
import { HsonAppearanceEditor } from '../src/appearance-editor.js';
import { initialAppearance, type AppearanceState } from '../src/appearance-model.js';
import * as vscode from 'vscode';

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type View = { error: string; dirty: boolean; canUndo: boolean; canRedo: boolean; mode: string;
  rejectedInputs: { kind: string; role: string; property: string; text: string }[] };
function harness() {
  let persisted: unknown = initialAppearance(), write: ReturnType<typeof deferred> | undefined;
  let confirmation: ReturnType<typeof deferred> | undefined;
  let echo = false, externalAfterWrite: AppearanceState | undefined;
  let view: View;
  let confirmations = 0;
  const writes: { state: AppearanceState; destination: vscode.ConfigurationTarget }[] = [];
  const controller: {
    receive(message: Record<string, unknown>): Promise<void>;
    present(): Promise<void>;
    configurationChanged(): void;
    saved: AppearanceState; draft: AppearanceState;
  } = Object.assign(Object.create(HsonAppearanceEditor.prototype), {
    scratchpads: {targets:()=>[],error:''},
    saved: initialAppearance(), draft: initialAppearance(), editTarget: 'override:all',
    role: 'value.attributeString', mode: 'dark', destination: 'user', comparison: 'draft',
    undoStack: [], redoStack: [], revision: 0, draftRevision: 0, inputRevision: 0,
    inputSequence: 0, rejectedInputs: [], error: '', configurationError: '',
    renderer: {setAppearance: async () => undefined},
    panel: {webview: {postMessage: async (message: View) => {view = message;}}},
    confirmRevert: async () => { confirmations++; await confirmation?.promise; return true; },
    configuration: () => ({inspect: () => ({globalValue: persisted}),
      update: async (_key: string, state: AppearanceState, destination: vscode.ConfigurationTarget) => {
        writes.push({state: structuredClone(state), destination});
        await write?.promise;
        persisted = state;
        if (echo) controller.configurationChanged();
        if (externalAfterWrite) persisted = externalAfterWrite;
      }}),
  });
  const send = async (type: string, value?: unknown, extra: Record<string, unknown> = {}) => {
    try { await controller.receive({type, value, role: 'value.attributeString', ...extra}); }
    catch (error) {
      // Same error presentation as the real webview message boundary.
      Object.assign(controller, {error: String(error)}); await controller.present(); throw error;
    }
  };
  return {controller, send, writes,
    edit: (value: string, extra: Record<string, unknown> = {}) => send('property', value, {property: 'foreground', ...extra}),
    async external(state: unknown) {persisted = state; controller.configurationChanged(); await controller.present();},
    delay: () => write = deferred(),
    delayRevert: () => confirmation = deferred(),
    echo: () => {echo = true;},
    afterWrite: (state: AppearanceState) => {externalAfterWrite = state;},
    get view() {return view;}, get persisted() {return persisted;}, get confirmations() {return confirmations;},
  };
}
const color = (state: AppearanceState) => state.overrides.all?.['value.attributeString']?.dark?.foreground;
const externalState = () => ({...initialAppearance(), assignments: {all: 'house'}});

export async function checkAppearanceTransitions(): Promise<void> {
  const cases: [string, () => Promise<void>][] = [];
  const test = (name: string, run: () => Promise<void>) => cases.push([name, run]);
  test('cycle blocks Save, preserves accepted Draft and creates no Undo entry', async () => {
    const h = harness();
    await h.send('inherit', 'value.attributeString', {role: 'comment.line'});
    const accepted = structuredClone(h.controller.draft);
    await assert.rejects(h.send('inherit', 'comment.line', {role: 'value.attributeString'}), /cycle/);
    assert.deepEqual(h.controller.draft, accepted);
    assert.match(h.view.error, /cycle/);
    assert.equal(h.view.rejectedInputs[0]?.text, 'comment.line');
    await assert.rejects(h.send('save'), /invalid input/);
    assert.equal(h.writes.length, 0);
    await h.send('compare', 'saved'); assert.match(h.view.error, /cycle/);
    await h.send('undo'); assert.deepEqual(h.controller.draft, initialAppearance());
    assert.equal(h.view.canUndo, false); assert.equal(h.view.error, '');
    await h.send('redo'); assert.deepEqual(h.controller.draft, accepted);
    await h.send('save'); assert.deepEqual(h.persisted, accepted);
  });
  for (const resolution of ['correct', 'reset', 'undo'] as const) test('hex + cycle + ' + resolution, async () => {
    const h = harness();
    await h.send('inherit', 'value.attributeString', {role: 'comment.line'});
    await assert.rejects(h.edit('#broken'), /Invalid/);
    await assert.rejects(h.send('inherit', 'comment.line', {role: 'value.attributeString'}), /cycle/);
    assert.equal(h.view.rejectedInputs.length, 2);
    assert.match(h.view.error, /Invalid/); assert.match(h.view.error, /cycle/);
    await assert.rejects(h.send('save'), /invalid input/);
    if (resolution === 'correct') {
      await h.send('inherit', '', {role: 'value.attributeString'});
      assert.equal(h.view.rejectedInputs.length, 1); assert.equal(h.view.rejectedInputs[0]?.text, '#broken');
      await assert.rejects(h.send('save'), /invalid input/); await h.edit('#123456');
    } else await h.send(resolution);
    assert.equal(h.view.rejectedInputs.length, 0);
    await h.send('save'); assert.deepEqual(h.controller.saved, h.controller.draft);
  });
  test('Reset and source correction preserve an unrelated advanced field error', async () => {
    const h = harness();
    await h.send('inherit', 'value.attributeString', {role: 'comment.line'});
    await assert.rejects(h.send('property', 'bad', {property: 'intensity'}), /Invalid/);
    await assert.rejects(h.send('inherit', 'comment.line', {role: 'value.attributeString'}), /cycle/);
    await h.send('reset', undefined, {property: 'foreground'});
    assert.deepEqual(h.view.rejectedInputs.map(input => input.property), ['intensity']);
    await assert.rejects(h.send('save'), /invalid input/);
    await h.send('reset', undefined, {property: 'intensity'});
    await h.send('save'); assert.equal(h.writes.length, 1);
  });
  test('explicit inherited-color replacement corrects hex without clearing intensity', async () => {
    const h = harness(); await h.edit('#123456');
    await assert.rejects(h.edit('#broken'), /Invalid/);
    await assert.rejects(h.send('property', 'bad', {property: 'intensity'}), /Invalid/);
    await h.send('inherit', '#abcdef', {materialize: true});
    assert.equal(color(h.controller.draft), '#abcdef');
    assert.deepEqual(h.view.rejectedInputs.map(input => input.property), ['intensity']);
    await assert.rejects(h.send('save'), /invalid input/);
  });
  test('explicit discard preserves accepted work and enables retry after failed Save', async () => {
    const h = harness(); await h.edit('#123456');
    await assert.rejects(h.edit('#broken'), /Invalid/); await h.send('discard-input');
    assert.equal(color(h.controller.draft), '#123456'); assert.equal(h.view.error, '');
    assert.equal(h.view.canUndo, true);
    const write = h.delay(), pending = h.send('save');
    write.reject(new Error('write failed')); await assert.rejects(pending, /write failed/);
    await h.send('discard-input'); const retry = h.delay(), saving = h.send('save'); retry.resolve(); await saving;
    assert.equal(color(h.controller.saved), '#123456'); assert.equal(h.view.canUndo, false);
  });
  test('role navigation keeps independent errors reachable for correction', async () => {
    const h = harness(); await h.edit('#123456');
    await assert.rejects(h.send('property', 'bad', {property: 'intensity', role: 'comment.line'}), /Invalid/);
    await assert.rejects(h.edit('#broken'), /Invalid/);
    await h.send('role', 'comment.line'); assert.equal(h.view.rejectedInputs.length, 2);
    await h.send('property', .5, {property: 'intensity', role: 'comment.line'});
    assert.deepEqual(h.view.rejectedInputs.map(input=>input.role), ['value.attributeString']);
    await h.send('role', 'value.attributeString'); await h.edit('#123456');
    assert.equal(h.view.error, ''); await h.send('save'); assert.equal(color(h.controller.saved), '#123456');
  });
  const ordering = async (before: boolean) => {
    const h = harness(); await h.edit('#bbbbbb'); await h.edit('#cccccc'); await h.send('undo');
    const write = h.delay(), pending = h.send('save');
    if (before) await h.send('redo'); write.resolve(); await pending;
    if (!before) await h.send('redo');
    assert.equal(color(h.controller.saved), '#bbbbbb'); assert.equal(color(h.controller.draft), '#cccccc');
    await h.send('undo'); assert.equal(color(h.controller.draft), '#bbbbbb');
    assert.equal(h.view.canUndo, false); await h.send('undo');
    assert.equal(color(h.controller.draft), '#bbbbbb');
    await h.send('redo'); assert.equal(color(h.controller.draft), '#cccccc');
    return {draft: h.controller.draft, saved: h.controller.saved, persisted: h.persisted, view: h.view};
  };
  test('Redo before/after successful Save produces equivalent observable history', async () => {
    assert.deepEqual(await ordering(true), await ordering(false));
  });
  test('Edit -> Undo -> Redo -> Save', async () => {
    const h = harness(); await h.edit('#bbbbbb'); await h.send('undo'); await h.send('redo'); await h.send('save');
    assert.equal(color(h.controller.saved), '#bbbbbb'); assert.equal(h.view.canUndo, false); assert.equal(h.view.canRedo, false);
  });
  for (const timing of ['before', 'during', 'after', 'final-read'] as const) test('external configuration protects Redo: ' + timing, async () => {
    const h = harness(); await h.edit('#bbbbbb'); await h.edit('#cccccc'); await h.send('undo');
    if (timing === 'before') {
      await h.external(externalState()); await assert.rejects(h.send('save'), /changed elsewhere/);
    } else {
      const write = h.delay(), pending = h.send('save');
      if (timing === 'during') await h.external(externalState());
      if (timing === 'final-read') h.afterWrite(externalState());
      write.resolve(); await pending;
      if (timing === 'after') await h.external(externalState());
      await assert.rejects(h.send('save'), /changed elsewhere/);
    }
    assert.equal(color(h.controller.draft), '#bbbbbb'); assert.equal(h.view.canRedo, true);
    await h.send('redo'); assert.equal(color(h.controller.draft), '#cccccc');
    await h.send('undo'); assert.equal(color(h.controller.draft), '#bbbbbb');
    await h.send('revert'); assert.deepEqual(h.controller.draft, h.controller.saved);
    assert.equal(h.view.canUndo, false); assert.equal(h.view.canRedo, false);
  });
  test('clean cursor with Redo conflicts and requires confirmed Revert', async () => {
    const h = harness(); await h.edit('#bbbbbb'); await h.send('undo');
    assert.equal(h.view.dirty, false); await h.external(externalState());
    assert.deepEqual(h.controller.draft, initialAppearance()); assert.match(h.view.error, /changed elsewhere/);
    await h.send('revert'); assert.equal(h.confirmations, 1); assert.deepEqual(h.controller.draft, externalState());
    await h.send('redo'); assert.deepEqual(h.controller.draft, externalState());
  });
  test('Revert confirms history even when Draft equals Saved and no conflict exists', async () => {
    const h = harness(); await h.edit('#bbbbbb'); await h.send('undo'); await h.send('revert');
    assert.equal(h.confirmations, 1); assert.equal(h.view.canRedo, false);
  });
  for (const invalid of [false, true]) test('Revert confirmation cannot accept a changed configuration: invalid=' + invalid, async () => {
    const h = harness(); await h.edit('#bbbbbb'); const confirmation = h.delayRevert(), reverting = h.send('revert');
    await h.external(invalid ? {assignments: {all: 'missing'}} : externalState());
    confirmation.resolve(); await assert.rejects(reverting, /Appearance changed while confirming/);
    assert.equal(color(h.controller.draft), '#bbbbbb'); assert.equal(h.view.canUndo, true);
  });
  test('clean external configuration adopts; active empty gesture protects local context', async () => {
    const h = harness(); await h.external(externalState()); assert.deepEqual(h.controller.draft, externalState());
    await h.send('begin-edit', undefined, {editGroup: 'gesture', inputRevision: 1, target: 'override:all', role: 'value.attributeString', mode: 'dark'});
    await h.external(initialAppearance()); assert.deepEqual(h.controller.draft, externalState()); assert.match(h.view.error, /changed elsewhere/);
  });
  test('own Save echoes before and after completion preserve later edits without conflict', async () => {
    const h = harness(); h.echo(); await h.edit('#bbbbbb');
    const write = h.delay(), pending = h.send('save'); await h.edit('#cccccc'); write.resolve(); await pending;
    await h.external(h.controller.saved); assert.equal(h.view.error, ''); assert.equal(color(h.controller.draft), '#cccccc');
    await h.send('undo'); assert.equal(color(h.controller.draft), '#bbbbbb'); assert.equal(h.view.canUndo, false);
  });
  test('Save captures destination; later edit and external configuration are retained', async () => {
    const h = harness(); await h.edit('#bbbbbb'); const write = h.delay(), pending = h.send('save');
    await h.send('destination', 'workspace'); await h.edit('#cccccc'); await h.external(externalState());
    assert.equal(h.writes[0]?.destination, vscode.ConfigurationTarget.Global);
    assert.equal(color(h.writes[0]!.state), '#bbbbbb'); write.resolve(); await pending;
    assert.equal(color(h.controller.draft), '#cccccc'); assert.equal(color(h.controller.saved), '#bbbbbb');
    assert.match(h.view.error, /changed elsewhere/); await h.send('undo'); assert.equal(color(h.controller.draft), '#bbbbbb');
  });
  for (const before of [false, true]) test('failed Save + Redo ordering retains complete history: ' + before, async () => {
    const h = harness(); await h.edit('#bbbbbb'); await h.edit('#cccccc'); await h.send('undo');
    const write = h.delay(), pending = h.send('save');
    if (before) await h.send('redo'); write.reject(new Error('write failed')); await assert.rejects(pending, /write failed/);
    if (!before) await h.send('redo'); await h.edit('#dddddd');
    for (const expected of ['#cccccc', '#bbbbbb', undefined]) {await h.send('undo'); assert.equal(color(h.controller.draft), expected);}
    assert.deepEqual(h.controller.saved, initialAppearance()); assert.deepEqual(h.persisted, initialAppearance());
  });
  for (const before of [false, true]) test('Undo cannot cross the captured Save boundary: completion first=' + before, async () => {
    const h = harness(); await h.edit('#bbbbbb'); const write = h.delay(), pending = h.send('save');
    if (before) {write.resolve(); await pending;}
    await h.send('undo'); assert.equal(color(h.controller.draft), '#bbbbbb'); assert.equal(h.view.canUndo, false);
    await h.edit('#dddddd'); await h.send('undo'); assert.equal(color(h.controller.draft), '#bbbbbb');
    if (!before) {write.resolve(); await pending;}
    await h.send('redo'); assert.equal(color(h.controller.draft), '#dddddd');
    await h.send('undo'); assert.equal(color(h.controller.draft), '#bbbbbb'); assert.equal(h.view.canUndo, false);
  });
  test('failed Save restores the detached Undo prefix after newer edits and navigation', async () => {
    const h = harness(); await h.edit('#aaaaaa'); await h.edit('#bbbbbb');
    const write = h.delay(), pending = h.send('save');
    await h.edit('#cccccc'); await h.send('undo'); await h.send('redo');
    write.reject(new Error('write failed')); await assert.rejects(pending, /write failed/);
    assert.equal(color(h.controller.draft), '#cccccc');
    for (const expected of ['#bbbbbb', '#aaaaaa', undefined]) {await h.send('undo'); assert.equal(color(h.controller.draft), expected);}
    assert.equal(h.view.canUndo, false);
  });
  test('pending Save does not clear new rejection, and grouping stops at captured snapshot', async () => {
    const h = harness(); await h.edit('#bbbbbb', {editGroup: 'g'});
    const write = h.delay(), pending = h.send('save');
    await h.edit('#cccccc', {editGroup: 'g'}); await assert.rejects(h.edit('#bad-input', {editGroup: 'g'}), /Invalid/);
    write.resolve(); await pending; assert.match(h.view.error, /Invalid/);
    await assert.rejects(h.send('save'), /invalid input/); await h.send('undo');
    assert.equal(color(h.controller.draft), '#bbbbbb'); assert.equal(h.view.canUndo, false);
  });
  test('gesture owns its full target and stale post-navigation input is ignored', async () => {
    const h = harness();
    await h.send('begin-edit', undefined, {editGroup: 'picker', inputRevision: 0, target: 'override:all', role: 'comment.line', mode: 'dark', property: 'foreground'});
    await h.edit('#abcdef', {editGroup: 'picker', inputRevision: 0, role: 'value.attributeString', mode: 'light'});
    assert.equal(h.controller.draft.overrides.all?.['comment.line']?.dark?.foreground, '#abcdef');
    assert.equal(color(h.controller.draft), undefined);
    await h.send('end-edit', undefined, {editGroup: 'picker'});
    await h.edit('#000000', {editGroup: 'picker', inputRevision: 0, role: 'comment.line', mode: 'dark'});
    assert.equal(h.controller.draft.overrides.all?.['comment.line']?.dark?.foreground, '#abcdef');
    await h.send('mode', 'light');
    await h.edit('#123456', {editGroup: 'picker', inputRevision: 0, role: 'comment.line', mode: 'dark'});
    assert.equal(h.controller.draft.overrides.all?.['comment.line']?.dark?.foreground, '#abcdef');
    await h.send('begin-edit', undefined, {editGroup: 'new', inputRevision: 1, target: 'override:all', role: 'comment.line', mode: 'light'});
    await h.edit('#654321', {editGroup: 'new', inputRevision: 1});
    assert.equal(h.controller.draft.overrides.all?.['comment.line']?.light?.foreground, '#654321');
  });
  const failures: string[] = [];
  for (const [name, run] of cases) {
    try {await run(); console.log('ok - transition: ' + name);}
    catch (error) {failures.push(name + ': ' + String(error));}
  }
  assert.deepEqual(failures, [], 'Appearance transition matrix failures');
  console.log(`ok - ${cases.length} deterministic Appearance transition cases`);
}
