import { Hson, hsonLiveMap, type HsonSchema } from "../src/index.ts";
import type { LiveMapDocumentLibrary, LivePath } from "../src/types/livemap.types.ts";
import type { Evidence as GeneratedPageEvidence } from "./fixtures/hson-schema-document/producer.PageSchema.hson-schema.generated.ts";

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
  const state = map.lib("state");

  state.at(["object"]).setKey("value", 2);
  // @ts-expect-error Object endpoints do not expose array operations.
  state.at(["object"]).push(2);

  state.at(["array"]).push(2);
  state.at(["array"]).at([0]).replace(3);
  // @ts-expect-error Array endpoints do not expose object operations.
  state.at(["array"]).setKey("value", 2);

  state.at(["scalar"]).replace("done");
  // @ts-expect-error Scalar endpoints do not expose object operations.
  state.at(["scalar"]).setKey("value", 2);
  // @ts-expect-error Scalar endpoints do not expose array operations.
  state.at(["scalar"]).push(2);

  const optional = state.at(["optional"]);
  // @ts-expect-error Optional endpoints require presence refinement.
  optional.setKey("enabled", true);
  optional.present()?.setKey("enabled", true);

  const union = state.at(["union"]);
  // @ts-expect-error Union endpoints expose only common operations before refinement.
  union.setKey("value", 2);
  // @ts-expect-error Union endpoints expose only common operations before refinement.
  union.push(2);
  union.asObject()?.setKey("value", 2);
  union.asArray()?.push(2);

  const dynamicPath: LivePath = ["object"];
  const dynamic = state.at(dynamicPath);
  // @ts-expect-error Broad paths require runtime refinement.
  dynamic.setKey("value", 2);
  dynamic.asObject()?.setKey("value", 2);

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
  const narrowedPage = libraries.lib("page");
  narrowedPage.at([]).attrs.set("id", "next");
  narrowedPage.at([0]).flags.set("hidden");
  narrowedPage.at([0, 0]).replace("next");
  // @ts-expect-error Library narrowing preserves text location capabilities.
  narrowedPage.at([0, 0]).attrs;
}
