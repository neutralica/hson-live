import { scan_part_reference } from "./part-placeholder.js";

/** Escaped sigils in :str operands are literal text. Keep source evidence
 * outside the graph so the decoded attribute remains an ordinary string. */
const literals = new WeakMap<object, ReadonlyMap<string, ReadonlySet<number>>>();

export function part_literal_sigils(attrs: object | undefined, name: string): ReadonlySet<number> | undefined {
  return attrs === undefined ? undefined : literals.get(attrs)?.get(name);
}

export function record_part_literal_sigils(attrs: object, name: string, offsets: ReadonlySet<number>): void {
  const fields = new Map(literals.get(attrs));
  fields.set(name, offsets);
  literals.set(attrs, fields);
}

export function copy_part_literal_sigils(source: object, target: object): void {
  const fields = literals.get(source);
  if (fields !== undefined) literals.set(target, fields);
}

export function decode_part_string_sigils(raw: string): ReadonlySet<number> {
  const offsets = new Set<number>();
  for (let at = 0, decoded = 0; at < raw.length; decoded++) {
    if (raw[at++] !== "\\") continue;
    if (raw[at] === "u") {
      if (/^(?:002[35]|005e)$/i.test(raw.slice(at + 1, at + 5))) offsets.add(decoded);
      at += 5;
    } else at++;
  }
  return offsets;
}

export function part_string_literal_sigils(value: string): ReadonlySet<number> {
  return new Set([...value.matchAll(/[%^#](?=\{)/g)].map(match => match.index));
}

/** Preserve the template's authored fragment boundaries through serialization.
 * Substitutions already carry escaped sigils. A bare sigil may still start a
 * reference across a slot, even when the slot supplied an empty string. */
export function escape_cross_slot_part_references(raw: string, slotStarts: readonly number[]): string {
  const value: string = JSON.parse('"' + raw + '"');
  const boundaries: number[] = [];
  const bareSigils = new Map<number, number>();
  let slot = 0;
  for (let at = 0, decoded = 0; at < raw.length; decoded++) {
    while (slotStarts[slot] === at) {
      boundaries.push(decoded);
      slot++;
    }
    const char = raw[at];
    if (char === "%" || char === "^" || char === "#") bareSigils.set(decoded, at);
    at += char === "\\" ? raw[at + 1] === "u" ? 6 : 2 : 1;
  }

  let boundaryIndex = 0, copied = 0, output = "", referenceEnd = 0;
  for (const [start, rawStart] of bareSigils) {
    if (start < referenceEnd || value[start + 1] !== "{") continue;
    while (boundaries[boundaryIndex] !== undefined && boundaries[boundaryIndex]! <= start) boundaryIndex++;
    const boundary = boundaries[boundaryIndex];
    if (boundary === undefined) break;
    // The legacy opener must not be manufactured either. Scan its shape only
    // to locate the end, leaving wholly authored legacy syntax to validation.
    const reference = value[start] === "#" ? "^" + value.slice(start + 1, boundary) : value.slice(start, boundary);
    const complete = scan_part_reference(reference, 0);
    if (complete !== undefined) {
      referenceEnd = start + complete.end;
      continue;
    }
    if (boundary !== start + 1 && scan_part_reference(reference, 0, true) === undefined) continue;
    output += raw.slice(copied, rawStart) + "\\u00" + value.charCodeAt(start).toString(16);
    copied = rawStart + 1;
  }
  return output + raw.slice(copied);
}
