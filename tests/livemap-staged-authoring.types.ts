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
writer.lib("plain").at(["count"]).set(1);
writer.lib("typed").at(["count"]).set(2);
writer.lib("typed").at(["mode"]).replace("dark");
writer.lib("page").at([0]).attrs.set("id", "main");

// @ts-expect-error A known data library has no document graph operation.
writer.lib("plain").graph({ domain: "graph", op: "replace-root", mode: "document", root: {} });
// @ts-expect-error Schema-governed count is numeric.
writer.lib("typed").at(["count"]).set("wrong");
// @ts-expect-error A known document library has no data setter.
writer.lib("page").at([0]).set(1);
// @ts-expect-error A Schema-governed data path cannot descend through a number.
writer.lib("typed").at(["count", "nested"]);

const dynamicName: string = "later";
const dynamic = writer.lib(dynamicName);
if (dynamic.mode === "document") dynamic.graph({ domain: "graph", op: "replace-root", mode: "document", root: map.lib("page").root() });
else dynamic.at(["count"]).set(1);

const batchCommit = map.batch(batch => {
  const result: void = batch.lib("typed").at(["count"]).set(2);
  void result;
  batch.lib("page").at([0]).attrs.set("id", "next");
});
const changed: boolean = batchCommit.changed;
void changed;
// @ts-expect-error The batch lifetime is synchronous.
map.batch(async batch => { batch.lib("typed").at(["count"]).set(3); });
// @ts-expect-error Batch has no direct one-write chain.
map.batch.lib("typed");

declare const locus: Locus<typeof map>;
const direct: Promise<void> = locus.lib("typed").at(["count"]).set(3);
const grouped: Promise<void> = locus.stage(stage => {
  const staged: void = stage.lib("typed").at(["count"]).set(4);
  void staged;
  stage.lib("page").at([0]).attrs.set("id", "final");
});
void direct;
void grouped;
// @ts-expect-error A stage callback cannot span awaits.
locus.stage(async stage => { stage.lib("typed").at(["count"]).set(5); });
// @ts-expect-error A Schema-governed direct setter rejects a string count.
locus.lib("typed").at(["count"]).set("wrong");
// @ts-expect-error Stage has no nested batch namespace.
locus.stage.batch(() => {});
// @ts-expect-error Reads and updates are deliberately absent from staged locations.
locus.lib("typed").at(["count"]).update(value => value + 1);
