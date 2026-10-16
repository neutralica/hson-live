import type { LiveMapSnapshot } from "../../types/livemap.types.js";

/** Internal QUID-free semantic cut for aggregate composition. */
export type PortableAggregateSnapshot = Readonly<Omit<LiveMapSnapshot, "format" | "libraries"> & {
  format: "hson-portable-aggregate-snapshot";
  /** Private Cut 3F content extension; ordinary snapshot admission rejects it. */
  libraries: readonly (LiveMapSnapshot["libraries"][number] & Readonly<{
    /** @internal */
    scopes?: import("./livemap.document.scoped-quad-codec.js").DocumentScopedQuadRecord;
  }>)[];
  authority: Readonly<{ logicalMapId: string; incarnationId: string }>;
}>;
