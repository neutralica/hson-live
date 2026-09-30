import type { LocusActionPayloads } from "../../types/locus.types.js";
import type { EchoEndpointTransport } from "../../types/echo.transport.types.js";
export type { EchoFiniteOperationOutcome } from "../../types/echo.transport.types.js";

/** The finite semantic capability consumed by Echo endpoint state. */
export type EchoFiniteOperationCapability<TActions extends LocusActionPayloads = LocusActionPayloads> =
  EchoEndpointTransport<TActions>["operations"];
