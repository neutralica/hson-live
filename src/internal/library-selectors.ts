import { assert_hson_identifier_name } from "../core/hson-name.js";
import { hson_schema_digest, type HsonSchema } from "../api/schema/hson-schema.js";

/** A current binding resolved by its existing authority; never a second registry. @internal */
export type FamilySelection<T> = Readonly<{
  family: "doc" | "data" | "parts";
  schema: HsonSchema;
  handle: T;
}>;

/** Shared family checks and JavaScript protocol behavior for every owner. @internal */
export function make_family_selectors<T>(resolve: (name: string) => FamilySelection<T> | undefined) {
  const family = (expected: FamilySelection<T>["family"]) => {
    function lookup(name: string, schema: HsonSchema | undefined, required: true): T;
    function lookup(name: string, schema?: HsonSchema): T | undefined;
    function lookup(name: string, schema?: HsonSchema, required = false): T | undefined {
      if (typeof name !== "string") throw new TypeError("Library selection requires a string name.");
      assert_hson_identifier_name(name, "Library");
      // The existing Schema authority rejects forged handles, including prototype spoofs.
      const digest = schema === undefined ? undefined : hson_schema_digest(schema);
      const selected = resolve(name);
      if (selected === undefined) {
        if (required) throw new Error(`Unknown LiveMap Library ${JSON.stringify(name)}.`);
        return undefined;
      }
      if (selected.family !== expected) {
        if (required) throw new Error(`Library ${JSON.stringify(name)} has family ${selected.family}; expected ${expected}.`);
        return undefined;
      }
      if (digest !== undefined && digest !== hson_schema_digest(selected.schema)) {
        if (required) throw new Error(`Library ${JSON.stringify(name)} governing Schema does not match the supplied Schema.`);
        return undefined;
      }
      return selected.handle;
    }
    const must = (name: string, schema?: HsonSchema): T => lookup(name, schema, true);
    const target = Object.freeze(Object.assign(function (name: string, schema?: HsonSchema) {
      return lookup(name, schema);
    }, { must }));
    return new Proxy(target, {
      get(target, key, receiver) {
        // Preserve function/Object intrinsics and Proxy invariants. Protocol probes
        // never resolve Libraries; colliding persisted names remain callable.
        if (key === "then" || key === "toJSON") return undefined;
        if (typeof key !== "string" || Reflect.has(target, key)) return Reflect.get(target, key, receiver);
        return must(key);
      },
    });
  };
  return { doc: family("doc"), data: family("data"), parts: family("parts") };
}
