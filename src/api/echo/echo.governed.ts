import type { LiveMap, LiveMapDocumentLibrary, LiveMapDataLibrary, LivePath,
  LiveMapCssOp, LiveMapDocumentContent, LiveMapDocumentAttrs, LiveMapDocumentAttributeValue,
  LiveMapDocumentCommitTarget } from "../../types/livemap.types.js";
import type { EchoLibrary } from "../../types/governor.types.js";
import { client_library_source_internal } from "../livemap/livemap.libraries.js";
import { echo_document_authority_for, type EchoDocumentAuthority } from "./echo.document-authority.js";
import { parse_document_stylesheet } from "../../internal/css/parse-document-stylesheet.js";
import { register_governed_document, governed_document_element_target, governed_document_slot,
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
          at: raw.at.bind(raw), render: raw.render.bind(raw),
          document: Object.freeze({ root: raw.document.root.bind(raw.document), content: raw.document.content,
            attrs: raw.document.attrs, flags: raw.document.flags }),
          css: raw.css, commits: raw.commits, schema: raw.schema })
        : Object.freeze({ source, mode: raw.mode, get rev() { return raw.rev; }, root: () => raw.root(),
          snap: raw.snap.bind(raw), at: raw.at.bind(raw), schema: raw.schema });
      if (raw.mode === "document") register_governed_document(local, raw);
      selected.set(name, Object.freeze({ raw, handle: local as EchoLibrary }));
      return local as EchoLibrary;
    }
    if (raw.mode !== "document") {
      const data = raw as LiveMapDataLibrary;
      const at = (path: LivePath) => {
        const stable = must_live_path(path);
        const location = data.at(stable);
        return Object.freeze({ get rev() { return location.rev; }, path: () => location.path(),
          snap: () => location.snap(), data: () => location.data(),
          watch: location.watch.bind(location), kind: () => location.kind(),
          at: (child: LivePath) => at([...stable, ...must_live_path(child)]),
        });
      };
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
    const location = (path: readonly number[]) => {
      const stable = validate_document_path(path);
      const rawLocation = document.at(stable);
      return Object.freeze({
        get rev() { return rawLocation.rev; }, path: () => rawLocation.path(),
        snap: () => rawLocation.snap(), watch: rawLocation.watch.bind(rawLocation), kind: () => rawLocation.kind(),
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
        attrs: Object.freeze({
          get: (key: string) => document.document.attrs.get(governed_document_element_target(document, stable), key),
          has: (key: string) => document.document.attrs.has(governed_document_element_target(document, stable), key),
          keys: () => document.document.attrs.keys(governed_document_element_target(document, stable)),
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
    const css = Object.assign(
      (operation: LiveMapCssOp) => enqueue(() => Object.freeze({ name: "document.css" as const, payload: { operation } })),
      { snapshot: () => document.css.snapshot(), has: (key: string) => document.css.has(key),
        list: () => document.css.list(), get: (key: string) => document.css.get(key),
        stylesheet: (text: string) => enqueue(() => Object.freeze({ name: "document.css" as const,
          payload: { operation: Object.freeze({ domain: "css" as const, kind: "replace" as const,
            stylesheet: parse_document_stylesheet(text, []) }) } })) },
    );
    const content = Object.assign(() => document.document.content(), {
      replace: (where: LiveMapDocumentCommitTarget, index: number, value: LiveMapDocumentContent) => enqueue(() => Object.freeze({
        name: "document.content.replace" as const, payload: { target: where, index, replacement: value },
      })),
      insert: (where: LiveMapDocumentCommitTarget, index: number, value: LiveMapDocumentContent) => enqueue(() => Object.freeze({
        name: "document.content.insert" as const, payload: { target: where, index, content: value },
      })),
      remove: (where: LiveMapDocumentCommitTarget, index: number) => enqueue(() => Object.freeze({
        name: "document.content.remove" as const, payload: { target: where, index },
      })),
      move: (where: LiveMapDocumentCommitTarget, from: number, to: number) => enqueue(() => Object.freeze({
        name: "document.content.move" as const, payload: { target: where, from, to },
      })),
    });
    const governed = Object.freeze({ source, mode: "document" as const,
      get rev() { return document.rev; }, root: () => document.root(), render: () => document.render(),
      commits: document.commits, schema: Object.freeze({ get: () => document.schema.get() }),
      at: location, css,
      document: Object.freeze({ root: () => document.document.root(),
        content, attrs: Object.freeze({
          get: document.document.attrs.get.bind(document.document.attrs),
          has: document.document.attrs.has.bind(document.document.attrs),
          keys: document.document.attrs.keys.bind(document.document.attrs),
          set: (where: LiveMapDocumentCommitTarget, key: string, value: LiveMapDocumentAttributeValue) => enqueue(() => Object.freeze({
            name: "document.attrs.set" as const, payload: { target: where, name: key, value },
          })),
          drop: (where: LiveMapDocumentCommitTarget, key: string) => enqueue(() => Object.freeze({
            name: "document.attrs.drop" as const, payload: { target: where, name: key },
          })),
          replace: (where: LiveMapDocumentCommitTarget, values: LiveMapDocumentAttrs) => enqueue(() => Object.freeze({
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
