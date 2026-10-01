import type { JsonValue } from "../../core/types.js";
import type {
  LiveMap, LiveMapDefinitions, LiveMapCssOp, LiveMapDocumentAttributeValue, LiveMapDocumentAttrs,
  LiveMapDocumentCommitTarget, LiveMapDocumentContent, LiveMapGraphOp,
  LiveMapStagedWriter, LivePath,
} from "../../types/livemap.types.js";
import type { LocusRuntimeLibraryAdditions, LocusStage } from "../../types/locus.core.types.js";
import { must_live_path } from "../livemap/livemap.guard.js";
import { validate_document_path } from "../livemap/livemap.document.path.js";

type Writer = LiveMapStagedWriter<LiveMap, void>;
type Selected = ReturnType<Writer["lib"]>;
type Document = Extract<Selected, Readonly<{ mode: "document" }>>;
type Data = Exclude<Selected, Document>;
type RuntimeDocumentLocation = Readonly<{
  replace: (value: LiveMapDocumentContent) => void;
  delete: () => void;
  insert: (index: number, value: LiveMapDocumentContent) => void;
  move: (from: number, to: number) => void;
  attrs: Readonly<{
    set: (name: string, value: LiveMapDocumentAttributeValue) => void;
    drop: (name: string) => void;
    replace: (values: LiveMapDocumentAttrs) => void;
  }>;
}>;

/** Keep direct navigation separate from the one shared authority submission. */
export function make_locus_stage<TMap extends LiveMap>(
  map: TMap,
  submit: (callback: (writer: Writer) => void) => Promise<void>,
  addLibraries: (definitions: LiveMapDefinitions, ownership: Readonly<Record<string, "private" | "shared">>) => Promise<void>,
  assertSubmissionAllowed: () => void,
): LocusStage<TMap> {
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
    return Object.freeze({
      at: (child: LivePath) => data_path(name, [...stable, ...must_live_path(child)]),
      set: (value: JsonValue) => submit(writer => { selected_data(writer, name).at(stable).set(value); }),
      replace: (value: JsonValue) => submit(writer => { selected_data(writer, name).at(stable).replace(value); }),
      delete: () => submit(writer => { selected_data(writer, name).at(stable).delete(); }),
    });
  };
  const document_location = (name: string, path: readonly number[]) => {
    const stable = validate_document_path(path);
    const selected = (writer: Writer): RuntimeDocumentLocation =>
      selected_document(writer, name).at(stable as never) as unknown as RuntimeDocumentLocation;
    return Object.freeze({
      at: (child: readonly number[]) => document_location(name, [...stable, ...validate_document_path(child)]),
      replace: (value: LiveMapDocumentContent) => submit(writer => { selected(writer).replace(value); }),
      delete: () => submit(writer => { selected(writer).delete(); }),
      insert: (index: number, value: LiveMapDocumentContent) => submit(writer => { selected(writer).insert(index, value); }),
      move: (from: number, to: number) => submit(writer => { selected(writer).move(from, to); }),
      attrs: Object.freeze({
        set: (attribute: string, value: LiveMapDocumentAttributeValue) => submit(writer => { selected(writer).attrs.set(attribute, value); }),
        drop: (attribute: string) => submit(writer => { selected(writer).attrs.drop(attribute); }),
        replace: (values: LiveMapDocumentAttrs) => submit(writer => { selected(writer).attrs.replace(values); }),
      }),
    });
  };
  const direct = Object.assign(
    (callback: (writer: Writer) => void): Promise<void> => submit(callback),
    {
      addLibraries(additions: LocusRuntimeLibraryAdditions): Promise<void> {
        try { assertSubmissionAllowed(); }
        catch (cause) { return Promise.reject(cause); }
        if (typeof additions !== "object" || additions === null || Array.isArray(additions)
          || Reflect.ownKeys(additions).some((key) => key !== "private" && key !== "shared")) {
          return Promise.reject(new TypeError("Locus runtime additions require private/shared groups."));
        }
        const definitions: Record<string, LiveMapDefinitions[string]> = Object.create(null);
        const ownership: Record<string, "private" | "shared"> = Object.create(null);
        for (const group of ["private", "shared"] as const) {
          const entries = additions[group];
          if (entries === undefined) continue;
          if (!Array.isArray(entries)) return Promise.reject(new TypeError("Locus runtime library group must be an array."));
          for (const entry of entries) {
            if (typeof entry !== "object" || entry === null || typeof entry.name !== "string" || !entry.name
              || Object.hasOwn(definitions, entry.name) || entry.definition === undefined || entry.css !== undefined
              || Reflect.ownKeys(entry).some((key) => key !== "name" && key !== "definition")) {
              return Promise.reject(new TypeError("Locus runtime Library addition is invalid or duplicated."));
            }
            definitions[entry.name] = entry.definition;
            ownership[entry.name] = group;
          }
        }
        if (Object.keys(definitions).length === 0) return Promise.reject(new TypeError("Locus runtime addition requires a Library."));
        return addLibraries(definitions, ownership);
      },
      lib(name: string) {
        const selected = map.lib(name);
        if (selected.mode !== "document") {
          return Object.freeze({ mode: selected.mode, at: (path: LivePath) => data_path(name, path) });
        }
        return Object.freeze({
          mode: "document" as const,
          at: (path: readonly number[]) => document_location(name, path),
          graph: (operation: LiveMapGraphOp) => submit(writer => { selected_document(writer, name).graph(operation as Exclude<LiveMapGraphOp, Readonly<{ op: "ensure-quid" }>>); }),
          css: (operation: LiveMapCssOp) => submit(writer => { selected_document(writer, name).css(operation); }),
          attrs: Object.freeze({
            set: (target: LiveMapDocumentCommitTarget, attribute: string, value: LiveMapDocumentAttributeValue) =>
              submit(writer => { selected_document(writer, name).attrs.set(target, attribute, value); }),
            drop: (target: LiveMapDocumentCommitTarget, attribute: string) =>
              submit(writer => { selected_document(writer, name).attrs.drop(target, attribute); }),
            replace: (target: LiveMapDocumentCommitTarget, values: LiveMapDocumentAttrs) =>
              submit(writer => { selected_document(writer, name).attrs.replace(target, values); }),
          }),
          content: Object.freeze({
            replace: (target: LiveMapDocumentCommitTarget, index: number, value: LiveMapDocumentContent) =>
              submit(writer => { selected_document(writer, name).content.replace(target, index, value); }),
            insert: (target: LiveMapDocumentCommitTarget, index: number, value: LiveMapDocumentContent) =>
              submit(writer => { selected_document(writer, name).content.insert(target, index, value); }),
            remove: (target: LiveMapDocumentCommitTarget, index: number) =>
              submit(writer => { selected_document(writer, name).content.remove(target, index); }),
            move: (target: LiveMapDocumentCommitTarget, from: number, to: number) =>
              submit(writer => { selected_document(writer, name).content.move(target, from, to); }),
          }),
        });
      },
    },
  );
  return direct as unknown as LocusStage<TMap>;
}
