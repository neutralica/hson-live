import { normalize_part_css_authoring } from "../../core/part-css-authoring.js";
import { capture_before_submission, capture_plain_instruction } from "../../internal/capture-instruction.js";
import { document_location_commands } from "../../internal/document-location-commands.js";
import { capture_document_attrs, capture_document_attrs_command, capture_document_attr_value, capture_document_content } from "../livemap/livemap.document.mutation.js";
import { normalize_document_request_target } from "../livemap/livemap.document.target.js";
import { canonical_portable_document_css_op } from "../../internal/css/portable-document-operations.js";
import { required_reads } from "../../internal/required-reads.js";
import { forward_part_write } from "../../internal/part-write.js";
import { make_parts_facade } from "../../internal/parts-facade.js";
import { make_family_selectors } from "../../internal/library-selectors.js";
import { type OwnedLibraryDefinition, admit_public_livemap_definitions, require_livemap_library_internal, resolve_livemap_library_internal } from "../livemap/livemap.libraries.js";
import { document_css_commands, document_css_reads, dispatch_document_css_command, capture_document_css_command } from "../../internal/document-css-commands.js";
import { collection_commands, normalize_part_collection_command } from "../livemap/livemap.collection-command.js";
import { collection_observations, live_observation, live_subscription, read_document_location } from "../../internal/library-observation.js";
import type { JsonValue } from "../../core/types.js";
import type {
  LiveMap, LiveMapCssOp, LiveMapDocumentAttributeValue, LiveMapDocumentAttrs,
  LiveMapDocumentRequestTarget, LiveMapDocumentContent,
  LiveMapStagedWriter, LivePath, LiveMapDataLibrary, LiveMapDocumentLibrary,
} from "../../types/livemap.types.js";
import type { LocusDefinitions, LocusStage } from "../../types/locus.core.types.js";
import { must_live_path, must_ordered_projected_value } from "../livemap/livemap.guard.js";
import { validate_document_path } from "../livemap/livemap.document.path.js";
import { mark_browser_html_producer } from "../../internal/browser-html-producer.js";
import { register_governed_document, write_document_quad } from "../../internal/governed-document.js";
import { capture_document_click, document_listener, type WritableDocumentLocation } from "../interactions/interactions.authoring.js";
import { add_interaction } from "../interactions/interactions.js";

type Writer = LiveMapStagedWriter<LiveMap, void>;
type Selected = ReturnType<Writer["doc"]["must"]> | ReturnType<Writer["data"]["must"]>;
type Document = Extract<Selected, Readonly<{ mode: "document" }>>;
/** Governed selection shares one authority submission without exposing the subordinate map. */
export function make_locus_stage<TMap extends LiveMap>(
  map: TMap,
  submit: (callback: (writer: Writer) => void) => Promise<void>,
  submitLibraries: (definitions: readonly OwnedLibraryDefinition[], ownership: Readonly<Record<string, "private" | "shared">>,
    css: Readonly<Record<string, import("../../types/document-css.types.js").DocumentCssRecord>>) => Promise<void>,
  assertSubmissionAllowed: () => void,
  assertReadable: () => void,
): Pick<import("../../types/locus.core.types.js").Locus<TMap>, "stage" | "doc" | "data" | "parts" | "admit"> {
  const observe = live_observation(assertReadable);
  const selected_document = (writer: Writer, name: string): Document => {
    const selected = writer.doc.must(name);
    if (selected.mode !== "document") throw new Error(`Staged Library ${JSON.stringify(name)} is not a document.`);
    return selected;
  };
  const selected_data = (writer: Writer, name: string) => {
    const selected = resolve_livemap_library_internal(map, name)?.family === "parts" ? writer.parts.must(name) : writer.data.must(name);
    return selected;
  };
  const listenAt = (name: string, document: LiveMapDocumentLibrary, select: () => readonly number[], assertLifetime?: () => void) =>
    document_listener(async (destination, key, input) => {
      assertSubmissionAllowed();
      assertReadable();
      const captured = capture_document_click(document.document, name, select, destination, key, input, assertLifetime);
      await submit(writer => {
        assertReadable();
        if (require_livemap_library_internal(map, name) !== document) throw new Error("Stale Library handle.");
        // This submission has no graph commands ahead of the addition in its candidate.
        add_interaction(writer, captured.descriptor());
      });
      return captured.id;
    });
  const data_path = (name: string, path: LivePath, owner: LiveMapDataLibrary, retained?: import("../../internal/library-observation.js").DataLocationObservations): import("../../types/governor.types.js").LocusDataLocation => {
    assertReadable();
    const stable = must_live_path(path);
    owner.schema.get();
    const raw = retained ?? owner.at(stable);
    const observations = collection_observations(raw, assertReadable);
    const commands = collection_commands(command => submit(writer => {
      if (require_livemap_library_internal(map, name) !== owner) throw new Error("Stale Library handle.");
      if ((command.collection === "array" ? raw.asArray() : raw.asObject()) === undefined) {
        throw new Error(`Data location is not an ${command.collection}.`);
      }
      const location = selected_data(writer, name).at(stable);
      Reflect.apply(Reflect.get(Reflect.get(location, command.collection), command.method), undefined, command.args);
    }), cause => Promise.reject(cause), command => resolve_livemap_library_internal(map, name)?.family === "parts" ? normalize_part_collection_command(command, stable) : command);
    const isParts = resolve_livemap_library_internal(map, name)?.family === "parts";
    const write = (method: "set" | "replace", value: JsonValue): Promise<void> => capture_before_submission(() => {
      const owned = must_ordered_projected_value(isParts ? normalize_part_css_authoring(value, stable) : value, stable);
      return submit(writer => {
        if (require_livemap_library_internal(map, name) !== owner) throw new Error("Stale Library handle.");
        raw.snap();
        const location = selected_data(writer, name).at(stable);
        Reflect.apply(location[method], location, [owned]);
      });
    });
    const snap = observe(() => raw.snap());
    const hson = observe(() => raw.hson());
    const facade = {
      get rev() { assertReadable(); return raw.rev; },
      path: observe(() => raw.path()),
      snap, hson, must: required_reads(snap, hson),
      watch: live_subscription(raw.watch.bind(raw), () => { assertReadable(); void raw.rev; }),
      ...(observations.array === undefined ? {} : { array: Object.freeze({ ...observations.array, ...commands.array }) }),
      ...(observations.object === undefined ? {} : { object: Object.freeze({ ...observations.object, ...commands.object }) }),
      kind: observe(() => raw.kind()),
      present: observe(() => { const checked = raw.present(); return checked === undefined ? undefined : data_path(name, stable, owner, checked); }),
      asArray: observe(() => { const checked = raw.asArray(); return checked === undefined ? undefined : data_path(name, stable, owner, checked); }),
      asObject: observe(() => { const checked = raw.asObject(); return checked === undefined ? undefined : data_path(name, stable, owner, checked); }),
      asScalar: observe(() => { const checked = raw.asScalar(); return checked === undefined ? undefined : data_path(name, stable, owner, checked); }),
      at: observe((child: LivePath) => data_path(name, [...stable, ...must_live_path(child)], owner, raw.at(child))),
      set: (value: JsonValue) => write("set", value),
      replace: (value: JsonValue) => write("replace", value),
      delete: () => submit(writer => { if (require_livemap_library_internal(map, name) !== owner) throw new Error("Stale Library handle."); raw.snap(); selected_data(writer, name).at(stable).delete(); }),
    };
    return Object.freeze(forward_part_write(facade, raw, assertReadable)) as unknown as import("../../types/governor.types.js").LocusDataLocation;
  };
  const document_location = (name: string, path: readonly number[], document: LiveMapDocumentLibrary, retained?: ReturnType<LiveMapDocumentLibrary["at"]>): NonNullable<ReturnType<import("../../types/governor.types.js").LocusDocumentLocation["asElement"]>> => {
    assertReadable();
    const stable = validate_document_path(path);
    const raw: WritableDocumentLocation = retained ?? document.at(stable);
    const read = read_document_location(raw, assertReadable);
    const edit = (run: (location: import("../livemap/livemap.staged.js").StagedDocumentLocation) => void) => submit(writer => {
      if (require_livemap_library_internal(map, name) !== document) throw new Error("Stale Library handle.");
      document.root();
      run(selected_document(writer, name).at(stable) as import("../livemap/livemap.staged.js").StagedDocumentLocation);
    });
    const commands = document_location_commands(edit);
    const listener = raw.listen === undefined ? undefined : listenAt(name, document, () => {
      if (raw.kind() !== "element") throw new TypeError("Document listener subject must be an ordinary element.");
      return raw.path();
    });
    const facade = Object.freeze({
      ...read, ...commands,
      ...(listener === undefined ? {} : { listen: listener }),
      get rev() { return read.rev; },
      present: observe(() => { const checked = raw.present(); return checked === undefined ? undefined : document_location(name, stable, document, checked); }),
      asElement: observe(() => { const checked = raw.asElement(); return checked === undefined ? undefined : document_location(name, stable, document, checked); }),
      asRoot: observe(() => { const checked = raw.asRoot(); return checked === undefined ? undefined : document_location(name, stable, document, checked); }),
      asText: observe(() => { const checked = raw.asText(); return checked === undefined ? undefined : document_location(name, stable, document, checked); }),
      id: observe((id: string) => { const found = raw.id(id); return found === undefined ? undefined : document_location(name, found.path(), document, found); }),
      at: observe((child: readonly number[]) => { raw.snap(); return document_location(name, [...stable, ...validate_document_path(child)], document, raw.at(child)); }),
      attrs: Object.freeze({ ...read.attrs, ...commands.attrs }),
      flags: Object.freeze({ ...read.flags, ...commands.flags }),
    });
    return facade as NonNullable<ReturnType<import("../../types/governor.types.js").LocusDocumentLocation["asElement"]>>;
  };
  const admit = async (definitions: LocusDefinitions): Promise<void> => {
    assertSubmissionAllowed();
    const captured = admit_public_livemap_definitions(definitions, true);
    if (captured.definitions.length === 0) throw new TypeError("Locus admission requires a Library.");
    await submitLibraries(captured.definitions, captured.ownership, captured.css);
  };
  const facades = new WeakMap<object, ReturnType<typeof makeLibrary>>();
  const makeLibrary = (name: string) => {
        const selected = require_livemap_library_internal(map, name);
        if (selected.mode !== "document") {
          const data = selected as LiveMapDataLibrary;
          const handle = Object.freeze({ mode: data.mode, get rev() { assertReadable(); return data.rev; }, root: observe(() => data.root()),
            snap: observe((path?: LivePath) => path === undefined ? data.snap() : data.snap(path)),
            hson: observe(() => data.hson()),
            must: required_reads(observe(() => data.snap()), observe(() => data.hson())), schema: Object.freeze({ get: observe(() => data.schema.get()) }),
            at: observe((path: LivePath) => data_path(name, path, data)) });
          return resolve_livemap_library_internal(map, name)?.family === "parts"
            ? make_parts_facade(handle, observe((key: string) => data.snap([key]) !== undefined)) : handle;
        }
        const document = selected as LiveMapDocumentLibrary;
        const edit = (run: (draft: Document) => void) => submit(writer => {
          if (require_livemap_library_internal(map, name) !== document) throw new Error("Stale Library handle.");
          document.root();
          run(selected_document(writer, name));
        });
        const commands = document_css_commands(input => capture_before_submission(() => {
          const command = capture_document_css_command(input);
          return edit(draft => {
            // The command facade records the same closed authoring call in the staged writer.
            dispatch_document_css_command(draft.css, command);
          });
        }), () => { document.root(); });
        const reads = document_css_reads(document.css, assertReadable);
        const css = Object.assign(
          (input: LiveMapCssOp) => capture_before_submission(() => {
            const operation = canonical_portable_document_css_op(capture_plain_instruction(input));
            return edit(draft => { draft.css(operation); });
          }),
          commands, reads, {
            var: Object.freeze({ ...commands.var, ...reads.var }),
            atProperty: Object.freeze({ ...commands.atProperty, ...reads.atProperty }),
            keyframes: Object.freeze({ ...commands.keyframes, ...reads.keyframes }),
          },
        );
        const request = (target: LiveMapDocumentRequestTarget) =>
          normalize_document_request_target(capture_plain_instruction(target), "replace-attrs");
        const content = Object.assign(
          observe(() => document.document.content()),
          {
            replace: (target: LiveMapDocumentRequestTarget, index: number, value: LiveMapDocumentContent) => capture_before_submission(() => {
              const stableTarget = request(target);
              const owned = capture_document_content(value, "replace-content");
              return edit(draft => { draft.content.replace(stableTarget, index, owned); });
            }),
            insert: (target: LiveMapDocumentRequestTarget, index: number, value: LiveMapDocumentContent) => capture_before_submission(() => {
              const stableTarget = request(target);
              const owned = capture_document_content(value, "insert-content");
              return edit(draft => { draft.content.insert(stableTarget, index, owned); });
            }),
            remove: (target: LiveMapDocumentRequestTarget, index: number) => capture_before_submission(() => {
              const stableTarget = request(target);
              return edit(draft => { draft.content.remove(stableTarget, index); });
            }),
            move: (target: LiveMapDocumentRequestTarget, from: number, to: number) => capture_before_submission(() => {
              const stableTarget = request(target);
              return edit(draft => { draft.content.move(stableTarget, from, to); });
            }),
          },
        );
        const handle = Object.freeze({
          mode: "document" as const,
          get rev() { assertReadable(); return document.rev; },
          root: observe(() => document.root()),
          snap: observe(() => document.snap()), hson: observe(() => document.hson()),
          must: required_reads(observe(() => document.snap()), observe(() => document.hson())), watch: live_subscription(document.watch.bind(document), () => { assertReadable(); void document.rev; }),
          render: mark_browser_html_producer(observe(() => document.render())),
          commits: Object.freeze({ observe: live_subscription(document.commits.observe, () => { assertReadable(); void document.rev; }) }),
          schema: Object.freeze({ get: observe(() => document.schema.get()) }),
          at: observe((path: readonly number[]) => document_location(name, path, document)),
          q: observe((quadName: string) => {
            const subject = document.q(quadName);
            return subject === undefined ? undefined : write_document_quad(subject, (current, run) => edit(draft => {
              run(draft.at(current.path()) as import("../livemap/livemap.staged.js").StagedDocumentLocation);
              current.path(); // Reject retirement or disposal during argument capture.
            }), path => listenAt(name, document, path, path), assertReadable);
          }),
          css,
          document: Object.freeze({ root: observe(() => document.document.root()),
            flags: Object.freeze({ has: observe(document.document.flags.has),
              set: (target: LiveMapDocumentRequestTarget, ...names: string[]) => capture_before_submission(() => {
                const stableTarget = request(target);
                return edit(draft => { draft.flags.set(stableTarget, ...names); });
              }),
              clear: (target: LiveMapDocumentRequestTarget, ...names: string[]) => capture_before_submission(() => {
                const stableTarget = request(target);
                return edit(draft => { draft.flags.clear(stableTarget, ...names); });
              }),
            }),
            content,
            attrs: Object.freeze({
              get: observe(document.document.attrs.get.bind(document.document.attrs)),
              has: observe(document.document.attrs.has.bind(document.document.attrs)),
              keys: observe(document.document.attrs.keys.bind(document.document.attrs)),
              must: Object.freeze({ get: observe(document.document.attrs.must.get) }),
              setMany: (target: LiveMapDocumentRequestTarget, values: LiveMapDocumentAttrs) => capture_before_submission(() => {
                const stableTarget = request(target);
                const owned = capture_document_attrs(values);
                return edit(draft => { draft.attrs.setMany(stableTarget, owned); });
              }),
              dropMany: (target: LiveMapDocumentRequestTarget, names: readonly string[]) => capture_before_submission(() => {
                const stableTarget = request(target);
                const owned = capture_document_attrs_command({ kind: "dropMany", names });
                if (owned.kind !== "dropMany") throw new Error("Expected attribute removal command.");
                return edit(draft => { draft.attrs.dropMany(stableTarget, owned.names); });
              }),
              clear: (target: LiveMapDocumentRequestTarget) => capture_before_submission(() => {
                const stableTarget = request(target);
                return edit(draft => { draft.attrs.clear(stableTarget); });
              }),
              set: (target: LiveMapDocumentRequestTarget, attribute: string, value: LiveMapDocumentAttributeValue) => capture_before_submission(() => {
                const stableTarget = request(target);
                const owned = capture_document_attr_value(attribute, value, "set-attr");
                return edit(draft => { draft.attrs.set(stableTarget, attribute, owned); });
              }),
              drop: (target: LiveMapDocumentRequestTarget, attribute: string) => capture_before_submission(() => {
                const stableTarget = request(target);
                return edit(draft => { draft.attrs.drop(stableTarget, attribute); });
              }),
              replace: (target: LiveMapDocumentRequestTarget, values: LiveMapDocumentAttrs) => capture_before_submission(() => {
                const stableTarget = request(target);
                const owned = capture_document_attrs(values, "attrs");
                return edit(draft => { draft.attrs.replace(stableTarget, owned); });
              }),
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
    assertReadable();
    const binding = resolve_livemap_library_internal(map, name);
    return binding === undefined ? undefined : { ...binding, handle: lib(name) };
  }), admit }) as unknown as Pick<import("../../types/locus.core.types.js").Locus<TMap>, "stage" | "doc" | "data" | "parts" | "admit">;
}
