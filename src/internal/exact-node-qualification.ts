import { PART_DECLARATION, part_structural_reference } from "./part-placeholder.js";
import { ARR_TAG, ELEM_TAG, HSON_META_TRANSIT_PREFIX, HSON_SYS_PREFIX, II_TAG, OBJ_TAG, ROOT_TAG, STR_TAG, VAL_TAG, _TRANSIT_PREFIX } from '../core/constants.js';
import { _throw_transform_err } from '../core/errors.js';
import { hson_metadata_candidate_key, hson_metadata_policy, hson_metadata_value_is_valid } from '../core/hson-metadata.js';
import { read_hson_node_quid } from '../core/hson-node-quid.js';
import { is_valid_hson_attribute_name, is_valid_hson_data_name } from '../core/hson-name.js';
import { is_Node } from '../core/node-guards.js';
import type { HsonNode, ReadonlyHsonNode } from '../core/types.js';

// Internal structural proof only: receiving roles confer no runtime identity authority.
const structuralTags: readonly string[] = [STR_TAG, VAL_TAG, OBJ_TAG, ARR_TAG, ELEM_TAG, II_TAG];
const dataTags: readonly string[] = [STR_TAG, VAL_TAG, OBJ_TAG, ARR_TAG];
type Trace = Readonly<{ parent?: Trace; key: string | number }>;
type Storage = 'node' | 'content' | 'attrs' | 'meta' | 'style' | 'css-leaf' | 'typed-style' | 'scalar' | 'observed-style' | 'observed-array' | 'observed-primitive';
type CopyJob = { kind: 'enter'; source: unknown; storage: Storage; path: Trace; target: object; key: string }
  | { kind: 'leave'; source: object };
const rootPath: Trace = { key: '$' };

function child(path: Trace, key: string | number): Trace { return { parent: path, key }; }
function path_text(path: Trace): string {
  const parts: Array<string | number> = [];
  for (let cursor: Trace | undefined = path; cursor; cursor = cursor.parent) append(parts, cursor.key);
  let result = '$';
  for (let index = parts.length - 2; index >= 0; index--) result += '[' + JSON.stringify(parts[index]) + ']';
  return result;
}
function fail(operation: string, path: Trace, message: string, code = 'HSON_CANONICAL_INVARIANT_VIOLATION', cause?: unknown): never {
  return _throw_transform_err(message, operation, undefined, cause, {
    code, stage: operation === 'LiveTree.node' || operation === 'LiveTree.hostRootNode'
      ? 'runtime-observation' : operation === 'toHson' || operation === 'toBinary' ? 'serialization-admission' : 'source-admission', path: path_text(path),
  });
}
function reflect<T>(operation: string, path: Trace, read: () => T): T {
  try { return read(); } catch (cause) { return fail(operation, path, 'graph storage reflection failed', undefined, cause); }
}
function put(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}
function append<T>(target: T[], value: T): void {
  // Capture/verification jobs and diagnostic paths must bypass inherited setters.
  put(target, String(target.length), value);
}
function finite(value: unknown, operation: string, path: Trace): void {
  if (typeof value === 'number' && !Number.isFinite(value)) fail(operation, path, 'Hson numbers must be finite', 'HSON_NUMBER_NONFINITE');
}

/** Descriptor observations are not an atomic view of an adversarial Proxy target. */
export function capture_exact_hson_graph(input: unknown, operation: string, portable: boolean): HsonNode {
  return capture_graph(input, operation, portable, false);
}

/** Copy runtime storage without public admission qualification or snapshot branding. @internal */
export function observe_exact_hson_graph(input: HsonNode, operation: string): ReadonlyHsonNode {
  const copy = capture_graph(input, operation, false, true);
  const seen = new WeakSet<object>();
  const stack: object[] = [copy];
  while (stack.length) {
    const value = stack.pop();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (typeof descriptor.value === 'object' && descriptor.value !== null) append(stack, descriptor.value);
    }
    Object.freeze(value);
  }
  // Capture establishes the observation domain, which includes runtime form
  // arrays and scalar styles that the mutable authoring type does not admit.
  return copy;
}

function capture_graph(input: unknown, operation: string, portable: boolean, observation: boolean): HsonNode {
  const holder: Record<string, unknown> = Object.create(null);
  const active = new WeakMap<object, Trace>();
  const copied = new WeakMap<object, Map<Storage, object>>();
  const stack: CopyJob[] = [{ kind: 'enter', source: input, storage: 'node', path: rootPath, target: holder, key: 'value' }];
  while (stack.length) {
    const job = stack.pop();
    if (!job) break;
    if (job.kind === 'leave') { active.delete(job.source); continue; }
    const { source, path, target, key } = job;
    let storage = job.storage;
    if (storage === 'scalar' || storage === 'observed-primitive'
      || (storage === 'observed-style' && (source === null || typeof source !== 'object'))
      || (storage === 'style' && typeof source === 'string')
      || (storage === 'css-leaf' && (source === null || typeof source !== 'object'))) {
      if (source !== null && source !== undefined && typeof source !== 'string' && typeof source !== 'number' && typeof source !== 'boolean') {
        fail(operation, path, 'unsupported semantic value type');
      }
      if (storage === 'observed-primitive' && source === undefined) fail(operation, path, 'runtime content and form arrays require primitive values');
      if (storage === 'css-leaf') {
        if (source === undefined) fail(operation, path, 'undefined style declaration is not canonical');
        finite(source, operation, path);
      }
      if (observation) finite(source, operation, path);
      put(target, key, source);
      continue;
    }
    if (storage === 'css-leaf') storage = 'typed-style';
    if (typeof source !== 'object' || source === null) fail(operation, path, 'semantic container must be an object');
    const origin = active.get(source);
    if (origin) fail(operation, path, 'cycle returns to ' + path_text(origin));
    const variantsForSource = copied.get(source);
    const previous = observation ? variantsForSource?.values().next().value : variantsForSource?.get(storage);
    // One observation object per source object, including sharing across
    // container roles. Validate each newly encountered role before reusing it.
    if (previous && (!observation || variantsForSource?.has(storage))) { put(target, key, previous); continue; }

    const array = reflect(operation, path, () => Array.isArray(source));
    const arrayStorage = storage === 'content' || storage === 'observed-array';
    if (arrayStorage ? !array : array) fail(operation, path, storage === 'content'
      ? 'content must be an array' : arrayStorage ? 'form values must be an array' : 'record must not be an array');
    const prototype = reflect(operation, path, () => Object.getPrototypeOf(source));
    if (!arrayStorage && prototype !== Object.prototype && prototype !== null) fail(operation, path, 'record must have Object.prototype or null prototype');
    const keys = reflect(operation, path, () => Reflect.ownKeys(source));
    if (portable && storage === 'meta' && keys.includes('quid')) {
      fail(operation, child(path, 'quid'), 'generated runtime QUID metadata is invalid in portable Transform input', 'PORTABLE_RUNTIME_QUID_FORBIDDEN');
    }
    const entries = new Map<string, unknown>();
    for (const entryKey of keys) {
      if (typeof entryKey === 'symbol') fail(operation, path, 'own symbol properties are not canonical storage');
      const entryPath = child(path, entryKey);
      if (storage === 'node' && !['$_tag', '$_content', '$_attrs', '$_meta'].includes(entryKey)) fail(operation, entryPath, 'unknown node storage field');
      if (storage === 'typed-style' && entryKey !== 'value' && entryKey !== 'unit') fail(operation, entryPath, 'unknown typed style field');
      const descriptor = reflect(operation, entryPath, () => Reflect.getOwnPropertyDescriptor(source, entryKey));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(operation, entryPath, 'semantic fields must be own data properties');
      if (!(arrayStorage && entryKey === 'length') && !descriptor.enumerable) fail(operation, entryPath, 'semantic fields must be enumerable');
      entries.set(entryKey, descriptor.value);
    }
    const semanticKeys = storage === 'node' ? ['$_tag', '$_content', '$_attrs', '$_meta']
      : storage === 'typed-style' ? ['value', 'unit'] : storage === 'meta' ? ['index', 'quid'] : [];
    for (const semanticKey of semanticKeys) {
      if (!entries.has(semanticKey) && prototype !== null
        && reflect(operation, child(path, semanticKey), () => Reflect.has(prototype, semanticKey))) {
        fail(operation, child(path, semanticKey), 'inherited semantic fields are not canonical storage');
      }
    }
    if (storage === 'node') {
      if (!entries.has('$_tag') || typeof entries.get('$_tag') !== 'string') fail(operation, child(path, '$_tag'), 'node must own a string $_tag');
      const contentPath = child(path, '$_content');
      if (!entries.has('$_content') || !reflect(operation, contentPath, () => Array.isArray(entries.get('$_content')))) fail(operation, contentPath, 'node must own array $_content');
      for (const optional of ['$_attrs', '$_meta']) {
        if (entries.has(optional) && (typeof entries.get(optional) !== 'object' || entries.get(optional) === null
          || reflect(operation, child(path, optional), () => Array.isArray(entries.get(optional))))) {
          fail(operation, child(path, optional), 'present optional container must be a plain record');
        }
      }
    }
    if (!observation && (storage === 'attrs' || storage === 'meta') && entries.size === 0) {
      fail(operation, path, 'empty optional container is not canonical; omit it', storage === 'attrs' ? 'HSON_EMPTY_ATTRIBUTES' : 'HSON_EMPTY_METADATA');
    }
    if (storage === 'typed-style') {
      const value = entries.get('value');
      if (!entries.has('value') || (typeof value !== 'string' && typeof value !== 'number')) fail(operation, child(path, 'value'), 'typed style value must be a string or finite number');
      finite(value, operation, child(path, 'value'));
      if (entries.has('unit') && entries.get('unit') !== undefined && typeof entries.get('unit') !== 'string') fail(operation, child(path, 'unit'), 'style unit must be a string or own-present undefined');
    }
    if (arrayStorage) {
      const length = entries.get('length');
      if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) fail(operation, path, 'invalid array length');
      if (entries.size !== length + 1) fail(operation, path, 'content arrays must be dense and have no extra properties');
      for (const entryKey of entries.keys()) {
        if (entryKey === 'length') continue;
        const index = Number(entryKey);
        if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== entryKey) fail(operation, child(path, entryKey), 'extra content-array property');
      }
      for (let index = 0; index < length; index++) if (!entries.has(String(index))) fail(operation, child(path, index), 'sparse content array');
    }

    // Copies must not reintroduce inherited semantic fields after admission.
    const result: object = previous ?? (arrayStorage ? [] : Object.create(observation ? prototype : null));
    let variants = copied.get(source);
    if (!variants) { variants = new Map(); copied.set(source, variants); }
    variants.set(storage, result);
    put(target, key, result);
    active.set(source, path);
    append(stack, { kind: 'leave', source });
    const children: CopyJob[] = [];
    for (const [entryKey, value] of entries) {
      if (arrayStorage && entryKey === 'length') continue;
      let next: Storage = 'scalar';
      if (storage === 'node') next = entryKey === '$_content' ? 'content' : entryKey === '$_attrs' ? 'attrs' : entryKey === '$_meta' ? 'meta' : 'scalar';
      else if (storage === 'content') next = typeof value === 'object' && value !== null ? 'node' : observation ? 'observed-primitive' : 'scalar';
      else if (storage === 'observed-array') next = 'observed-primitive';
      else if (storage === 'attrs' && entryKey === 'style') next = observation ? 'observed-style' : 'style';
      else if (observation && storage === 'attrs' && Array.isArray(value)) next = 'observed-array';
      else if (storage === 'observed-style') next = 'observed-style';
      else if (storage === 'style') next = 'css-leaf';
      append(children, { kind: 'enter', source: value, storage: next, path: child(path, storage === 'content' ? Number(entryKey) : entryKey), target: result, key: entryKey });
    }
    for (let index = children.length - 1; index >= 0; index--) append(stack, children[index]);
  }
  if (!is_captured_node(holder.value)) return fail(operation, rootPath, 'input must be a HsonNode');
  return holder.value;
}

function is_captured_node(value: unknown): value is HsonNode {
  if (typeof value !== 'object' || value === null) return false;
  const tag = Reflect.getOwnPropertyDescriptor(value, '$_tag');
  const content = Reflect.getOwnPropertyDescriptor(value, '$_content');
  return tag !== undefined && Object.hasOwn(tag, 'value') && typeof tag.value === 'string'
    && content !== undefined && Object.hasOwn(content, 'value') && Array.isArray(content.value);
}

// runtime-branch selects an existing element or data relationship for a
// standalone owner; it never changes the role of children under ELEM.
export type ExactHsonRole = 'complete' | 'data' | 'member' | 'object-relationship' | 'item' | 'element-content' | 'branch' | 'runtime-branch' | 'text'
  | 'data-root' | 'document-source' | 'document-root' | 'document-item';
type Role = ExactHsonRole;
type VerifyJob = { node: HsonNode; role: Role; path: Trace; index?: number };

/** Generic runtime content may be a source carrier or a standalone relationship.
 * Receiving family, Schema and identity authority remain with its owner. @internal
 */
export function qualify_exact_hson_graph_content(root: HsonNode, operation: string): void {
  const first = root.$_content[0];
  const role: ExactHsonRole = root.$_tag === ROOT_TAG
    ? is_Node(first) && (first.$_tag === OBJ_TAG || first.$_tag === ARR_TAG || first.$_tag === VAL_TAG)
      ? 'data-root' : 'document-source'
    : root.$_tag === ELEM_TAG ? 'element-content'
      : structuralTags.includes(root.$_tag) ? 'complete' : 'runtime-branch';
  qualify_exact_hson_graph(root, operation, role, true);
}

/** Only captured/private graphs enter this contextual verifier. */
export function qualify_exact_hson_graph(root: HsonNode, operation: string, rootRole: Role = 'complete', runtime = false): void {
  const seen = new WeakMap<object, Set<Role>>();
  const stack: VerifyJob[] = [{ node: root, role: rootRole, path: rootPath }];
  while (stack.length) {
    const job = stack.pop();
    if (!job) break;
    const { node, path } = job;
    let role = job.role;
    const tag = node.$_tag;
    const content = node.$_content;
    if (role === 'data-root' && tag !== ROOT_TAG) role = 'data';
    if (role === 'document-source' && tag === ELEM_TAG) role = 'element-content';
    if ((role === 'document-source' || role === 'document-root') && tag !== ROOT_TAG) {
      fail(operation, path, role === 'document-root' ? 'retained document owner requires ROOT' : 'document source requires ROOT or ELEM');
    }
    if (role === 'document-item') role = tag === STR_TAG ? 'text' : 'branch';
    // Sibling-dependent evidence must be checked at every occurrence.
    if (role === 'item' && node.$_meta?.index !== String(job.index)) fail(operation, child(child(path, '$_meta'), 'index'), 'II index must equal its physical position');
    const visited = seen.get(node);
    if (visited?.has(role)) continue;
    if (visited) visited.add(role); else seen.set(node, new Set([role]));
    const ownedRoot = tag === ROOT_TAG && (role === 'data-root' || role === 'document-source' || role === 'document-root');
    if (tag === ROOT_TAG && !ownedRoot) fail(operation, path, '_hson_root is an internal attachment carrier, not a complete portable value');
    const structural = tag.startsWith(HSON_SYS_PREFIX);
    if (structural && !ownedRoot && !structuralTags.includes(tag)) fail(operation, child(path, '$_tag'), 'unknown structural node tag');
    if (role === 'complete' && !structural) fail(operation, path, 'bare named branch is not a complete portable value');
    if (role === 'data' && !dataTags.includes(tag)) fail(operation, path, 'array value must be a complete data value');
    if (role === 'text' && tag !== STR_TAG) fail(operation, path, 'element text must be STR');
    if (role === 'member' && structural) fail(operation, path, 'object members require ordinary names');
    if (role === 'branch' && structural) fail(operation, path, 'element content requires a named element branch');
    if (role === 'runtime-branch' && structural) fail(operation, path, 'runtime branch receiver requires an ordinary named branch');
    if (role === 'item' && tag !== II_TAG) fail(operation, path, 'only II may occur under ARR');
    if (role === 'object-relationship' && tag !== OBJ_TAG && tag !== ARR_TAG) fail(operation, path, 'object member requires OBJ or ARR relationship');
    if (role === 'element-content' && tag !== ELEM_TAG) fail(operation, path, 'named element requires ELEM relationship');
    if (tag === II_TAG && role !== 'item') fail(operation, path, 'II may occur only directly under ARR');

    if (node.$_meta) {
      for (const key of Object.keys(node.$_meta)) {
        const fieldPath = child(child(path, '$_meta'), key);
        if (key === 'quid' && !runtime) fail(operation, fieldPath, 'portable runtime QUID claim is forbidden', 'PORTABLE_RUNTIME_QUID_FORBIDDEN');
        if (key === 'quid' && runtime) {
          // Preserve the established QUID validation cause without consulting
          // identity registries or treating structural validity as authority.
          try { read_hson_node_quid(node); }
          catch (cause) { fail(operation, fieldPath, 'runtime QUID metadata is invalid', undefined, cause); }
        }
        const policy = hson_metadata_policy(tag, key);
        const value: unknown = Reflect.getOwnPropertyDescriptor(node.$_meta, key)?.value;
        if (!policy.valid || !hson_metadata_value_is_valid(key, value)) fail(operation, fieldPath, 'invalid metadata value or placement');
      }
    }
    if (node.$_attrs) {
      if (structural || role === 'member') fail(operation, child(path, '$_attrs'), 'attributes belong to named element roles');
      const structure = part_structural_reference(node);
      for (const key of Object.keys(node.$_attrs)) {
        const attrPath = child(child(path, '$_attrs'), key);
        const lower = key.toLowerCase();
        const declaration = key === PART_DECLARATION && node.$_attrs[key] === PART_DECLARATION;
        if ((!is_valid_hson_attribute_name(key) && !(structure !== undefined && key === `#{${structure.reference}}`)) || lower === PART_DECLARATION && !declaration || hson_metadata_candidate_key(key) !== undefined && !declaration || lower.startsWith(HSON_META_TRANSIT_PREFIX) || lower.startsWith(_TRANSIT_PREFIX)) fail(operation, attrPath, 'invalid or reserved attribute name');
        if (key !== 'style') {
          const value: unknown = node.$_attrs[key];
          if (!runtime && typeof value !== 'string') fail(operation, attrPath, 'portable ordinary attribute values must be strings');
          if (runtime) {
            finite(value, operation, attrPath);
            if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
              fail(operation, attrPath, 'runtime ordinary attributes require finite primitives');
            }
          }
        }
      }
    }
    const enqueue = (value: unknown, nextRole: Role, index: number, expectedIndex?: number): void => {
      const at = child(child(path, '$_content'), index);
      if (!is_Node(value)) fail(operation, at, 'content must contain nodes outside primitive leaves');
      append(stack, { node: value, role: nextRole, path: at, ...(expectedIndex === undefined ? {} : { index: expectedIndex }) });
    };
    if (ownedRoot) {
      if (role === 'data-root') {
        if (content.length !== 1) fail(operation, child(path, '$_content'), 'data ROOT must own exactly one complete data value');
        enqueue(content[0], 'data', 0);
      } else if (content.length === 1 && is_Node(content[0]) && content[0].$_tag === ELEM_TAG) {
        // Existing source/carrier ownership, including a nested singleton STR.
        enqueue(content[0], 'element-content', 0);
      } else {
        for (let index = content.length - 1; index >= 0; index--) enqueue(content[index], 'document-item', index);
      }
      continue;
    }
    if (tag === STR_TAG || tag === VAL_TAG) {
      if (content.length !== 1) fail(operation, child(path, '$_content'), 'primitive leaf must contain exactly one value');
      const value = content[0];
      finite(value, operation, child(child(path, '$_content'), 0));
      if (tag === STR_TAG ? typeof value !== 'string' : value !== null && typeof value !== 'number' && typeof value !== 'boolean') fail(operation, child(child(path, '$_content'), 0), 'wrong primitive leaf type');
      continue;
    }
    if (!structural) {
      if (!is_valid_hson_data_name(tag) || ((role === 'branch' || role === 'runtime-branch') && tag.length === 0)) fail(operation, child(path, '$_tag'), 'invalid ordinary name for structural role');
      if ((role === 'branch' || role === 'runtime-branch') && content.length === 0) continue;
      if (content.length !== 1) fail(operation, child(path, '$_content'), 'ordinary relationship must contain exactly one structural node');
      const dataRelationship = role === 'runtime-branch' && is_Node(content[0])
        && (content[0].$_tag === OBJ_TAG || content[0].$_tag === ARR_TAG);
      enqueue(content[0], role === 'member' || dataRelationship ? 'object-relationship' : 'element-content', 0);
    } else if (tag === II_TAG) {
      if (content.length !== 1) fail(operation, child(path, '$_content'), 'II must contain exactly one value');
      enqueue(content[0], 'data', 0);
    } else if (tag === ARR_TAG) {
      for (let index = content.length - 1; index >= 0; index--) enqueue(content[index], 'item', index, index);
    } else if (tag === OBJ_TAG) {
      const only = content[0];
      const scalar = content.length === 1 && is_Node(only) && (only.$_tag === STR_TAG || only.$_tag === VAL_TAG);
      if (scalar) {
        if (role !== 'object-relationship') fail(operation, path, 'complete OBJ scalar carrier is forbidden');
        enqueue(only, 'data', 0);
      } else {
        const names = new Set<string>();
        for (let index = 0; index < content.length; index++) {
          const member = content[index];
          if (!is_Node(member)) fail(operation, child(child(path, '$_content'), index), 'object members must be nodes');
          if (names.has(member.$_tag)) fail(operation, child(child(path, '$_content'), index), 'duplicate object member name');
          names.add(member.$_tag);
        }
        for (let index = content.length - 1; index >= 0; index--) enqueue(content[index], 'member', index);
      }
    } else if (tag === ELEM_TAG) {
      if (content.length === 0) fail(operation, path, 'empty ELEM relationship is invalid');
      if (role === 'complete' && content.length === 1 && is_Node(content[0]) && content[0].$_tag === STR_TAG) fail(operation, path, 'complete ELEM string carrier is forbidden');
      for (let index = content.length - 1; index >= 0; index--) {
        const value = content[index];
        enqueue(value, is_Node(value) && value.$_tag === STR_TAG ? 'text' : 'branch', index);
      }
    }
  }
}
