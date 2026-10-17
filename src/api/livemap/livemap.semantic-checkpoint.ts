import type { LiveMapSemanticCheckpoint } from "./livemap.internal.js";
import { registry_from_entries } from "./livemap.hosted.js";
import { admit_public_livemap_root } from "./livemap.node-admission.js";
import { prepare_livemap_root } from "./livemap.document.js";
import { decode_document_quads, own_document_quads, assert_portable_document_css_correspondence } from "./livemap.document.quad.js";
import { decode_document_scoped_library, own_document_scopes } from "./livemap.document.scoped-portable.js";
import { decode_portable_document_stylesheet, encode_portable_document_stylesheet } from "../../internal/css/portable-document-stylesheet.js";
import { own_data_library_validation, validate_data_library } from "./livemap.parts.js";
import { HsonSchema } from "../schema/hson-schema.js";
import { validate_hson_schema_graph } from "../../internal/schema-hson-validation/validate-canonical-hson.js";

function exact(value: object, keys: readonly string[]): void {
  if (typeof value !== "object" || value === null
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError("Invalid semantic checkpoint record.");
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => typeof key !== "string" || !keys.includes(key)
    || !Object.getOwnPropertyDescriptor(value, key)?.enumerable
    || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))) {
    throw new TypeError("Invalid semantic checkpoint fields.");
  }
}

function entries<T>(value: readonly T[]): readonly T[] {
  if (!Array.isArray(value) || value.length > 1_024 || Reflect.ownKeys(value).length !== value.length + 1) {
    throw new TypeError("Invalid semantic checkpoint Library array.");
  }
  const result: T[] = [];
  for (let index = 0; index < value.length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, index);
    if (!field?.enumerable || !Object.hasOwn(field, "value")) throw new TypeError("Invalid checkpoint Library entry.");
    result.push(field.value);
  }
  return result;
}

/** Own and admit the entire existing checkpoint before allocation or storage callbacks.
 * Scoped and flat correspondence are alternative contracts, including explicit empty state. @internal
 */
export function own_semantic_checkpoint(input: LiveMapSemanticCheckpoint): LiveMapSemanticCheckpoint {
  exact(input, ["authority", "revision", "registry", "libraries"]);
  exact(input.authority, ["logicalMapId", "incarnationId"]);
  exact(input.registry, ["format", "digest", "libraries"]);
  if (!Number.isSafeInteger(input.revision) || input.revision < 0
    || typeof input.authority.logicalMapId !== "string" || !input.authority.logicalMapId
    || typeof input.authority.incarnationId !== "string" || !input.authority.incarnationId
    || input.registry.format !== "hson-hosted-registry") throw new TypeError("Invalid semantic checkpoint authority.");
  const contracts = entries(input.registry.libraries), material = entries(input.libraries), names = new Set<string>();
  for (const entry of contracts) {
    exact(entry, ["name", "mode", "schema", "schemaDigest", "rootCodec",
      ...(Object.hasOwn(entry, "scope") ? ["scope"] : []), ...(Object.hasOwn(entry, "validation") ? ["validation"] : [])]);
    if (typeof entry.name !== "string" || !entry.name || entry.name.length > 1_024 || names.has(entry.name)
      || !["document", "data-object", "data-array", "data-string", "data-number", "data-boolean", "data-null"].includes(entry.mode)
      || (entry.scope !== undefined && entry.scope !== "hson-internal") || entry.rootCodec !== "hson-exact-value") {
      throw new TypeError("Invalid semantic checkpoint Library contract.");
    }
    names.add(entry.name);
  }
  const registry = registry_from_entries(contracts);
  if (registry.digest !== input.registry.digest || material.length !== registry.libraries.length) {
    throw new TypeError("Invalid semantic checkpoint registry.");
  }
  const authority = Object.freeze({ ...input.authority }), revision = input.revision;
  const libraries = material.map((library, index) => {
    const entry = registry.libraries[index]!;
    exact(library, ["name", "root", ...(entry.mode === "document" ? ["css"] : []),
      ...(Object.hasOwn(library, "quads") ? ["quads"] : []), ...(Object.hasOwn(library, "scopes") ? ["scopes"] : [])]);
    if (library.name !== entry.name) throw new TypeError("Invalid semantic checkpoint Library order.");
    const scopes = own_document_scopes(library);
    if (scopes !== undefined && entry.mode !== "document") throw new TypeError("Scoped checkpoint requires a document Library.");
    const root = admit_public_livemap_root(library.root, entry.mode === "document" ? "document" : "data", "Semantic checkpoint");
    const prepared = prepare_livemap_root(root, entry.mode === "document" ? "document" : "data");
    if (prepared.mode !== entry.mode) throw new TypeError("Checkpoint root mode disagrees with registry.");
    validate_hson_schema_graph(HsonSchema.fromHson(entry.schema), prepared.root);
    validate_data_library(root, entry.mode, own_data_library_validation(entry));
    if (scopes !== undefined) return Object.freeze({ name: library.name,
      ...decode_document_scoped_library({ root, scopes, css: library.css }) });
    const quads = decode_document_quads(own_document_quads(library), root, entry.mode);
    if (Object.hasOwn(library, "quads") && quads === undefined) throw new TypeError("Invalid checkpoint QUAD field.");
    const css = entry.mode === "document"
      ? encode_portable_document_stylesheet(decode_portable_document_stylesheet(library.css)) : undefined;
    if (css !== undefined) assert_portable_document_css_correspondence(root, "document", quads, css);
    return Object.freeze({ name: library.name, root, ...(quads === undefined ? {} : { quads }),
      ...(css === undefined ? {} : { css }) });
  });
  return Object.freeze({ authority, revision, registry, libraries: Object.freeze(libraries) });
}
