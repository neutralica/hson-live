// proxy.ts

import type { JsonValue } from "../../core/types.js";
import type { LiveMapCore, LiveMapPathHandle, LiveMapPathValue, LiveMapProxy, LivePath, LivePathPart } from "../../types/livemap.types.js";


const PROXY_METHODS = new Set<PropertyKey>(["$_"]);

type DocumentProxyLocation = Readonly<{
  at: (path: readonly number[]) => DocumentProxyLocation;
}>;

type DocumentProxy<TLocation extends DocumentProxyLocation> = Readonly<{
  readonly $_: TLocation;
  readonly [index: number]: DocumentProxy<TLocation>;
}>;

/**
 * JavaScript runtimes, debuggers, serializers, and Promise machinery commonly
 * probe implicitly. These reads must remain inert: they must not create child
 * proxies, mutate state, or make the proxy appear Promise-like.
 *
 * Data with these names is still reachable through `proxy.$_.object.getKey(...)`.
 */
const PROXY_RESERVED_PROPERTIES = new Set<PropertyKey>([
  "then",
  "catch",
  "finally",
  "toJSON",
  "toString",
  "valueOf",
  "inspect",
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);
/**
 * Build a path-projection proxy over a LiveMap core.
 *
 * Property access extends the data path only. Mutations intentionally go
 * through `$_`, so proxy writes keep the same contract as path handles:
 *
 * - `proxy.user.$_.set(...)` uses LiveMap `set` semantics.
 * - `proxy.user.$_.setMany(...)` writes child fields under an object path.
 * - `proxy.user.$_.replace(...)` destructively replaces the endpoint.
 * - `proxy.user.$_.delete()` deletes the resolved endpoint.
 *
 * Direct assignment and `delete proxy.foo` are rejected so JavaScript property
 * semantics do not bypass LiveMap validation, schema checks, or commit events.
 */
export function make_livemap_proxy<TValue = JsonValue | undefined, TPath extends LivePath = []>(
  core: LiveMapCore<TValue>,
  path: TPath = [] as unknown as TPath,
): LiveMapProxy<TValue, TPath> {
  const proxyPath = [...path] as LivePath;
  let pathHandle: LiveMapPathHandle<LiveMapPathValue<TValue, TPath>> | undefined;
  return make_location_proxy(
    () => pathHandle ??= core.at(path as LivePath) as unknown as LiveMapPathHandle<LiveMapPathValue<TValue, TPath>>,
    (part) => make_livemap_proxy<TValue, [...TPath, LivePathPart]>(
      core,
      [...proxyPath, part] as [...TPath, LivePathPart],
    ),
    proxy_property_to_path_part,
  ) as LiveMapProxy<TValue, TPath>;
}

/** Build the document-mode form of the existing location proxy vocabulary. */
export function make_livemap_document_proxy<TLocation extends DocumentProxyLocation>(
  location: TLocation,
): DocumentProxy<TLocation> {
  return make_location_proxy(
    () => location,
    (part) => make_livemap_document_proxy(location.at([part]) as TLocation),
    document_proxy_property_to_index,
  ) as DocumentProxy<TLocation>;
}

function make_location_proxy<TLocation, TPart extends LivePathPart>(
  location: () => TLocation,
  child: (part: TPart) => unknown,
  propertyToPart: (property: string) => TPart | undefined,
): unknown {
  /**
   * `$_` is a real own property, not only a synthetic trap result. That keeps
   * `ownKeys` / descriptor reflection inside Proxy invariants, including under
   * stricter runtime reflection.
   *
   * The null prototype prevents inherited Object methods from appearing on the
   * path-builder target.
   */
  const target = Object.defineProperty(Object.create(null), "$_", {
    configurable: true,
    enumerable: false,
    value: undefined,
    writable: false,
  });

  /**
   * Cache child proxies so repeated property access is identity-stable:
   * `proxy.user === proxy.user`.
   */
  const childProxies = new Map<string, unknown>();

  return new Proxy(target, {
    get: (_target, property) => {
      if (property === "$_") {
        return location();
      }

      if (typeof property === "symbol") return undefined;
      if (PROXY_RESERVED_PROPERTIES.has(property)) return undefined;

      const childPathPart = propertyToPart(property);
      if (childPathPart === undefined) return undefined;
      const childProxyKey = typeof childPathPart === "number" ? `#${childPathPart}` : `$${childPathPart}`;
      const existingChildProxy = childProxies.get(childProxyKey);
      if (existingChildProxy !== undefined) return existingChildProxy;

      const childProxy = child(childPathPart);
      childProxies.set(childProxyKey, childProxy);
      return childProxy;
    },
    has: (_target, property) => PROXY_METHODS.has(property),
    ownKeys: () => [...PROXY_METHODS] as string[],
    getOwnPropertyDescriptor: (_target, property) => {
      if (!PROXY_METHODS.has(property)) return undefined;

      return Object.getOwnPropertyDescriptor(_target, property);
    },
    getPrototypeOf: () => null,
    set: () => {
      throw new Error("LiveMap proxy values must be changed through $_.");
    },
    deleteProperty: () => {
      throw new Error("LiveMap proxy values must be deleted through $_.");
    },
    defineProperty: () => {
      throw new Error("LiveMap proxy properties must not be defined directly.");
    },
    setPrototypeOf: () => {
      throw new Error("LiveMap proxy prototype must not be changed.");
    },
    preventExtensions: () => {
      throw new Error("LiveMap proxy extensibility must not be changed.");
    },
  });
}

/**
 * Convert canonical non-negative integer property names into array-index path
 * parts. Unsafe integers remain string keys to avoid precision loss.
 */
function proxy_property_to_path_part(property: string): LivePathPart {
  if (/^(0|[1-9]\d*)$/.test(property)) {
    const numericProperty = Number(property);
    if (Number.isSafeInteger(numericProperty)) return numericProperty;
  }

  return property;
}

/** Document structure admits only canonical non-negative safe integer properties. */
function document_proxy_property_to_index(property: string): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(property)) return undefined;
  const numericProperty = Number(property);
  return Number.isSafeInteger(numericProperty) ? numericProperty : undefined;
}
