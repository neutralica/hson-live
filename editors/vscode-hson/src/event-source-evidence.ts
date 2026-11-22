import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { HsonEventImportEvidence } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";

export type EventSourceEvidence = Readonly<{
  fileName: string;
  textHash: string;
  importOffsets: readonly number[];
}>;

export type EventSourceConfiguration = Readonly<{
  sessionId: string;
  revision: number;
}> & (Readonly<{ discoveryId: string; eventSources: readonly ConfiguredEventSource[] }>
  | Readonly<{ retainedEventSources: readonly ConfiguredEventSource[] }>);

export type ConfiguredEventSource = EventSourceEvidence & Readonly<{ owners: readonly string[] }>;

export function event_source_text_hash(text: string): string {
  return createHash("sha256").update(text, "utf16le").digest("hex");
}

export const NO_EVENT_IMPORTS: ReadonlySet<number> = new Set();

/** Rebind the workspace's proof to the exact text used by each consumer. */
export function event_source_imports(sources: readonly EventSourceEvidence[], caseSensitive: boolean): HsonEventImportEvidence {
  const key = (fileName: string) => caseSensitive ? resolve(fileName) : resolve(fileName).toLowerCase();
  const entries = new Map<string, { textHash: string; imports: ReadonlySet<number>; checked?: string }>(sources.map(source => [key(source.fileName), {
    textHash: source.textHash, imports: new Set(source.importOffsets),
  }]));
  return (fileName, text) => {
    const source = entries.get(key(fileName));
    if (source === undefined) return NO_EVENT_IMPORTS;
    if (source.checked !== text) {
      if (event_source_text_hash(text) !== source.textHash) return NO_EVENT_IMPORTS;
      source.checked = text;
    }
    return source.imports;
  };
}
