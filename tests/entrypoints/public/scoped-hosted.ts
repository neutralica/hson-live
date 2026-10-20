import { hsonLiveMap, type LiveMap } from "hson-live/livemap";
import type { Echo, EchoReplicaTransport } from "hson-live/echo";
import type { LocusSession, LocusSessionNow } from "hson-live/locus";

async function receive(session: LocusSession, transport: EchoReplicaTransport): Promise<Echo<LiveMap>> {
  const now: LocusSessionNow = session.now();
  const roots: readonly (readonly number[])[] = now.libs.libraries.flatMap(entry => entry.scopes?.occurrences.map(o => o.root) ?? []);
  void roots;
  return hsonLiveMap.echo.create({ now, credential: session.credential!, transport });
}
function permissions(echo: Echo<LiveMap>) {
  const library = echo.doc.must("scoped");
  if (library.source !== "authority-projected") return;
  if (library.mode === "document") {
    const command: Promise<void> = library.at([]).asElement()!.attrs.set("title", "authorized on server");
    void command;
    const subject = library.q("left");
    if (subject) {
      const active: boolean = subject.active;
      void active;
      // @ts-expect-error H1 does not add chained scoped lookup.
      subject.q("child");
      // @ts-expect-error Existing QUAD observations do not grant mutation.
      subject.attrs.set("title", "unauthorized");
    }
    // @ts-expect-error Echo does not acquire the authority CSS authoring surface.
    library.css.sel("button").set.color("red");
  } else {
    // @ts-expect-error Projected data remains read-only.
    library.at(["n"]).set(1);
  }
  // @ts-expect-error Echo does not admit new authority Libraries.
  echo.addLibraries({ shared: [] });
}
void receive; void permissions;
