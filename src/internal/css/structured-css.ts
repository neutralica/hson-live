import { mediaToAtRule } from "./global-css-scopes.js";
import { parse_complete_css_list } from "./complete-list.js";
/// <reference path="../../types/css-tree-browser.d.ts" />
import { generate } from 'css-tree/dist/csstree.esm';
import { CSS_PSEUDOS, normalize_css_map, type NormalizedCssMap } from '../../core/css-map.js';
import { decode_portable_document_stylesheet, encode_portable_document_stylesheet } from "./portable-document-stylesheet.js";
import type { DocumentCssRecord, DocumentCssOrderEntry } from '../../types/document-css.types.js';

import { relative_css_selector, append_css_pseudo } from "./relative-selector.js";
export { relative_css_selector } from "./relative-selector.js";

/** Walk a qualified map in authored order into a detached receiving candidate.
 * Callers publish only after this complete traversal succeeds. No CSS state is owned here. */
export function visit_structured_css(
  map: NormalizedCssMap,
  selector: string,
  scopes: readonly string[],
  declaration: (selector: string, scopes: readonly string[], property: string, value: string | undefined) => void,
  resolveSubject?: (name: string) => string | undefined,
): void {
  let length = 0;
  const emit = (value: NormalizedCssMap, subject: string, context: readonly string[]): void => {
    for (const [key, body] of Object.entries(value)) {
      if (body === undefined || typeof body === "string") {
        length += subject.length + key.length + (body?.length ?? 0);
        if (length > 4_000_000) throw new SyntaxError("Structured CSS expansion resource limit exceeded.");
        declaration(subject, context, key, body);
      } else if (key === "$media") {
        for (const [condition, group] of Object.entries(body)) {
          if (group === undefined || typeof group === "string") throw new SyntaxError("Invalid CSS media group.");
          parse_complete_css_list(condition, "mediaQueryList");
          const header = mediaToAtRule(condition);
          emit(group, subject, [...context, header]);
        }
      } else if (key.startsWith("@:")) {
        const target = resolveSubject?.(key.slice(2));
        if (target === undefined) throw new TypeError(`CSS subject cannot be resolved: ${key}`);
        emit(body, target, context);
      } else {
        const pseudo = CSS_PSEUDOS[key];
        emit(body, pseudo === undefined ? relative_css_selector(key, subject) : append_css_pseudo(subject, pseudo), context);
      }
    }
  };
  emit(map, selector, scopes);
}

export function structured_part_stylesheet(input: unknown, names: ReadonlySet<string>): DocumentCssRecord {
  const map = normalize_css_map(input);
  let length = 0, next = 0;
  const rules: DocumentCssRecord["rules"][number][] = [];
  const emit = (value: NormalizedCssMap, subject: string, scopes: readonly string[] = []): DocumentCssOrderEntry[] => {
    const output: DocumentCssOrderEntry[] = [];
    for (const [key, body] of Object.entries(value)) {
      if (body === undefined) continue; // Complete admission applies deletion to an empty contribution.
      if (typeof body === 'string') {
        // normalize_css_map has qualified every authored declaration slot.
        const ruleKey = `stylesheet:${++next}`;
        rules.push({ ruleKey, selector: subject, scopes, declarations: [[key, body]] });
        output.push({ kind: "rule", ruleKey, scopes });
        length += subject.length + key.length + body.length;
      } else if (key === '$media') {
        for (const [condition, group] of Object.entries(body)) {
          if (group === undefined || typeof group === 'string') throw new SyntaxError('Invalid CSS media group.');
          const query = parse_complete_css_list(condition, 'mediaQueryList');
          const header = `@media ${generate(query)}`;
          output.push({ kind: "group", header, entries: emit(group, subject, [...scopes, header]) });
        }
      } else if (key.startsWith('@:')) {
        const name = key.slice(2);
        if (!names.has(name)) throw new TypeError(`Part CSS references missing local QUAD ${name}.`);
        output.push(...emit(body, `[hson\\:quad="${name}"]`, scopes));
      } else {
        const pseudo = CSS_PSEUDOS[key];
        const target = relative_css_selector(pseudo === undefined ? key : `&${pseudo}`, subject);
        output.push(...emit(body, target, scopes));
      }
    }

    if (length > 4_000_000) throw new SyntaxError('Structured CSS expansion limit exceeded.');
    return output;
  };
  const order = emit(map, ':scope');
  return encode_portable_document_stylesheet(decode_portable_document_stylesheet({ rules, properties: [], keyframes: [], order }));
}
