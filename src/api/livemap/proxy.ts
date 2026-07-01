// proxy.ts

import type { LiveMapCore, LiveMapProxy, LivePath, LivePathPart } from "./livemap.types.js";

const PROXY_METHODS = new Set<PropertyKey>(["$_"]);

export function make_livemap_proxy(core: LiveMapCore, path: LivePath = []): LiveMapProxy {
  const proxyPath = [...path];
  const target = Object.defineProperty({}, "$_", {
    configurable: true,
    enumerable: false,
    value: undefined,
    writable: false,
  });

  return new Proxy(target, {
    get: (_target, property) => {
      if (property === "$_") return core.at(proxyPath);

      if (typeof property === "symbol") return undefined;

      return make_livemap_proxy(core, [...proxyPath, proxy_property_to_path_part(property)]);
    },
    has: (_target, property) => PROXY_METHODS.has(property),
    ownKeys: () => [...PROXY_METHODS] as string[],
    getOwnPropertyDescriptor: (_target, property) => {
      if (!PROXY_METHODS.has(property)) return undefined;

      return Object.getOwnPropertyDescriptor(_target, property);
    },
    set: () => {
      throw new Error("LiveMap proxy values must be changed through $_.");
    },
    deleteProperty: () => {
      throw new Error("LiveMap proxy values must be deleted through $_.");
    },
  }) as LiveMapProxy;
}

function proxy_property_to_path_part(property: string): LivePathPart {
  if (/^(0|[1-9]\d*)$/.test(property)) return Number(property);

  return property;
}