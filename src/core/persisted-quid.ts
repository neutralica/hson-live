/** Canonical 80-bit persisted node identity. */
export type PersistedQuid = string;

export const PERSISTED_QUID_LENGTH = 16;
export const PERSISTED_QUID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

const PERSISTED_QUID_CHARS = new Set(PERSISTED_QUID_ALPHABET);

/** True only for an already-canonical persisted QUID; this never normalizes. */
export function is_persisted_quid(value: unknown): value is PersistedQuid {
  if (typeof value !== "string" || value.length !== PERSISTED_QUID_LENGTH) return false;
  for (const char of value) if (!PERSISTED_QUID_CHARS.has(char)) return false;
  return true;
}

/** Direct, padding-free encoding of exactly ten bytes into sixteen Base32 digits. */
export function encode_persisted_quid(bytes: Uint8Array): PersistedQuid {
  if (bytes.length !== 10) throw new Error("persisted QUID encoding requires exactly 10 bytes");
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += PERSISTED_QUID_ALPHABET[(buffer >>> bits) & 31];
    }
  }
  return output;
}
