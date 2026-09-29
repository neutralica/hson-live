declare const BROWSER_REALIZATION_HTML: unique symbol;

/**
 * HTML produced by the browser-realization composition path.
 *
 * The brand distinguishes this parser-compatible output from Hson transport
 * HTML. It makes no sanitization, trust, XSS, CSP, or authentication claim.
 */
export type BrowserRealizationHtml = string & Readonly<{
  [BROWSER_REALIZATION_HTML]: true;
}>;
