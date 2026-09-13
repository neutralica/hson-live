const TARGET_CHUNK_CODE_UNITS = 32 * 1_024;
const MAX_PENDING_FRAGMENTS = 256;

/** Collect text without retaining one JavaScript array entry or rope node per small fragment. */
export class BoundedStringWriter {
  readonly #chunks: string[] = [];
  readonly #pending: string[] = [];
  #pendingLength = 0;

  write(fragment: string): void {
    if (fragment.length === 0) return;
    if (fragment.length >= TARGET_CHUNK_CODE_UNITS) {
      this.#flush();
      this.#chunks.push(fragment);
      return;
    }
    this.#pending.push(fragment);
    this.#pendingLength += fragment.length;
    if (this.#pendingLength >= TARGET_CHUNK_CODE_UNITS || this.#pending.length >= MAX_PENDING_FRAGMENTS) this.#flush();
  }

  finish(): string {
    this.#flush();
    return this.#chunks.join("");
  }

  #flush(): void {
    if (this.#pending.length === 0) return;
    this.#chunks.push(this.#pending.join(""));
    this.#pending.length = 0;
    this.#pendingLength = 0;
  }
}
