import { parentPort } from "node:worker_threads";
import {
  empty_portable_document_stylesheet,
  set_portable_document_declaration,
  set_portable_document_property,
  set_portable_document_keyframes,
  render_portable_document_stylesheet,
  encode_portable_document_stylesheet,
} from "../../src/internal/css/portable-document-stylesheet.ts";

let sheet = empty_portable_document_stylesheet();
sheet = set_portable_document_declaration(sheet, "body", "body", "color", "navy");
sheet = set_portable_document_declaration(sheet, "media", "body", "color", "white", ["@media (max-width: 600px)"]);
sheet = set_portable_document_property(sheet, ["--phase", "<number>", "0"]);
sheet = set_portable_document_keyframes(sheet, { name: "fade", steps: { from: { opacity: "0" }, to: { opacity: "1" } } });
parentPort?.postMessage({ record: encode_portable_document_stylesheet(sheet), css: render_portable_document_stylesheet(sheet) });
