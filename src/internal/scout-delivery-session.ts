import type { LocusSession, LocusSessionHtmlNow } from "../types/locus.core.types.js";
import type { LiveMap } from "../types/livemap.types.js";

const owners = new WeakMap<LocusSession, Readonly<{ map: LiveMap; begin: (claimed: () => void) => void; assert: () => void }>>();
const captures = new WeakMap<object, LocusSession>();

export function register_scout_session(session: LocusSession, owner: Readonly<{ map: LiveMap; begin: (claimed: () => void) => void; assert: () => void }>): void {
  owners.set(session, owner);
}
export function register_scout_capture(capture: object, session: LocusSession): void { captures.set(capture, session); }
export function scout_delivery_session(session: LocusSession, capture: LocusSessionHtmlNow) {
  const owner = owners.get(session);
  if (owner === undefined || captures.get(capture) !== session) throw new Error("Scout delivery requires this session's original HTML capture.");
  owner.assert();
  return owner;
}
