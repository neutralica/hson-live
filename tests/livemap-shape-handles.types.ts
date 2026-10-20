import { Hson, hsonLiveMap, type HsonSchema } from "../src/index.ts";
import type { LiveMapDocumentLibrary, LivePath } from "../src/types/livemap.types.ts";
import type { Evidence as GeneratedPageEvidence } from "./fixtures/hson-schema-document/out/internal/hson-schema/producer.ts/PageSchema.hson-schema.generated.js";

type ShapeState = Readonly<{
  object: Readonly<{ value: number }>;
  array: readonly number[];
  scalar: string;
  optional?: Readonly<{ enabled: boolean }>;
  union: Readonly<{ value: number }> | readonly number[];
}>;

declare const ShapeSchema: HsonSchema<ShapeState, "data">;

if (false) {
  const map = hsonLiveMap.fromLibraries({
    state: {
      data: {
        object: { value: 1 },
        array: [1],
        scalar: "ready",
        union: { value: 1 },
      },
      schema: ShapeSchema,
    },
  });
  const state = map.data.must("state");

  state.at(["object"]).object.setKey("value", 2);
  // @ts-expect-error Object endpoints do not expose array operations.
  state.at(["object"]).array.push(2);

  state.at(["array"]).array.push(2);
  state.at(["array"]).at([0]).replace(3);
  // @ts-expect-error Array endpoints do not expose object operations.
  state.at(["array"]).object.setKey("value", 2);

  state.at(["scalar"]).replace("done");
  // @ts-expect-error Scalar endpoints do not expose object operations.
  state.at(["scalar"]).object.setKey("value", 2);
  // @ts-expect-error Scalar endpoints do not expose array operations.
  state.at(["scalar"]).array.push(2);

  const optional = state.at(["optional"]);
  // @ts-expect-error Optional endpoints require presence refinement.
  optional.object.setKey("enabled", true);
  optional.present()?.object.setKey("enabled", true);

  const union = state.at(["union"]);
  // @ts-expect-error Union endpoints expose only common operations before refinement.
  union.object.setKey("value", 2);
  // @ts-expect-error Union endpoints expose only common operations before refinement.
  union.array.push(2);
  union.asObject()?.object.setKey("value", 2);
  union.asArray()?.array.push(2);

  const dynamicPath: LivePath = ["object"];
  const dynamic = state.at(dynamicPath);
  // @ts-expect-error Broad paths require runtime refinement.
  dynamic.object.setKey("value", 2);
  dynamic.asObject()?.object.setKey("value", 2);

  // @ts-expect-error Invalid literal paths are rejected by the existing path resolver.
  state.at(["missing"]);
}

declare const typedPage: LiveMapDocumentLibrary<GeneratedPageEvidence["value"], "page">;

if (false) {
  const page = typedPage;
  page.at([]).attrs.set("id", "next");
  page.at([]).flags.set("hidden");
  page.at([0]).attrs.keys();
  page.at([0]).insert(0, "next");
  page.at([0, 0]).replace("next");
  // @ts-expect-error Text locations do not expose element attributes.
  page.at([0, 0]).attrs;
  // @ts-expect-error Text locations do not own document content insertion.
  page.at([0, 0]).insert(0, "next");

  const PageSchema = Hson.schema`<type "document" tag "main" attrs <props <id "string" hidden <optional "flag">>> content <sequence [<tag "section" content "string">]>>` as unknown as HsonSchema<
    GeneratedPageEvidence["value"],
    "document"
  >;
  const libraries = hsonLiveMap.fromLibraries({
    page: {
      document: `<main id=hero <section "body"/>/>`,
      schema: PageSchema,
    },
  });
  const narrowedPage = libraries.doc.must("page");
  narrowedPage.at([]).attrs.set("id", "next");
  narrowedPage.at([0]).flags.set("hidden");
  narrowedPage.at([0, 0]).replace("next");
  // @ts-expect-error Library narrowing preserves text location capabilities.
  narrowedPage.at([0, 0]).attrs;
}
