import type { LocusConnectionContext } from "./locus.protocol.types.js";
import type { LiveMapRootMode } from "./livemap.types.js";

/** Deployment ownership for one application library. Never part of Hson or a Schema. */
export type LocusLibraryOwnership = "private" | "shared" | "local";

/** One explicit application-catalog entry. Local initializers never enter `locus.map`. */
export type LocusLibraryCatalogEntry =
  | Readonly<{
    name: string;
    ownership: "private" | "shared";
    /** Initial authority state for Locus-owned construction. Omit when adopting a map. */
    definition?: import("./livemap.types.js").LiveMapLibraryDefinition;
    initializer?: never;
    /** Initial document stylesheet; valid only for a document definition. */
    css?: import("./document-css.types.js").DocumentCssRecord;
  }>
  | Readonly<{
    name: string;
    ownership: "local";
    initializer: import("./livemap.types.js").LiveMapLibraryDefinition;
    /** Initial document stylesheet. Invalid for data initializers. */
    css?: import("./document-css.types.js").DocumentCssRecord;
  }>;

/** Canonical, portable, session-authorized initializer definition. */
export type LocusLocalInitializer = Readonly<{
  name: string;
  mode: LiveMapRootMode;
  schema: import("../api/transform/transform.types.js").HsonSchemaData;
  schemaDigest: string;
  rootCodec: "hson-exact-value";
  root: Readonly<{ format: "hson-exact-value"; payload: string }>;
  css?: import("./document-css.types.js").DocumentCssRecord;
  fingerprint: string;
}>;

export type LocusProjectionSystemFeature = "interactions";

/** Portable authority half of a composed client LiveMap; local libraries are separate. */
export type AuthorityProjectionSnapshot = Readonly<{
  format: "hson-authority-projection-snapshot";
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
  systemFeatures: readonly LocusProjectionSystemFeature[];
  writableDocuments: readonly string[];
  system: Readonly<{ interactions: Readonly<{ format: "hson-exact-value"; payload: string }> }> | null;
}>;

/** Libraries and system features requested for one authorized client scope. */
export type LocusRequestedProjection = Readonly<{
  libraries: readonly string[];
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
