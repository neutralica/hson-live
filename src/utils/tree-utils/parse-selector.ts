// parse-selector.ts

import { HsonQuery } from "../../types/livetree.types";


/**
 * Parse a *simple* CSS selector string into an `HsonQuery`.
 *
 * Supported selector features (intentionally limited):
 * - Tag selectors:        `div`, `span`
 * - ID selectors:         `#main`
 * - Class selectors:      `.item` (multiple classes are space-joined)
 * - Attribute equality:   `[type="button"]`
 * - Attribute presence (`[disabled]`) is currently ignored.
 *
 * Explicit non-goals (by design):
 * - No combinators (`>`, `+`, `~`, whitespace)
 * - No pseudo-classes / pseudo-elements
 * - No namespaces, escaping, or selector lists
 *
 * Semantics:
 * - The first leading tag name (if present) becomes `query.tag`
 * - `#id` maps to `attrs.id`
 * - `.class` values accumulate into a single space-delimited `attrs.class`
 * - `[attr="value"]` sets `attrs[attr] = value`
 * - Bare `[attr]` does not add a constraint (presence checks are not represented)
 *
 * This parser is intended for HSON’s internal querying needs, not as a
 * general-purpose CSS selector engine.
 *
 * @param selector - A simple selector string (e.g. `div#app.item[data-x="1"]`)
 * @returns A normalized `HsonQuery` object
 */
export function parse_selector(selector: string): HsonQuery {
    const query: HsonQuery = { attrs: {} };

    /* regular expression matches the parts of a selector */
    const tagRegex = /^[a-zA-Z0-9]+/;
    const idRegex = /#([a-zA-Z0-9_-]+)/g;
    const classRegex = /\.([a-zA-Z0-9_-]+)/g;
    const attrRegex = /\[([a-zA-Z0-9_-]+)(?:="([^"]+)")?\]/g;

    /* extract tag name */
    const tagMatch = selector.match(tagRegex);
    if (tagMatch) {
        query.tag = tagMatch[0];
    }

    /* extract id */
    let match;
    while ((match = idRegex.exec(selector)) !== null) {
        query.attrs!.id = match[1];
    }

    /* extract classList */
    while ((match = classRegex.exec(selector)) !== null) {
        query.attrs!.class = ((query.attrs!.class || '') + ' ' + match[1]).trim();
    }

    /* extract attrs & flags */
    while ((match = attrRegex.exec(selector)) !== null) {
        const [, key, value] = match;
        if (value !== undefined) {
            query.attrs![key] = value;/* [attr="value"] */
        }
    }

    return query;
}
