// @hson-live-external-test
import assert from 'node:assert/strict';
import { admit_exact_portable_node, copy_transform_node, own_transform_source } from '../src/api/transform/node-exact.ts';
import { canonical_hson_graph_equal } from '../src/core/canonical-hson-equal.ts';
import { read_transform_error_details } from '../src/core/errors.ts';
import type { HsonNode, HsonAttrs } from '../src/core/types.ts';
import { create_test_event_emitter } from './test-events.mjs';

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.node-exact",
  title: "Exact node storage, roles and snapshot ownership",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["node", "canonical", "snapshot", "rejection", "public-api", "externally-discoverable"]),
});
const events = create_test_event_emitter('transform.node-exact');
let checks = 0;
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, 'pass'); checks++; console.log('ok ' + checks + ' - ' + name); }
  catch (error) { events.case_end(name, 'fail'); events.terminal('fail'); throw error; }
}
const n = (tag: string, content: HsonNode['$_content'] = [], attrs?: HsonAttrs): HsonNode => (
  attrs === undefined ? { $_tag: tag, $_content: content } : { $_tag: tag, $_content: content, $_attrs: attrs }
);
const str = (value: string) => n('_hson_str', [value]);
const val = (value: number | boolean | null) => n('_hson_val', [value]);
const obj = (...content: HsonNode[]) => n('_hson_obj', content);
const elem = (...content: HsonNode[]) => n('_hson_elem', content);
const ii = (value: HsonNode, index = '0'): HsonNode => ({ $_tag: '_hson_ii', $_content: [value], $_meta: { index } });
function rejects(input: unknown, code = 'HSON_CANONICAL_INVARIANT_VIOLATION'): void {
  assert.throws(() => admit_exact_portable_node(input), error => {
    const details = read_transform_error_details(error);
    assert.equal(details?.operation, 'fromNode');
    assert.equal(details?.stage, 'source-admission');
    assert.equal(details?.code, code);
    assert.match(details?.path ?? '', /^\$/);
    return true;
  });
}
check('canonical complete values and nested relationships remain exact', () => {
  for (const graph of [str(''), str('\ud800\0\r\n'), val(-0), val(true), val(null), obj(), n('_hson_arr'),
    obj(n('', [obj(str('x'))])), obj(n('a', [n('_hson_arr', [ii(val(1))])])),
    elem(n('p')), elem(str(''), str('a'), str('b')), elem(n('p', [elem(str('x'))]))]) {
    const snapshot = admit_exact_portable_node(graph);
    assert.equal(canonical_hson_graph_equal(snapshot, graph), true);
    assert.notEqual(snapshot, graph);
    assert.equal(canonical_hson_graph_equal(copy_transform_node(snapshot), graph), true);
  }
});
check('complete aliases, wrong relationships and owned roots reject', () => {
  for (const graph of [elem(str('x')), obj(str('x')), obj(val(1)), n('p'), n('p', [elem(str('x'))]),
    n('_hson_root'), ii(val(1)), elem(), obj(obj()), obj(n('_hson_arr')),
    obj(n('a', [str('x')])), elem(val(1)), elem(obj()), elem(n('_hson_arr')),
    n('_hson_arr', [ii(n('_hson_root', [str('x')]))]), n('_hson_arr', [ii(obj(str('x')))]),
    elem(n('')), obj(n('a')), elem(n('p', [elem()]))]) rejects(graph);
});
check('optional containers reject presence defects without repair', () => {
  rejects({ ...str('x'), $_attrs: {} }, 'HSON_EMPTY_ATTRIBUTES');
  rejects({ ...str('x'), $_meta: {} }, 'HSON_EMPTY_METADATA');
  for (const value of [undefined, null, [], 1, '']) {
    rejects({ ...str('x'), $_attrs: value });
    rejects({ ...str('x'), $_meta: value });
  }
});
check('unknown, hidden, accessor and symbol fields reject without hooks', () => {
  let calls = 0;
  rejects({ ...str('x'), toJSON() { calls++; return str('changed'); } });
  const hidden = str('x'); Object.defineProperty(hidden, 'extra', { value: 1 }); rejects(hidden);
  const hiddenTag = str('x'); Object.defineProperty(hiddenTag, '$_tag', { value: '_hson_str', enumerable: false }); rejects(hiddenTag);
  const getter = str('x'); Object.defineProperty(getter, '$_content', { enumerable: true, get() { calls++; return ['x']; } }); rejects(getter);
  const missing = { $_tag: '_hson_str' }; rejects(missing);
  const nodeSymbol = str('x'); Reflect.set(nodeSymbol, Symbol('extra'), 1); rejects(nodeSymbol);
  const attrsSymbol: HsonAttrs = { id: 'x' }; Reflect.set(attrsSymbol, Symbol('extra'), 1); rejects(elem(n('p', [], attrsSymbol)));
  const meta = { index: '0' }; Reflect.set(meta, Symbol('extra'), 1); rejects(n('_hson_arr', [{ $_tag: '_hson_ii', $_content: [val(1)], $_meta: meta }]));
  const style = { width: { value: -0, unit: undefined } }; Reflect.set(style.width, Symbol('extra'), 1); rejects(elem(n('p', [], { style })));
  const styleSymbol = { color: 'red' }; Reflect.set(styleSymbol, Symbol('extra'), 1); rejects(elem(n('p', [], { style: styleSymbol })));
  const attrGetter = { id: 'x' }; Object.defineProperty(attrGetter, 'id', { enumerable: true, get() { calls++; return 'x'; } }); rejects(elem(n('p', [], attrGetter)));
  assert.equal(calls, 0);
});
check('dense descriptor arrays reject extras, sparsity and own overrides', () => {
  let calls = 0;
  for (const key of ['map', 'toJSON', Symbol.iterator]) {
    const graph = str('x'); Reflect.set(graph.$_content, key, () => { calls++; return ['changed']; }); rejects(graph);
  }
  const sparse = str('x'); delete sparse.$_content[0]; rejects(sparse);
  const arraySymbol = str('x'); Reflect.set(arraySymbol.$_content, Symbol('extra'), 1); rejects(arraySymbol);
  const getter = str('x'); Object.defineProperty(getter.$_content, '0', { enumerable: true, get() { calls++; return 'x'; } }); rejects(getter);
  const inherited = str('x'); Object.setPrototypeOf(inherited.$_content, { map() { calls++; return []; } });
  assert.equal(copy_transform_node(admit_exact_portable_node(inherited)).$_content[0], 'x');
  assert.equal(calls, 0);
});
check('plain/null records and nonsemantic descriptor flags are supported', () => {
  const graph: HsonNode = Object.create(null);
  Object.defineProperties(graph, { $_tag: { value: '_hson_str', enumerable: true }, $_content: { value: ['x'], enumerable: true } });
  assert.equal(canonical_hson_graph_equal(admit_exact_portable_node(graph), str('x')), true);
  Object.defineProperty(Object.prototype, '$_meta', { value: { index: '0' }, configurable: true });
  try { rejects(str('x')); } finally { Reflect.deleteProperty(Object.prototype, '$_meta'); }
});
check('portable ordinary attrs are strings; style storage stays exact', () => {
  for (const value of [0, -0, false, null, undefined]) rejects(elem(n('p', [], { id: value })));
  for (const value of ['', '0', 'false']) assert.equal(copy_transform_node(admit_exact_portable_node(elem(n('p', [], { id: value })))).$_content.length, 1);
  for (const style of [{}, { color: '' }, { width: { value: -0 } }, { width: { value: -0, unit: undefined } },
    { width: { value: 2, unit: '' } }, { color: '  red  ', display: null }, { fooBar: 'a', 'foo-bar': 'b' }]) {
    const graph = elem(n('p', [], { style }));
    assert.equal(canonical_hson_graph_equal(copy_transform_node(admit_exact_portable_node(graph)), graph), true);
  }
  rejects(val(Infinity), 'HSON_NUMBER_NONFINITE');
  rejects({ ...str('x'), $_meta: { quid: undefined } }, 'PORTABLE_RUNTIME_QUID_FORBIDDEN');
});
check('array positions, duplicate members and role-sensitive sharing are checked', () => {
  rejects(n('_hson_arr', [ii(val(1), '1'), ii(val(2), '0')]));
  for (const index of ['00', '-0', '1', '+0', '0.0', '']) rejects(n('_hson_arr', [ii(val(1), index)]));
  const shared = str('x');
  assert.equal(canonical_hson_graph_equal(admit_exact_portable_node(obj(n('a', [obj(shared)]), n('b', [obj(shared)]))), obj(n('a', [obj(str('x'))]), n('b', [obj(str('x'))]))), true);
  rejects(obj(n('a', [obj(shared)]), shared));
  const item = ii(val(1)); rejects(n('_hson_arr', [item, item]));
  rejects(obj(n('a', [obj(str('x'))]), n('a', [obj(str('y'))])));
});
check('cycles fail and deep valid graphs do not acquire a semantic depth cutoff', () => {
  const cycle = n('_hson_root'); cycle.$_content.push(cycle); rejects(cycle);
  let graph = val(-0);
  for (let level = 0; level < 1500; level++) graph = n('_hson_arr', [ii(graph)]);
  let observed = copy_transform_node(admit_exact_portable_node(graph));
  for (let level = 0; level < 1500; level++) observed = (observed.$_content[0] as HsonNode).$_content[0] as HsonNode;
  assert.equal(Object.is(observed.$_content[0], -0), true);
});
check('private ownership isolates caller, observations and style leaves', () => {
  const graph = elem(n('p', [elem(str('x'))], { style: { width: { value: 2, unit: undefined } } }));
  const expected = copy_transform_node(graph);
  const snapshot = admit_exact_portable_node(graph);
  assert.equal(Object.isFrozen(graph), false);
  graph.$_content.length = 0;
  const first = copy_transform_node(snapshot); const second = copy_transform_node(snapshot);
  first.$_content.length = 0;
  assert.equal(canonical_hson_graph_equal(second, expected), true);
  assert.equal(canonical_hson_graph_equal(snapshot, expected), true);
  const owner = n('_hson_root');
  assert.equal(copy_transform_node(own_transform_source(owner)).$_tag, '_hson_root');
});
check('proxy reflection failures are structured; observations are not target atomicity', () => {
  rejects(new Proxy(str('x'), { ownKeys() { throw new Error('trap'); } }));
  const revokedNode = Proxy.revocable(str('x'), {}); revokedNode.revoke(); rejects(revokedNode.proxy);
  for (const field of ['$_content', '$_attrs', '$_meta']) {
    const revoked = Proxy.revocable([], {}); revoked.revoke();
    rejects({ ...str('x'), [field]: revoked.proxy });
  }
  const raw = { ...str('x'), hidden: 1 };
  const proxy = new Proxy(raw, { ownKeys() { return ['$_tag', '$_content']; }, get() { throw new Error('ordinary get must not run'); } });
  assert.equal(canonical_hson_graph_equal(admit_exact_portable_node(proxy), str('x')), true);
  assert.equal(raw.hidden, 1);
});
events.terminal('pass');
console.log('1..' + checks);
