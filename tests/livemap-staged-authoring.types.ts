import { hsonLiveMap, type HsonSchema, type Locus } from "../src/index.js";
import type { LiveMapStagedWriter } from "../src/types/livemap.types.js";
import type { Evidence as PageEvidence } from "./fixtures/hson-schema-document/out/internal/hson-schema/producer.ts/PageSchema.hson-schema.generated.js";

declare const stateSchema: HsonSchema<{ count: number; mode: "light" | "dark" }, "data">;
declare const pageSchema: HsonSchema<PageEvidence["value"], "document">;

const map = hsonLiveMap.fromLibraries({
  plain: { data: { count: 0 } },
  typed: { data: { count: 0, mode: "light" }, schema: stateSchema },
  page: { document: '<main id="hero" <section "body"/>/>', schema: pageSchema },
});

declare const writer: LiveMapStagedWriter<typeof map, void>;
writer.data.must("plain").at(["count"]).set(1);
writer.data.must("typed").at(["count"]).set(2);
writer.data.must("typed").at(["mode"]).replace("dark");
writer.doc.must("page").at([0]).attrs.set("id", "main");

// @ts-expect-error A known data library has no document graph operation.
writer.data.must("plain").graph({ domain: "graph", op: "replace-root", mode: "document", root: {} });
// @ts-expect-error Schema-governed count is numeric.
writer.data.must("typed").at(["count"]).set("wrong");
// @ts-expect-error A known document library has no data setter.
writer.doc.must("page").at([0]).set(1);
// @ts-expect-error A Schema-governed data path cannot descend through a number.
writer.data.must("typed").at(["count", "nested"]);

const dynamicName: string = "later";
const dynamic = writer.data.must(dynamicName);
writer.doc.must(dynamicName).graph({ domain: "graph", op: "replace-root", mode: "document", root: map.doc.must("page").root() });
dynamic.at(["count"]).set(1);

const batchCommit = map.batch(batch => {
  const result: void = batch.data.must("typed").at(["count"]).set(2);
  void result;
  batch.doc.must("page").at([0]).attrs.set("id", "next");
});
const changed: boolean = batchCommit.changed;
void changed;
// @ts-expect-error The batch lifetime is synchronous.
map.batch(async batch => { batch.data.must("typed").at(["count"]).set(3); });
// @ts-expect-error Batch has no direct one-write chain.
map.batch.data.must("typed");

declare const locus: Locus<typeof map>;
const direct: Promise<void> = locus.data.must("typed").at(["count"]).set(3);
const grouped: Promise<void> = locus.stage(stage => {
  const staged: void = stage.data.must("typed").at(["count"]).set(4);
  void staged;
  stage.doc.must("page").at([0]).attrs.set("id", "final");
});
void direct;
void grouped;
// @ts-expect-error A stage callback cannot span awaits.
locus.stage(async stage => { stage.data.must("typed").at(["count"]).set(5); });
// @ts-expect-error A Schema-governed direct setter rejects a string count.
locus.data.must("typed").at(["count"]).set("wrong");
// @ts-expect-error Stage has no nested batch namespace.
locus.stage.batch(() => {});
// @ts-expect-error Reads and updates are deliberately absent from staged locations.
locus.data.must("typed").at(["count"]).update(value => value + 1);
