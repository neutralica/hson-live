import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { create_echo_aggregate_replica_capability_internal } from "../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { create_echo_with_replica_loaders_internal } from "../src/api/echo/echo.ts";
import type { EchoReplicaLoaders } from "../src/api/echo/echo.lazy.ts";

const StateSchema = Hson.schema`<type "data" content <value "number">>`;
const registry = () => hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema: StateSchema } });
const socket = Object.freeze({
  send(_raw: string) {},
  close() {},
  onMessage(_listener: (raw: string) => void) { return () => {}; },
  onClose(_listener: () => void) { return () => {}; },
});

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

{
  const map = registry();
  let loads = 0;
  const loaders: EchoReplicaLoaders = Object.freeze({
    async aggregate() {
      loads += 1;
      throw new Error("unexpected loader invocation");
    },
  });
  const echo = create_echo_with_replica_loaders_internal({
    socket,
    map,
    recovery: { logicalMapId: "registry-capability" },
  }, loaders);
  assert.equal(echo.map, map);
  assert.equal(echo.recovery.status, "idle");
  assert.equal(loads, 0);
  assert.throws(() => map.lib("state").at(["value"]).set(1), /managed|reserved|controlled/i);
  echo.dispose();
  assert.equal(loads, 0);
  assert.doesNotThrow(() => map.lib("state").at(["value"]).set(2));
}

process.stdout.write("Echo registry capability acceptance passed.\n");
