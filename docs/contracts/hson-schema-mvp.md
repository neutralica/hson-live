# Hson Schema authoring and proof

A Schema is authored as Hson data and compiled into a frozen, nominal runtime object:

```ts
import { Hson, type HsonFromSchema, type JsonFromSchema } from "hson-live";

export const UserSchema = Hson.schema`
  <type "data" content <
    name "string"
    nickname <optional "string">
    score "number"
  >>
`;

export type UserHson = HsonFromSchema<typeof UserSchema>;
export type UserJson = JsonFromSchema<typeof UserSchema>;
const authored: UserHson = Hson.data`<name "Ada" score 37>`;
```

The packaged `hson-schema` tool discovers direct, substitution-free official `Hson.schema` declarations, checks Schema semantics, and generates private evidence in current tool-owned `.hson/` compiler projects for value, mode, and Schema identity. The application imports the Schema symbol and uses `HsonFromSchema<typeof UserSchema>` and `JsonFromSchema<typeof UserSchema>`; it does not import generated suffix names.

`HsonFromSchema<S>` chooses `HsonData<S>` or `HsonDocument<S>` from the Schema family. `JsonFromSchema<S>` projects a data Schema to its ordinary JS/JSON-shaped TypeScript value, including readonly structure and generated refinement evidence; document Schemas are rejected. The lower-level `HsonData<S>` and `HsonDocument<S>` remain precise canonical string carrier/proof types.

For example, a data Schema can use this representation pair:

```ts
const DeckSchema = Hson.schema`<type "data" content <title "string">>`;
type DeckHson = HsonFromSchema<typeof DeckSchema>;
type DeckJson = JsonFromSchema<typeof DeckSchema>;
const deck: DeckHson = Hson.data`<title "Introduction">`;
```

Run `hson-schema generate --project tsconfig.json` after authoring or changing Schemas, and `hson-schema check --project tsconfig.json` in the authoritative build. `verify` checks artifact freshness without repairing it. Static authored assignments are proven only when the analyzer validates the direct `Hson.data` source against current generated evidence. Plain TypeScript sees the tag's unproved `HsonData` return and cannot grant proof on its own. The TypeScript editor plugin uses current in-memory compiler views, including unsaved source. See the [compiler workflow and publishing contract](./hson-schema-compiler-project-phase-4.md).

Dynamic values are certified through the Schema object:

```ts
const certified: UserHson = UserSchema.certify(dynamicCanonicalHson);
const portableDefinition = UserSchema.toHson(); // HsonSchemaData primitive string
const reconstructed = Hson.schema.fromHson(portableDefinition);
```

`certify` validates the candidate in the Schema's data mode and returns the canonical primitive string. `fromHson` validates the portable Schema definition again; reconstructed object identity need not equal the original. LiveMap admission uses `hsonLiveMap.fromLibraries({ state: { data, schema: UserSchema } })` and validates future mutations against that Schema.

An authored `union` takes an ordered array of at least two branches. Every pair must be distinguishable. For closed objects, a shared required member with different direct exact-string values establishes distinction, including when the branches are local refs:

```hson
<type "data" defs <
  Paragraph <content <kind <exact "paragraph"> text "string">>
  Heading <content <kind <exact "heading"> text "string">>
  Code <content <kind <exact "code"> source "string">>
  Block <union [<ref "Paragraph">, <ref "Heading">, <ref "Code">]>
> content <content <block <ref "Block">>>>
```

Generated value projections are deeply readonly and carry inaccessible proof at refined objects, arrays, tuples, numbers, and strings. Ordinary materialization, object spread, array transforms, and arithmetic do not preserve those proofs. Static authored tags with substitutions do not receive Schema-specific proof.

## Runtime Schema identity

Runtime `schemaDigest` is SHA-256 of a deterministic encoding of the fully validated ordered authored Schema definition, before compiler lowering. The encoder uses fixed tuples: a type tag followed by its payload; object payloads contain ordered `[name, encodedValue]` pairs, and arrays contain ordered encoded items. Finite numbers use exact normalized spellings with explicit `-0`. It never materializes member keys through an ordinary JavaScript object.

Identity ignores whitespace/layout, quote and escape spelling, accepted equivalent array syntax, and physical-versus-escaped newlines with the same decoded value. It preserves authored definition/member order (including integer-like names), def names/ref structure, unused definitions, inline versus ref, union order, document sequence order, optionality, exact values and configured uniqueness mapping/order. This is definition identity, not universal behavioral equivalence. Every definition, including unused definitions and reference cycles, validates before identity is available.

Compiler topology, evaluator diagnostics and source ranges do not enter identity. Tooling retains exact authored source and `sourceDigest` as provenance/evidence; runtime Schema handles retain the normalized definition. Registry compatibility uses Schema identity plus ordered library names, scope, root mode and root codec; it excludes Schema presentation bytes. Local initializer fingerprints use Schema identity while retaining exact root/CSS state. Echo/Locus/checkpoint reconstruction verifies exact transport/chunk checksums where applicable, parses and fully validates Schema source, recomputes its definition digest, and then enforces authority/revision/session/topology/permission fences. Existing persisted artifacts hard-cut; no compatibility or version path is provided.
