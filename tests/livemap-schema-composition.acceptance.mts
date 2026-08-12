// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run(); checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`);
}

const Seat = hson.liveMap.schema.define((s) => s.exact({ connected: s.boolean }));
const State = hson.liveMap.schema.define((s) => s.exact({ left: Seat, right: Seat }));

check("defined exact schemas nest in later exact schemas", () => {
  assert.equal(State.validateRoot({ left: { connected: true }, right: { connected: false } }).ok, true);
});
check("nested defined evidence rejects missing fields", () => {
  assert.equal(State.validateRoot({ left: {}, right: { connected: false } }).ok, false);
});
check("nested defined evidence rejects unknown exact fields", () => {
  assert.equal(State.validateRoot({ left: { connected: true, extra: 1 }, right: { connected: false } }).ok, false);
});
check("one child schema can appear twice in one parent", () => {
  const map = hson.liveMap.fromJson({ left: { connected: true }, right: { connected: false } }).schema.use(State);
  assert.equal(map.at(["left", "connected"]).snap(), true);
  assert.equal(map.at(["right", "connected"]).snap(), false);
});
check("one child schema can appear in independent parents", () => {
  const Left = hson.liveMap.schema.define((s) => s.exact({ left: Seat }));
  const Right = hson.liveMap.schema.define((s) => s.exact({ right: Seat }));
  assert.equal(Left.validateRoot({ left: { connected: true } }).ok, true);
  assert.equal(Right.validateRoot({ right: { connected: false } }).ok, true);
});
check("defined schema composes as an array item", () => {
  const Seats = hson.liveMap.schema.define((s) => s.array(Seat));
  assert.equal(Seats.validateRoot([{ connected: true }, { connected: false }]).ok, true);
});
check("defined schema composes through postfix array", () => {
  const Seats = hson.liveMap.schema.define(() => Seat.array);
  assert.equal(Seats.validateRoot([{ connected: true }]).ok, true);
});
check("defined schema composes as a tuple member", () => {
  const Pair = hson.liveMap.schema.define((s) => s.tuple(Seat, Seat));
  assert.equal(Pair.validateRoot([{ connected: true }, { connected: false }]).ok, true);
});
check("defined schema composes as a pick branch", () => {
  const Choice = hson.liveMap.schema.define((s) => s.pick(Seat, s.string));
  assert.equal(Choice.validateRoot({ connected: true }).ok, true);
  assert.equal(Choice.validateRoot("none").ok, true);
});
check("defined schema composes as a record value", () => {
  const Seats = hson.liveMap.schema.define((s) => s.record(Seat));
  assert.equal(Seats.validateRoot({ a: { connected: true }, b: { connected: false } }).ok, true);
});
check("defined schema composes as a refine base", () => {
  const Connected = hson.liveMap.schema.define((s) => s.refine(Seat, "connected", (value) => value.connected));
  assert.equal(Connected.validateRoot({ connected: true }).ok, true);
  assert.equal(Connected.validateRoot({ connected: false }).ok, false);
});
check("defined schema composes through lazy", () => {
  const LazySeat = hson.liveMap.schema.define((s) => s.lazy(() => Seat));
  assert.equal(LazySeat.validateRoot({ connected: true }).ok, true);
});
check("defined schema composes through partial", () => {
  const MaybeSeat = hson.liveMap.schema.define((s) => s.partial({ seat: Seat }));
  const RawNested = hson.liveMap.schema.define((s) => s.partial({ profile: { name: s.string } }));
  assert.equal(MaybeSeat.validateRoot({}).ok, true);
  assert.equal(MaybeSeat.validateRoot({ seat: { connected: true } }).ok, true);
  assert.equal(RawNested.validateRoot({ profile: { name: "Ada" } }).ok, true);
});
check("defined schema composes through deepPartial", () => {
  const MaybeSeat = hson.liveMap.schema.define((s) => s.deepPartial({ seat: Seat }));
  const RawNested = hson.liveMap.schema.define((s) => s.deepPartial({ profile: { name: s.string } }));
  assert.equal(MaybeSeat.validateRoot({ seat: {} }).ok, true);
  assert.equal(RawNested.validateRoot({ profile: {} }).ok, true);
});
check("defined schema composes through tagged variants", () => {
  const Event = hson.liveMap.schema.define((s) => s.tagged("kind", { changed: { seat: Seat }, cleared: {} }));
  assert.equal(Event.validateRoot({ kind: "changed", seat: { connected: true } }).ok, true);
  assert.equal(Event.validateRoot({ kind: "cleared" }).ok, true);
});
check("defined optional modifier retains projected semantics", () => {
  const Wrapper = hson.liveMap.schema.define((s) => s.exact({ seat: Seat.optional }));
  assert.equal(Wrapper.validateRoot({}).ok, true);
});
check("defined nullable modifier retains projected semantics", () => {
  const NullableSeat = hson.liveMap.schema.define(() => Seat.nullable);
  assert.equal(NullableSeat.validateRoot(null).ok, true);
});
check("defined readonly modifier retains projected semantics", () => {
  const ReadonlySeat = hson.liveMap.schema.define(() => Seat.readonly);
  assert.equal(ReadonlySeat.validateRoot({ connected: true }).ok, true);
  assert.equal(ReadonlySeat.rules[0]?.readonly, true);
});
check("same defined root attaches to independent maps", () => {
  const first = hson.liveMap.fromJson({ left: { connected: true }, right: { connected: false } });
  const second = hson.liveMap.fromJson({ left: { connected: false }, right: { connected: true } });
  first.schema.use(State); second.schema.use(State);
  assert.equal(first.schema.get(), State); assert.equal(second.schema.get(), State);
});
check("aliasing preserves defined schema identity", () => {
  const Alias = Seat;
  assert.equal(Alias, Seat);
});
check("defining from a defined schema creates distinct identity", () => {
  const Equivalent = hson.liveMap.schema.define(() => Seat);
  assert.notEqual(Equivalent, Seat);
  assert.equal(Equivalent.validateRoot({ connected: true }).ok, true);
});
check("defined schema outer values and retained IR are deeply frozen", () => {
  assert.equal(Object.isFrozen(State), true);
  assert.equal(Object.isFrozen(State.root), true);
  assert.equal(Object.isFrozen(State.root.props), true);
  assert.equal(Object.isFrozen(State.rules), true);
});
check("caller-owned shapes are snapshotted at define", () => {
  const shape: Record<string, unknown> = { connected: undefined };
  const Stable = hson.liveMap.schema.define((s) => {
    shape.connected = s.boolean;
    return s.exact(shape as never);
  });
  shape.connected = hson.liveMap.schema.define((s) => s.string);
  assert.equal(Stable.validateRoot({ connected: true }).ok, true);
  assert.equal(Stable.validateRoot({ connected: "changed" }).ok, false);
});
check("schema.get preserves exact object identity", () => {
  const map = hson.liveMap.fromJson({ connected: true });
  map.schema.use(Seat);
  assert.equal(map.schema.get(), Seat);
});
check("invalid define results reject at runtime", () => {
  assert.throws(
    () => Reflect.apply(hson.liveMap.schema.define, hson.liveMap.schema, [() => undefined]),
    /recognized schema expression/,
  );
});

process.stdout.write(`# ${checks} compositional schema.define checks passed\n`);
emit_hson_live_test_completion("livemap.schema-composition", checks, checks, 0);
