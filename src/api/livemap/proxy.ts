// proxy.ts

import type { LiveMapCore, LiveMapProxy, LivePath, LivePathPart } from "./livemap.types.js";


const PROXY_METHODS = new Set<PropertyKey>(["$_"]);
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

export function make_livemap_proxy(core: LiveMapCore, path: LivePath = []): LiveMapProxy {
  const proxyPath = [...path];
  const target = Object.defineProperty(Object.create(null), "$_", {
    configurable: true,
    enumerable: false,
    value: undefined,
    writable: false,
  });

  return new Proxy(target, {
    get: (_target, property) => {
      if (property === "$_") return core.at(proxyPath);

      if (typeof property === "symbol") return undefined;
      if (PROXY_RESERVED_PROPERTIES.has(property)) return undefined;

      return make_livemap_proxy(core, [...proxyPath, proxy_property_to_path_part(property)]);
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
  }) as LiveMapProxy;
}

function proxy_property_to_path_part(property: string): LivePathPart {
  if (/^(0|[1-9]\d*)$/.test(property)) {
    const numericProperty = Number(property);
    if (Number.isSafeInteger(numericProperty)) return numericProperty;
  }

  return property;
}