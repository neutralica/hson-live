import { is_Node } from '../../core/node-guards.js';
import type { HsonNode } from '../../core/types.js';
import { capture_exact_hson_graph as capture, qualify_exact_hson_graph as qualify } from '../../internal/exact-node-qualification.js';

// Private Transform snapshots; contextual runtime qualification has no public bypass.
const snapshots = new WeakSet<object>();

function own(node: HsonNode): HsonNode {
  const seen = new WeakSet<object>();
  const stack: object[] = [node];
  while (stack.length) {
    const value = stack.pop();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const nested: unknown = Reflect.getOwnPropertyDescriptor(value, key)?.value;
      if (typeof nested === 'object' && nested !== null) {
        // Publication traverses captured semantic records before freezing them.
        // Do not expose those records to an inherited index setter here.
        Object.defineProperty(stack, stack.length, {
          value: nested, enumerable: true, writable: true, configurable: true,
        });
      }
    }
    Object.freeze(value);
    snapshots.add(value);
  }
  return node;
}

/** Raw public portable admission; no normalization and no caller references. */
export function admit_exact_portable_node(input: unknown, operation = 'fromNode'): HsonNode {
  const node = capture(input, operation, true);
  qualify(node, operation);
  return own(node);
}

/** Preserve an already parsed source's ownership/output shape during staging. */
export function own_transform_source(node: HsonNode): HsonNode {
  return snapshots.has(node) ? node : own(capture(node, 'Transform.snapshot', false));
}

/** Independent mutable observation; descriptor flags/topology are not semantics. */
export function copy_transform_node(node: HsonNode): HsonNode {
  return capture(node, 'Transform.toNode', false);
}

export function is_transform_snapshot(value: unknown): value is HsonNode {
  return typeof value === 'object' && value !== null && snapshots.has(value) && is_Node(value);
}

/** Generic Binary's source-owner extraction happens before this qualification. */
export function qualify_transform_value(node: HsonNode, operation: 'toBinary' | 'toHson'): void { qualify(node, operation); }
