import type { BrowserRealizationHtml } from "../api/ssr/ssr.types.js";

// Function identity carries the runtime meaning; the HTML value remains a string.
const producers = new WeakSet<object>();
declare const BROWSER_HTML_PRODUCER: unique symbol;

export type BrowserHtmlProducer = (() => BrowserRealizationHtml) & Readonly<{
  [BROWSER_HTML_PRODUCER]: true;
}>;

export function mark_browser_html_producer<T extends () => BrowserRealizationHtml>(producer: T): T & BrowserHtmlProducer {
  producers.add(producer);
  if (!is_browser_html_producer(producer)) throw new Error("Browser HTML producer marking failed.");
  return producer;
}

export function is_browser_html_producer(value: unknown): value is BrowserHtmlProducer {
  return typeof value === "function" && producers.has(value);
}
