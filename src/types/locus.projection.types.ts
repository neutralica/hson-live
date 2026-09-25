import type { LocusConnectionContext } from "./locus.protocol.types.js";
import type { LiveMapRootMode } from "./livemap.types.js";

/** Hosted deployment policy for one application library. Never part of Hson or a Schema. */
export type LocusLibraryExposure = "server-private" | "client-public";

/** An entry list makes duplicate and conflicting classifications detectable. */
export type LocusExposureEntry = Readonly<{
  library: string;
  exposure: LocusLibraryExposure;
}>;

export type LocusProjectionSystemFeature = "interactions";

/** Portable authority half of a composed client LiveMap; local libraries are separate. */
export type AuthorityProjectionSnapshot = Readonly<{
  format: "hson-authority-projection-snapshot-v2";
  authority: Readonly<{ logicalMapId: string; incarnationId: string }>;
  revision: number;
  projectionDigest: string;
  libraries: readonly Readonly<{
    name: string;
    mode: LiveMapRootMode;
    schema: import("../api/transform/transform.types.js").HsonSchemaData;
    schemaDigest: string;
    rootCodec: "hson-exact-value";
    root: Readonly<{ format: "hson-exact-value"; payload: string }>;
    css?: import("./document-css.types.js").DocumentCssRecord;
  }>[];
  htmlDocument: string | null;
  systemFeatures: readonly LocusProjectionSystemFeature[];
  writableDocuments: readonly string[];
  system: Readonly<{ interactions: Readonly<{ format: "hson-exact-value"; payload: string }> }> | null;
}>;

/** An explicit request; selecting an HTML document also requests that library. */
export type LocusRequestedProjection = Readonly<{
  libraries: readonly string[];
  htmlDocument?: string;
  systemFeatures?: readonly LocusProjectionSystemFeature[];
}>;

export type LocusProjectionAuthorizationContext = Readonly<{
  requested: LocusRequestedProjection;
  logicalMapId: string;
  incarnationId: string;
  connection?: LocusConnectionContext;
}>;

/** Read and built-in document-write grants are independent. Omitted grants deny. */
export type LocusProjectionAuthorization = Readonly<{
  libraries?: readonly string[];
  systemFeatures?: readonly LocusProjectionSystemFeature[];
  writableDocuments?: readonly string[];
}>;

export type LocusProjectionAuthorizer = (
  context: LocusProjectionAuthorizationContext,
) => LocusProjectionAuthorization | Promise<LocusProjectionAuthorization>;
