import type { HsonNode } from "./types.js";

export const AUTHORED_EVENT_TAG = "hson:event";

/** Bare native listener options shared by Event admission and editor completion. */
export const AUTHORED_EVENT_FLAGS: ReadonlyMap<string, string> = new Map([
  ["once", "Remove the native listener after its first occurrence"],
  ["capture", "Listen during the native capture phase"],
  ["passive", "Register a passive native listener"],
  ["preventDefault", "Attempt native default cancellation during dispatch"],
  ["stopProp", "Stop native propagation"],
  ["stopImmediateProp", "Stop native immediate propagation"],
  ["document", "Listen on the subject's owning Document"],
  ["window", "Listen on the subject's owning Window"],
]);

export function is_event_attachment_attribute(name: string): boolean {
  return name.toLowerCase().startsWith("event:");
}

type AttachmentPosition = Readonly<{ index: number; line: number; column: number }>;
const attachments = new WeakMap<object, ReadonlyMap<string, AttachmentPosition>>();

/** Scanner evidence belongs to privately owned source, outside canonical graph storage. */
export function record_event_attachments(attrs: object, flags: ReadonlyMap<string, AttachmentPosition>): void {
  if (flags.size) attachments.set(attrs, flags);
}

export function copy_event_attachments(source: object, target: object): void {
  const flags = attachments.get(source);
  if (flags !== undefined) attachments.set(target, flags);
}

export function event_attachment_position(node: HsonNode, name: string): AttachmentPosition | undefined {
  const attrs = node.$_attrs;
  return attrs === undefined ? undefined : attachments.get(attrs)?.get(name);
}
