import type { LiveMapSnapshot } from "../../types/livemap.types.js";

/** Internal QUID-free semantic cut for aggregate composition. */
export type PortableAggregateSnapshot = Readonly<Omit<LiveMapSnapshot, "format"> & {
  format: "hson-portable-aggregate-snapshot-v2";
  authority: Readonly<{ logicalMapId: string; incarnationId: string }>;
}>;
