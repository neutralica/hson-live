import { capture_before_submission } from "./capture-instruction.js";
import type { StagedDocumentLocation } from "../api/livemap/livemap.staged.js";
import {
  capture_document_attrs,
  capture_document_attrs_command,
  capture_document_attr_value,
  capture_document_content,
} from "../api/livemap/livemap.document.mutation.js";
import type { LiveMapDocumentAttributeValue, LiveMapDocumentAttrs, LiveMapDocumentContent } from "../types/livemap.types.js";

/** Own value arguments now; the governor resolves the location inside its queue. */
export function document_location_commands(edit: (run: (location: StagedDocumentLocation) => void) => Promise<void>) {
  return Object.freeze({
    replace: (value: LiveMapDocumentContent) => capture_before_submission(() => {
      const owned = capture_document_content(value, "replace-content");
      return edit(location => location.replace(owned));
    }),
    delete: () => edit(location => location.delete()),
    insert: (index: number, value: LiveMapDocumentContent) => capture_before_submission(() => {
      const owned = capture_document_content(value, "insert-content");
      return edit(location => location.insert(index, owned));
    }),
    move: (from: number, to: number) => edit(location => location.move(from, to)),
    attrs: Object.freeze({
      set: (name: string, value: LiveMapDocumentAttributeValue) => capture_before_submission(() => {
        const owned = capture_document_attr_value(name, value, "set-attr");
        return edit(location => location.attrs.set(name, owned));
      }),
      drop: (name: string) => edit(location => location.attrs.drop(name)),
      replace: (values: LiveMapDocumentAttrs) => capture_before_submission(() => {
        const owned = capture_document_attrs(values, "attrs");
        return edit(location => location.attrs.replace(owned));
      }),
      setMany: (values: LiveMapDocumentAttrs) => capture_before_submission(() => {
        const owned = capture_document_attrs(values);
        return edit(location => location.attrs.setMany(owned));
      }),
      dropMany: (names: readonly string[]) => capture_before_submission(() => {
        const command = capture_document_attrs_command({ kind: "dropMany", names });
        if (command.kind !== "dropMany") throw new Error("Expected attribute removal command.");
        return edit(location => location.attrs.dropMany(command.names));
      }),
      clear: () => edit(location => location.attrs.clear()),
    }),
    flags: Object.freeze({
      set: (...names: string[]) => edit(location => location.flags.set(...names)),
      clear: (...names: string[]) => edit(location => location.flags.clear(...names)),
    }),
  });
}
