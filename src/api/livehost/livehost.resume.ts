// livehost.resume.ts

import type { JsonValue } from "../../core/types.js";
import type { LiveMapStructuralJsonEnvelope, LivePath } from "../../types/livemap.types.js";
import type { LiveHostSeq, LiveHostServerSyncMessage } from "../../types/livehost.types.js";

export type LiveHostResumeEntry = Readonly<{
  seq: LiveHostSeq;
  path: LivePath;
  value: JsonValue | undefined;
}> & Partial<LiveMapStructuralJsonEnvelope>;

export type LiveHostResumeLog = Readonly<{
  record_sync: (message: LiveHostServerSyncMessage) => void;
  replay_after: (seq: LiveHostSeq) => readonly LiveHostServerSyncMessage[];
  can_replay_after: (seq: LiveHostSeq) => boolean;
  debug_entries: () => readonly LiveHostResumeEntry[];
}>;

export type LiveHostResumeLogOptions = Readonly<{
  maxEntries?: number;
}>;

function clone_json_value<TValue>(value: TValue): TValue {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as TValue;
}

function clone_live_path(path: LivePath): LivePath {
  return [...path];
}

function clone_entry(entry: LiveHostResumeEntry): LiveHostResumeEntry {
  return Object.freeze({
    seq: entry.seq,
    path: clone_live_path(entry.path),
    value: clone_json_value(entry.value),
    ...transport_fields(entry),
  });
}

function sync_message_from_entry(entry: LiveHostResumeEntry): LiveHostServerSyncMessage {
  return {
    type: "sync",
    seq: entry.seq,
    path: clone_live_path(entry.path),
    value: clone_json_value(entry.value),
    ...transport_fields(entry),
  };
}

export function make_livehost_resume_log(options: LiveHostResumeLogOptions = {}): LiveHostResumeLog {
  const maxEntries = Math.max(0, Math.trunc(options.maxEntries ?? 100));
  const entries: LiveHostResumeEntry[] = [];

  function record_sync(message: LiveHostServerSyncMessage): void {
    if (maxEntries === 0) return;

    entries.push(Object.freeze({
      seq: message.seq,
      path: clone_live_path(message.path),
      value: clone_json_value(message.value),
      ...transport_fields(message),
    }));

    while (entries.length > maxEntries) entries.shift();
  }

  function replay_after(seq: LiveHostSeq): readonly LiveHostServerSyncMessage[] {
    return entries
      .filter((entry) => entry.seq > seq)
      .map(sync_message_from_entry);
  }

  function can_replay_after(seq: LiveHostSeq): boolean {
    if (!entries.length) return true;
    return seq >= entries[0].seq - 1;
  }

  function debug_entries(): readonly LiveHostResumeEntry[] {
    return entries.map(clone_entry);
  }

  return Object.freeze({
    record_sync,
    replay_after,
    can_replay_after,
    debug_entries,
  });
}

function transport_fields(
  value: Partial<LiveMapStructuralJsonEnvelope>,
): Partial<LiveMapStructuralJsonEnvelope> {
  const transportPresent = Object.hasOwn(value, "format")
    || Object.hasOwn(value, "formatVersion")
    || Object.hasOwn(value, "payload");
  if (!transportPresent) return Object.freeze({});
  if (value.format !== "structural-json"
    || value.formatVersion !== 1
    || typeof value.payload !== "string") {
    throw new Error("LiveHost resume sync has an invalid exact transport envelope.");
  }
  return Object.freeze({ format: value.format, formatVersion: value.formatVersion, payload: value.payload });
}
