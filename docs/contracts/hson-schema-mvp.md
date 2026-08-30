# Hson Schema MVP

The proof-safe MVP authors Schema as ordinary Hson:

```ts
import { Hson, type HsonSchema } from "hson-live";

export const UserSchema: HsonSchema = Hson`
  <type "data" content <
    name "string"
    nickname <optional "string">
    score "number"
  >>
`;
```

The declaration must be one exported module-scope `const`, with one declarator,
a direct official `HsonSchema` annotation, and a direct substitution-free
official `Hson` tagged template. Schema declarations cannot be reexported or
composed across files.

The implemented expression vocabulary is deliberately small: `"string"`,
`"number"`, `"boolean"`, `"null"`, `exact`, closed `content`, direct-member
`optional`, homogeneous `array`, fixed `tuple`, and a two-branch distinguishable
`union`. Objects are closed and members are required unless directly wrapped in
`optional`.

Generation adds `<DeclarationName>Type` and `<DeclarationName>Hson` type exports
to the authored module. Generated application structures are deeply readonly and
carry inaccessible nominal evidence at every object, array, and tuple boundary.
Their proof is lost by spread, reconstruction, and array transforms. Generated
Schema-Hson types carry a distinct inaccessible proof.

Run:

```text
npm run hson-schema:generate
npm run hson-schema:verify
npm run hson-schema:check
npm run hson-schema:build
npm run hson-schema:watch
```

Generation is explicit. Verification is fail-closed and never repairs evidence.
It binds the normalized declaration identity, exact Schema body, verified
semantic graph, generated declaration bytes, and analyzer compatibility version.
The analyzer uses a resolved TypeScript Program, executes no workspace module,
and is the authority for static Schema-bound Hson. The VS Code extension is not
required. Raw `tsc` is not the complete certification build.

Supported consumers must enable all of:

```json
{
  "compilerOptions": {
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true
  }
}
```

Static certification uses the generated type directly:

```ts
import { Hson } from "hson-live";
import type { UserSchemaHson } from "./user-schema.js";

const user: UserSchemaHson = Hson`<name "Ada" score 37>`;
```

Dynamic canonical Hson is certified through the runtime proof boundary:

```ts
const user: UserSchemaHson = Hson.certify(UserSchema, dynamicCanonicalHson);
```

Certification returns the identical immutable canonical string and fails with the
existing structured Schema error behavior. Legacy LiveMap Schema validation is
unchanged.

There is intentionally no public Schema-value materializer. Existing
`.toJson().value()` and LiveMap projections return ordinary mutable values and do
not mint Schema proof. In this MVP, exact Schema-bound Hson is the public runtime
certificate; `UserSchemaType` proves generated declaration and nominal-carrier
fidelity without claiming a public producer.

Documents, attrs, tags, open objects, records, refinements, recursion in human
syntax, definitions/references, interpolation, mutable certified values,
cross-file Schema composition, and materialization APIs are outside this MVP.
