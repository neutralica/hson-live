# Authoring a private Schema 2.0 definition

This experiment reads a Data Schema declaration and lowers it to Schema 1.0 for compilation and certification. Its authoring grammar is private and provisional.

## Objects and names

A bare operation selects a Schema expression. Inside an `object`, one pair of angle brackets encloses all the application members in encounter order. Each single-quoted name starts a member. The next sibling name or the map’s closing `>` ends it. Double quotes enclose string operands and header text.

```hson
<data <object <
  'name' <string>
  'age' optional <number int min="0">
  'active' <boolean>
>>>
```

This closed object requires a string `name` and a boolean `active`. An `age`, when present, must be a nonnegative integer. The member owns `optional`. The `number` expression owns the ordered headers `int` and `min="0"`. Put headers before their owner’s expression or literal. The reader records a name standing alone as a distinct member with an absent body. Schema lowering requires each object member and definition to have one type expression.

Nested objects use the same production.

```hson
<data <object <
  'address' <object <
    'city' <string>
    'state' <string>
  >>
>>>
```

Names such as `'content'`, `'ref'`, `'object'`, `'members'` and `'defs'` all declare application properties. HSON name escapes are decoded before checking for duplicate names within each map. A duplicate is reported at its second occurrence.

## Root composition and references

A `data` declaration may contain one `defs` clause followed by one root expression. Both are optional. Write the clauses directly in that order. A single clause is the direct structural body. When both are present, the root owns their ordered sequence. The definitions use the same open-object boundaries as properties.

```hson
<data
  <defs <
    'Score' <number int min="0" max="100">
  >>
  <ref "Score">
>
```

Here the bare `ref` selects the definition named by its string operand. Every Data expression can also appear directly at the root, for example `<data <number int min="0">>` or `<data <array <string>>>`. Only a named object member can be optional. `<data>` and `<data <any>>` both describe any Data value. `<data <object <>>>` describes an empty closed object.

Lowering emits one required `root` after `type` and any `defs`. An omitted authored root emits `root "any"`. For example, `<type "data" root <array "string">>` certifies arrays of strings. The expression `<type "data" root <object <array "string">>>` certifies objects with a required string member named `array`. Each `object` operation takes an ordered member map and preserves application keys and their authored source ranges.

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

Tuple positions and union alternatives are ordered expression groups. Both HSON array spellings, `[...]` and `«...»`, take comma-separated items and allow a trailing comma. This declaration uses both operations.

```hson
<data <object <
  'position' <tuple [<number>, <number>]>
  'label' <union [<string>, <number>, <null>]>
>>>
```

`exact` accepts a finite primitive Data value such as `<exact -0>`, `<exact null>` or `<exact "">`. A bare `null` is a literal operand. The reader distinguishes absent content from null, the empty Data object `<>`, the empty array `[]` and the empty string `""`. In an `object` or `defs` map position, `<>` supplies a present empty member map.

A braced header operand contains one ordinary HSON Data value. For example, `unique={<by "slot" cases [["A", ["left"]]]>}` configures array uniqueness. HSON whitespace, `//` comments, quoted-name escapes and source coordinates follow the existing scanner. Quoted numeric headers preserve the sign of zero when lowered. The compiler checks operand domains, references and union distinguishability. The fixtures include complete [configured uniqueness](authored/D11.hson) and [Deck](authored/D10.hson) declarations.

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

Collection expressions emit content first and then refinements in authored header order. Historical permutations of those fields have no dedicated spelling. Document Schema roots, element definitions, tags, attributes, sequences and counted repetition remain outside this private Data Schema grammar.
