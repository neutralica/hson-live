import assert from "node:assert/strict";
import { Hson, hsonLocus, type InteractionDescriptor } from "../src/index.ts";
import { MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";
import { node_to_json_value } from "../src/api/livemap/livemap.editor.ts";
import { decode_hosted_root } from "../src/api/livemap/livemap.hosted.ts";

const Count = Hson.schema`<type "data" content <value "number">>`;
const Secret = Hson.schema`<type "data" content <token "string">>`;
const listener = { event: "click", target: "element", capture: false, once: false, passive: false,
  missingTarget: "ignore", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false } as const;
const descriptor: InteractionDescriptor = { id: "save", kind: "browser", key: "save", args: null,
  subject: { library: "page", path: [0] }, listener };
const css = { rules: [{ ruleKey: "hero", selector: "main", scopes: [], declarations: [["color", "red"]] }],
  properties: [], keyframes: [], order: [{ kind: "rule", ruleKey: "hero", scopes: [] }] } as const;
const definition = {
  private: [{ name: "secret", definition: { data: { token: "hidden" }, schema: Secret } }],
  shared: [
    { name: "count", definition: { data: { value: 1 }, schema: Count } },
    { name: "page", definition: { document: "<main <button/>/>" } },
  ],
  local: [{ name: "ui", initializer: { data: { selected: false } } }],
  defaultProjection: { libraries: ["count", "page", "ui"] },
  authorizeProjection: () => ({ libraries: ["count", "page", "ui"] }),
} as const;
const locus = hsonLocus.create({ ...definition, interactions: [descriptor] });
assert.deepEqual(locus.map.capture().registry.libraries.filter((entry) => entry.scope !== "hson-internal").map((entry) => entry.name),
  ["secret", "count", "page"]);
assert.throws(() => locus.map.lib("ui"), /Unknown LiveMap Library/);
assert.ok(locus.map.capture().registry.libraries.some((entry) => entry.scope === "hson-internal"));
await locus.stage.lib("count").at(["value"]).set(2);
await locus.stage((loc) => { loc.lib("count").at(["value"]).set(3); });
assert.equal(Hson.data.materialize(locus.map.lib("count").at(["value"]).data()!), 3);
const session = await locus.session.create({ libraries: ["count", "page", "secret", "ui"] });
assert.deepEqual(session.now().libs.libraries.map((entry) => entry.name), ["count", "page"]);
assert.deepEqual(session.now().local.map((entry) => entry.name), ["ui"]);
await assert.rejects(hsonLocus.checkpoint(locus), /no durable backing/i);
locus.dispose();

const styled = hsonLocus.create({ shared: [{ name: "page", definition: { document: "<main/>" }, css }],
  logicalMapId: "styled-authority" });
assert.match(styled.map.lib("page").css.snapshot(), /color:red/);
styled.dispose();
const combinedDefinition = { shared: [{ name: "page", definition: { document: "<main <button/>/>" }, css }],
  interactions: [descriptor], logicalMapId: "combined-interactions-css" } as const;
const combined = hsonLocus.create(combinedDefinition);
assert.equal(combined.rev, 2); // CSS then descriptor; enabling the system slot creates no revision.
assert.match(combined.map.lib("page").css.snapshot(), /color:red/);
const combinedSystem = combined.map.capture().libraries.find((entry) => entry.name === "@hson/canonical-interactions");
assert.ok(combinedSystem);
const combinedValue = node_to_json_value(decode_hosted_root(combinedSystem.root));
if (typeof combinedValue !== "object" || combinedValue === null || Array.isArray(combinedValue)
  || !Array.isArray(combinedValue.descriptors)) throw new Error("Initial interaction descriptors are missing.");
assert.equal(combinedValue.descriptors.length, 1);
assert.throws(() => combined.map.lib("page").css.clearAll(), /managed|authority/i);
combined.dispose();
const combinedStorage = new MemoryCheckpointAdapter();
const combinedDurable = await hsonLocus.resume({ ...combinedDefinition, persistence: combinedStorage });
assert.equal(combinedDurable.rev, 2);
combinedDurable.dispose();
const combinedRestored = await hsonLocus.resume({ ...combinedDefinition, persistence: combinedStorage });
assert.equal(combinedRestored.rev, 2);
assert.match(combinedRestored.map.lib("page").css.snapshot(), /color:red/);
const restoredSystem = combinedRestored.map.capture().libraries.find((entry) => entry.name === "@hson/canonical-interactions");
assert.ok(restoredSystem);
const restoredValue = node_to_json_value(decode_hosted_root(restoredSystem.root));
if (typeof restoredValue !== "object" || restoredValue === null || Array.isArray(restoredValue)
  || !Array.isArray(restoredValue.descriptors)) throw new Error("Restored interaction descriptors are missing.");
assert.equal(restoredValue.descriptors.length, 1);
combinedRestored.dispose();
const storage = new MemoryCheckpointAdapter();
const durable = await hsonLocus.resume({ shared: [{ name: "page", definition: { document: "<main/>" }, css }],
  logicalMapId: "styled-durable", persistence: storage });
const revision = durable.rev;
durable.dispose();
const restored = await hsonLocus.resume({ shared: [{ name: "page", definition: { document: "<main/>" }, css }],
  logicalMapId: "styled-durable", persistence: storage });
assert.equal(restored.rev, revision);
assert.match(restored.map.lib("page").css.snapshot(), /color:red/);
restored.dispose();

assert.throws(() => hsonLocus.create({ shared: [{ name: "count", definition: { data: { value: "wrong" }, schema: Count } }] }),
  /Schema|invalid|mismatch/i);
console.log("ok - Locus grouped construction, local initializers, CSS, and interactions");
