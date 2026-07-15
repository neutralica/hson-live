/**
 * Guard a cached API namespace on every property access and method call.
 * Plain-object sub-surfaces are wrapped recursively; host objects and DOM/class
 * return values are left intact.
 */
export function guard_api_surface<T extends object>(
  surface: T,
  guard: () => void,
  exempt?: object,
): T {
  const cache = new WeakMap<object, object>();

  const wrap = (value: unknown, receiver?: object): unknown => {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) {
      return value;
    }
    if (value === exempt) return value;

    if (typeof value === "function") {
      const callable = function guarded_call(this: unknown, ...args: unknown[]): unknown {
        guard();
        const result = Reflect.apply(value, receiver ?? this, args);
        return is_plain_object(result) ? wrap(result) : result;
      };
      return new Proxy(callable, {
        get(_target, property): unknown {
          guard();
          return wrap(Reflect.get(value, property, value), value);
        },
      });
    }

    const cached = cache.get(value);
    if (cached) return cached;

    // Use an empty facade with the same prototype. This preserves dynamic Proxy
    // getters while avoiding frozen-property Proxy invariants.
    const facade = Object.create(Object.getPrototypeOf(value)) as object;
    const proxy = new Proxy(facade, {
      get(_target, property): unknown {
        guard();
        return wrap(Reflect.get(value, property, value), value);
      },
      ownKeys(): ArrayLike<string | symbol> {
        guard();
        return Reflect.ownKeys(value);
      },
      getOwnPropertyDescriptor(_target, property): PropertyDescriptor | undefined {
        guard();
        const descriptor = Reflect.getOwnPropertyDescriptor(value, property);
        return descriptor ? { ...descriptor, configurable: true } : undefined;
      },
    });
    cache.set(value, proxy);
    return proxy;
  };

  return wrap(surface) as T;
}

function is_plain_object(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
