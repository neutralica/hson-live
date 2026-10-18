import { empty_portable_document_stylesheet } from "../../internal/css/portable-document-stylesheet.js";
import { capture_document_attrs_command } from "../livemap/livemap.document.mutation.js";
import { document_css_reads, document_css_commands, capture_document_css_command, lower_document_css_command } from "../../internal/document-css-commands.js";
import { read_data_location, read_document_location } from "../../internal/library-observation.js";
import { mark_browser_html_producer } from "../../internal/browser-html-producer.js";
import type { LiveMap, LiveMapDocumentLibrary, LiveMapDataLibrary, LivePath,
  LiveMapCssOp, LiveMapDocumentContent, LiveMapDocumentAttrs, LiveMapDocumentAttributeValue,
  LiveMapDocumentRequestTarget } from "../../types/livemap.types.js";
import type { EchoLibrary } from "../../types/governor.types.js";
import { client_library_source_internal } from "../livemap/livemap.libraries.js";
import { echo_document_authority_for, type EchoDocumentAuthority } from "./echo.document-authority.js";
import { parse_document_stylesheet } from "../../internal/css/parse-document-stylesheet.js";
import { read_document_quad, register_governed_document, governed_document_element_target, governed_document_slot,
  governed_document_remove_slot, governed_document_insert_slot, governed_document_move_target } from "../../internal/governed-document.js";
import { validate_document_path } from "../livemap/livemap.document.path.js";
import { must_live_path } from "../livemap/livemap.guard.js";

/** The selected map library stays private; source determines which writes exist. */
export function make_echo_library_selector(
  map: LiveMap,
  ensureDocumentAuthority: (selected: LiveMapDocumentLibrary) => EchoDocumentAuthority,
): (name: string) => EchoLibrary {
  const selected = new Map<string, Readonly<{ raw: LiveMapDataLibrary | LiveMapDocumentLibrary; handle: EchoLibrary }>>();
  const select = (name: string): EchoLibrary => {
    const raw = map.lib(name);
    const cached = selected.get(name);
    if (cached?.raw === raw) return cached.handle;
    const source = client_library_source_internal(raw);
    if (source === undefined) throw new Error("Echo Library ownership is unavailable.");
    if (source === "client-local") {
      const local = raw.mode === "document"
        ? Object.freeze({ source, mode: raw.mode, get rev() { return raw.rev; }, root: () => raw.root(),
          at: raw.at.bind(raw), render: mark_browser_html_producer(() => raw.render()),
          document: Object.freeze({ root: raw.document.root.bind(raw.document), content: raw.document.content,
            attrs: raw.document.attrs, flags: raw.document.flags }),
          q: raw.q.bind(raw), css: raw.css, commits: raw.commits, schema: raw.schema })
        : Object.freeze({ source, mode: raw.mode, get rev() { return raw.rev; }, root: () => raw.root(),
          snap: raw.snap.bind(raw), at: raw.at.bind(raw), schema: raw.schema });
      if (raw.mode === "document") register_governed_document(local, raw);
      selected.set(name, Object.freeze({ raw, handle: local as EchoLibrary }));
      return local as EchoLibrary;
    }
    if (raw.mode !== "document") {
      const data = raw as LiveMapDataLibrary;
      const at = (path: LivePath) => read_data_location(data.at(must_live_path(path)));
      const projected = Object.freeze({ source, mode: data.mode, get rev() { return data.rev; },
        root: () => data.root(), snap: data.snap.bind(data), at,
        schema: Object.freeze({ get: () => data.schema.get() }) });
      selected.set(name, Object.freeze({ raw, handle: projected as EchoLibrary }));
      return projected as EchoLibrary;
    }
    const document = raw as LiveMapDocumentLibrary;
    const authority = ensureDocumentAuthority(document) ?? echo_document_authority_for(document);
    if (authority === undefined) throw new Error("Projected document authority is unavailable.");
    const enqueue = authority.enqueue;
    const flag_values = (names: readonly string[]) => {
      const command = capture_document_attrs_command({ kind: "setFlags", names });
      if (command.kind === "setMany") throw new Error("Expected semantic flag names.");
      return Object.freeze(Object.fromEntries(command.names.map(name => [name, name])));
    };
    const location = (path: readonly number[]): NonNullable<ReturnType<import("../../types/governor.types.js").EchoDocumentLocation["asElement"]>> => {
      const stable = validate_document_path(path);
      const rawLocation = document.at(stable);
      return Object.freeze({
        get rev() { return rawLocation.rev; }, path: () => rawLocation.path(),
        snap: () => rawLocation.snap(), watch: rawLocation.watch.bind(rawLocation), kind: () => rawLocation.kind(),
        present: () => rawLocation.present() === undefined ? undefined : location(stable),
        asElement: () => rawLocation.asElement() === undefined ? undefined : location(stable),
        asRoot: () => rawLocation.asRoot() === undefined ? undefined : location(stable),
        asText: () => rawLocation.asText() === undefined ? undefined : location(stable),
        at: (child: readonly number[]) => location([...stable, ...child]),
        id: (id: string) => { const found = rawLocation.id(id); return found === undefined ? undefined : location(found.path()); },
        replace: (value: LiveMapDocumentContent) => enqueue(() => {
          const slot = governed_document_slot(document, stable);
          return Object.freeze({ name: "document.content.replace" as const,
            payload: { target: slot.target, index: slot.index, replacement: value } });
        }),
        delete: () => enqueue(() => {
          const slot = governed_document_remove_slot(document, stable);
          return Object.freeze({ name: "document.content.remove" as const,
            payload: { target: slot.target, index: slot.index } });
        }),
        insert: (at: number, value: LiveMapDocumentContent) => enqueue(() => {
          const slot = governed_document_insert_slot(document, stable, at, value);
          return Object.freeze({ name: "document.content.insert" as const,
            payload: { target: slot.target, index: slot.index, content: slot.content } });
        }),
        move: (from: number, to: number) => enqueue(() => Object.freeze({
          name: "document.content.move" as const,
          payload: { target: governed_document_move_target(document, stable), from, to },
        })),
        flags: Object.freeze({ ...read_document_location(rawLocation).flags,
          set: (...names: string[]) => enqueue(() => ({ name: "document.attrs.setMany",
            payload: { target: governed_document_element_target(document, stable), values: flag_values(names) } })),
        }),
        attrs: Object.freeze({
          must: read_document_location(rawLocation).attrs.must,
          get: (key: string) => document.document.attrs.get(governed_document_element_target(document, stable), key),
          has: (key: string) => document.document.attrs.has(governed_document_element_target(document, stable), key),
          keys: () => document.document.attrs.keys(governed_document_element_target(document, stable)),
          setMany: (values: LiveMapDocumentAttrs) => enqueue(() => ({ name: "document.attrs.setMany", payload: { target: governed_document_element_target(document, stable), values } })),
          dropMany: (names: readonly string[]) => enqueue(() => ({ name: "document.attrs.dropMany", payload: { target: governed_document_element_target(document, stable), names } })),
          clear: () => enqueue(() => ({ name: "document.attrs.clear", payload: { target: governed_document_element_target(document, stable) } })),
          set: (key: string, value: LiveMapDocumentAttributeValue) => enqueue(() => Object.freeze({
            name: "document.attrs.set" as const,
            payload: { target: governed_document_element_target(document, stable), name: key, value },
          })),
          drop: (key: string) => enqueue(() => Object.freeze({
            name: "document.attrs.drop" as const,
            payload: { target: governed_document_element_target(document, stable), name: key },
          })),
          replace: (values: LiveMapDocumentAttrs) => enqueue(() => Object.freeze({
            name: "document.attrs.replace" as const,
            payload: { target: governed_document_element_target(document, stable), values },
          })),
        }),
      });
    };
    // These commands author complete units and need no projected-state read/modify/write.
    const cssCommands = document_css_commands(command => enqueue(() => {
      document.root();
      const operation = lower_document_css_command(empty_portable_document_stylesheet(), capture_document_css_command(command));
      return operation === undefined ? undefined : { name: "document.css", payload: { operation } };
    }));
    const cssReads = document_css_reads(document.css);
    const css = Object.assign(
      (operation: LiveMapCssOp) => enqueue(() => Object.freeze({ name: "document.css" as const, payload: { operation } })),
      { ...cssReads, clearAll: cssCommands.clearAll,
        atProperty: Object.freeze({ ...cssCommands.atProperty, ...cssReads.atProperty }),
        keyframes: Object.freeze({ ...cssCommands.keyframes, ...cssReads.keyframes }),
        stylesheet: (text: string) => enqueue(() => Object.freeze({ name: "document.css" as const,
          payload: { operation: Object.freeze({ domain: "css" as const, kind: "replace" as const,
            stylesheet: parse_document_stylesheet(text, []) }) } })) },
    );
    const content = Object.assign(() => document.document.content(), {
      replace(where: LiveMapDocumentRequestTarget, index: number, value: LiveMapDocumentContent) {
        if (arguments.length !== 3) throw new TypeError("Document content replacement requires exactly three arguments; caller-authored lineage is unsupported.");
        return enqueue(() => Object.freeze({ name: "document.content.replace" as const, payload: { target: where, index, replacement: value } }));
      },
      insert: (where: LiveMapDocumentRequestTarget, index: number, value: LiveMapDocumentContent) => enqueue(() => Object.freeze({
        name: "document.content.insert" as const, payload: { target: where, index, content: value },
      })),
      remove: (where: LiveMapDocumentRequestTarget, index: number) => enqueue(() => Object.freeze({
        name: "document.content.remove" as const, payload: { target: where, index },
      })),
      move: (where: LiveMapDocumentRequestTarget, from: number, to: number) => enqueue(() => Object.freeze({
        name: "document.content.move" as const, payload: { target: where, from, to },
      })),
    });
    const governed = Object.freeze({ source, mode: "document" as const,
      get rev() { return document.rev; }, root: () => document.root(), render: mark_browser_html_producer(() => document.render()),
      commits: document.commits, schema: Object.freeze({ get: () => document.schema.get() }),
      at: location, css,
      q: (name: string) => { const subject = document.q(name); return subject === undefined ? undefined : read_document_quad(subject); },
      document: Object.freeze({ root: () => document.document.root(),
        content, flags: Object.freeze({ has: document.document.flags.has,
          set: (target: LiveMapDocumentRequestTarget, ...names: string[]) => enqueue(() => {
            document.root(); return { name: "document.attrs.setMany", payload: { target, values: flag_values(names) } };
          }),
        }), attrs: Object.freeze({
          must: document.document.attrs.must,
          setMany: (target: LiveMapDocumentRequestTarget, values: LiveMapDocumentAttrs) => enqueue(() => { document.root(); return { name: "document.attrs.setMany", payload: { target, values } }; }),
          dropMany: (target: LiveMapDocumentRequestTarget, names: readonly string[]) => enqueue(() => { document.root(); return { name: "document.attrs.dropMany", payload: { target, names } }; }),
          clear: (target: LiveMapDocumentRequestTarget) => enqueue(() => { document.root(); return { name: "document.attrs.clear", payload: { target } }; }),
          get: document.document.attrs.get.bind(document.document.attrs),
          has: document.document.attrs.has.bind(document.document.attrs),
          keys: document.document.attrs.keys.bind(document.document.attrs),
          set: (where: LiveMapDocumentRequestTarget, key: string, value: LiveMapDocumentAttributeValue) => enqueue(() => Object.freeze({
            name: "document.attrs.set" as const, payload: { target: where, name: key, value },
          })),
          drop: (where: LiveMapDocumentRequestTarget, key: string) => enqueue(() => Object.freeze({
            name: "document.attrs.drop" as const, payload: { target: where, name: key },
          })),
          replace: (where: LiveMapDocumentRequestTarget, values: LiveMapDocumentAttrs) => enqueue(() => Object.freeze({
            name: "document.attrs.replace" as const, payload: { target: where, values },
          })),
        }),
      }),
    });
    register_governed_document(governed, document);
    selected.set(name, Object.freeze({ raw, handle: governed as EchoLibrary }));
    return governed as EchoLibrary;
  };
  return select;
}
