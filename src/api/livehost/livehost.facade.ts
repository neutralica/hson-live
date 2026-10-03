import { is_browser_html_producer, type BrowserHtmlProducer } from "../../internal/browser-html-producer.js";
import type { LiveHost, LiveHostApplication, LiveHostHttpMethod, LiveHostRequestRoute } from "../../types/livehost.types.js";

type ResponseHandler = LiveHostRequestRoute["handle"];
type HtmlProducer = BrowserHtmlProducer;
type RequestHandler = ResponseHandler | HtmlProducer;
type RequestTuple = readonly [path: string, handle: RequestHandler];

function is_request_handler(value: unknown): value is RequestHandler {
  return typeof value === "function";
}

function is_request_tuple(value: unknown): value is RequestTuple {
  return Array.isArray(value) && typeof value[0] === "string" && is_request_handler(value[1]);
}

export type LiveHostCreateInput = Omit<LiveHostApplication, "dispose"> &
  Partial<Pick<LiveHostApplication, "dispose">>;

/** An ordinary application with pre-bind authoring operations. */
function request_route(method: string, path: string, handler: RequestHandler): LiveHostRequestRoute {
  if (is_browser_html_producer(handler)) {
    return {
      method, path,
      handle() {
        return new Response(handler(), { headers: { "content-type": "text/html; charset=utf-8" } });
      },
    };
  }
  return { method, path, handle: handler };
}

function http_method(method: string, destination?: LiveHostRequestRoute[]): LiveHostHttpMethod {
  function construct(path: string, handle: ResponseHandler): LiveHostRequestRoute;
  function construct(path: string, render: HtmlProducer): LiveHostRequestRoute;
  function construct(route: RequestTuple, ...routes: readonly RequestTuple[]): readonly LiveHostRequestRoute[];
  function construct(...args: unknown[]): LiveHostRequestRoute | readonly LiveHostRequestRoute[] {
    if (typeof args[0] === "string") {
      if (!is_request_handler(args[1])) throw new TypeError("LiveHost route handler must be a function.");
      const route = request_route(method, args[0], args[1]);
      destination?.push(route);
      return route;
    }
    const routes = args.map((entry) => {
      if (!is_request_tuple(entry)) throw new TypeError("LiveHost grouped route must be a [path, handler] tuple.");
      return request_route(method, entry[0], entry[1]);
    });
    destination?.push(...routes);
    return routes;
  }
  return construct;
}

function create(input: LiveHostCreateInput): LiveHost {
  const requests = [...(input.requests ?? [])];
  const ready = input.ready?.bind(input);
  const dispose = input.dispose?.bind(input) ?? (() => undefined);
  return {
    name: input.name,
    requests,
    ...(input.connections === undefined ? {} : { connections: [...input.connections] }),
    ...(ready === undefined ? {} : { ready }),
    dispose,
    add(...routes) { requests.push(...routes); },
    GET: http_method("GET", requests),
    POST: http_method("POST", requests),
    PUT: http_method("PUT", requests),
    DELETE: http_method("DELETE", requests),
  };
}

export const hsonLiveHost = Object.freeze({
  create,
});
