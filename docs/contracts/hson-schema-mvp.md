# Hson Schema authoring and proof

A Schema is authored as Hson data and compiled into a frozen, nominal runtime object:

```ts
import { Hson, type HsonData, type SchemaType } from "hson-live";

export const UserSchema = Hson.schema`
  <type "data" content <
    name "string"
    nickname <optional "string">
    score "number"
  >>
`;

export type User = SchemaType<typeof UserSchema>;
const authored: HsonData<typeof UserSchema> = Hson.data`<name "Ada" score 37>`;
```

The packaged `hson-schema` tool discovers direct, substitution-free official `Hson.schema` declarations, checks Schema semantics, and generates private evidence in current tool-owned `.hson/` compiler projects for value, mode, and Schema identity. The application imports the Schema symbol and uses `SchemaType<typeof UserSchema>` and `HsonData<typeof UserSchema>`; it does not import generated suffix names.

Run `hson-schema generate --project tsconfig.json` after authoring or changing Schemas, and `hson-schema check --project tsconfig.json` in the authoritative build. `verify` checks artifact freshness without repairing it. Static authored assignments are proven only when the analyzer validates the direct `Hson.data` source against current generated evidence. Plain TypeScript sees the tag's unproved `HsonData` return and cannot grant proof on its own. The TypeScript editor plugin uses current in-memory compiler views, including unsaved source. See the [compiler workflow and publishing contract](./hson-schema-compiler-project-phase-4.md).

Dynamic values are certified through the Schema object:

```ts
const certified: HsonData<typeof UserSchema> = UserSchema.certify(dynamicCanonicalHson);
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
