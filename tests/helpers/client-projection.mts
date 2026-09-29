import type { AuthorityProjectionSnapshot } from "../../src/types/locus.projection.types.ts";
import type { LiveMapInput } from "../../src/types/livemap.types.ts";
import { compose_client_projection_internal } from "../../src/api/echo/echo.projection.ts";

/** Internal invariant seam for projection, partition, and reconciliation tests. */
export function client_projection_map(input: Readonly<{
  authority: AuthorityProjectionSnapshot;
  localLibraries: LiveMapInput;
}>) {
  return compose_client_projection_internal(input.authority, input.localLibraries);
}
