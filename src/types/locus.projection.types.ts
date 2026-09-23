import type { LocusConnectionContext } from "./locus.protocol.types.js";

/** Hosted deployment policy for one application library. Never part of Hson or a Schema. */
export type LocusLibraryExposure = "server-private" | "client-public";

/** An entry list makes duplicate and conflicting classifications detectable. */
export type LocusExposureEntry = Readonly<{
  library: string;
  exposure: LocusLibraryExposure;
}>;

export type LocusProjectionSystemFeature = "interactions";

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
