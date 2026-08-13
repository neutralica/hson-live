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
check("open objects admit projected extras while preserving declared validation", () => {
  const OpenSeat = hson.liveMap.schema.define((s) => s.object({ connected: s.boolean }));
  assert.equal(OpenSeat.validateRoot({ connected: true, label: "A", nested: [1, null] }).ok, true);
  assert.equal(OpenSeat.validateRoot({ connected: "wrong", label: "A" }).ok, false);
});
check("defined schema composes as an array item", () => {
  const Seats = hson.liveMap.schema.define((s) => s.array(Seat));
  assert.equal(Seats.validateRoot([{ connected: true }, { connected: false }]).ok, true);
});
check("postfix array is absent from defined schemas", () => {
  assert.equal("array" in Seat, false);
  hson.liveMap.schema.define((s) => {
    assert.equal("array" in s.string, false);
    return s.string;
  });
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
check("defined schema composes as a constrain base", () => {
  const Connected = hson.liveMap.schema.define((s) => s.constrain(Seat, "connected", (value) => value.connected));
  assert.equal(Connected.validateRoot({ connected: true }).ok, true);
  assert.equal(Connected.validateRoot({ connected: false }).ok, false);
});
check("defined schema composes through recurse", () => {
  const RecursiveSeat = hson.liveMap.schema.define((s) => s.recurse(() => Seat));
  assert.equal(RecursiveSeat.validateRoot({ connected: true }).ok, true);
});
check("defined schema composes through partial", () => {
  const MaybeSeat = hson.liveMap.schema.define((s) => s.partial(s.object({ seat: Seat })));
  const MaybeExactSeat = hson.liveMap.schema.define((s) => s.partial(s.exact({ seat: Seat })));
  const RawNested = hson.liveMap.schema.define((s) => s.partial(s.object({ profile: s.object({ name: s.string }) })));
  assert.equal(MaybeSeat.validateRoot({}).ok, true);
  assert.equal(MaybeSeat.validateRoot({ seat: { connected: true } }).ok, true);
  assert.equal(MaybeSeat.validateRoot({ extra: true }).ok, true);
  assert.equal(MaybeExactSeat.validateRoot({ extra: true }).ok, false);
  assert.equal(RawNested.validateRoot({ profile: { name: "Ada" } }).ok, true);
});
check("defined schema composes through deepPartial", () => {
  const MaybeSeat = hson.liveMap.schema.define((s) => s.deepPartial(s.object({ seat: Seat })));
  const RawNested = hson.liveMap.schema.define((s) => s.deepPartial(s.object({ profile: s.object({ name: s.string }) })));
  assert.equal(MaybeSeat.validateRoot({ seat: {} }).ok, true);
  assert.equal(RawNested.validateRoot({ profile: {} }).ok, true);
});
check("defined schema composes through tagged variants", () => {
  const Event = hson.liveMap.schema.define((s) => s.tagged("kind", {
    changed: Seat,
    cleared: s.object({}),
  }));
  assert.equal(Event.validateRoot({ kind: "changed", connected: true }).ok, true);
  assert.equal(Event.validateRoot({ kind: "changed", connected: true, extra: 1 }).ok, false);
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
check("descriptive readonly modifier is absent", () => {
  assert.equal("readonly" in Seat, false);
  assert.equal("readonly" in Seat.rules[0]!, false);
  hson.liveMap.schema.define((s) => {
    assert.equal("readonly" in s.string, false);
    return s.string;
  });
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
check("literal and tagged caller values are snapshotted at define", () => {
  const literal = { code: 1 };
  const variants: Record<string, object> = { changed: undefined as never };
  const StableLiteral = hson.liveMap.schema.define((s) => s.literal(literal));
  const StableTagged = hson.liveMap.schema.define((s) => {
    variants.changed = s.exact({ value: s.number });
    return s.tagged("kind", variants as never);
  });
  literal.code = 2;
  variants.changed = hson.liveMap.schema.define((s) => s.exact({ value: s.string }));
  assert.equal(StableLiteral.validateRoot({ code: 1 }).ok, true);
  assert.equal(StableLiteral.validateRoot({ code: 2 }).ok, false);
  assert.equal(StableTagged.validateRoot({ kind: "changed", value: 1 }).ok, true);
  assert.equal(StableTagged.validateRoot({ kind: "changed", value: "changed" }).ok, false);
});
check("invalid define results reject at runtime", () => {
  assert.throws(
    () => Reflect.apply(hson.liveMap.schema.define, hson.liveMap.schema, [() => undefined]),
    /recognized schema expression/,
  );
  assert.throws(
    () => Reflect.apply(hson.liveMap.schema.define, hson.liveMap.schema, [(s: { string: object }) => ({ value: s.string })]),
    /recognized schema expression/,
  );
  hson.liveMap.schema.define((s) => {
    assert.throws(() => Reflect.apply(s.pick, s, []), /at least one choice/);
    assert.throws(() => Reflect.apply(s.literal, s, []), /at least one value/);
    assert.throws(() => Reflect.apply(s.tagged, s, ["kind", {}]), /at least one branch/);
    return s.string;
  });
});

process.stdout.write(`# ${checks} compositional schema.define checks passed\n`);
emit_hson_live_test_completion("livemap.schema-composition", checks, checks, 0);
