import { parse_complete_css_list } from "./complete-list.js";
import { assert_css_declaration_syntax } from "./declaration-syntax.js";
/// <reference path="../../types/css-tree-browser.d.ts" />
import { generate } from 'css-tree/dist/csstree.esm';
import { CSS_PSEUDOS, normalize_css_map, type NormalizedCssMap } from '../../core/css-map.js';
import { parse_document_stylesheet } from './parse-document-stylesheet.js';
import type { DocumentCssRecord } from '../../types/document-css.types.js';

import { relative_css_selector } from "./relative-selector.js";
export { relative_css_selector } from "./relative-selector.js";

export function structured_part_stylesheet(input: unknown, names: ReadonlySet<string>): DocumentCssRecord {
  const map = normalize_css_map(input);
  let length = 0;
  const emit = (value: NormalizedCssMap, subject: string): string => {
    const output: string[] = [];
    for (const [key, body] of Object.entries(value)) {
      if (typeof body === 'string') {
        // Parsing the value separately prevents declarations/rules from escaping their value slot.
        assert_css_declaration_syntax(key, body);
        output.push(`${subject}{${key}:${body}}`);
      } else if (key === '$media') {
        for (const [condition, group] of Object.entries(body)) {
          if (typeof group === 'string') throw new SyntaxError('Invalid CSS media group.');
          const query = parse_complete_css_list(condition, 'mediaQueryList');
          output.push(`@media ${generate(query)}{${emit(group, subject)}}`);
        }
      } else if (key.startsWith('@:')) {
        const name = key.slice(2);
        if (!names.has(name)) throw new TypeError(`Part CSS references missing local QUAD ${name}.`);
        output.push(emit(body, `[hson\\:quad="${name}"]`));
      } else {
        const pseudo = CSS_PSEUDOS[key];
        const target = relative_css_selector(pseudo === undefined ? key : `&${pseudo}`, subject);
        output.push(emit(body, target));
        if ((key === '__before' || key === '__after') && !Object.hasOwn(body, 'content')) output.push(`${target}{content:""}`);
      }
    }
    const text = output.join('\n');
    length += text.length;
    if (length > 4_000_000) throw new SyntaxError('Structured CSS expansion limit exceeded.');
    return text;
  };
  return parse_document_stylesheet(emit(map, ':scope'), []);
}
