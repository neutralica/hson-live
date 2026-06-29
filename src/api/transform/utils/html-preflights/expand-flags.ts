// expand-flags.ts

/*******
 * Expand boolean/flag-style attributes into explicit key="key" values.
 *
 * Behavior:
 * - Scans only tag headers (`<tag ...>` and `<tag ... />`).
 * - For attributes without a value (e.g. `disabled`), rewrites them to
 *   `disabled="disabled"`.
 * - Attributes that already have values are left unchanged.
 * - End tags, comments, and doctypes are not modified.
 *
 * This keeps downstream XML-ish parsers happy by ensuring attributes always
 * have an explicit value while preserving HTML boolean semantics.
 *
 * @param input - Markup string containing tag attributes.
 * @returns Markup with flag-style attributes expanded to key="key".
 *******/
export function expand_flags(input: string): string {
    /* regex finds opening tags (<tag ...>) or self-closing tags (<tag ... />)
          captures: 1=tagName, 2=attributes string, 3=self-closing slash (optional) */
    const tagRegex = /<([a-zA-Z0-9:_-]+)((?:\s+[a-zA-Z_:][a-zA-Z0-9:_.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^>\s/]*))?)*\s*)(\/?)>/g;

    return input.replace(tagRegex, (fullMatch, tagName, attrsStr, selfCloseSlash) => {
        /*  attrsStr now contains only the attribute part of the tag, e.g., ' id="x" class="y" disabled'
            - regex finds individual attributes within the attribute string
            - looks for whitespace, then attribute name, then optionally captures the =value part
            - captures: 1=attrName, 2=value part (including = and quotes/value), if present */
        const attrParseRegex = /\s+([a-zA-Z_:][a-zA-Z0-9:_.-]+)(\s*=\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^>\s/]*))?/g;

        let newAttrsStr = ''; /* Accumulator for the processed attribute string */
        let lastIndex = 0; /* tracks position within the original attrsStr */
        let match;

        /* use regex.exec() to iterate through all attributes found in attrsStr */
        while ((match = attrParseRegex.exec(attrsStr)) !== null) {
            const attrName = match[1];
            const valuePart = match[2]; /* undefined if no '=' or value was found after the name */

            /* append the portion of the string between the last attribute and this one (usually whitespace) */
            newAttrsStr += attrsStr.substring(lastIndex, match.index);

            if (valuePart === undefined) {
                /* no value was present after the attribute name. assume it's a flag */
                newAttrsStr += ` ${attrName}="${attrName}"`;

            } else {
               /* attribute already had a value (=value or ="value" or ='value')
                    append the name and the captured value part exactly as they were found */
                newAttrsStr += ` ${attrName}${valuePart}`;
            }
            /* update lastIndex to the end of the current match */
            lastIndex = attrParseRegex.lastIndex;
        }

        /* append any remaining whitespace or characters from the end of the original attrsStr */
        newAttrsStr += attrsStr.substring(lastIndex);

      /* reconstruct the tag with the modified attribute string */
        return `<${tagName}${newAttrsStr}${selfCloseSlash || ''}>`; /* add back self-closing slash */
    });
}
