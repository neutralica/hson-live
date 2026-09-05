import {
  create_locus,
  create_echo,
  create_persistent_locus,
  hsonLiveMap,
} from "hson-live";
import type {
  DocumentLiveMap,
  LiveMap,
  Locus,
  Echo,
  LocusMapValue,
  LocusMultiLibraryPersistenceAdapter,
  LocusPersistenceAdapter,
  LocusSchema,
  LocusServerMessage,
} from "hson-live";
import type { JsonValue } from "../src/core/types.ts";
import { create_livehost_locus_registry } from "hson-live/livehost";
import { TreeSchema, UserSchema, type UserSchemaType } from "./fixtures/hson-schema-mvp/producer.ts";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends (<T>() => T extends TRight ? 1 : 2)
    ? (<T>() => T extends TRight ? 1 : 2) extends (<T>() => T extends TLeft ? 1 : 2)
      ? true
      : false
    : false;
type Assert<TValue extends true> = TValue;

type GeneratedStateIsNotJsonValue = Assert<Equal<UserSchemaType extends JsonValue ? true : false, false>>;

const initialUser = {
  name: "Ada",
  nickname: "ada",
  score: 37,
  age: 37,
  percent: 80,
  code: "ID-7",
  status: "ready",
  phase: "lobby",
  turn: "player1",
  zero: 0,
  negativeZero: -0,
  signedZeroChoice: -0,
  flags: [true, false],
  pair: ["pair", 2],
  account: { kind: "user", handle: "ada" },
};

const governedMap = hsonLiveMap.fromJson(initialUser).schema.use(UserSchema);
type SchemaUseReturnsExactMap = Assert<Equal<typeof governedMap, LiveMap<UserSchemaType>>>;
type LocusValueRetainsProof = Assert<Equal<LocusMapValue<typeof governedMap>, UserSchemaType>>;

declare const stateAdmission: LocusSchema<UserSchemaType>;
void stateAdmission;

// @ts-expect-error Wire messages remain JSON-constrained and do not acquire nominal state proof.
type ProofBearingWireMessage = LocusServerMessage<UserSchemaType>;

const authority = create_locus({
  map: governedMap,
  actions: {
    async update(context) {
      const state: UserSchemaType = context.map.snap();
      const age: UserSchemaType["age"] = context.map.at(["age"]).snap();
      context.map.sub((next) => {
        const exact: UserSchemaType = next;
        void exact;
      });
      await context.mutate((draft) => draft.replace({
        name: "Grace",
        nickname: "grace",
        score: 38,
        age: 38,
        percent: 81,
        code: "ID-7",
        status: "ready",
        phase: "ready",
        turn: "player2",
        zero: 0,
        negativeZero: -0,
        signedZeroChoice: 0,
        flags: [true],
        pair: ["next", 3],
        account: { kind: "admin", level: 4 },
      }));
      if (false) {
        // @ts-expect-error Mutation drafts retain the generated candidate domain.
        await context.mutate((draft) => draft.at(["age"]).replace("old"));
      }
      void state;
      void age;
    },
  },
});

const authorityState: UserSchemaType = authority.map.snap();
const authorityAge: UserSchemaType["age"] = authority.map.at(["age"]).snap();
authority.map.sub((next) => {
  const exact: UserSchemaType = next;
  void exact;
});
authority.map.sub.diff((next, prev) => {
  const exactNext: UserSchemaType = next;
  const exactPrev: UserSchemaType = prev;
  void exactNext;
  void exactPrev;
});
authority.map.sub.path(["age"], (next, prev) => {
  const exactNext: UserSchemaType["age"] = next;
  const exactPrev: UserSchemaType["age"] = prev;
  void exactNext;
  void exactPrev;
});
authority.mutate((draft) => draft.at(["age"]).replace(39));
if (false) {
  // @ts-expect-error Authority mutations reject malformed generated candidates.
  authority.mutate((draft) => draft.at(["age"]).replace("39"));
}

const socket = {
  send(_message: string) {},
  close(_code?: number, _reason?: string) {},
  onMessage(_listener: (message: string) => void) {},
  onClose(_listener: () => void) {},
};

const inferredClient = create_echo({ socket, map: governedMap, recovery: { logicalMapId: "governed-map" } });
const explicitClient = create_echo<typeof governedMap>({ socket, map: governedMap, recovery: { logicalMapId: "governed-map" } });
type InferredClientMapIsExact = Assert<Equal<typeof inferredClient.map, typeof governedMap>>;
type ExplicitClientMapIsExact = Assert<Equal<typeof explicitClient.map, typeof governedMap>>;
const clientState: UserSchemaType = inferredClient.map.snap();
const clientAge: UserSchemaType["age"] = inferredClient.map.at(["age"]).snap();
inferredClient.map.sub((next) => {
  const exact: UserSchemaType = next;
  void exact;
});
inferredClient.map.sub.diff((next, prev) => {
  const exactNext: UserSchemaType = next;
  const exactPrev: UserSchemaType = prev;
  void exactNext;
  void exactPrev;
});
inferredClient.map.sub.path(["age"], (next) => {
  const exact: UserSchemaType["age"] = next;
  void exact;
});
inferredClient.recovery.onChange((change) => {
  const exactMap: typeof governedMap = change.map;
  const exactState: UserSchemaType = change.map.snap();
  void exactMap;
  void exactState;
});
if (false) {
  // @ts-expect-error Client mirrors retain generated mutation candidate checking.
  inferredClient.map.at(["age"]).replace("39");
}

const ordinaryMap = hsonLiveMap.fromJson({ count: 0 });
type OrdinaryMapValueIsUnchanged = Assert<Equal<LocusMapValue<typeof ordinaryMap>, JsonValue | undefined>>;
const ordinaryAuthority = create_locus({ map: ordinaryMap });
const ordinaryClient = create_echo({ socket, map: ordinaryMap, recovery: { logicalMapId: "ordinary-map" } });
const ordinaryCount: JsonValue | undefined = ordinaryClient.map.at(["count"]).snap();

const documentCandidate = hsonLiveMap.fromHson("<main/>");
if (documentCandidate.mode === "document") {
  type DocumentMapValueIsUndefined = Assert<Equal<LocusMapValue<typeof documentCandidate>, undefined>>;
  const documentAuthority: Locus<DocumentLiveMap> = create_locus({ map: documentCandidate });
  const documentClient: Echo<DocumentLiveMap> = create_echo({ socket, map: documentCandidate, recovery: { logicalMapId: "document-map" } });
  declare_document_persistence(documentCandidate);
  void documentAuthority;
  void documentClient;
  const documentMapValueIsUndefined: DocumentMapValueIsUndefined = true;
  void documentMapValueIsUndefined;
}

const libraries = hsonLiveMap.fromLibraries({
  user: { data: initialUser, schema: UserSchema },
  tree: { data: { value: "root", age: 1, children: [] }, schema: TreeSchema },
});
const multiAuthority = create_locus({ map: libraries });
const multiClient = create_echo({
  socket,
  map: libraries,
  recovery: { logicalMapId: "proof-bearing-multi-library" },
});
type MultiClientUsesEchoFamily = Assert<Equal<typeof multiClient, Echo<typeof libraries>>>;
const exactUserName: string = multiClient.map.lib("user").snap().name;
void exactUserName;
multiClient.connect();
declare const multiPersistence: LocusMultiLibraryPersistenceAdapter;
create_persistent_locus({ map: libraries, persistence: multiPersistence });

const liveHostRegistry = create_livehost_locus_registry({
  maxLoci: 1,
  idleMs: 1_000,
  create() {
    return authority;
  },
});
liveHostRegistry.acquire("proof-bearing").then((result) => {
  if (!result.ok) return;
  const state: UserSchemaType = result.value.locus.map.snap();
  result.value.release();
  void state;
});

function declare_document_persistence(map: DocumentLiveMap): void {
  declare_persistent_document_locus(map, documentPersistence);
}

declare const documentPersistence: LocusPersistenceAdapter;
function declare_persistent_document_locus(map: DocumentLiveMap, persistence: LocusPersistenceAdapter): void {
  void create_persistent_locus({ map, persistence });
}

type ProofBearingAssertions =
  | GeneratedStateIsNotJsonValue
  | SchemaUseReturnsExactMap
  | LocusValueRetainsProof
  | InferredClientMapIsExact
  | ExplicitClientMapIsExact
  | OrdinaryMapValueIsUnchanged;
const proofBearingAssertions: ProofBearingAssertions = true;

void authorityState;
void authorityAge;
void clientState;
void clientAge;
void explicitClient;
void ordinaryAuthority;
void ordinaryCount;
void multiAuthority;
void proofBearingAssertions;
