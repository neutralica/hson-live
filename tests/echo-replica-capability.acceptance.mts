import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { create_echo_aggregate_replica_capability_internal } from "../src/api/echo/echo.aggregate-replica.lifecycle.ts";

const StateSchema = Hson.schema`<type "data" content <value "number">>`;
const registry = () => hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema: StateSchema } });

{
  const map = registry();
  const replica = create_echo_aggregate_replica_capability_internal(map);
  assert.throws(() => map.lib("state").at(["value"]).set(1), /managed|reserved|controlled/i);
  replica.markFailed(new Error("recoverable"));
  assert.equal(replica.ready, false);
  replica.markReady();
  assert.equal(replica.ready, true);
  replica.dispose();
  replica.dispose();
  assert.equal(replica.ready, false);
  assert.doesNotThrow(() => map.lib("state").at(["value"]).set(2));
}

process.stdout.write("Echo registry capability acceptance passed.\n");
