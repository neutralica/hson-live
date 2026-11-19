# Authoring a private Schema 2.0 definition

A source string contains one declaration. The bare head selects a Schema operation. A single-quoted head introduces an application member or a definition. Use double quotes for string values and text operands. Put modifiers before the body, in the order they should appear in the definition.

```hson
<data [
  <members
    <'age' optional <number int min="0">>
    <'address' <object <'city' <string>>>>
    <'position' <tuple [<number>, <number>]>>
  >
]>
```

## Root roles

The explicit root group is provisional to this experiment. Use `<data>` to omit root content. For a present body, supply an HSON array containing an optional `defs` clause followed by at most one content clause. A content clause may be `members`, `object`, `ref` or `any`. Direct member maps use `members`. Use `object` for an explicit object descriptor, including a sole member named `ref` or a sole `content` member whose descriptor would collide with Schema 1.0 root dispatch.

```hson
<data [
  <defs <'Score' <number int min="0" max="100">>>,
  <ref "Score">
]>
```

Map clauses contain successive named declarations. Use `<members <>>`, `<object <>>` and `<defs <>>` for explicit empty maps. A contentless operation has an absent body. In literal positions, `null`, `<>`, `[]` and `""` keep their distinct Data values.

## Expressions and operands

| Expression | Body | Headers |
| --- | --- | --- |
| `any`, `null`, `boolean` | Absent | None |
| `number` | Absent | `int`, `min`, `max`, `over`, `under` |
| `string` | Absent | `len`, `minlen`, `maxlen`, `prefix`, `suffix`, `contains`, `alphabet` |
| `exact` | One finite Data primitive, including null | None |
| `ref` | A definition-name string | None |
| `object` | Ordered named members | Members may carry the bare `optional` flag |
| `array` | One expression | `len`, `minlen`, `maxlen`, bare or configured `unique` |
| `tuple` | An HSON array of positional expressions | `len`, `minlen`, `maxlen` |
| `union` | An HSON array of branches | None |

Both `[...]` and `«...»` take comma-separated expressions and allow a trailing comma. HSON whitespace and `//` comments are accepted. Quoted numeric modifiers are decoded by the lowerer. Configured uniqueness takes one braced HSON Data operand, for example `unique={<by "slot" cases [["A", ["left"]]]>}`. The compiler checks operand domains, references, and union distinguishability. The authored [D11 definition](authored/D11.hson) exercises configured uniqueness, and the [D10 definition](authored/D10.hson) exercises the Deck corpus Schema.

## Trying a source

From the repository root, this compiles the D02 excerpt and certifies a candidate using the existing Schema implementation.

```sh
node --import=tsx --input-type=module <<'JS'
import { readFileSync } from "node:fs";
import { compile_schema_source } from "./experiments/schema2/compile-source.ts";
import { HsonSchema } from "./src/api/schema/hson-schema.ts";
import { HsonDataValue } from "./src/api/data/hson-data.ts";

const source = readFileSync("experiments/schema2/authored/D02-excerpt.hson", "utf8");
const result = compile_schema_source(source);
if (result.ok) {
  console.log(result.schema1Source);
  const schema = HsonSchema.fromHson(result.schema1Source);
  const candidate = HsonDataValue.fromSource('<displayName "Mina" address <line1 "18 Cedar Lane" city "Bristol">>');
  console.log(schema.certify(candidate).toHson());
} else {
  console.log(result.issues);
}
JS
```

For structural inspection alone, call `read_schema_source` in `source-reader.ts`. Its `rangeOf(record)` returns half-open UTF-16 offsets for that read. Syntax and lowering failures throw `SchemaSourceError` with an authored range. A lowering failure retains the original error and its owned origin. Compiler issues retain their code, path and generated range and carry an additional `authoredRange`. A range-only issue can be projected to a generated value with exactly matching coverage. An issue with no matching evidence anchors to the root. Locations inside a structured header operand currently identify its owning header.

Collection shorthand emits content first, followed by refinements in header order. Other historical Schema 1.0 field orders and Document Schema authoring remain open.
