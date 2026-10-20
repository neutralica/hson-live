import { make_family_selectors } from "../../internal/library-selectors.js";
import { admit_public_livemap_definitions, require_livemap_library_internal, resolve_livemap_library_internal } from "../livemap/livemap.libraries.js";
import { document_css_commands, document_css_reads, dispatch_document_css_command } from "../../internal/document-css-commands.js";
import { collection_commands } from "../livemap/livemap.collection-command.js";
import { collection_observations, read_document_location } from "../../internal/library-observation.js";
import type { JsonValue } from "../../core/types.js";
import type {
  LiveMap, LiveMapDefinitions, LiveMapCssOp, LiveMapDocumentAttributeValue, LiveMapDocumentAttrs,
  LiveMapDocumentRequestTarget, LiveMapDocumentContent,
  LiveMapStagedWriter, LivePath, LiveMapDataLibrary, LiveMapDocumentLibrary,
} from "../../types/livemap.types.js";
import type { LocusDefinitions, LocusStage } from "../../types/locus.core.types.js";
import { must_live_path } from "../livemap/livemap.guard.js";
import { validate_document_path } from "../livemap/livemap.document.path.js";
import { mark_browser_html_producer } from "../../internal/browser-html-producer.js";
import { register_governed_document, write_document_quad } from "../../internal/governed-document.js";

type Writer = LiveMapStagedWriter<LiveMap, void>;
type Selected = ReturnType<Writer["doc"]["must"]> | ReturnType<Writer["data"]["must"]>;
type Document = Extract<Selected, Readonly<{ mode: "document" }>>;
type Data = Exclude<Selected, Document>;
/** Governed selection shares one authority submission without exposing the subordinate map. */
export function make_locus_stage<TMap extends LiveMap>(
  map: TMap,
  submit: (callback: (writer: Writer) => void) => Promise<void>,
  submitLibraries: (definitions: LiveMapDefinitions, ownership: Readonly<Record<string, "private" | "shared">>,
    css: Readonly<Record<string, import("../../types/document-css.types.js").DocumentCssRecord>>) => Promise<void>,
  assertSubmissionAllowed: () => void,
): Pick<import("../../types/locus.core.types.js").Locus<TMap>, "stage" | "doc" | "data" | "parts" | "admit"> {
  const selected_document = (writer: Writer, name: string): Document => {
    const selected = writer.doc.must(name);
    if (selected.mode !== "document") throw new Error(`Staged Library ${JSON.stringify(name)} is not a document.`);
    return selected;
  };
  const selected_data = (writer: Writer, name: string): Data => {
    const selected = resolve_livemap_library_internal(map, name)?.family === "parts" ? writer.parts.must(name) : writer.data.must(name);
    return selected;
  };
  const data_path = (name: string, path: LivePath, owner: LiveMapDataLibrary, retained?: import("../../internal/library-observation.js").DataLocationObservations): import("../../types/governor.types.js").LocusDataLocation => {
    const stable = must_live_path(path);
    owner.schema.get();
    const raw = retained ?? owner.at(stable);
    const observations = collection_observations(raw);
    const commands = collection_commands(command => submit(writer => {
      if (require_livemap_library_internal(map, name) !== owner) throw new Error("Stale Library handle.");
      if ((command.collection === "array" ? raw.asArray() : raw.asObject()) === undefined) {
        throw new Error(`Data location is not an ${command.collection}.`);
      }
      const location = selected_data(writer, name).at(stable);
      Reflect.apply(Reflect.get(Reflect.get(location, command.collection), command.method), undefined, command.args);
    }), cause => Promise.reject(cause));
    return Object.freeze({
      get rev() { return raw.rev; },
      path: () => raw.path(),
      snap: () => raw.snap(),
      data: () => raw.data(),
      watch: (listener: (value: JsonValue | undefined) => void) => raw.watch(listener),
      ...(observations.array === undefined ? {} : { array: Object.freeze({ ...observations.array, ...commands.array }) }),
      ...(observations.object === undefined ? {} : { object: Object.freeze({ ...observations.object, ...commands.object }) }),
      kind: () => raw.kind(),
      present: () => { const checked = raw.present(); return checked === undefined ? undefined : data_path(name, stable, owner, checked); },
      asArray: () => { const checked = raw.asArray(); return checked === undefined ? undefined : data_path(name, stable, owner, checked); },
      asObject: () => { const checked = raw.asObject(); return checked === undefined ? undefined : data_path(name, stable, owner, checked); },
      asScalar: () => { const checked = raw.asScalar(); return checked === undefined ? undefined : data_path(name, stable, owner, checked); },
      at: (child: LivePath) => data_path(name, [...stable, ...must_live_path(child)], owner, raw.at(child)),
      set: (value: JsonValue) => submit(writer => { if (require_livemap_library_internal(map, name) !== owner) throw new Error("Stale Library handle."); raw.snap(); selected_data(writer, name).at(stable).set(value); }),
      replace: (value: JsonValue) => submit(writer => { if (require_livemap_library_internal(map, name) !== owner) throw new Error("Stale Library handle."); raw.snap(); selected_data(writer, name).at(stable).replace(value); }),
      delete: () => submit(writer => { if (require_livemap_library_internal(map, name) !== owner) throw new Error("Stale Library handle."); raw.snap(); selected_data(writer, name).at(stable).delete(); }),
    }) as unknown as import("../../types/governor.types.js").LocusDataLocation;
  };
  const document_location = (name: string, path: readonly number[], document: LiveMapDocumentLibrary): NonNullable<ReturnType<import("../../types/governor.types.js").LocusDocumentLocation["asElement"]>> => {
    const stable = validate_document_path(path);
    const raw = document.at(stable);
    const read = read_document_location(raw);
    const at = (path: readonly number[]) => document_location(name, path, document);
    const edit = (run: (location: import("../livemap/livemap.staged.js").StagedDocumentLocation) => void) => submit(writer => {
      if (require_livemap_library_internal(map, name) !== document) throw new Error("Stale Library handle.");
      document.root();
      run(selected_document(writer, name).at(stable) as import("../livemap/livemap.staged.js").StagedDocumentLocation);
    });
    return Object.freeze({
      ...read,
      get rev() { return raw.rev; },
      present: () => raw.present() === undefined ? undefined : at(stable),
      asElement: () => raw.asElement() === undefined ? undefined : at(stable),
      asRoot: () => raw.asRoot() === undefined ? undefined : at(stable),
      asText: () => raw.asText() === undefined ? undefined : at(stable),
      id: (id: string) => { const found = raw.id(id); return found === undefined ? undefined : at(found.path()); },
      at: (child: readonly number[]) => { raw.snap(); return at([...stable, ...validate_document_path(child)]); },
      replace: (value: LiveMapDocumentContent) => edit(location => location.replace(value)),
      delete: () => edit(location => location.delete()),
      insert: (index: number, value: LiveMapDocumentContent) => edit(location => location.insert(index, value)),
      move: (from: number, to: number) => edit(location => location.move(from, to)),
      attrs: Object.freeze({ ...read.attrs,
        set: (name: string, value: LiveMapDocumentAttributeValue) => edit(location => location.attrs.set(name, value)),
        drop: (name: string) => edit(location => location.attrs.drop(name)),
        replace: (values: LiveMapDocumentAttrs) => edit(location => location.attrs.replace(values)),
        setMany: (values: LiveMapDocumentAttrs) => edit(location => location.attrs.setMany(values)),
        dropMany: (names: readonly string[]) => edit(location => location.attrs.dropMany(names)),
        clear: () => edit(location => location.attrs.clear()),
      }),
      flags: Object.freeze({ ...read.flags,
        set: (...names: string[]) => edit(location => location.flags.set(...names)),
        clear: (...names: string[]) => edit(location => location.flags.clear(...names)),
      }),
    });
  };
  const admit = async (definitions: LocusDefinitions): Promise<void> => {
    assertSubmissionAllowed();
    const captured = admit_public_livemap_definitions(definitions, true);
    if (Object.keys(captured.definitions).length === 0) throw new TypeError("Locus admission requires a Library.");
    await submitLibraries(captured.definitions, captured.ownership, captured.css);
  };
  const facades = new WeakMap<object, ReturnType<typeof makeLibrary>>();
  const makeLibrary = (name: string) => {
        const selected = require_livemap_library_internal(map, name);
        if (selected.mode !== "document") {
          const data = selected as LiveMapDataLibrary;
          const handle = Object.freeze({ mode: data.mode, get rev() { return data.rev; }, root: () => data.root(),
            snap: data.snap.bind(data), schema: Object.freeze({ get: () => data.schema.get() }),
            at: (path: LivePath) => data_path(name, path, data) });
          return handle;
        }
        const document = selected as LiveMapDocumentLibrary;
        const edit = (run: (draft: Document) => void) => submit(writer => {
          if (require_livemap_library_internal(map, name) !== document) throw new Error("Stale Library handle.");
          document.root();
          run(selected_document(writer, name));
        });
        const commands = document_css_commands(command => edit(draft => {
          // The command facade records the same closed authoring call in the staged writer.
          dispatch_document_css_command(draft.css, command);
        }), () => { document.root(); });
        const reads = document_css_reads(document.css);
        const css = Object.assign(
          (operation: LiveMapCssOp) => edit(draft => { draft.css(operation); }),
          commands, reads, {
            var: Object.freeze({ ...commands.var, ...reads.var }),
            atProperty: Object.freeze({ ...commands.atProperty, ...reads.atProperty }),
            keyframes: Object.freeze({ ...commands.keyframes, ...reads.keyframes }),
          },
        );
        const content = Object.assign(
          () => document.document.content(),
          {
            replace: (target: LiveMapDocumentRequestTarget, index: number, value: LiveMapDocumentContent) =>
              edit(draft => { draft.content.replace(target, index, value); }),
            insert: (target: LiveMapDocumentRequestTarget, index: number, value: LiveMapDocumentContent) =>
              edit(draft => { draft.content.insert(target, index, value); }),
            remove: (target: LiveMapDocumentRequestTarget, index: number) =>
              edit(draft => { draft.content.remove(target, index); }),
            move: (target: LiveMapDocumentRequestTarget, from: number, to: number) =>
              edit(draft => { draft.content.move(target, from, to); }),
          },
        );
        const handle = Object.freeze({
          mode: "document" as const,
          get rev() { return document.rev; },
          root: () => document.root(),
          render: mark_browser_html_producer(() => document.render()),
          commits: document.commits,
          schema: Object.freeze({ get: () => document.schema.get() }),
          at: (path: readonly number[]) => document_location(name, path, document),
          q: (name: string) => {
            const subject = document.q(name);
            return subject === undefined ? undefined : write_document_quad(subject, (current, run) => edit(draft => {
              run(draft.at(current.path()) as import("../livemap/livemap.staged.js").StagedDocumentLocation);
              current.path(); // Reject retirement or disposal during argument capture.
            }));
          },
          css,
          document: Object.freeze({ root: () => document.document.root(),
            flags: Object.freeze({ has: document.document.flags.has,
              set: (target: LiveMapDocumentRequestTarget, ...names: string[]) => edit(draft => { draft.flags.set(target, ...names); }),
              clear: (target: LiveMapDocumentRequestTarget, ...names: string[]) => edit(draft => { draft.flags.clear(target, ...names); }),
            }),
            content,
            attrs: Object.freeze({
              get: document.document.attrs.get.bind(document.document.attrs),
              has: document.document.attrs.has.bind(document.document.attrs),
              keys: document.document.attrs.keys.bind(document.document.attrs),
              must: document.document.attrs.must,
              setMany: (target: LiveMapDocumentRequestTarget, values: LiveMapDocumentAttrs) => edit(draft => { draft.attrs.setMany(target, values); }),
              dropMany: (target: LiveMapDocumentRequestTarget, names: readonly string[]) => edit(draft => { draft.attrs.dropMany(target, names); }),
              clear: (target: LiveMapDocumentRequestTarget) => edit(draft => { draft.attrs.clear(target); }),
              set: (target: LiveMapDocumentRequestTarget, attribute: string, value: LiveMapDocumentAttributeValue) =>
                edit(draft => { draft.attrs.set(target, attribute, value); }),
              drop: (target: LiveMapDocumentRequestTarget, attribute: string) =>
                edit(draft => { draft.attrs.drop(target, attribute); }),
              replace: (target: LiveMapDocumentRequestTarget, values: LiveMapDocumentAttrs) =>
                edit(draft => { draft.attrs.replace(target, values); }),
            }),
          }),
        });
        register_governed_document(handle, document);
        return handle;
      };
  const lib = (name: string) => {
    const raw = require_livemap_library_internal(map, name);
    let handle = facades.get(raw);
    if (handle === undefined) { handle = makeLibrary(name); facades.set(raw, handle); }
    return handle;
  };
  return Object.freeze({ stage: submit, ...make_family_selectors(name => {
    const binding = resolve_livemap_library_internal(map, name);
    return binding === undefined ? undefined : { ...binding, handle: lib(name) };
  }), admit }) as unknown as Pick<import("../../types/locus.core.types.js").Locus<TMap>, "stage" | "doc" | "data" | "parts" | "admit">;
}
