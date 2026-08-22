export async function sha256_bytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined || typeof subtle.digest !== "function") {
    throw new Error("SHA-256 hashing requires WebCrypto SubtleCrypto support.");
  }
  let digest: ArrayBuffer;
  try {
    const snapshot = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(snapshot).set(bytes);
    digest = await subtle.digest("SHA-256", snapshot);
  } catch (cause) {
    throw new Error("SHA-256 hashing requires WebCrypto SHA-256 support.", { cause });
  }
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sha256_text(value: string): Promise<string> {
  return sha256_bytes(new TextEncoder().encode(value));
}
