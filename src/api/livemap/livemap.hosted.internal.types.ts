import type { LiveMapLibrariesSnapshot } from "../../types/livemap.types.js";

/** Internal QUID-free semantic cut for aggregate composition. */
export type PortableAggregateSnapshot = Readonly<Omit<LiveMapLibrariesSnapshot, "format"> & {
  format: "hson-portable-aggregate-snapshot-v1";
  authority: Readonly<{ logicalMapId: string; incarnationId: string }>;
}>;
