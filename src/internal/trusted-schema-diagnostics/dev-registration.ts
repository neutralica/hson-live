import type { TrustedSchemaSourceBinding } from "./protocol.js";
/** Private D1 development hook; never exported from public hson-live APIs. */
export type TrustedSchemaDevRegistration = Readonly<{
  id: string;
  schema: object;
  origin: unknown;
  sourceBinding?: TrustedSchemaSourceBinding;
}>;

// Keep conflicting evidence. A Map keyed only by id silently lost ambiguity.
const REGISTRATIONS: TrustedSchemaDevRegistration[] = [];

export function register_trusted_schema_for_development(id: string, schema: object, origin: unknown, sourceBinding?: TrustedSchemaSourceBinding): TrustedSchemaDevRegistration {
  if (!id || (typeof schema !== "object" && typeof schema !== "function") || schema === null) {
    throw new TypeError("Trusted Schema development registration requires an id and an actual Schema object.");
  }
  const registration = Object.freeze({ id, schema, origin, sourceBinding: sourceBinding === undefined ? undefined : Object.freeze({ ...sourceBinding }) });
  REGISTRATIONS.push(registration);
  return registration;
}

export function consume_trusted_schema_development_registrations(): readonly TrustedSchemaDevRegistration[] {
  const registrations = [...REGISTRATIONS];
  REGISTRATIONS.length = 0;
  return Object.freeze(registrations);
}
