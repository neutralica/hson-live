/** Private D1 development hook; never exported from public hson-live APIs. */
export type TrustedSchemaDevRegistration = Readonly<{
  id: string;
  schema: object;
  origin: unknown;
}>;

const REGISTRATIONS = new Map<string, TrustedSchemaDevRegistration>();

export function register_trusted_schema_for_development(id: string, schema: object, origin: unknown): TrustedSchemaDevRegistration {
  if (!id || (typeof schema !== "object" && typeof schema !== "function") || schema === null) {
    throw new TypeError("Trusted Schema development registration requires an id and an actual Schema object.");
  }
  const registration = Object.freeze({ id, schema, origin });
  REGISTRATIONS.set(id, registration);
  return registration;
}

export function consume_trusted_schema_development_registrations(): readonly TrustedSchemaDevRegistration[] {
  const registrations = [...REGISTRATIONS.values()];
  REGISTRATIONS.clear();
  return Object.freeze(registrations);
}
