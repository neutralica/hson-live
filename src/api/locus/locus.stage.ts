import type { JsonValue } from "../../core/types.js";
import type {
  LiveMap, LiveMapDefinitions, LiveMapCssOp, LiveMapDocumentAttributeValue, LiveMapDocumentAttrs,
  LiveMapDocumentCommitTarget, LiveMapDocumentContent, LiveMapGraphOp,
  LiveMapStagedWriter, LivePath, LiveMapDataLibrary, LiveMapDocumentLibrary,
} from "../../types/livemap.types.js";
import type { LocusRuntimeLibraryAdditions, LocusStage } from "../../types/locus.core.types.js";
import type { GovernorLibrarySelector } from "../../types/governor.types.js";
import { must_live_path } from "../livemap/livemap.guard.js";
import { validate_document_path } from "../livemap/livemap.document.path.js";
import { parse_document_stylesheet } from "../../internal/css/parse-document-stylesheet.js";
import { mark_browser_html_producer } from "../../internal/browser-html-producer.js";
import { register_governed_document, governed_document_element_target, governed_document_slot,
  governed_document_remove_slot, governed_document_insert_slot, governed_document_move_target } from "../../internal/governed-document.js";

type Writer = LiveMapStagedWriter<LiveMap, void>;
type Selected = ReturnType<Writer["lib"]>;
type Document = Extract<Selected, Readonly<{ mode: "document" }>>;
type Data = Exclude<Selected, Document>;
/** Governed selection shares one authority submission without exposing the subordinate map. */
export function make_locus_stage<TMap extends LiveMap>(
  map: TMap,
  submit: (callback: (writer: Writer) => void) => Promise<void>,
  submitLibraries: (definitions: LiveMapDefinitions, ownership: Readonly<Record<string, "private" | "shared">>,
    css: Readonly<Record<string, import("../../types/document-css.types.js").DocumentCssRecord>>) => Promise<void>,
  assertSubmissionAllowed: () => void,
): Readonly<{ stage: LocusStage<TMap>; lib: GovernorLibrarySelector<TMap>;
  addLibraries: (additions: LocusRuntimeLibraryAdditions) => Promise<void> }> {
  const selected_document = (writer: Writer, name: string): Document => {
    const selected = writer.lib(name);
    if (selected.mode !== "document") throw new Error(`Staged Library ${JSON.stringify(name)} is not a document.`);
    return selected;
  };
  const selected_data = (writer: Writer, name: string): Data => {
    const selected = writer.lib(name);
    if (selected.mode === "document") throw new Error(`Staged Library ${JSON.stringify(name)} is not data.`);
    return selected;
  };
  const data_path = (name: string, path: LivePath) => {
    const stable = must_live_path(path);
    const raw = (map.lib(name) as LiveMapDataLibrary).at(stable);
    return Object.freeze({
      get rev() { return raw.rev; },
      path: () => raw.path(),
      snap: () => raw.snap(),
      data: () => raw.data(),
      watch: (listener: (value: JsonValue | undefined) => void) => raw.watch(listener),
      kind: () => raw.kind(),
      at: (child: LivePath) => data_path(name, [...stable, ...must_live_path(child)]),
      set: (value: JsonValue) => submit(writer => { selected_data(writer, name).at(stable).set(value); }),
      replace: (value: JsonValue) => submit(writer => { selected_data(writer, name).at(stable).replace(value); }),
      delete: () => submit(writer => { selected_data(writer, name).at(stable).delete(); }),
    });
  };
  const document_location = (name: string, path: readonly number[]) => {
    const stable = validate_document_path(path);
    const document = map.lib(name) as LiveMapDocumentLibrary;
    const raw = document.at(stable);
    return Object.freeze({
      get rev() { return raw.rev; },
      path: () => raw.path(),
      snap: () => raw.snap(),
      watch: (listener: (value: unknown) => void) => raw.watch(listener),
      kind: () => raw.kind(),
      id: (id: string) => {
        const found = raw.id(id);
        return found === undefined ? undefined : document_location(name, found.path());
      },
      at: (child: readonly number[]) => document_location(name, [...stable, ...validate_document_path(child)]),
      replace: (value: LiveMapDocumentContent) => submit(writer => {
        const slot = governed_document_slot(document, stable);
        selected_document(writer, name).content.replace(slot.target, slot.index, value);
      }),
      delete: () => submit(writer => {
        const slot = governed_document_remove_slot(document, stable);
        selected_document(writer, name).content.remove(slot.target, slot.index);
      }),
      insert: (index: number, value: LiveMapDocumentContent) => submit(writer => {
        const slot = governed_document_insert_slot(document, stable, index, value);
        selected_document(writer, name).content.insert(slot.target, slot.index, slot.content);
      }),
      move: (from: number, to: number) => submit(writer => {
        selected_document(writer, name).content.move(governed_document_move_target(document, stable), from, to);
      }),
      attrs: Object.freeze({
        get: (attribute: string) => document.document.attrs.get(governed_document_element_target(document, stable), attribute),
        has: (attribute: string) => document.document.attrs.has(governed_document_element_target(document, stable), attribute),
        keys: () => document.document.attrs.keys(governed_document_element_target(document, stable)),
        set: (attribute: string, value: LiveMapDocumentAttributeValue) => submit(writer => {
          selected_document(writer, name).attrs.set(governed_document_element_target(document, stable), attribute, value);
        }),
        drop: (attribute: string) => submit(writer => {
          selected_document(writer, name).attrs.drop(governed_document_element_target(document, stable), attribute);
        }),
        replace: (values: LiveMapDocumentAttrs) => submit(writer => {
          selected_document(writer, name).attrs.replace(governed_document_element_target(document, stable), values);
        }),
      }),
    });
  };
  const addLibraries = (additions: LocusRuntimeLibraryAdditions): Promise<void> => {
        try { assertSubmissionAllowed(); }
        catch (cause) { return Promise.reject(cause); }
        if (typeof additions !== "object" || additions === null || Array.isArray(additions)
          || Reflect.ownKeys(additions).some((key) => key !== "private" && key !== "shared")) {
          return Promise.reject(new TypeError("Locus runtime additions require private/shared groups."));
        }
        const definitions: Record<string, LiveMapDefinitions[string]> = Object.create(null);
        const ownership: Record<string, "private" | "shared"> = Object.create(null);
        const css: Record<string, import("../../types/document-css.types.js").DocumentCssRecord> = Object.create(null);
        for (const group of ["private", "shared"] as const) {
          const entries = additions[group];
          if (entries === undefined) continue;
          if (!Array.isArray(entries)) return Promise.reject(new TypeError("Locus runtime library group must be an array."));
          for (const entry of entries) {
            if (typeof entry !== "object" || entry === null || typeof entry.name !== "string" || !entry.name
              || Object.hasOwn(definitions, entry.name) || entry.definition === undefined
              || Reflect.ownKeys(entry).some((key) => key !== "name" && key !== "definition" && key !== "css")) {
              return Promise.reject(new TypeError("Locus runtime Library addition is invalid or duplicated."));
            }
            if (entry.css !== undefined) {
              if (!("document" in entry.definition)) return Promise.reject(new TypeError("Initial CSS requires a document definition."));
              try { css[entry.name] = parse_document_stylesheet(entry.css, []); }
              catch (cause) { return Promise.reject(cause); }
            }
            definitions[entry.name] = entry.definition;
            ownership[entry.name] = group;
          }
        }
        if (Object.keys(definitions).length === 0) return Promise.reject(new TypeError("Locus runtime addition requires a Library."));
        return submitLibraries(definitions, ownership, css);
      };
  const lib = (name: string) => {
        const selected = map.lib(name);
        if (selected.mode !== "document") {
          const data = selected as LiveMapDataLibrary;
          return Object.freeze({ mode: data.mode, get rev() { return data.rev; }, root: () => data.root(),
            snap: data.snap.bind(data), schema: Object.freeze({ get: () => data.schema.get() }),
            at: (path: LivePath) => data_path(name, path) });
        }
        const document = selected as LiveMapDocumentLibrary;
        const css = Object.assign(
          (operation: LiveMapCssOp) => submit(writer => { selected_document(writer, name).css(operation); }),
          { snapshot: () => document.css.snapshot(), has: (key: string) => document.css.has(key),
            list: () => document.css.list(), get: (key: string) => document.css.get(key),
            stylesheet: (text: string) => submit(writer => { selected_document(writer, name).css.stylesheet(text); }) },
        );
        const content = Object.assign(
          () => document.document.content(),
          {
            replace: (target: LiveMapDocumentCommitTarget, index: number, value: LiveMapDocumentContent) =>
              submit(writer => { selected_document(writer, name).content.replace(target, index, value); }),
            insert: (target: LiveMapDocumentCommitTarget, index: number, value: LiveMapDocumentContent) =>
              submit(writer => { selected_document(writer, name).content.insert(target, index, value); }),
            remove: (target: LiveMapDocumentCommitTarget, index: number) =>
              submit(writer => { selected_document(writer, name).content.remove(target, index); }),
            move: (target: LiveMapDocumentCommitTarget, from: number, to: number) =>
              submit(writer => { selected_document(writer, name).content.move(target, from, to); }),
          },
        );
        const handle = Object.freeze({
          mode: "document" as const,
          get rev() { return document.rev; },
          root: () => document.root(),
          render: mark_browser_html_producer(() => document.render()),
          commits: document.commits,
          schema: Object.freeze({ get: () => document.schema.get() }),
          at: (path: readonly number[]) => document_location(name, path),
          css,
          document: Object.freeze({ root: () => document.document.root(),
            content,
            attrs: Object.freeze({
              get: document.document.attrs.get.bind(document.document.attrs),
              has: document.document.attrs.has.bind(document.document.attrs),
              keys: document.document.attrs.keys.bind(document.document.attrs),
              set: (target: LiveMapDocumentCommitTarget, attribute: string, value: LiveMapDocumentAttributeValue) =>
                submit(writer => { selected_document(writer, name).attrs.set(target, attribute, value); }),
              drop: (target: LiveMapDocumentCommitTarget, attribute: string) =>
                submit(writer => { selected_document(writer, name).attrs.drop(target, attribute); }),
              replace: (target: LiveMapDocumentCommitTarget, values: LiveMapDocumentAttrs) =>
                submit(writer => { selected_document(writer, name).attrs.replace(target, values); }),
            }),
          }),
        });
        register_governed_document(handle, document);
        return handle;
      };
  return Object.freeze({ stage: submit as LocusStage<TMap>, lib: lib as GovernorLibrarySelector<TMap>, addLibraries });
}
