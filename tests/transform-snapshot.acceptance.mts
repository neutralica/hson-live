// @hson-live-external-test
import assert from 'node:assert/strict';
import { hsonTransform } from '../src/api/transform/transform.facade.ts';
import { SAFE_TRANSFORM_SOURCE, UNSAFE_TRANSFORM_SOURCE } from '../src/api/transform/transform.browser.ts';
import { hson } from '../src/hson.ts';
import { Hson } from '../src/hson-authoring.ts';
import { hsonLiveTree } from '../src/api/livetree/livetree.facade.ts';
import { canonical_hson_graph_equal } from '../src/core/canonical-hson-equal.ts';
import { read_transform_error_details } from '../src/core/errors.ts';
import type { HsonNode } from '../src/core/types.ts';
import type { TransformOutput } from '../src/api/transform/transform.types.ts';
import { create_test_event_emitter } from './test-events.mjs';

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.snapshot",
  title: "All-source Transform snapshot and terminal consistency",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["snapshot", "node", "binary", "worker", "public-api", "externally-discoverable"]),
});
const events = create_test_event_emitter('transform.snapshot');
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  events.case_begin(name, name);
  try { await run(); events.case_end(name, 'pass'); checks++; console.log('ok ' + checks + ' - ' + name); }
  catch (error) { events.case_end(name, 'fail'); events.terminal('fail'); throw error; }
}
const str = (value: string): HsonNode => ({ $_tag: '_hson_str', $_content: [value] });
const val = (value: number): HsonNode => ({ $_tag: '_hson_val', $_content: [value] });
const branch = (): HsonNode => ({ $_tag: 'p', $_content: [{ $_tag: '_hson_elem', $_content: [str('red')] }], $_attrs: { id: 'x' } });
const complete = (): HsonNode => ({ $_tag: '_hson_elem', $_content: [branch()] });
const publicNodes = [hsonTransform, SAFE_TRANSFORM_SOURCE, UNSAFE_TRANSFORM_SOURCE, hson];

await check('all generic node implementations reject eagerly and agree', () => {
  for (const input of [{ ...str('x'), toJSON() { throw new Error('hook'); } },
    { $_tag: '_hson_elem', $_content: [str('x')] }, { $_tag: '_hson_obj', $_content: [val(1)] }, branch(),
    { $_tag: '_hson_root', $_content: [] }, { ...str('x'), $_meta: {} }]) {
    const details = publicNodes.map(source => {
      let observed: unknown;
      try { source.fromNode(input); } catch (error) { observed = error; }
      const result = read_transform_error_details(observed);
      assert.equal(result?.stage, 'source-admission'); assert.equal(result?.operation, 'fromNode');
      return result;
    });
    for (const detail of details) assert.deepEqual(detail, details[0]);
  }
});
await check('each node alias owns input and returns independent copies', () => {
  for (const factory of publicNodes) {
    const input = complete(); const source = factory.fromNode(input); const expected = source.toNode();
    const first = source.toNode(); first.$_content.length = 0; input.$_content.length = 0;
    assert.equal(canonical_hson_graph_equal(source.toNode(), expected), true);
    assert.notEqual(source.toNode(), source.toNode());
    assert.equal(Object.isFrozen(input), false);
  }
});
await check('source routes retain shapes but never expose mutable source state', () => {
  const jsonInput = { value: 'red' };
  const routes: Array<readonly [string, () => TransformOutput]> = [
    ['Hson', () => hsonTransform.fromHson('<p id="x" "red"/>')],
    ['JSON', () => hsonTransform.fromJson(jsonInput)],
    ['trusted HTML', () => hsonTransform.fromTrustedHtml('<p id="x">red</p>')],
    ['untrusted HTML', () => hsonTransform.fromUntrustedHtml('<p id="x">red</p>')],
    ['Binary', () => hsonTransform.fromBinary(hsonTransform.fromNode(complete()).toBinary().serialize())],
    ['browser Hson', () => SAFE_TRANSFORM_SOURCE.fromHson('<p id="x" "red"/>')],
    ['browser JSON', () => UNSAFE_TRANSFORM_SOURCE.fromJson({ value: 'red' })],
  ];
  for (const [name, create] of routes) {
    const source = create(); const expected = source.toNode(); const html = source.toHtml().serialize(); const json = source.toJson().serialize();
    const first = source.toNode(); first.$_content.length = 0;
    assert.equal(canonical_hson_graph_equal(source.toNode(), expected), true, name);
    assert.equal(source.toHtml().serialize(), html, name); assert.equal(source.toJson().serialize(), json, name);
    if (name.includes('JSON') || name.includes('HTML')) assert.equal(expected.$_tag, '_hson_root');
  }
  assert.deepEqual(jsonInput, { value: 'red' });
});
await check('all terminal selections, options and hashes observe one version', async () => {
  for (const reverse of [false, true]) {
    const input = val(1); const source = hsonTransform.fromNode(input);
    const html = reverse ? source.toHtml() : undefined;
    const binary = source.toBinary(); const json = source.toJson(); const hsonOutput = source.toHson().noBreak();
    const selectedHtml = html ?? source.toHtml();
    const expectedHtml = selectedHtml.serialize(); const expectedBytes = binary.serialize();
    const [hsonHash, jsonHash, htmlHash, binaryHash] = await Promise.all([hsonOutput.sha256(), json.sha256(), selectedHtml.sha256(), binary.sha256()]);
    input.$_content[0] = 2; source.toNode().$_content[0] = 3;
    assert.equal(source.toNode().$_content[0], 1); assert.equal(hsonOutput.serialize(), '1');
    assert.equal(json.value(), 1); assert.equal(json.serialize(), '1');
    assert.equal(selectedHtml.serialize(), expectedHtml); assert.deepEqual(binary.serialize(), expectedBytes);
    assert.equal(source.toHson().withOptions({ noBreak: false }).serialize(), '1');
    assert.deepEqual(await Promise.all([hsonOutput.sha256(), json.sha256(), selectedHtml.sha256(), binary.sha256()]), [hsonHash, jsonHash, htmlHash, binaryHash]);
    const bytes = binary.serialize(); bytes.fill(0); assert.deepEqual(binary.serialize(), expectedBytes);
  }
});
await check('nested copies, style presence and JSON value copies are isolated', () => {
  const input = complete(); input.$_content[0] = { ...branch(), $_attrs: { style: { width: { value: -0, unit: undefined } } } };
  const source = hsonTransform.fromNode(input); const expected = source.toNode();
  const copy = source.toNode(); (copy.$_content[0] as HsonNode).$_attrs = { id: 'changed' };
  (input.$_content[0] as HsonNode).$_attrs = { id: 'caller' };
  assert.equal(canonical_hson_graph_equal(source.toNode(), expected), true);
  const data = hsonTransform.fromJson({ a: [1] }).toJson();
  const observed = data.value() as { a: number[] }; observed.a.push(2);
  assert.deepEqual(data.value(), { a: [1] });
});
await check('snapshot-backed JSON and HTML retain signed zero without structuredClone', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
  Reflect.deleteProperty(globalThis, 'structuredClone');
  try {
    for (const source of [hsonTransform.fromNode(val(-0)), hsonTransform.fromJson(-0), hsonTransform.fromHson('-0')]) {
      assert.equal(source.toHson().serialize(), '-0'); assert.equal(source.toJson().serialize(), '-0');
      assert.equal(Object.is(source.toJson().value(), -0), true); assert.match(source.toHtml().serialize(), /-0/);
      assert.equal(Object.is(hsonTransform.fromBinary(source.toBinary().serialize()).toNode().$_content[0], -0), true);
    }
  } finally { if (descriptor) Object.defineProperty(globalThis, 'structuredClone', descriptor); }
});
await check('inherited metadata getter after admission cannot corrupt any terminal', async () => {
  for (const reverse of [false, true]) {
    const raw: HsonNode = Object.assign(Object.create(null), val(-0));
    const source = hsonTransform.fromNode(raw);
    const html = reverse ? source.toHtml() : undefined;
    const json = source.toJson(); const hsonOutput = source.toHson().noBreak();
    const selectedHtml = html ?? source.toHtml(); const binary = source.toBinary();
    const expectedHtml = selectedHtml.serialize(); const expectedBytes = binary.serialize();
    const hashes = await Promise.all([hsonOutput.sha256(), json.sha256(), selectedHtml.sha256(), binary.sha256()]);
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, '$_meta');
    let calls = 0;
    Object.defineProperty(Object.prototype, '$_meta', {
      configurable: true,
      get() {
        calls++;
        if (this.$_tag === '_hson_val' && !Object.isFrozen(this)) this.$_content[0] = 42;
        return undefined;
      },
    });
    try {
      const first = source.toNode(); const second = source.toNode();
      assert.equal(Object.getPrototypeOf(first), null); assert.equal(Object.isFrozen(first), false);
      assert.notEqual(first, second); assert.notEqual(first, raw);
      assert.equal(Object.is(first.$_content[0], -0), true);
      first.$_content[0] = 7; raw.$_content[0] = 8;
      assert.equal(Object.is(second.$_content[0], -0), true);
      assert.equal(Object.is(source.toNode().$_content[0], -0), true);
      assert.equal(Object.is(json.value(), -0), true); assert.equal(json.serialize(), '-0');
      assert.equal(hsonOutput.serialize(), '-0'); assert.equal(source.toHson().serialize(), '-0');
      assert.equal(selectedHtml.serialize(), expectedHtml); assert.equal(source.toHtml().serialize(), expectedHtml);
      assert.equal(source.toJson().serialize(), '-0'); assert.deepEqual(source.toBinary().serialize(), expectedBytes);
      assert.deepEqual(await Promise.all([hsonOutput.sha256(), json.sha256(), selectedHtml.sha256(), binary.sha256()]), hashes);
      assert.equal(calls, 0);
    } finally {
      if (descriptor) Object.defineProperty(Object.prototype, '$_meta', descriptor);
      else Reflect.deleteProperty(Object.prototype, '$_meta');
    }
  }
});
await check('inherited storage before admission is rejected or excluded without getter reads', () => {
  const plain = val(-0);
  const nullRecord: HsonNode = Object.assign(Object.create(null), val(-0));
  // Both supported input prototypes produce safe copies in the normal case.
  for (const raw of [plain, nullRecord]) {
    const copy = hsonTransform.fromNode(raw).toNode();
    assert.equal(Object.getPrototypeOf(copy), null); assert.equal(Object.is(copy.$_content[0], -0), true);
  }
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, '$_meta');
  let calls = 0;
  Object.defineProperty(Object.prototype, '$_meta', { configurable: true, get() { calls++; return { quid: 'inherited' }; } });
  try {
    assert.throws(() => hsonTransform.fromNode(plain), error => {
      const details = read_transform_error_details(error);
      assert.equal(details?.code, 'HSON_CANONICAL_INVARIANT_VIOLATION');
      assert.equal(details?.path, '$["$_meta"]'); return true;
    });
    const source = hsonTransform.fromNode(nullRecord); const copy = source.toNode();
    assert.equal(copy.$_meta, undefined); assert.equal(Object.is(copy.$_content[0], -0), true);
    assert.equal(source.toJson().serialize(), '-0'); assert.equal(calls, 0);
  } finally {
    if (descriptor) Object.defineProperty(Object.prototype, '$_meta', descriptor);
    else Reflect.deleteProperty(Object.prototype, '$_meta');
  }
});
await check('nested mutable semantic records exclude inherited metadata and attributes', () => {
  const input = complete();
  const element = input.$_content[0] as HsonNode;
  element.$_attrs = { id: 'x', style: { width: { value: -0, unit: 'px' }, color: 'red' } };
  const source = hsonTransform.fromNode(input);
  const undefinedUnitInput = complete();
  (undefinedUnitInput.$_content[0] as HsonNode).$_attrs = { style: { width: { value: -0, unit: undefined } } };
  const undefinedUnitSource = hsonTransform.fromNode(undefinedUnitInput);
  const expected = source.toNode(); const expectedHtml = source.toHtml().serialize();
  const expectedJson = source.toJson().serialize(); const expectedHson = source.toHson().serialize();
  const expectedBytes = source.toBinary().serialize();
  const descriptors = ['$_meta', '$_attrs'].map(key => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)] as const);
  Object.defineProperty(Object.prototype, '$_meta', { configurable: true, value: { quid: 'inherited' } });
  Object.defineProperty(Object.prototype, '$_attrs', { configurable: true, writable: true, value: { id: 'inherited' } });
  try {
    const first = source.toNode(); const second = source.toNode();
    const copiedElement = first.$_content[0] as HsonNode;
    const attrs = copiedElement.$_attrs!;
    assert.ok(attrs.style);
    assert.equal(Object.getPrototypeOf(first), null); assert.equal(Object.getPrototypeOf(copiedElement), null);
    assert.equal(Object.getPrototypeOf(attrs), null); assert.equal(Object.getPrototypeOf(attrs.style), null);
    const width: unknown = Reflect.getOwnPropertyDescriptor(attrs.style, 'width')!.value;
    assert.ok(typeof width === 'object' && width !== null);
    assert.equal(Object.getPrototypeOf(width), null); assert.equal(Object.hasOwn(width, 'unit'), true);
    assert.equal(Reflect.getOwnPropertyDescriptor(width, 'unit')?.value, 'px');
    assert.equal(Object.is(Reflect.getOwnPropertyDescriptor(width, 'value')?.value, -0), true);
    const undefinedAttrs = (undefinedUnitSource.toNode().$_content[0] as HsonNode).$_attrs!;
    assert.ok(undefinedAttrs.style);
    const undefinedWidth: unknown = Reflect.getOwnPropertyDescriptor(undefinedAttrs.style, 'width')!.value;
    assert.ok(typeof undefinedWidth === 'object' && undefinedWidth !== null);
    assert.equal(Object.getPrototypeOf(undefinedWidth), null);
    assert.equal(Object.hasOwn(undefinedWidth, 'unit'), true);
    assert.equal(Reflect.getOwnPropertyDescriptor(undefinedWidth, 'unit')?.value, undefined);
    assert.equal(first.$_meta, undefined); assert.equal(first.$_attrs, undefined); assert.equal(copiedElement.$_meta, undefined);
    assert.equal(canonical_hson_graph_equal(first, expected), true);
    Reflect.set(width, 'value', 42); attrs.id = 'changed'; first.$_content.length = 0;
    assert.equal(canonical_hson_graph_equal(second, expected), true);
    assert.equal(source.toJson().serialize(), expectedJson); assert.equal(source.toHson().serialize(), expectedHson);
    assert.equal(source.toHtml().serialize(), expectedHtml); assert.deepEqual(source.toBinary().serialize(), expectedBytes);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(Object.prototype, key, descriptor);
      else Reflect.deleteProperty(Object.prototype, key);
    }
  }
});
await check('raw Binary decoded storage and complete roles reject without repair', () => {
  const hex = (value: string) => Uint8Array.from(value.replaceAll(/\s/g, '').match(/../g)!.map(v => Number.parseInt(v, 16)));
  const fixtures = [
    hex('48534f4e 11 00 01 00000000 00000001 0078'), // STR with present-empty metadata
    hex('48534f4e 10 00000001 0070 00 00 00000000'), // bare p[]
    hex('48534f4e 15 00 00 00000001 11 00 00 00000001 0078'), // ELEM[STR]
  ];
  for (const bytes of fixtures) assert.throws(() => hsonTransform.fromBinary(bytes), error => {
    const details = read_transform_error_details(error); assert.equal(details?.operation, 'fromBinary'); assert.equal(details?.stage, 'source-admission'); return true;
  });
  const bytes = hsonTransform.fromNode(complete()).toBinary().serialize(); const source = hsonTransform.fromBinary(bytes);
  bytes.fill(0); source.toNode().$_content.length = 0;
  assert.equal(canonical_hson_graph_equal(source.toNode(), complete()), true);
});
await check('owned Document and runtime branch identity remain separate', () => {
  const input = complete(); const source = hsonTransform.fromNode(input);
  const tree = hsonLiveTree.fromNode(input.$_content[0] as HsonNode, { isolated: true });
  assert.equal(typeof tree.quid, 'string'); assert.equal((source.toNode().$_content[0] as HsonNode).$_meta, undefined);
  const document = Hson.document.fromNode({ $_tag: '_hson_root', $_content: [str('before'), branch(), str('after')] });
  assert.equal(Hson.document.toNode(document).$_content.length, 3);
});
await check('deep direct values are admitted independently of transport capacity', () => {
  let input = val(-0);
  for (let index = 0; index < 1500; index++) input = { $_tag: '_hson_arr', $_content: [{ $_tag: '_hson_ii', $_content: [input], $_meta: { index: '0' } }] };
  let copy = hsonTransform.fromNode(input).toNode();
  for (let index = 0; index < 1500; index++) copy = (copy.$_content[0] as HsonNode).$_content[0] as HsonNode;
  assert.equal(Object.is(copy.$_content[0], -0), true);
});
await check('valid inline style preserves snapshots and Binary and Hson round trips', () => {
  const original = hsonTransform.fromHson('<p style="color:red"/>').toNode();
  const source = hsonTransform.fromNode(original);
  assert.equal(canonical_hson_graph_equal(source.toNode(), original), true);
  assert.equal(canonical_hson_graph_equal(hsonTransform.fromBinary(source.toBinary().serialize()).toNode(), original), true);
  assert.equal(canonical_hson_graph_equal(hsonTransform.fromHson(source.toHson().serialize()).toNode(), original), true);
});
events.terminal('pass'); console.log('1..' + checks);
