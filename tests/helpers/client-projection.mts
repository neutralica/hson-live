import type { AuthorityProjectionSnapshot } from "../../src/types/locus.projection.types.ts";
import type { LiveMapInput } from "../../src/types/livemap.types.ts";
import { compose_client_projection_internal } from "../../src/api/echo/echo.projection.ts";
import { make_locus_application_catalog } from "../../src/api/locus/locus.local-initializer.ts";
import { hsonLiveMap } from "../../src/api/livemap/livemap.facade.ts";

/** Internal invariant seam for projection, partition, and reconciliation tests. */
export function client_projection_map(input: Readonly<{
  authority: AuthorityProjectionSnapshot;
  local: LiveMapInput;
}>) {
  const catalog = make_locus_application_catalog(hsonLiveMap.create(), Object.entries(input.local).map(([name, initializer]) =>
    Object.freeze({ name, ownership: "local" as const, initializer })));
  return compose_client_projection_internal(input.authority, Object.freeze([...catalog.local.values()]));
}

/** Canonical local definitions for low-level transport partition tests. */
export function local_initializers(input: LiveMapInput) {
  const catalog = make_locus_application_catalog(hsonLiveMap.create(), Object.entries(input).map(([name, initializer]) =>
    Object.freeze({ name, ownership: "local" as const, initializer })));
  return Object.freeze([...catalog.local.values()]);
}
