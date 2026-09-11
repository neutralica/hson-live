import { HsonData } from "../data/hson-data.js";

let nextFallbackIdentityId = 0;

/** @internal Shared default identity source for Echo client and request identities. */
export function make_echo_reload_safe_id(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid !== undefined) return `${prefix}-${uuid}`;
  nextFallbackIdentityId += 1;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${nextFallbackIdentityId.toString(36)}`;
}

/** @internal Admit and snapshot one configured-action payload exactly once. */
export function admit_echo_action_payload(value: unknown): HsonData {
  return HsonData.from(value);
}
