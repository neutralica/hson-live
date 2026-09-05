import type { JsonValue } from "../../core/types.js";

let nextFallbackIdentityId = 0;

/** @internal Shared default identity source for Echo client and request identities. */
export function make_echo_reload_safe_id(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid !== undefined) return `${prefix}-${uuid}`;
  nextFallbackIdentityId += 1;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${nextFallbackIdentityId.toString(36)}`;
}

/** @internal Detach one supported action payload from caller-owned containers. */
export function clone_echo_action_payload(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const clone = value.map(clone_echo_action_payload);
    Object.freeze(clone);
    return clone;
  }
  const clone: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) clone[key] = clone_echo_action_payload(value[key]);
  return Object.freeze(clone);
}
