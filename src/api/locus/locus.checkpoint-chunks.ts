/** Internal bounded, semantic JSON token stream for durable checkpoint roots and Schemas. */
import { hosted_sha256 } from "../livemap/livemap.hosted.js";

export const CHECKPOINT_CHUNK_MAX_BYTES = 1_024 * 1_024;
export const CHECKPOINT_MAX_CHUNKS = 65_536;
export const CHECKPOINT_MAX_MANIFEST_BYTES = 16 * 1_024 * 1_024;
export const CHECKPOINT_MAX_DEPTH = 4_096;
const STRING_PART_CHARS = 8_192;
const encoder = new TextEncoder();

export type CheckpointChunk = Readonly<{ id: string; payload: string }>;
export type CheckpointChunkDescriptor = Readonly<{
  id: string;
  owner: string;
  part: "schema" | "root" | "css";
  rev: number;
  index: number;
  bytes: number;
  sha256: string;
}>;

type Token = readonly ["o" | "a" | "e" | "z"]
  | readonly ["k" | "s", string, boolean]
  | readonly ["n", number]
  | readonly ["b", boolean];

function* string_tokens(kind: "k" | "s", value: string): Generator<Token> {
  if (value.length === 0) { yield [kind, "", true]; return; }
  for (let offset = 0; offset < value.length; offset += STRING_PART_CHARS) {
    const end = Math.min(value.length, offset + STRING_PART_CHARS);
    yield [kind, value.slice(offset, end), end === value.length];
  }
}

/** Emits a deterministic stream without stringifying an entire root. */
function* tokens(value: unknown): Generator<Token> {
  type Work =
    | { kind: "value"; value: unknown; depth: number }
    | { kind: "array"; value: unknown[]; index: number; depth: number }
    | { kind: "object"; value: Record<string, unknown>; keys: Iterator<string>; depth: number };
  function* own_keys(object: Record<string, unknown>): Generator<string> {
    for (const key in object) if (Object.hasOwn(object, key) && object[key] !== undefined) yield key;
  }
  const stack: Work[] = [{ kind: "value", value, depth: 0 }];
  while (stack.length > 0) {
    const next = stack.at(-1)!;
    if (next.kind === "array") {
      if (next.index === next.value.length) { stack.pop(); yield ["e"]; }
      else stack.push({ kind: "value", value: next.value[next.index++], depth: next.depth + 1 });
      continue;
    }
    if (next.kind === "object") {
      const key = next.keys.next();
      if (key.done) { stack.pop(); yield ["e"]; }
      else {
        yield* string_tokens("k", key.value);
        stack.push({ kind: "value", value: next.value[key.value], depth: next.depth + 1 });
      }
      continue;
    }
    stack.pop();
    const current = next.value;
    if (current === null) { yield ["z"]; continue; }
    if (typeof current === "string") { yield* string_tokens("s", current); continue; }
    if (typeof current === "number" && Number.isFinite(current)) { yield ["n", current]; continue; }
    if (typeof current === "boolean") { yield ["b", current]; continue; }
    if (Array.isArray(current)) {
      if (next.depth >= CHECKPOINT_MAX_DEPTH) throw new Error("Checkpoint nesting exceeds its supported bound.");
      yield ["a"];
      stack.push({ kind: "array", value: current, index: 0, depth: next.depth });
      continue;
    }
    if (typeof current === "object" && current !== null) {
      if (next.depth >= CHECKPOINT_MAX_DEPTH) throw new Error("Checkpoint nesting exceeds its supported bound.");
      yield ["o"];
      const object = current as Record<string, unknown>;
      stack.push({ kind: "object", value: object, keys: own_keys(object), depth: next.depth });
      continue;
    }
    throw new Error("Checkpoint contains an unsupported semantic value.");
  }
}

export function* encode_checkpoint_chunks(
  checkpointId: string, rev: number, owner: string, part: "schema" | "root" | "css", value: unknown,
): Generator<Readonly<{ chunk: CheckpointChunk; descriptor: CheckpointChunkDescriptor }>> {
  let payload = "";
  let bytes = 0;
  let index = 0;
  const emit = () => {
    const id = `${checkpointId}:${owner}:${part}:${index}`;
    const result = Object.freeze({
      chunk: Object.freeze({ id, payload }),
      descriptor: Object.freeze({ id, owner, part, rev, index, bytes, sha256: hosted_sha256(payload) }),
    });
    payload = "";
    bytes = 0;
    index += 1;
    return result;
  };
  for (const token of tokens(value)) {
    const line = `${JSON.stringify(token)}\n`;
    const size = encoder.encode(line).byteLength;
    if (size > CHECKPOINT_CHUNK_MAX_BYTES) throw new Error("Checkpoint token exceeds its chunk bound.");
    if (bytes + size > CHECKPOINT_CHUNK_MAX_BYTES) yield emit();
    payload += line;
    bytes += size;
  }
  if (bytes > 0) yield emit();
}

type Frame = { kind: "object" | "array"; value: Record<string, unknown> | unknown[]; key?: string };

/** Feed one verified chunk at a time. No complete encoded root is assembled. */
export class CheckpointTokenDecoder {
  private readonly stack: Frame[] = [];
  private result: unknown;
  private supplied = false;
  private pendingString: { kind: "k" | "s"; parts: string[] } | undefined;

  feed(payload: string): void {
    if (!payload.endsWith("\n")) throw new Error("Checkpoint chunk token boundary is malformed.");
    const lines = payload.split("\n");
    lines.pop();
    for (const line of lines) {
      if (line.length === 0) throw new Error("Checkpoint chunk contains an empty token.");
      const token = JSON.parse(line) as Token;
      if (!Array.isArray(token)) throw new Error("Checkpoint token is malformed.");
      const [kind] = token;
      if (kind === "k" || kind === "s") {
        if (token.length !== 3 || typeof token[1] !== "string" || typeof token[2] !== "boolean") throw new Error("Checkpoint string token is malformed.");
        if (this.pendingString === undefined) this.pendingString = { kind, parts: [] };
        if (this.pendingString.kind !== kind) throw new Error("Checkpoint string token order is malformed.");
        this.pendingString.parts.push(token[1]);
        if (token[2]) {
          const value = this.pendingString.parts.join("");
          this.pendingString = undefined;
          if (kind === "k") {
            const parent = this.stack.at(-1);
            if (parent?.kind !== "object" || parent.key !== undefined || Object.hasOwn(parent.value, value)) throw new Error("Checkpoint key is misplaced or duplicated.");
            parent.key = value;
          } else this.attach(value);
        }
      } else {
        if (this.pendingString !== undefined) throw new Error("Checkpoint string is incomplete.");
        if (kind === "o" || kind === "a") {
          if (token.length !== 1) throw new Error("Checkpoint container token is malformed.");
          if (this.stack.length >= CHECKPOINT_MAX_DEPTH) throw new Error("Checkpoint nesting exceeds its supported bound.");
          const value = kind === "o" ? Object.create(null) as Record<string, unknown> : [] as unknown[];
          this.attach(value);
          this.stack.push({ kind: kind === "o" ? "object" : "array", value });
        } else if (kind === "e") {
          if (token.length !== 1) throw new Error("Checkpoint end token is malformed.");
          const frame = this.stack.pop();
          if (frame === undefined || frame.key !== undefined) throw new Error("Checkpoint container end is misplaced.");
        } else if (kind === "z" && token.length === 1) this.attach(null);
        else if (kind === "n" && token.length === 2 && typeof token[1] === "number" && Number.isFinite(token[1])) this.attach(token[1]);
        else if (kind === "b" && token.length === 2 && typeof token[1] === "boolean") this.attach(token[1]);
        else throw new Error("Checkpoint token is malformed.");
      }
    }
  }

  finish(): unknown {
    if (!this.supplied || this.stack.length !== 0 || this.pendingString !== undefined) throw new Error("Checkpoint token stream is incomplete.");
    return this.result;
  }

  private attach(value: unknown): void {
    const parent = this.stack.at(-1);
    if (parent === undefined) {
      if (this.supplied) throw new Error("Checkpoint has multiple root values.");
      this.result = value;
      this.supplied = true;
    } else if (parent.kind === "array") (parent.value as unknown[]).push(value);
    else {
      if (parent.key === undefined) throw new Error("Checkpoint object value has no key.");
      Object.defineProperty(parent.value, parent.key, { value, enumerable: true, writable: true, configurable: true });
      parent.key = undefined;
    }
  }
}

export function validate_checkpoint_chunk(chunk: unknown, descriptor: CheckpointChunkDescriptor): string {
  if (typeof chunk !== "object" || chunk === null || Array.isArray(chunk)) throw new Error("Checkpoint chunk is missing.");
  const value = chunk as Record<string, unknown>;
  if (Object.keys(value).length !== 2 || value.id !== descriptor.id || typeof value.payload !== "string") throw new Error("Checkpoint chunk identity is invalid.");
  if (value.payload.length > CHECKPOINT_CHUNK_MAX_BYTES) throw new Error("Checkpoint chunk exceeds its bound.");
  const bytes = encoder.encode(value.payload).byteLength;
  if (bytes !== descriptor.bytes || bytes > CHECKPOINT_CHUNK_MAX_BYTES || hosted_sha256(value.payload) !== descriptor.sha256) {
    throw new Error("Checkpoint chunk integrity is invalid.");
  }
  return value.payload;
}
