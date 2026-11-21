# Hson Schema authoring and proof

A Schema is authored as Hson data and compiled into a frozen, nominal runtime object:

```ts
import { Hson, type HsonFromSchema, type JsonFromSchema } from "hson-live";

export const UserSchema = Hson.schema`
  <type "data" root <object <
    name "string"
    nickname <optional "string">
    score "number"
  >>>
`;

export type UserHson = HsonFromSchema<typeof UserSchema>;
export type UserJson = JsonFromSchema<typeof UserSchema>;
const authored: UserHson = Hson.data`<name "Ada" score 37>`;
```

The packaged `hson-schema` tool discovers direct, substitution-free official `Hson.schema` declarations, checks Schema semantics, and generates private evidence for JavaScript reads, Data proposals, mode, and Schema identity in the current tool-owned `.hson/` compiler project. Applications use the authored Schema symbol with `HsonFromSchema<typeof UserSchema>` and `JsonFromSchema<typeof UserSchema>`.

`HsonFromSchema<S>` chooses the canonical Hson proof representation from the Schema family. `JsonFromSchema<S>` projects a Data Schema to a JavaScript-facing structure with exact literals, unions and recursive references. `HsonDataValue<S>.materialize()` returns this projection. A carrier without static Schema evidence materializes as `unknown`.

Schema validation checks own Data members. A required named member keeps its declared read type because it is present as an own property. A declared optional member reads as `unknown`, since an omitted member can resolve to an inherited value, including a user-added prototype property. Arbitrary string reads on open objects and objects reached through bare `any` or `ANY_DATA` also return `unknown`. LiveMap applies the same read contract to snapshots, refinements, and object selections.

LiveMap write proposals retain the declared types of required and optional named members and accept readonly Data candidates. Runtime admission checks refinements, relational uniqueness, and wildcard constraints on extra keys. Use an exact carrier such as `Hson.data.fromSource(location.must.hson())` to forward a snapshot whose JavaScript read type includes unknown members.

For example, a data Schema can use this representation pair:

```ts
const DeckSchema = Hson.schema`<type "data" root <object <title "string">>>`;
type DeckHson = HsonFromSchema<typeof DeckSchema>;
type DeckJson = JsonFromSchema<typeof DeckSchema>;
const deck: DeckHson = Hson.data`<title "Introduction">`;
```

Run `hson-schema generate --project tsconfig.json` after authoring or changing Schemas, and `hson-schema check --project tsconfig.json` in the authoritative build. `verify` checks artifact freshness without repairing it. Static authored assignments are proven only when the analyzer validates the direct `Hson.data` source against current generated evidence. Plain TypeScript sees the tag's unproved `HsonDataValue` return and cannot grant proof on its own. The TypeScript editor plugin uses current in-memory compiler views, including unsaved source. See the [compiler workflow and publishing contract](./hson-schema-compiler-project-phase-4.md).

Dynamic values are certified through the Schema object:

```ts
const certified: UserHson = UserSchema.certify(dynamicCanonicalHson);
const portableDefinition = UserSchema.toHson(); // HsonSchemaData primitive string
const reconstructed = Hson.schema.fromHson(portableDefinition);
```

`certify` validates the candidate in the Schema's data mode and returns an authenticated Schema-specific `HsonDataValue`; ordinary string candidates are literal Data and source requires `Hson.data.fromSource()`. Document certification returns canonical Document text. `fromHson` validates the portable Schema definition again; reconstructed object identity need not equal the original. LiveMap admission uses `hsonLiveMap.fromLibraries({ state: { data, schema: UserSchema } })` and validates future mutations against that Schema.

A Data Schema contains `type "data"`, optional `defs <…>`, and a required `root` expression, in that order. Use `root "any"` for unrestricted Data and `root <object <…>>` for an exact object with an ordered member map. An empty map is `root <object <>>`. Definitions using the former Data `content` or `expression` envelope fields fail admission.

An authored `union` takes an ordered array of at least two branches. Every pair must be distinguishable. For closed objects, a shared required member with different direct exact-string values establishes distinction, including when the branches are local refs:

```hson
<type "data" defs <
  Paragraph <object <kind <exact "paragraph"> text "string">>
  Heading <object <kind <exact "heading"> text "string">>
  Code <object <kind <exact "code"> source "string">>
  Block <union [<ref "Paragraph">, <ref "Heading">, <ref "Code">]>
> root <object <block <ref "Block">>>>
```

Generated data projections are structural and readonly as API discipline, without runtime freezing or certification. Ordinary objects, reconstruction, collection transforms, and arithmetic may inhabit those projections when structurally valid. Schema handles and Schema-bound Hson retain certification identity; runtime admission validates refinements and whole-value invariants before publishing state. Static authored Hson tags with substitutions do not receive Schema-specific certification.

## Runtime Schema identity

Runtime `schemaDigest` is SHA-256 of a deterministic encoding of the fully validated ordered authored Schema definition, before compiler lowering. The encoder uses fixed tuples: a type tag followed by its payload; object payloads contain ordered `[name, encodedValue]` pairs, and arrays contain ordered encoded items. Finite numbers use exact normalized spellings with explicit `-0`. It never materializes member keys through an ordinary JavaScript object.

Identity ignores whitespace/layout, quote and escape spelling, accepted equivalent array syntax, and physical-versus-escaped newlines with the same decoded value. It preserves authored definition/member order (including integer-like names), def names/ref structure, unused definitions, inline versus ref, union order, document sequence order, optionality, exact values and configured uniqueness mapping/order. This is definition identity, not universal behavioral equivalence. Every definition, including unused definitions and reference cycles, validates before identity is available.

Compiler topology, evaluator diagnostics and source ranges do not enter identity. Tooling retains exact authored source and `sourceDigest` as provenance/evidence; runtime Schema handles retain the normalized definition. Registry compatibility uses Schema identity plus ordered library names, scope, root mode and root codec; it excludes Schema presentation bytes. Local initializer fingerprints use Schema identity while retaining exact root/CSS state. Echo/Locus/checkpoint reconstruction verifies exact transport/chunk checksums where applicable, parses and fully validates Schema source, recomputes its definition digest, and then enforces authority/revision/session/topology/permission fences. Existing persisted artifacts hard-cut; no compatibility or version path is provided.
