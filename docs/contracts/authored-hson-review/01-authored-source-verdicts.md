# Authored-HSON source verdicts

This is the first-pass worksheet for the **materialized authored-HSON conformance corpus candidate**.
The primary question for every row is: **Does this exact source belong to the authored HSON language?**

## Reviewer key

```text
V = valid authored HSON
I = invalid authored HSON
? = uncertain or requires discussion
blank = not reviewed
```

The **Current proposal** column is the candidate's present classification. It is not a recommendation
and the reviewer need not follow it. A blank human-verdict cell does not imply agreement. Complete
the optional note only when the verdict alone is insufficient. Exact diagnostic codes, stages,
coordinates, paths, related evidence, expected graphs, and canonical output are not being certified
during this pass.

## Review progress

```text
Reviewed rows:
Valid verdicts:
Invalid verdicts:
Uncertain verdicts:
Unreviewed:
Family verdicts used:
Individual overrides:
```

This area is intentionally blank. Do not infer progress from the Current proposal column.

## Evidence and scope

- [Immutable provenance audit](evidence/authored-hson-corpus-provenance-audit.txt) — SHA-256 `41b2d0ba4f539eae8d12fb4ccafaafba2aa6cf69427ceba3b9ca4b2163111b09`
- [Immutable shape preview](evidence/authored-hson-shape-coverage-preview.txt) — SHA-256 `40f1ee261325ead71ed170765e443a1fd182d76efec4f11bce9eb94f214d4180`
- Included here: 269 authored-HSON sources (100 proposed valid; 169 proposed invalid).
- Deferred: 11 graph-only accepted transports, 9 graph-only rejected transports, 14 structural JSON transports,
  49 structural HTML transports, 4 diagnostic-circuit regressions, and 10 specialized-test references.

## Matched source contrasts

### Matched contrast: object versus element closer

```hson
<a 1>   // current proposal: valid HSON object
<a 1/>  // current proposal: invalid HSON element typed content
```

### Typed object values versus element flags

```hson
<t true f false n null>
<x true false null/>
```

### Primitive-looking object keys

```hson
<true 1 false 2 null 3>
```

### Homogeneous versus mixed root modes

```hson
<a/><b/>   // current proposal: valid element fragment
<a/><b 2>  // current proposal: invalid mixed modes
```

### Matched contrast: empty decoded-name roles

```hson
<`` 1>
<``/>
<e ``="x"/>
<e ``/>
```

An empty decoded object-property key is presently proposed valid; empty element,
attribute, and flag names are presently proposed invalid.

## 1. Primitive values

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.accept.literal.primitive.empty-string; source:inline; review:standalone -->
| `hson.accept.literal.primitive.empty-string` | `""` | Valid | A bare empty quoted string admits one string leaf. |  |  |
<!-- authored-case:hson.accept.literal.primitive.false; source:inline; review:standalone -->
| `hson.accept.literal.primitive.false` | `false` | Valid | Bare false is a typed primitive value. |  |  |
<!-- authored-case:hson.accept.literal.primitive.null; source:inline; review:standalone -->
| `hson.accept.literal.primitive.null` | `null` | Valid | Bare null is a typed primitive value. |  |  |
<!-- authored-case:hson.accept.literal.primitive.string; source:inline; review:standalone -->
| `hson.accept.literal.primitive.string` | `"hello"` | Valid | A bare ordinary quoted string admits one string leaf. |  |  |
<!-- authored-case:hson.accept.literal.primitive.true; source:inline; review:standalone -->
| `hson.accept.literal.primitive.true` | `true` | Valid | Bare true is a typed primitive value. |  |  |


## 2. Basic HSON objects

### Matched contrast: object versus element closer

```hson
<a 1>   // current proposal: valid HSON object
<a 1/>  // current proposal: invalid HSON element typed content
```

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.accept.literal.object.comments; source:display; review:standalone -->
| `hson.accept.literal.object.comments` | <pre>Escaped source: &quot;&lt;a// key/value\u000A 1 b// key/value\u000D\u000A 2&gt;&quot;<br>Actual code units: index 14: LF U+000A; index 31: CR U+000D; index 32: LF U+000A; all other code units are printable as shown</pre> | Valid | Physical-line comments are grammar trivia between object tokens.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.accept.literal.object.empty; source:inline; review:standalone -->
| `hson.accept.literal.object.empty` | `<>` | Valid | One angle pair denotes an empty HSON object. |  |  |
<!-- authored-case:hson.accept.literal.object.multiple-properties; source:inline; review:standalone -->
| `hson.accept.literal.object.multiple-properties` | `<a 1 b "two" c false>` | Valid | Object property order is retained.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.accept.literal.object.negative-zero; source:inline; review:standalone -->
| `hson.accept.literal.object.negative-zero` | `<value -0>` | Valid | An object property preserves negative zero.<br>**Review attention:** Negative zero must remain distinct from positive zero. |  |  |
<!-- authored-case:hson.accept.literal.object.one-property; source:inline; review:standalone -->
| `hson.accept.literal.object.one-property` | `<a 1>` | Valid | An object contains a punctuation-free key/value property.<br>**Review attention:** Implementation-derived classification or expectation provenance. Direct `>` versus `/>` contrast. |  |  |


## 3. Basic HSON arrays

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.accept.literal.array.empty-bracket; source:inline; review:standalone -->
| `hson.accept.literal.array.empty-bracket` | `[]` | Valid | An empty bracket array canonicalizes to guillemets. |  |  |
<!-- authored-case:hson.accept.literal.array.empty-guillemet; source:inline; review:standalone -->
| `hson.accept.literal.array.empty-guillemet` | `«»` | Valid | An empty guillemet array admits. |  |  |
<!-- authored-case:hson.accept.literal.array.negative-zero; source:inline; review:standalone -->
| `hson.accept.literal.array.negative-zero` | `[-0,0]` | Valid | An array item preserves negative zero.<br>**Review attention:** Implementation-derived classification or expectation provenance. Negative zero must remain distinct from positive zero. |  |  |
<!-- authored-case:hson.accept.literal.array.primitives; source:inline; review:standalone -->
| `hson.accept.literal.array.primitives` | `[1,"two",false,null]` | Valid | Arrays remain comma-separated and retain primitive item order.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.accept.literal.array.trailing-comma-bracket; source:inline; review:standalone -->
| `hson.accept.literal.array.trailing-comma-bracket` | `[1,2,]` | Valid | A bracket-array trailing comma is accepted variation.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.accept.literal.array.trailing-comma-guillemet; source:inline; review:standalone -->
| `hson.accept.literal.array.trailing-comma-guillemet` | `«1,2,»` | Valid | A guillemet-array trailing comma is accepted variation. |  |  |


## 4. Basic HSON elements

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.accept.literal.element.adjacent-strings; source:inline; review:standalone -->
| `hson.accept.literal.element.adjacent-strings` | `<div "a" "b"/>` | Valid | Two adjacent authored string leaves remain distinct.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.accept.literal.element.attribute; source:inline; review:standalone -->
| `hson.accept.literal.element.attribute` | `<input title="value"/>` | Valid | An element attribute retains its explicit value. |  |  |
<!-- authored-case:hson.accept.literal.element.empty; source:inline; review:standalone -->
| `hson.accept.literal.element.empty` | `<div/>` | Valid | A self-closing angle construct denotes an empty HSON element. |  |  |
<!-- authored-case:hson.accept.literal.element.flag; source:inline; review:standalone -->
| `hson.accept.literal.element.flag` | `<input disabled/>` | Valid | A bare name in the element attribute region is a flag. |  |  |
<!-- authored-case:hson.accept.literal.element.quid; source:inline; review:standalone -->
| `hson.accept.literal.element.quid` | `<main @0000000000000001/>` | Valid | An element QUID remains supported.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.accept.literal.element.text; source:inline; review:standalone -->
| `hson.accept.literal.element.text` | `<p "text"/>` | Valid | An HSON element may contain quoted string content. |  |  |
<!-- authored-case:hson.accept.literal.element.three-empty-strings; source:inline; review:standalone -->
| `hson.accept.literal.element.three-empty-strings` | `<div """"""/>` | Valid | Three adjacent empty authored string leaves remain three.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |


## 5. Legal compositions

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.accept.basis.root.element-fragment; source:inline; review:standalone -->
| `hson.accept.basis.root.element-fragment` | `<a/><b/>` | Valid | A homogeneous root element fragment preserves sibling order. |  |  |
<!-- authored-case:hson.accept.literal.array.nested; source:inline; review:standalone -->
| `hson.accept.literal.array.nested` | `[[1],«2,3»]` | Valid | Nested arrays retain indexed membership.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.accept.literal.array.object-item; source:inline; review:standalone -->
| `hson.accept.literal.array.object-item` | `[<name "Ada">]` | Valid | An array item may be a HSON object.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.accept.literal.element.mixed-content; source:inline; review:standalone -->
| `hson.accept.literal.element.mixed-content` | `<p "first" <em "middle"/> "last"/>` | Valid | Element strings and nested elements retain their order.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.accept.literal.element.nested; source:inline; review:standalone -->
| `hson.accept.literal.element.nested` | `<p <em "text"/>/>` | Valid | An HSON element may contain a nested element.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.accept.literal.object.array-value; source:inline; review:standalone -->
| `hson.accept.literal.object.array-value` | `<items «1,2»>` | Valid | An object property may contain an array.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.accept.literal.object.nested; source:inline; review:standalone -->
| `hson.accept.literal.object.nested` | `<record <field 2>>` | Valid | An object property may contain a nested HSON object.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |


## 6. Contextual object keys and element flags

```hson
<t true f false n null>
<x true false null/>
<true 1 false 2 null 3>
```

The same primitive-looking spelling has a different role in an object value,
an object property key, and an element flag position.

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.accept.basis.object.primitive-looking-keys; source:inline; review:standalone -->
| `hson.accept.basis.object.primitive-looking-keys` | `<true 1 false 2 null 3>` | Valid | true, false, and null are ordinary property keys in HSON object key position.<br>**Review attention:** Primitive-looking name or flag versus typed primitive value. |  |  |
<!-- authored-case:hson.accept.literal.element.keyword-flags; source:inline; review:standalone -->
| `hson.accept.literal.element.keyword-flags` | `<x true false null/>` | Valid | Bare true, false, and null in the element attribute region are flags.<br>**Review attention:** Implementation-derived classification or expectation provenance. Primitive-looking name or flag versus typed primitive value. |  |  |
<!-- authored-case:hson.accept.literal.object.typed-keywords; source:inline; review:standalone -->
| `hson.accept.literal.object.typed-keywords` | `<t true f false n null>` | Valid | true, false, and null in object value position remain typed.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |


## 7. Accepted number spellings

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.accept.basis.number.negative-exponent-sign; source:inline; review:standalone -->
| `hson.accept.basis.number.negative-exponent-sign` | `1e-3` | Valid | An exponent may contain a minus sign. |  |  |
<!-- authored-case:hson.accept.basis.number.negative-integer; source:inline; review:standalone -->
| `hson.accept.basis.number.negative-integer` | `-1` | Valid | A minus may prefix a nonzero JSON integer. |  |  |
<!-- authored-case:hson.accept.basis.number.positive-exponent-sign; source:inline; review:standalone -->
| `hson.accept.basis.number.positive-exponent-sign` | `1e+3` | Valid | An exponent may contain an explicit plus sign. |  |  |
<!-- authored-case:hson.accept.basis.number.positive-fraction; source:inline; review:standalone -->
| `hson.accept.basis.number.positive-fraction` | `0.5` | Valid | A fraction retains digits on both sides of the decimal point. |  |  |
<!-- authored-case:hson.accept.basis.number.uppercase-exponent; source:inline; review:standalone -->
| `hson.accept.basis.number.uppercase-exponent` | `1E3` | Valid | An uppercase exponent marker is accepted. |  |  |
<!-- authored-case:hson.accept.literal.primitive.exponent; source:inline; review:standalone -->
| `hson.accept.literal.primitive.exponent` | `1e3` | Valid | Exponent notation admits and canonicalizes by value. |  |  |
<!-- authored-case:hson.accept.literal.primitive.negative-fraction; source:inline; review:standalone -->
| `hson.accept.literal.primitive.negative-fraction` | `-12.5` | Valid | A negative finite fraction admits. |  |  |
<!-- authored-case:hson.accept.literal.primitive.negative-zero; source:inline; review:standalone -->
| `hson.accept.literal.primitive.negative-zero` | `-0` | Valid | Negative zero retains exact numeric identity.<br>**Review attention:** Negative zero must remain distinct from positive zero. |  |  |
<!-- authored-case:hson.accept.literal.primitive.positive-integer; source:inline; review:standalone -->
| `hson.accept.literal.primitive.positive-integer` | `42` | Valid | A positive finite integer admits. |  |  |
<!-- authored-case:hson.accept.literal.primitive.zero; source:inline; review:standalone -->
| `hson.accept.literal.primitive.zero` | `0` | Valid | Zero admits as a typed numeric leaf. |  |  |


## 8. Rejected number spellings

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.reject.basis.number.hexadecimal; source:inline; review:standalone -->
| `hson.reject.basis.number.hexadecimal` | `0x10` | Invalid | Hexadecimal spelling is not JSON-compatible HSON number syntax. |  |  |
<!-- authored-case:hson.reject.basis.number.leading-plus; source:inline; review:standalone -->
| `hson.reject.basis.number.leading-plus` | `+1` | Invalid | A JSON-compatible HSON number may not begin with plus. |  |  |
<!-- authored-case:hson.reject.basis.number.leading-zero; source:inline; review:standalone -->
| `hson.reject.basis.number.leading-zero` | `01` | Invalid | A nonzero integer may not begin with zero. |  |  |
<!-- authored-case:hson.reject.basis.number.missing-exponent-digits; source:inline; review:standalone -->
| `hson.reject.basis.number.missing-exponent-digits` | `1e` | Invalid | An exponent marker requires following digits. |  |  |
<!-- authored-case:hson.reject.basis.number.missing-fraction-digits; source:inline; review:standalone -->
| `hson.reject.basis.number.missing-fraction-digits` | `1.` | Invalid | A decimal point requires following fraction digits. |  |  |
<!-- authored-case:hson.reject.basis.number.missing-integer-before-fraction; source:inline; review:standalone -->
| `hson.reject.basis.number.missing-integer-before-fraction` | `.5` | Invalid | A fraction requires an integer component before the decimal point. |  |  |
<!-- authored-case:hson.reject.basis.number.missing-signed-exponent-digits; source:inline; review:standalone -->
| `hson.reject.basis.number.missing-signed-exponent-digits` | `1e+` | Invalid | An exponent sign requires following digits. |  |  |
<!-- authored-case:hson.reject.basis.number.named-nan; source:inline; review:standalone -->
| `hson.reject.basis.number.named-nan` | `NaN` | Invalid | NaN is not an authored finite number. |  |  |
<!-- authored-case:hson.reject.basis.number.named-negative-infinity; source:inline; review:standalone -->
| `hson.reject.basis.number.named-negative-infinity` | `-Infinity` | Invalid | Negative Infinity is not an authored finite number. |  |  |
<!-- authored-case:hson.reject.basis.number.named-positive-infinity; source:inline; review:standalone -->
| `hson.reject.basis.number.named-positive-infinity` | `Infinity` | Invalid | Infinity is not an authored finite number. |  |  |
<!-- authored-case:hson.reject.basis.number.nonfinite-overflow; source:inline; review:standalone -->
| `hson.reject.basis.number.nonfinite-overflow` | `1e309` | Invalid | A syntactically valid number that overflows binary64 rejects as nonfinite. |  |  |
<!-- authored-case:hson.reject.basis.number.numeric-separator; source:inline; review:standalone -->
| `hson.reject.basis.number.numeric-separator` | `1_0` | Invalid | Numeric separators are not JSON-compatible HSON number syntax. |  |  |


## 9. Accepted source trivia and comments

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.accept.basis.trivia.array-slots; source:display; review:standalone -->
| `hson.accept.basis.trivia.array-slots` | <pre>Escaped source: &quot;[ \u00091 \u000D,\u000A// next item\u000A 2 \u000D\u000A]&quot;<br>Actual code units: index 2: HT U+0009; index 5: CR U+000D; index 7: LF U+000A; index 20: LF U+000A; index 24: CR U+000D; index 25: LF U+000A; all other code units are printable as shown</pre> | Valid | Array trivia covers after-opener, before-comma, after-comma, before-closer, and a terminated item-boundary comment.<br>**Review attention:** Complex trivia composition. |  |  |
<!-- authored-case:hson.accept.basis.trivia.comment-to-eof; source:inline; review:standalone -->
| `hson.accept.basis.trivia.comment-to-eof` | `42// comment to EOF` | Valid | A physical-line comment may supply trailing root trivia through EOF. |  |  |
<!-- authored-case:hson.accept.basis.trivia.element-slots; source:display; review:standalone -->
| `hson.accept.basis.trivia.element-slots` | <pre>Escaped source: &quot;&lt; \u000Awidget \u0009 title \u000D= \u000A\&quot;value\&quot;\u000D\u000A enabled \u0009 \&quot;a\&quot;// next leaf\u000A \&quot;b\&quot; \u000D /&gt;&quot;<br>Actual code units: index 2: LF U+000A; index 10: HT U+0009; index 18: CR U+000D; index 21: LF U+000A; index 29: CR U+000D; index 30: LF U+000A; index 40: HT U+0009; index 57: LF U+000A; index 63: CR U+000D; all other code units are printable as shown</pre> | Valid | Element trivia covers before-name, after-name, around equals, between header items, before and between content, and before slash.<br>**Review attention:** Implementation-influenced expected output; this pass reviews source validity only, not attribute output order. Complex trivia composition. |  |  |
<!-- authored-case:hson.accept.basis.trivia.object-slots; source:display; review:standalone -->
| `hson.accept.basis.trivia.object-slots` | <pre>Escaped source: &quot;&lt; \u0009alpha// first\u000A// second\u000D\u000A 1\u000D beta\u00092 \u000A&gt;&quot;<br>Actual code units: index 2: HT U+0009; index 16: LF U+000A; index 26: CR U+000D; index 27: LF U+000A; index 30: CR U+000D; index 36: HT U+0009; index 39: LF U+000A; all other code units are printable as shown</pre> | Valid | Object trivia covers after-open, key/value, sibling, before-close, and consecutive terminated-comment slots.<br>**Review attention:** Complex trivia composition. |  |  |
<!-- authored-case:hson.accept.literal.trivia.space-tab-lf-cr; source:display; review:standalone -->
| `hson.accept.literal.trivia.space-tab-lf-cr` | <pre>Escaped source: &quot; \u0009\u000D\u000A42\u000D\u000A&quot;<br>Actual code units: index 1: HT U+0009; index 2: CR U+000D; index 3: LF U+000A; index 6: CR U+000D; index 7: LF U+000A; all other code units are printable as shown</pre> | Valid | Grammar trivia is exactly SPACE, HT, LF, and CR. |  |  |


## 10. Rejected trivia and unsupported whitespace

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.reject.literal.comment.block; source:inline; review:standalone -->
| `hson.reject.literal.comment.block` | `/*x*/1` | Invalid | Block comments are unsupported.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.source.comment-only; source:inline; review:standalone -->
| `hson.reject.literal.source.comment-only` | `// comment` | Invalid | Comment-only source has no semantic value.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.source.whitespace-only; source:inline; review:standalone -->
| `hson.reject.literal.source.whitespace-only` | `   ` | Invalid | Whitespace-only source has no semantic value.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.whitespace.byte-order-mark; source:display; review:standalone -->
| `hson.reject.literal.whitespace.byte-order-mark` | <pre>Escaped source: &quot;1\uFEFF&quot;<br>Actual code units: index 1: BYTE ORDER MARK U+FEFF; all other code units are printable as shown</pre> | Invalid | U+FEFF is not authored-HSON trivia.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |

### Family: Unsupported external whitespace

Code points outside SPACE, HT, LF, and CR are not authored-HSON trivia.

Family verdict (`V/I/?`): ______

Inheritance rule:
If a family verdict is present, every blank row inherits it.
An individual row verdict overrides the family verdict.
Blank family and row verdicts mean not reviewed.

<!-- family:start unsupported-whitespace -->
| Case ID | Exact source/display | Current proposal | Distinct varied value | Row override (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.reject.family.unsupported-whitespace.u000b; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u000b` | <pre>Escaped source: &quot;1\u000B&quot;<br>Actual code units: index 1: VERTICAL TAB U+000B; all other code units are printable as shown</pre> | Invalid | unsupported-u000b<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u000c; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u000c` | <pre>Escaped source: &quot;1\u000C&quot;<br>Actual code units: index 1: FORM FEED U+000C; all other code units are printable as shown</pre> | Invalid | unsupported-u000c<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u00a0; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u00a0` | <pre>Escaped source: &quot;1\u00A0&quot;<br>Actual code units: index 1: NO-BREAK SPACE U+00A0; all other code units are printable as shown</pre> | Invalid | unsupported-u00a0<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u1680; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u1680` | <pre>Escaped source: &quot;1\u1680&quot;<br>Actual code units: index 1: OGHAM SPACE MARK U+1680; all other code units are printable as shown</pre> | Invalid | unsupported-u1680<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2000; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u2000` | <pre>Escaped source: &quot;1\u2000&quot;<br>Actual code units: index 1: Unicode whitespace U+2000; all other code units are printable as shown</pre> | Invalid | unsupported-u2000<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2001; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u2001` | <pre>Escaped source: &quot;1\u2001&quot;<br>Actual code units: index 1: Unicode whitespace U+2001; all other code units are printable as shown</pre> | Invalid | unsupported-u2001<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2002; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u2002` | <pre>Escaped source: &quot;1\u2002&quot;<br>Actual code units: index 1: Unicode whitespace U+2002; all other code units are printable as shown</pre> | Invalid | unsupported-u2002<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2003; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u2003` | <pre>Escaped source: &quot;1\u2003&quot;<br>Actual code units: index 1: Unicode whitespace U+2003; all other code units are printable as shown</pre> | Invalid | unsupported-u2003<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2004; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u2004` | <pre>Escaped source: &quot;1\u2004&quot;<br>Actual code units: index 1: Unicode whitespace U+2004; all other code units are printable as shown</pre> | Invalid | unsupported-u2004<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2005; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u2005` | <pre>Escaped source: &quot;1\u2005&quot;<br>Actual code units: index 1: Unicode whitespace U+2005; all other code units are printable as shown</pre> | Invalid | unsupported-u2005<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2006; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u2006` | <pre>Escaped source: &quot;1\u2006&quot;<br>Actual code units: index 1: Unicode whitespace U+2006; all other code units are printable as shown</pre> | Invalid | unsupported-u2006<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2007; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u2007` | <pre>Escaped source: &quot;1\u2007&quot;<br>Actual code units: index 1: Unicode whitespace U+2007; all other code units are printable as shown</pre> | Invalid | unsupported-u2007<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2008; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u2008` | <pre>Escaped source: &quot;1\u2008&quot;<br>Actual code units: index 1: Unicode whitespace U+2008; all other code units are printable as shown</pre> | Invalid | unsupported-u2008<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2009; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u2009` | <pre>Escaped source: &quot;1\u2009&quot;<br>Actual code units: index 1: Unicode whitespace U+2009; all other code units are printable as shown</pre> | Invalid | unsupported-u2009<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u200a; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u200a` | <pre>Escaped source: &quot;1\u200A&quot;<br>Actual code units: index 1: Unicode whitespace U+200A; all other code units are printable as shown</pre> | Invalid | unsupported-u200a<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2028; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u2028` | <pre>Escaped source: &quot;1\u2028&quot;<br>Actual code units: index 1: LINE SEPARATOR U+2028; all other code units are printable as shown</pre> | Invalid | unsupported-u2028<br>**Review attention:** Implementation-derived classification or expectation provenance. Exercises U+2028 LINE SEPARATOR. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2029; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u2029` | <pre>Escaped source: &quot;1\u2029&quot;<br>Actual code units: index 1: PARAGRAPH SEPARATOR U+2029; all other code units are printable as shown</pre> | Invalid | unsupported-u2029<br>**Review attention:** Implementation-derived classification or expectation provenance. Exercises U+2029 PARAGRAPH SEPARATOR. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u202f; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u202f` | <pre>Escaped source: &quot;1\u202F&quot;<br>Actual code units: index 1: NARROW NO-BREAK SPACE U+202F; all other code units are printable as shown</pre> | Invalid | unsupported-u202f<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u205f; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u205f` | <pre>Escaped source: &quot;1\u205F&quot;<br>Actual code units: index 1: MEDIUM MATHEMATICAL SPACE U+205F; all other code units are printable as shown</pre> | Invalid | unsupported-u205f<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.unsupported-whitespace.u3000; source:display; review:family:unsupported-whitespace -->
| `hson.reject.family.unsupported-whitespace.u3000` | <pre>Escaped source: &quot;1\u3000&quot;<br>Actual code units: index 1: IDEOGRAPHIC SPACE U+3000; all other code units are printable as shown</pre> | Invalid | unsupported-u3000<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- family:end unsupported-whitespace -->


## 11. Accepted quoted-string escapes

### Family: Accepted ordinary quoted-string escape dispatch

Each displayed JSON escape is accepted in a quoted HSON string.

Family verdict (`V/I/?`): ______

Inheritance rule:
If a family verdict is present, every blank row inherits it.
An individual row verdict overrides the family verdict.
Blank family and row verdicts mean not reviewed.

<!-- family:start quoted-string-ordinary-dispatch -->
| Case ID | Exact source/display | Current proposal | Distinct varied value | Row override (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.accept.family.quoted-string.quote; source:inline; review:family:quoted-string-ordinary-dispatch -->
| `hson.accept.family.quoted-string.quote` | `"\""` | Valid | quote |  |  |
<!-- authored-case:hson.accept.family.quoted-string.backslash; source:inline; review:family:quoted-string-ordinary-dispatch -->
| `hson.accept.family.quoted-string.backslash` | `"\\"` | Valid | backslash |  |  |
<!-- authored-case:hson.accept.family.quoted-string.slash; source:inline; review:family:quoted-string-ordinary-dispatch -->
| `hson.accept.family.quoted-string.slash` | `"\/"` | Valid | slash |  |  |
<!-- authored-case:hson.accept.family.quoted-string.backspace; source:inline; review:family:quoted-string-ordinary-dispatch -->
| `hson.accept.family.quoted-string.backspace` | `"\b"` | Valid | backspace |  |  |
<!-- authored-case:hson.accept.family.quoted-string.form-feed; source:inline; review:family:quoted-string-ordinary-dispatch -->
| `hson.accept.family.quoted-string.form-feed` | `"\f"` | Valid | form-feed |  |  |
<!-- authored-case:hson.accept.family.quoted-string.line-feed; source:inline; review:family:quoted-string-ordinary-dispatch -->
| `hson.accept.family.quoted-string.line-feed` | `"\n"` | Valid | line-feed |  |  |
<!-- authored-case:hson.accept.family.quoted-string.carriage-return; source:inline; review:family:quoted-string-ordinary-dispatch -->
| `hson.accept.family.quoted-string.carriage-return` | `"\r"` | Valid | carriage-return |  |  |
<!-- authored-case:hson.accept.family.quoted-string.tab; source:inline; review:family:quoted-string-ordinary-dispatch -->
| `hson.accept.family.quoted-string.tab` | `"\t"` | Valid | tab |  |  |
<!-- authored-case:hson.accept.family.quoted-string.escape-before-quote; source:inline; review:family:quoted-string-ordinary-dispatch -->
| `hson.accept.family.quoted-string.escape-before-quote` | `"end\t"` | Valid | escape-before-quote |  |  |
<!-- authored-case:hson.accept.family.quoted-string.escape-before-container-closer; source:inline; review:family:quoted-string-ordinary-dispatch -->
| `hson.accept.family.quoted-string.escape-before-container-closer` | `<e "x\t"/>` | Valid | escape-before-container-closer |  |  |
<!-- family:end quoted-string-ordinary-dispatch -->

### Family: Accepted quoted-string Unicode boundaries

Each complete four-hex-digit Unicode escape sequence is accepted in a quoted HSON string.

Family verdict (`V/I/?`): ______

Inheritance rule:
If a family verdict is present, every blank row inherits it.
An individual row verdict overrides the family verdict.
Blank family and row verdicts mean not reviewed.

<!-- family:start quoted-string-unicode-boundaries -->
| Case ID | Exact source/display | Current proposal | Distinct varied value | Row override (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.accept.family.quoted-string.unicode-lowercase; source:inline; review:family:quoted-string-unicode-boundaries -->
| `hson.accept.family.quoted-string.unicode-lowercase` | `"\u0061"` | Valid | unicode-lowercase |  |  |
<!-- authored-case:hson.accept.family.quoted-string.unicode-uppercase; source:inline; review:family:quoted-string-unicode-boundaries -->
| `hson.accept.family.quoted-string.unicode-uppercase` | `"\u006A"` | Valid | unicode-uppercase |  |  |
<!-- authored-case:hson.accept.family.quoted-string.unicode-mixed-case; source:inline; review:family:quoted-string-unicode-boundaries -->
| `hson.accept.family.quoted-string.unicode-mixed-case` | `"\u00aF"` | Valid | unicode-mixed-case |  |  |
<!-- authored-case:hson.accept.family.quoted-string.unicode-u0000; source:inline; review:family:quoted-string-unicode-boundaries -->
| `hson.accept.family.quoted-string.unicode-u0000` | `"\u0000"` | Valid | unicode-u0000 |  |  |
<!-- authored-case:hson.accept.family.quoted-string.unicode-u001f; source:inline; review:family:quoted-string-unicode-boundaries -->
| `hson.accept.family.quoted-string.unicode-u001f` | `"\u001F"` | Valid | unicode-u001f |  |  |
<!-- authored-case:hson.accept.family.quoted-string.unicode-u007f; source:inline; review:family:quoted-string-unicode-boundaries -->
| `hson.accept.family.quoted-string.unicode-u007f` | `"\u007F"` | Valid | unicode-u007f |  |  |
<!-- authored-case:hson.accept.family.quoted-string.unicode-u0080; source:inline; review:family:quoted-string-unicode-boundaries -->
| `hson.accept.family.quoted-string.unicode-u0080` | `"\u0080"` | Valid | unicode-u0080 |  |  |
<!-- authored-case:hson.accept.family.quoted-string.unicode-u00ff; source:inline; review:family:quoted-string-unicode-boundaries -->
| `hson.accept.family.quoted-string.unicode-u00ff` | `"\u00FF"` | Valid | unicode-u00ff |  |  |
<!-- authored-case:hson.accept.family.quoted-string.unicode-u0100; source:inline; review:family:quoted-string-unicode-boundaries -->
| `hson.accept.family.quoted-string.unicode-u0100` | `"\u0100"` | Valid | unicode-u0100 |  |  |
<!-- authored-case:hson.accept.family.quoted-string.unicode-u2028; source:inline; review:family:quoted-string-unicode-boundaries -->
| `hson.accept.family.quoted-string.unicode-u2028` | `"\u2028"` | Valid | unicode-u2028<br>**Review attention:** Exercises U+2028 LINE SEPARATOR. |  |  |
<!-- authored-case:hson.accept.family.quoted-string.unicode-u2029; source:inline; review:family:quoted-string-unicode-boundaries -->
| `hson.accept.family.quoted-string.unicode-u2029` | `"\u2029"` | Valid | unicode-u2029<br>**Review attention:** Exercises U+2029 PARAGRAPH SEPARATOR. |  |  |
<!-- authored-case:hson.accept.family.quoted-string.unicode-high-surrogate; source:inline; review:family:quoted-string-unicode-boundaries -->
| `hson.accept.family.quoted-string.unicode-high-surrogate` | `"\uD800"` | Valid | unicode-high-surrogate<br>**Review attention:** Contains an isolated high-surrogate escape. |  |  |
<!-- authored-case:hson.accept.family.quoted-string.unicode-low-surrogate; source:inline; review:family:quoted-string-unicode-boundaries -->
| `hson.accept.family.quoted-string.unicode-low-surrogate` | `"\uDC00"` | Valid | unicode-low-surrogate<br>**Review attention:** Contains an isolated low-surrogate escape. |  |  |
<!-- authored-case:hson.accept.family.quoted-string.unicode-surrogate-pair; source:inline; review:family:quoted-string-unicode-boundaries -->
| `hson.accept.family.quoted-string.unicode-surrogate-pair` | `"\uD83D\uDE00"` | Valid | unicode-surrogate-pair |  |  |
<!-- authored-case:hson.accept.family.quoted-string.consecutive-unicode; source:inline; review:family:quoted-string-unicode-boundaries -->
| `hson.accept.family.quoted-string.consecutive-unicode` | `"\u0041\u0042"` | Valid | consecutive-unicode |  |  |
<!-- family:end quoted-string-unicode-boundaries -->


## 12. Malformed quoted-string escapes

### Family: Malformed quoted-string escapes

Each displayed malformed, incomplete, or unsupported quoted-string escape is invalid.

Family verdict (`V/I/?`): ______

Inheritance rule:
If a family verdict is present, every blank row inherits it.
An individual row verdict overrides the family verdict.
Blank family and row verdicts mean not reviewed.

<!-- family:start quoted-string-malformed-escapes -->
| Case ID | Exact source/display | Current proposal | Distinct varied value | Row override (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.reject.family.quoted-string.unicode-zero-hex; source:inline; review:family:quoted-string-malformed-escapes -->
| `hson.reject.family.quoted-string.unicode-zero-hex` | `"\u"` | Invalid | unicode-zero-hex<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.unicode-one-hex; source:inline; review:family:quoted-string-malformed-escapes -->
| `hson.reject.family.quoted-string.unicode-one-hex` | `"\u1"` | Invalid | unicode-one-hex<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.unicode-two-hex; source:inline; review:family:quoted-string-malformed-escapes -->
| `hson.reject.family.quoted-string.unicode-two-hex` | `"\u12"` | Invalid | unicode-two-hex<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.unicode-three-hex; source:inline; review:family:quoted-string-malformed-escapes -->
| `hson.reject.family.quoted-string.unicode-three-hex` | `"\u123"` | Invalid | unicode-three-hex<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.invalid-hex-position-1; source:inline; review:family:quoted-string-malformed-escapes -->
| `hson.reject.family.quoted-string.invalid-hex-position-1` | `"\uG000"` | Invalid | invalid-hex-position-1<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.invalid-hex-position-2; source:inline; review:family:quoted-string-malformed-escapes -->
| `hson.reject.family.quoted-string.invalid-hex-position-2` | `"\u0G00"` | Invalid | invalid-hex-position-2<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.invalid-hex-position-3; source:inline; review:family:quoted-string-malformed-escapes -->
| `hson.reject.family.quoted-string.invalid-hex-position-3` | `"\u00G0"` | Invalid | invalid-hex-position-3<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.invalid-hex-position-4; source:inline; review:family:quoted-string-malformed-escapes -->
| `hson.reject.family.quoted-string.invalid-hex-position-4` | `"\u000G"` | Invalid | invalid-hex-position-4<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.unicode-interrupted-space; source:inline; review:family:quoted-string-malformed-escapes -->
| `hson.reject.family.quoted-string.unicode-interrupted-space` | `"\u 000"` | Invalid | unicode-interrupted-space<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.unicode-interrupted-quote; source:inline; review:family:quoted-string-malformed-escapes -->
| `hson.reject.family.quoted-string.unicode-interrupted-quote` | `"\u"000"` | Invalid | unicode-interrupted-quote<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.unicode-interrupted-backslash; source:inline; review:family:quoted-string-malformed-escapes -->
| `hson.reject.family.quoted-string.unicode-interrupted-backslash` | `"\u\000"` | Invalid | unicode-interrupted-backslash<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.unsupported-letter; source:inline; review:family:quoted-string-malformed-escapes -->
| `hson.reject.family.quoted-string.unsupported-letter` | `"\q"` | Invalid | unsupported-letter<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.eof-during-unicode; source:inline; review:family:quoted-string-malformed-escapes -->
| `hson.reject.family.quoted-string.eof-during-unicode` | `"\u12` | Invalid | eof-during-unicode<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.trailing-backslash; source:inline; review:family:quoted-string-malformed-escapes -->
| `hson.reject.family.quoted-string.trailing-backslash` | `"bad\` | Invalid | trailing-backslash<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- family:end quoted-string-malformed-escapes -->


## 13. Raw controls in quoted strings

### Family: Raw C0 controls in quoted strings

A raw U+0000 through U+001F code unit is invalid inside a quoted string.

Family verdict (`V/I/?`): ______

Inheritance rule:
If a family verdict is present, every blank row inherits it.
An individual row verdict overrides the family verdict.
Blank family and row verdicts mean not reviewed.

<!-- family:start quoted-string-raw-c0 -->
| Case ID | Exact source/display | Current proposal | Distinct varied value | Row override (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.reject.family.quoted-string.raw-u0000; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0000` | <pre>Escaped source: &quot;\&quot;a\u0000b\&quot;&quot;<br>Actual code units: index 2: NUL U+0000; all other code units are printable as shown</pre> | Invalid | raw-u0000<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0001; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0001` | <pre>Escaped source: &quot;\&quot;a\u0001b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0001; all other code units are printable as shown</pre> | Invalid | raw-u0001<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0002; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0002` | <pre>Escaped source: &quot;\&quot;a\u0002b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0002; all other code units are printable as shown</pre> | Invalid | raw-u0002<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0003; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0003` | <pre>Escaped source: &quot;\&quot;a\u0003b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0003; all other code units are printable as shown</pre> | Invalid | raw-u0003<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0004; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0004` | <pre>Escaped source: &quot;\&quot;a\u0004b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0004; all other code units are printable as shown</pre> | Invalid | raw-u0004<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0005; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0005` | <pre>Escaped source: &quot;\&quot;a\u0005b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0005; all other code units are printable as shown</pre> | Invalid | raw-u0005<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0006; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0006` | <pre>Escaped source: &quot;\&quot;a\u0006b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0006; all other code units are printable as shown</pre> | Invalid | raw-u0006<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0007; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0007` | <pre>Escaped source: &quot;\&quot;a\u0007b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0007; all other code units are printable as shown</pre> | Invalid | raw-u0007<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0008; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0008` | <pre>Escaped source: &quot;\&quot;a\u0008b\&quot;&quot;<br>Actual code units: index 2: BACKSPACE U+0008; all other code units are printable as shown</pre> | Invalid | raw-u0008<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0009; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0009` | <pre>Escaped source: &quot;\&quot;a\u0009b\&quot;&quot;<br>Actual code units: index 2: HT U+0009; all other code units are printable as shown</pre> | Invalid | raw-u0009<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u000a; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u000a` | <pre>Escaped source: &quot;\&quot;a\u000Ab\&quot;&quot;<br>Actual code units: index 2: LF U+000A; all other code units are printable as shown</pre> | Invalid | raw-u000a<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u000b; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u000b` | <pre>Escaped source: &quot;\&quot;a\u000Bb\&quot;&quot;<br>Actual code units: index 2: VERTICAL TAB U+000B; all other code units are printable as shown</pre> | Invalid | raw-u000b<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u000c; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u000c` | <pre>Escaped source: &quot;\&quot;a\u000Cb\&quot;&quot;<br>Actual code units: index 2: FORM FEED U+000C; all other code units are printable as shown</pre> | Invalid | raw-u000c<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u000d; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u000d` | <pre>Escaped source: &quot;\&quot;a\u000Db\&quot;&quot;<br>Actual code units: index 2: CR U+000D; all other code units are printable as shown</pre> | Invalid | raw-u000d<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u000e; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u000e` | <pre>Escaped source: &quot;\&quot;a\u000Eb\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+000E; all other code units are printable as shown</pre> | Invalid | raw-u000e<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u000f; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u000f` | <pre>Escaped source: &quot;\&quot;a\u000Fb\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+000F; all other code units are printable as shown</pre> | Invalid | raw-u000f<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0010; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0010` | <pre>Escaped source: &quot;\&quot;a\u0010b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0010; all other code units are printable as shown</pre> | Invalid | raw-u0010<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0011; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0011` | <pre>Escaped source: &quot;\&quot;a\u0011b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0011; all other code units are printable as shown</pre> | Invalid | raw-u0011<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0012; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0012` | <pre>Escaped source: &quot;\&quot;a\u0012b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0012; all other code units are printable as shown</pre> | Invalid | raw-u0012<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0013; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0013` | <pre>Escaped source: &quot;\&quot;a\u0013b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0013; all other code units are printable as shown</pre> | Invalid | raw-u0013<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0014; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0014` | <pre>Escaped source: &quot;\&quot;a\u0014b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0014; all other code units are printable as shown</pre> | Invalid | raw-u0014<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0015; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0015` | <pre>Escaped source: &quot;\&quot;a\u0015b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0015; all other code units are printable as shown</pre> | Invalid | raw-u0015<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0016; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0016` | <pre>Escaped source: &quot;\&quot;a\u0016b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0016; all other code units are printable as shown</pre> | Invalid | raw-u0016<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0017; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0017` | <pre>Escaped source: &quot;\&quot;a\u0017b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0017; all other code units are printable as shown</pre> | Invalid | raw-u0017<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0018; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0018` | <pre>Escaped source: &quot;\&quot;a\u0018b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0018; all other code units are printable as shown</pre> | Invalid | raw-u0018<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u0019; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u0019` | <pre>Escaped source: &quot;\&quot;a\u0019b\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+0019; all other code units are printable as shown</pre> | Invalid | raw-u0019<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u001a; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u001a` | <pre>Escaped source: &quot;\&quot;a\u001Ab\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+001A; all other code units are printable as shown</pre> | Invalid | raw-u001a<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u001b; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u001b` | <pre>Escaped source: &quot;\&quot;a\u001Bb\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+001B; all other code units are printable as shown</pre> | Invalid | raw-u001b<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u001c; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u001c` | <pre>Escaped source: &quot;\&quot;a\u001Cb\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+001C; all other code units are printable as shown</pre> | Invalid | raw-u001c<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u001d; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u001d` | <pre>Escaped source: &quot;\&quot;a\u001Db\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+001D; all other code units are printable as shown</pre> | Invalid | raw-u001d<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u001e; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u001e` | <pre>Escaped source: &quot;\&quot;a\u001Eb\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+001E; all other code units are printable as shown</pre> | Invalid | raw-u001e<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.quoted-string.raw-u001f; source:display; review:family:quoted-string-raw-c0 -->
| `hson.reject.family.quoted-string.raw-u001f` | <pre>Escaped source: &quot;\&quot;a\u001Fb\&quot;&quot;<br>Actual code units: index 2: raw C0 control U+001F; all other code units are printable as shown</pre> | Invalid | raw-u001f<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- family:end quoted-string-raw-c0 -->


## 14. Accepted backtick names

### Matched contrast: empty decoded-name roles

```hson
<`` 1>
<``/>
<e ``="x"/>
<e ``/>
```

An empty decoded object-property key is presently proposed valid; empty element,
attribute, and flag names are presently proposed invalid.

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.accept.basis.backtick-name.element-name; source:inline; review:standalone -->
| `hson.accept.basis.backtick-name.element-name` | ``<`x y`/>`` | Valid | A nonempty backtick name is admitted as an HSON element name. |  |  |
<!-- authored-case:hson.accept.literal.object.colon-dot-names; source:inline; review:standalone -->
| `hson.accept.literal.object.colon-dot-names` | `<:x 1 a.b 2>` | Valid | Colon and dot keys canonicalize through backticks.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.accept.literal.object.empty-decoded-key; source:inline; review:standalone -->
| `hson.accept.literal.object.empty-decoded-key` | ```<`` 1>``` | Valid | An empty decoded object-property key is valid.<br>**Review attention:** Implementation-derived classification or expectation provenance. Empty decoded name; validity depends on the name's grammatical role. |  |  |

### Family: Accepted ordinary backtick-name escape dispatch

Each displayed ordinary escape is accepted in a backtick object-property name.

Family verdict (`V/I/?`): ______

Inheritance rule:
If a family verdict is present, every blank row inherits it.
An individual row verdict overrides the family verdict.
Blank family and row verdicts mean not reviewed.

<!-- family:start backtick-name-ordinary-dispatch -->
| Case ID | Exact source/display | Current proposal | Distinct varied value | Row override (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.accept.family.backtick-name.escaped-backtick; source:inline; review:family:backtick-name-ordinary-dispatch -->
| `hson.accept.family.backtick-name.escaped-backtick` | ``<`tick\`name` 1>`` | Valid | escaped-backtick |  |  |
<!-- authored-case:hson.accept.family.backtick-name.escaped-backslash; source:inline; review:family:backtick-name-ordinary-dispatch -->
| `hson.accept.family.backtick-name.escaped-backslash` | ``<`back\\slash` 1>`` | Valid | escaped-backslash |  |  |
<!-- authored-case:hson.accept.family.backtick-name.backspace; source:inline; review:family:backtick-name-ordinary-dispatch -->
| `hson.accept.family.backtick-name.backspace` | ``<`back\bspace` 1>`` | Valid | backspace |  |  |
<!-- authored-case:hson.accept.family.backtick-name.form-feed; source:inline; review:family:backtick-name-ordinary-dispatch -->
| `hson.accept.family.backtick-name.form-feed` | ``<`form\ffeed` 1>`` | Valid | form-feed |  |  |
<!-- authored-case:hson.accept.family.backtick-name.line-feed; source:inline; review:family:backtick-name-ordinary-dispatch -->
| `hson.accept.family.backtick-name.line-feed` | ``<`line\nname` 1>`` | Valid | line-feed |  |  |
<!-- authored-case:hson.accept.family.backtick-name.carriage-return; source:inline; review:family:backtick-name-ordinary-dispatch -->
| `hson.accept.family.backtick-name.carriage-return` | ``<`line\rname` 1>`` | Valid | carriage-return |  |  |
<!-- authored-case:hson.accept.family.backtick-name.tab; source:inline; review:family:backtick-name-ordinary-dispatch -->
| `hson.accept.family.backtick-name.tab` | ``<`line\tname` 1>`` | Valid | tab |  |  |
<!-- family:end backtick-name-ordinary-dispatch -->

### Family: Accepted backtick-name Unicode boundaries

Each complete four-hex-digit Unicode escape sequence is accepted in a backtick object-property name.

Family verdict (`V/I/?`): ______

Inheritance rule:
If a family verdict is present, every blank row inherits it.
An individual row verdict overrides the family verdict.
Blank family and row verdicts mean not reviewed.

<!-- family:start backtick-name-unicode-boundaries -->
| Case ID | Exact source/display | Current proposal | Distinct varied value | Row override (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.accept.family.backtick-name.unicode-lowercase; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.unicode-lowercase` | ``<`lower\u0061name` 1>`` | Valid | unicode-lowercase |  |  |
<!-- authored-case:hson.accept.family.backtick-name.unicode-uppercase; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.unicode-uppercase` | ``<`upper\u006Aname` 1>`` | Valid | unicode-uppercase |  |  |
<!-- authored-case:hson.accept.family.backtick-name.unicode-mixed-case; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.unicode-mixed-case` | ``<`mixed\u00aFname` 1>`` | Valid | unicode-mixed-case |  |  |
<!-- authored-case:hson.accept.family.backtick-name.unicode-u0000; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.unicode-u0000` | ``<`nul\u0000name` 1>`` | Valid | unicode-u0000 |  |  |
<!-- authored-case:hson.accept.family.backtick-name.unicode-control; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.unicode-control` | ``<`control\u0001name` 1>`` | Valid | unicode-control |  |  |
<!-- authored-case:hson.accept.family.backtick-name.unicode-u001f; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.unicode-u001f` | ``<`unit\u001Fname` 1>`` | Valid | unicode-u001f |  |  |
<!-- authored-case:hson.accept.family.backtick-name.unicode-u007f; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.unicode-u007f` | ``<`unit\u007fname` 1>`` | Valid | unicode-u007f |  |  |
<!-- authored-case:hson.accept.family.backtick-name.unicode-u0080; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.unicode-u0080` | ``<`unit\u0080name` 1>`` | Valid | unicode-u0080 |  |  |
<!-- authored-case:hson.accept.family.backtick-name.unicode-u00ff; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.unicode-u00ff` | ``<`unit\u00FFname` 1>`` | Valid | unicode-u00ff |  |  |
<!-- authored-case:hson.accept.family.backtick-name.unicode-u0100; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.unicode-u0100` | ``<`unit\u0100name` 1>`` | Valid | unicode-u0100 |  |  |
<!-- authored-case:hson.accept.family.backtick-name.unicode-u2028; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.unicode-u2028` | ``<`unit\u2028name` 1>`` | Valid | unicode-u2028<br>**Review attention:** Exercises U+2028 LINE SEPARATOR. |  |  |
<!-- authored-case:hson.accept.family.backtick-name.unicode-u2029; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.unicode-u2029` | ``<`unit\u2029name` 1>`` | Valid | unicode-u2029<br>**Review attention:** Exercises U+2029 PARAGRAPH SEPARATOR. |  |  |
<!-- authored-case:hson.accept.family.backtick-name.unicode-lambda; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.unicode-lambda` | ``<`lambda\u03bbname` 1>`` | Valid | unicode-lambda |  |  |
<!-- authored-case:hson.accept.family.backtick-name.unicode-high-surrogate; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.unicode-high-surrogate` | ``<`high\uD800name` 1>`` | Valid | unicode-high-surrogate<br>**Review attention:** Contains an isolated high-surrogate escape. |  |  |
<!-- authored-case:hson.accept.family.backtick-name.unicode-low-surrogate; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.unicode-low-surrogate` | ``<`low\uDC00name` 1>`` | Valid | unicode-low-surrogate<br>**Review attention:** Contains an isolated low-surrogate escape. |  |  |
<!-- authored-case:hson.accept.family.backtick-name.unicode-surrogate-pair; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.unicode-surrogate-pair` | ``<`pair\uD83D\uDE00name` 1>`` | Valid | unicode-surrogate-pair |  |  |
<!-- authored-case:hson.accept.family.backtick-name.consecutive-unicode; source:inline; review:family:backtick-name-unicode-boundaries -->
| `hson.accept.family.backtick-name.consecutive-unicode` | ``<`pair\u0041\u0042name` 1>`` | Valid | consecutive-unicode |  |  |
<!-- family:end backtick-name-unicode-boundaries -->


## 15. Malformed backtick names

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.reject.basis.backtick-name.attribute-name; source:inline; review:standalone -->
| `hson.reject.basis.backtick-name.attribute-name` | ``<e `data key`="value"/>`` | Invalid | Backtick names are not admitted as element attribute names. |  |  |
<!-- authored-case:hson.reject.basis.backtick-name.flag-name; source:inline; review:standalone -->
| `hson.reject.basis.backtick-name.flag-name` | ``<e `feature flag`/>`` | Invalid | Backtick names are not admitted as element flag names. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.trailing-backslash; source:inline; review:standalone -->
| `hson.reject.family.backtick-name.trailing-backslash` | ``<`name\`` | Invalid | This displayed malformed or unsupported backtick-name escape is invalid.<br>**Review attention:** Implementation-derived classification or expectation provenance. Calibrated diagnostic; review only the rejection verdict here. Exact diagnostic ownership is deferred. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.unicode-interrupted-backtick; source:inline; review:standalone -->
| `hson.reject.family.backtick-name.unicode-interrupted-backtick` | ``<`\u`000` 1>`` | Invalid | This displayed malformed or unsupported backtick-name escape is invalid.<br>**Review attention:** Implementation-derived classification or expectation provenance. Calibrated diagnostic; review only the rejection verdict here. Exact diagnostic ownership is deferred. |  |  |

### Family: Malformed backtick-name escapes

Each displayed malformed, incomplete, or unsupported backtick-name escape is invalid.

Family verdict (`V/I/?`): ______

Inheritance rule:
If a family verdict is present, every blank row inherits it.
An individual row verdict overrides the family verdict.
Blank family and row verdicts mean not reviewed.

<!-- family:start backtick-name-malformed-escapes -->
| Case ID | Exact source/display | Current proposal | Distinct varied value | Row override (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.reject.family.backtick-name.unsupported-letter; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.unsupported-letter` | ``<`\q` 1>`` | Invalid | unsupported-letter<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.unsupported-slash; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.unsupported-slash` | ``<`\/` 1>`` | Invalid | unsupported-slash<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.unsupported-zero; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.unsupported-zero` | ``<`\0` 1>`` | Invalid | unsupported-zero<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.unsupported-hex; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.unsupported-hex` | ``<`\x41` 1>`` | Invalid | unsupported-hex<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.unicode-zero-hex; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.unicode-zero-hex` | ``<`\u` 1>`` | Invalid | unicode-zero-hex<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.unicode-one-hex; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.unicode-one-hex` | ``<`\u1` 1>`` | Invalid | unicode-one-hex<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.unicode-two-hex; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.unicode-two-hex` | ``<`\u12` 1>`` | Invalid | unicode-two-hex<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.unicode-three-hex; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.unicode-three-hex` | ``<`\u123` 1>`` | Invalid | unicode-three-hex<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.invalid-hex-position-1; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.invalid-hex-position-1` | ``<`\uG000` 1>`` | Invalid | invalid-hex-position-1<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.invalid-hex-position-2; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.invalid-hex-position-2` | ``<`\u0G00` 1>`` | Invalid | invalid-hex-position-2<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.invalid-hex-position-3; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.invalid-hex-position-3` | ``<`\u00G0` 1>`` | Invalid | invalid-hex-position-3<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.invalid-hex-position-4; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.invalid-hex-position-4` | ``<`\u000G` 1>`` | Invalid | invalid-hex-position-4<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.unicode-interrupted-space; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.unicode-interrupted-space` | ``<`\u 000` 1>`` | Invalid | unicode-interrupted-space<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.unicode-interrupted-quote; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.unicode-interrupted-quote` | ``<`\u"000` 1>`` | Invalid | unicode-interrupted-quote<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.unicode-interrupted-closer; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.unicode-interrupted-closer` | ``<`\u>000` 1>`` | Invalid | unicode-interrupted-closer<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.unicode-interrupted-backslash; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.unicode-interrupted-backslash` | ``<`\u\000` 1>`` | Invalid | unicode-interrupted-backslash<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.eof; source:inline; review:family:backtick-name-malformed-escapes -->
| `hson.reject.family.backtick-name.eof` | ``<`name`` | Invalid | eof<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- family:end backtick-name-malformed-escapes -->


## 16. Raw controls in backtick names

### Family: Raw C0 controls in backtick names

A raw U+0000 through U+001F code unit is invalid inside a backtick name.

Family verdict (`V/I/?`): ______

Inheritance rule:
If a family verdict is present, every blank row inherits it.
An individual row verdict overrides the family verdict.
Blank family and row verdicts mean not reviewed.

<!-- family:start backtick-name-raw-c0 -->
| Case ID | Exact source/display | Current proposal | Distinct varied value | Row override (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.reject.family.backtick-name.raw-u0000; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0000` | <pre>Escaped source: &quot;&lt;`a\u0000b` 1&gt;&quot;<br>Actual code units: index 3: NUL U+0000; all other code units are printable as shown</pre> | Invalid | raw-u0000<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0001; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0001` | <pre>Escaped source: &quot;&lt;`a\u0001b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0001; all other code units are printable as shown</pre> | Invalid | raw-u0001<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0002; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0002` | <pre>Escaped source: &quot;&lt;`a\u0002b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0002; all other code units are printable as shown</pre> | Invalid | raw-u0002<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0003; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0003` | <pre>Escaped source: &quot;&lt;`a\u0003b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0003; all other code units are printable as shown</pre> | Invalid | raw-u0003<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0004; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0004` | <pre>Escaped source: &quot;&lt;`a\u0004b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0004; all other code units are printable as shown</pre> | Invalid | raw-u0004<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0005; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0005` | <pre>Escaped source: &quot;&lt;`a\u0005b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0005; all other code units are printable as shown</pre> | Invalid | raw-u0005<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0006; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0006` | <pre>Escaped source: &quot;&lt;`a\u0006b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0006; all other code units are printable as shown</pre> | Invalid | raw-u0006<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0007; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0007` | <pre>Escaped source: &quot;&lt;`a\u0007b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0007; all other code units are printable as shown</pre> | Invalid | raw-u0007<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0008; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0008` | <pre>Escaped source: &quot;&lt;`a\u0008b` 1&gt;&quot;<br>Actual code units: index 3: BACKSPACE U+0008; all other code units are printable as shown</pre> | Invalid | raw-u0008<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0009; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0009` | <pre>Escaped source: &quot;&lt;`a\u0009b` 1&gt;&quot;<br>Actual code units: index 3: HT U+0009; all other code units are printable as shown</pre> | Invalid | raw-u0009<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u000a; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u000a` | <pre>Escaped source: &quot;&lt;`a\u000Ab` 1&gt;&quot;<br>Actual code units: index 3: LF U+000A; all other code units are printable as shown</pre> | Invalid | raw-u000a<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u000b; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u000b` | <pre>Escaped source: &quot;&lt;`a\u000Bb` 1&gt;&quot;<br>Actual code units: index 3: VERTICAL TAB U+000B; all other code units are printable as shown</pre> | Invalid | raw-u000b<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u000c; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u000c` | <pre>Escaped source: &quot;&lt;`a\u000Cb` 1&gt;&quot;<br>Actual code units: index 3: FORM FEED U+000C; all other code units are printable as shown</pre> | Invalid | raw-u000c<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u000d; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u000d` | <pre>Escaped source: &quot;&lt;`a\u000Db` 1&gt;&quot;<br>Actual code units: index 3: CR U+000D; all other code units are printable as shown</pre> | Invalid | raw-u000d<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u000e; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u000e` | <pre>Escaped source: &quot;&lt;`a\u000Eb` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+000E; all other code units are printable as shown</pre> | Invalid | raw-u000e<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u000f; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u000f` | <pre>Escaped source: &quot;&lt;`a\u000Fb` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+000F; all other code units are printable as shown</pre> | Invalid | raw-u000f<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0010; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0010` | <pre>Escaped source: &quot;&lt;`a\u0010b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0010; all other code units are printable as shown</pre> | Invalid | raw-u0010<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0011; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0011` | <pre>Escaped source: &quot;&lt;`a\u0011b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0011; all other code units are printable as shown</pre> | Invalid | raw-u0011<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0012; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0012` | <pre>Escaped source: &quot;&lt;`a\u0012b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0012; all other code units are printable as shown</pre> | Invalid | raw-u0012<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0013; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0013` | <pre>Escaped source: &quot;&lt;`a\u0013b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0013; all other code units are printable as shown</pre> | Invalid | raw-u0013<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0014; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0014` | <pre>Escaped source: &quot;&lt;`a\u0014b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0014; all other code units are printable as shown</pre> | Invalid | raw-u0014<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0015; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0015` | <pre>Escaped source: &quot;&lt;`a\u0015b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0015; all other code units are printable as shown</pre> | Invalid | raw-u0015<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0016; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0016` | <pre>Escaped source: &quot;&lt;`a\u0016b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0016; all other code units are printable as shown</pre> | Invalid | raw-u0016<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0017; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0017` | <pre>Escaped source: &quot;&lt;`a\u0017b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0017; all other code units are printable as shown</pre> | Invalid | raw-u0017<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0018; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0018` | <pre>Escaped source: &quot;&lt;`a\u0018b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0018; all other code units are printable as shown</pre> | Invalid | raw-u0018<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u0019; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u0019` | <pre>Escaped source: &quot;&lt;`a\u0019b` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+0019; all other code units are printable as shown</pre> | Invalid | raw-u0019<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u001a; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u001a` | <pre>Escaped source: &quot;&lt;`a\u001Ab` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+001A; all other code units are printable as shown</pre> | Invalid | raw-u001a<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u001b; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u001b` | <pre>Escaped source: &quot;&lt;`a\u001Bb` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+001B; all other code units are printable as shown</pre> | Invalid | raw-u001b<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u001c; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u001c` | <pre>Escaped source: &quot;&lt;`a\u001Cb` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+001C; all other code units are printable as shown</pre> | Invalid | raw-u001c<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u001d; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u001d` | <pre>Escaped source: &quot;&lt;`a\u001Db` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+001D; all other code units are printable as shown</pre> | Invalid | raw-u001d<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u001e; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u001e` | <pre>Escaped source: &quot;&lt;`a\u001Eb` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+001E; all other code units are printable as shown</pre> | Invalid | raw-u001e<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.family.backtick-name.raw-u001f; source:display; review:family:backtick-name-raw-c0 -->
| `hson.reject.family.backtick-name.raw-u001f` | <pre>Escaped source: &quot;&lt;`a\u001Fb` 1&gt;&quot;<br>Actual code units: index 3: raw C0 control U+001F; all other code units are printable as shown</pre> | Invalid | raw-u001f<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- family:end backtick-name-raw-c0 -->


## 17. Invalid HSON object grammar

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.reject.literal.object.attribute-syntax; source:inline; review:standalone -->
| `hson.reject.literal.object.attribute-syntax` | `<a title="x" "v">` | Invalid | Object properties do not use attribute equals syntax.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.object.comma; source:inline; review:standalone -->
| `hson.reject.literal.object.comma` | `<a 1, b 2>` | Invalid | Object properties do not use commas.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.object.duplicate; source:inline; review:standalone -->
| `hson.reject.literal.object.duplicate` | `<a 1 a 2>` | Invalid | Duplicate decoded object-property keys reject.<br>**Review attention:** Duplicate declaration behavior. |  |  |
<!-- authored-case:hson.reject.literal.object.extra-value; source:inline; review:standalone -->
| `hson.reject.literal.object.extra-value` | `<a 1 2 3>` | Invalid | An object property has exactly one value.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.object.flag; source:inline; review:standalone -->
| `hson.reject.literal.object.flag` | `<a flag>` | Invalid | An object property cannot omit its value.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.object.missing-trivia; source:inline; review:standalone -->
| `hson.reject.literal.object.missing-trivia` | `<a"x">` | Invalid | A property key and value require trivia.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.object.quid; source:inline; review:standalone -->
| `hson.reject.literal.object.quid` | `<a @0000000000000001 1>` | Invalid | Object-property QUIDs do not exist in authored HSON.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |


## 18. Invalid HSON array grammar

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.reject.literal.array.mismatched-bracket; source:inline; review:standalone -->
| `hson.reject.literal.array.mismatched-bracket` | `[1,2»` | Invalid | A bracket array must close with a bracket.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.array.mismatched-guillemet; source:inline; review:standalone -->
| `hson.reject.literal.array.mismatched-guillemet` | `«1,2]` | Invalid | A guillemet array must close with a guillemet.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.array.missing-comma; source:inline; review:standalone -->
| `hson.reject.literal.array.missing-comma` | `[1 2]` | Invalid | Array items require commas.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.array.missing-item; source:inline; review:standalone -->
| `hson.reject.literal.array.missing-item` | `[1,,2]` | Invalid | Two array commas cannot omit an item.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |


## 19. Invalid HSON element grammar

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.reject.literal.element.duplicate-attribute; source:inline; review:standalone -->
| `hson.reject.literal.element.duplicate-attribute` | `<e x="1" x="2"/>` | Invalid | Duplicate decoded element attributes reject.<br>**Review attention:** Duplicate declaration behavior. |  |  |
<!-- authored-case:hson.reject.literal.element.duplicate-quid; source:inline; review:standalone -->
| `hson.reject.literal.element.duplicate-quid` | `<e @0000000000000001 @0000000000000002/>` | Invalid | An element cannot declare two QUIDs.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.element.flag-after-content; source:inline; review:standalone -->
| `hson.reject.literal.element.flag-after-content` | `<e "x" late/>` | Invalid | Element flags cannot follow content.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.element.malformed-closer; source:inline; review:standalone -->
| `hson.reject.literal.element.malformed-closer` | `<e/ >` | Invalid | Whitespace cannot split an element closer.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.element.missing-attribute-value; source:inline; review:standalone -->
| `hson.reject.literal.element.missing-attribute-value` | `<e x=/>` | Invalid | An explicit element attribute requires a value.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.element.missing-quid; source:inline; review:standalone -->
| `hson.reject.literal.element.missing-quid` | `<e @/>` | Invalid | An element QUID marker requires a persisted QUID.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.empty-attribute-name; source:inline; review:standalone -->
| `hson.reject.literal.empty-attribute-name` | ```<e ``="x"/>``` | Invalid | An empty decoded attribute name rejects.<br>**Review attention:** Implementation-derived classification or expectation provenance. Empty decoded name; validity depends on the name's grammatical role. |  |  |
<!-- authored-case:hson.reject.literal.empty-element-name; source:inline; review:standalone -->
| `hson.reject.literal.empty-element-name` | ```<``/>``` | Invalid | An empty decoded element name rejects.<br>**Review attention:** Implementation-derived classification or expectation provenance. Empty decoded name; validity depends on the name's grammatical role. |  |  |
<!-- authored-case:hson.reject.literal.empty-flag-name; source:inline; review:standalone -->
| `hson.reject.literal.empty-flag-name` | ```<e ``/>``` | Invalid | An empty decoded flag name rejects.<br>**Review attention:** Implementation-derived classification or expectation provenance. Empty decoded name; validity depends on the name's grammatical role. |  |  |


## 20. Root and structural-mode failures

```hson
<a 1>     // current proposal: valid HSON object
<a 1/>    // current proposal: invalid HSON element typed content

<a/><b/>  // current proposal: valid element fragment
<a/><b 2> // current proposal: invalid mixed modes
```

These contrasts make the consequences of `>` versus `/>` and homogeneous
versus mixed root modes visible. The exact descriptors also appear below.

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.reject.basis.mode.object-element; source:inline; review:standalone -->
| `hson.reject.basis.mode.object-element` | `<a <e/>>` | Invalid | An HSON object property cannot contain an element-mode value.<br>**Review attention:** Structural-mode crossing or `>` versus `/>` boundary. |  |  |
<!-- authored-case:hson.reject.literal.element.numeric-content; source:inline; review:standalone -->
| `hson.reject.literal.element.numeric-content` | `<e 1/>` | Invalid | Numeric typed content beneath an HSON element rejects.<br>**Review attention:** Implementation-derived classification or expectation provenance. Structural-mode crossing or `>` versus `/>` boundary. Direct `>` versus `/>` contrast. |  |  |
<!-- authored-case:hson.reject.literal.mode.array-element; source:inline; review:standalone -->
| `hson.reject.literal.mode.array-element` | `[<e/>]` | Invalid | An array cannot contain element-mode content.<br>**Review attention:** Implementation-derived classification or expectation provenance. Structural-mode crossing or `>` versus `/>` boundary. |  |  |
<!-- authored-case:hson.reject.literal.mode.element-array; source:inline; review:standalone -->
| `hson.reject.literal.mode.element-array` | `<e [1]/>` | Invalid | An HSON element cannot contain an array.<br>**Review attention:** Implementation-derived classification or expectation provenance. Structural-mode crossing or `>` versus `/>` boundary. |  |  |
<!-- authored-case:hson.reject.literal.mode.element-object; source:inline; review:standalone -->
| `hson.reject.literal.mode.element-object` | `<e <b 1>/>` | Invalid | An HSON element cannot contain object structure.<br>**Review attention:** Implementation-derived classification or expectation provenance. Structural-mode crossing or `>` versus `/>` boundary. |  |  |
<!-- authored-case:hson.reject.literal.root.bare-name; source:inline; review:standalone -->
| `hson.reject.literal.root.bare-name` | `value` | Invalid | An arbitrary bare name is not a root primitive.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.root.mixed-modes; source:inline; review:standalone -->
| `hson.reject.literal.root.mixed-modes` | `<a/><b 2>` | Invalid | Element and object root modes cannot mix.<br>**Review attention:** Structural-mode crossing or `>` versus `/>` boundary. |  |  |
<!-- authored-case:hson.reject.literal.root.multiple-values; source:inline; review:standalone -->
| `hson.reject.literal.root.multiple-values` | `1 2` | Invalid | A root contains exactly one semantic value. |  |  |
<!-- authored-case:hson.reject.literal.root.trailing-closer; source:inline; review:standalone -->
| `hson.reject.literal.root.trailing-closer` | `42>` | Invalid | Trailing source after a primitive rejects.<br>**Review attention:** Implementation-derived classification or expectation provenance. |  |  |
<!-- authored-case:hson.reject.literal.source.empty; source:inline; review:standalone -->
| `hson.reject.literal.source.empty` | `` | Invalid | Empty source has no semantic value. |  |  |


## 21. Legacy and historical cases

| Case ID | Exact authored source | Current proposal | Plain-English claim | Human verdict (`V/I/?`) | Optional note |
|---|---|---|---|---|---|
<!-- authored-case:hson.reject.literal.authored-metadata; source:inline; review:standalone -->
| `hson.reject.literal.authored-metadata` | `<e hson:index="0"/>` | Invalid | Authored structural metadata names reject.<br>**Review attention:** Implementation-derived classification or expectation provenance. Metadata or reserved-name behavior. |  |  |
<!-- authored-case:hson.reject.literal.object.legacy-adjacent; source:inline; review:standalone -->
| `hson.reject.literal.object.legacy-adjacent` | `<a 1><b 2>` | Invalid | Adjacent angle objects do not merge into one object.<br>**Review attention:** Implementation-derived classification or expectation provenance. Historical or legacy-syntax regression. |  |  |
<!-- authored-case:hson.reject.literal.object.legacy-doubled; source:inline; review:standalone -->
| `hson.reject.literal.object.legacy-doubled` | `<<a 1>>` | Invalid | Legacy doubled-angle object syntax rejects.<br>**Review attention:** Historical or legacy-syntax regression. |  |  |
<!-- authored-case:hson.reject.literal.reserved-name; source:inline; review:standalone -->
| `hson.reject.literal.reserved-name` | `<_hson_obj/>` | Invalid | Authored _hson_* element names reject.<br>**Review attention:** Implementation-derived classification or expectation provenance. Metadata or reserved-name behavior. |  |  |

## Deferred review packets

These are intentionally outside this first authored-source verdict pass:

- graph-only accepted and rejected transport;
- structural JSON transport;
- structural HTML transport;
- diagnostic-circuit regressions;
- specialized-test cross-references.

## Regenerating a comparison template safely

This document is now human-owned. The generator refuses to overwrite it. To compare the current
descriptor-derived candidate with this editable worksheet, generate into a temporary file:

```sh
TS_NODE_TRANSPILE_ONLY=true node --loader ts-node/esm \
  tests/certified-corpus/generate-authored-source-verdicts.mts \
  --output /tmp/01-authored-source-verdicts.candidate.md
diff -u docs/contracts/authored-hson-review/01-authored-source-verdicts.md \
  /tmp/01-authored-source-verdicts.candidate.md
```

The comparison can reveal descriptor drift without destroying human verdicts. Use `--initialize`
only for a missing canonical worksheet; initialization refuses to replace an existing file.

## Reviewer questions or global notes

-

## Cases marked `?`

To be generated after review.

## Candidate disagreements

To be generated after review.
