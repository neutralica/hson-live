import { is_ordinary_element_node } from "../../core/node-guards.js";
import { document_css_subject_identities, translate_document_css_identities } from "../../internal/css/css-identity-translation.js";
import { merge_part_stylesheets, retire_part_styles } from "../../internal/css/part-stylesheet.js";
import { encode_portable_document_stylesheet, portable_document_stylesheet_equal, type PortableDocumentStylesheet } from "../../internal/css/portable-document-stylesheet.js";
import type { DocumentCompositionStyle } from "./livemap.document.composition.js";
import type { PreparedDocumentScopedComposition } from "./livemap.document.scoped-composition.js";
import type { DocumentScopedQuadContext, DocumentScopedQuads } from "./livemap.document.scoped-quad.js";
import { livemap_document_identity_quids } from "./livemap.document.identity.js";
import { resolve_document_path, validate_document_path } from "./livemap.document.path.js";
import type { DocumentQuadCorrespondence } from "./livemap.document.quad.js";

/** Complete detached state, authenticated by its existing Library authority.
 * There is deliberately no install/commit capability until scoped portable
 * correspondence and incremental replay can represent every accepted effect.
 * @internal
 */
export type PreparedDocumentScopedLibrary = PreparedDocumentScopedComposition & Readonly<{
  stylesheet: PortableDocumentStylesheet;
}>;

type ScopedState = DocumentScopedQuadContext & Readonly<{ scopes: DocumentScopedQuads }>;

/** Retire against OLD occurrence ownership, before installing incoming CSS.
 * A root subject may survive replacement without its occurrence surviving.
 * Existing explicitly owned CSS uses the same root carrier, so no second CSS
 * registry or stylesheet engine is needed. Independent subject rules are left
 * for ordinary strict correspondence validation.
 * @internal
 */
export function retire_document_scoped_styles(stylesheet: PortableDocumentStylesheet,
  before: ScopedState, after: ScopedState): PortableDocumentStylesheet {
  const active = new Set(livemap_document_identity_quids(after.overlay));
  const surviving = new Set(after.scopes.occurrences.map(scope => scope.lifetime));
  for (const scope of before.scopes.occurrences) if (!surviving.has(scope.lifetime)) active.delete(scope.rootQuid);
  return retire_part_styles(stylesheet, active);
}

function install(stylesheet: PortableDocumentStylesheet, styles: readonly DocumentCompositionStyle[],
  state: ScopedState, assertCurrent: () => void): PortableDocumentStylesheet {
  const records = styles.map(style => {
    const demanded = new Set(document_css_subject_identities(style.css, "inbound"));
    const names = new Set<string>(), paths = new Set<string>();
    const associations = style.subjects.map((subject): DocumentQuadCorrespondence => {
      const path = validate_document_path(subject.path), key = JSON.stringify(path);
      const quid = state.overlay.quidAtPath(path);
      if (!demanded.has(subject.name) || names.has(subject.name) || paths.has(key)
        || quid === undefined || !state.issued.has(quid)
        || !is_ordinary_element_node(resolve_document_path(state.root, "document", path))) {
        throw new Error("Scoped Part CSS requires exact owner-issued destination correspondence.");
      }
      names.add(subject.name); paths.add(key);
      return { name: subject.name, path, quid, disposition: "authored" };
    });
    if (names.size !== demanded.size) throw new Error("Unresolved scoped Part CSS subject.");
    return translate_document_css_identities(style.css, "inbound", { associations, assertCurrent }, true);
  });
  const next = merge_part_stylesheets([encode_portable_document_stylesheet(stylesheet), ...records]);
  for (const quid of document_css_subject_identities(encode_portable_document_stylesheet(next), "outbound")) {
    if (!state.issued.has(quid) || state.overlay.pathForQuid(quid) === undefined) {
      throw new Error("Managed CSS requires a surviving Library subject.");
    }
  }
  assertCurrent();
  return next;
}

/** Consume each step in its own coordinates; never use the final overlay to
 * interpret an earlier contribution or the final scopes to retire an old one.
 * Identity is already staged by composition; CSS preparation cannot mint it.
 * @internal
 */
export function prepare_document_scoped_library_styles(candidate: PreparedDocumentScopedComposition,
  stylesheet: PortableDocumentStylesheet, before?: PreparedDocumentScopedLibrary): PreparedDocumentScopedLibrary {
  candidate.assertCurrent();
  let css = candidate.steps.length === 0
    ? install(stylesheet, candidate.initialStyles, candidate, candidate.assertCurrent) : stylesheet;
  let previous: ScopedState | undefined = before;
  for (const step of candidate.steps) {
    if (previous === undefined) throw new Error("Scoped mutation CSS requires its before-state.");
    const next = { ...step.context, scopes: step.scopes };
    css = install(retire_document_scoped_styles(css, previous, next), step.styles, next, candidate.assertCurrent);
    previous = next;
  }
  candidate.assertCurrent();
  return Object.freeze({ ...candidate, stylesheet: css,
    changed: candidate.changed || !portable_document_stylesheet_equal(stylesheet, css) });
}
