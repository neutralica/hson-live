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
///---> CONFIRMED
```hson
<a 1>   // current proposal: valid HSON object
<a 1/>  // current proposal: invalid HSON element typed content
```

### Typed object values versus element flags
///---> CONFIRMED
```hson
<t true f false n null>   /// valid:  JS object {t: true, f: false, n null}
<x true false null/>      /// valid: empty x element w boolean attributes <x true="true" false="false" null="null"></x>
```

### Primitive-looking object keys

```hson
<true 1 false 2 null 3> /// valid: JS Object {true: 1, false: 2, null: 3}
```

### Homogeneous versus mixed root modes

```hson
<a/><b/>   // current proposal: valid element fragment /// valid: empty a and b elements: <a></a> <b></b>
<a/><b 2>  // current proposal: invalid mixed modes /// INVALID confirmed
```

### Matched contrast: empty decoded-name roles

```hson
<`` 1>        /// valid: {"":1}
<``/>         /// INVALID html <></> 
<e ``="x"/>   /// INVALID html <e ="x"></e>
<e ``/>       /// INVALID backticks only permitted on tag names
```

An empty decoded object-property key is presently proposed valid; empty element,
attribute, and flag names are presently proposed invalid.

## 1. Primitive values

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.primitive.empty-string -->

**Verdict — V / I / ?:** `VALID`

A bare empty quoted string admits one string leaf.

**Source:** `""`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.primitive.false -->

**Verdict — V / I / ?:** `VALID*`

Bare false is a typed primitive value.

**Source:** `false`

**Current proposal:** Valid

**Notes:**
* only VALID in _hson_obj context. typed content is invalid in _hson_elem

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.primitive.null -->

**Verdict — V / I / ?:** `VALID* `

Bare null is a typed primitive value.

**Source:** `null`

**Current proposal:** Valid

**Notes:**
see false
---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.primitive.string -->

**Verdict — V / I / ?:** `VALID `

A bare ordinary quoted string admits one string leaf.

**Source:** `"hello"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.primitive.true -->

**Verdict — V / I / ?:** ` VALID`

Bare true is a typed primitive value.

**Source:** `true`

**Current proposal:** Valid

**Notes:**
see false

## 2. Basic HSON objects

### Matched contrast: object versus element closer

```hson
<a 1>   // current proposal: valid HSON object /// -> confirmed
<a 1/>  // current proposal: invalid HSON element typed content /// -> confirmed
```

<!-- review-meta: source=display; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.accept.literal.object.comments -->

**Verdict — V / I / ?:** ` VALID/CORRECT`

Physical-line comments are grammar trivia between object tokens.

**Source:**

```text
"<a// key/value\u000A 1 b// key/value\u000D\u000A 2>"
```

**Special code units:** index 14: LF U+000A; index 31: CR U+000D; index 32: LF U+000A; all other code units are printable as shown

**Current proposal:** Valid

**Notes:**
exact codes not clear but yes this is correct

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.object.empty -->

**Verdict — V / I / ?:** ` VALID`

One angle pair denotes an empty HSON object.

**Source:** `<>`

**Current proposal:** Valid

**Notes:**
`</>` not valid however


---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.accept.literal.object.multiple-properties -->

**Verdict — V / I / ?:** `VALID/CORRECT `

Object property order is retained.

**Source:** `<a 1 b "two" c false>`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Negative zero must remain distinct from positive zero. -->
<!-- authored-case:hson.accept.literal.object.negative-zero -->

**Verdict — V / I / ?:** `VALID `

An object property preserves negative zero.

**Source:** `<value -0>`

**Review attention:** Negative zero must remain distinct from positive zero.

**Current proposal:** Valid

**Notes:**
seek 1:1 parity with JSON for typed primitives
---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. Direct `>` versus `/>` contrast. -->
<!-- authored-case:hson.accept.literal.object.one-property -->

**Verdict — V / I / ?:** `PARTIALLY CORRECT/UNCLEAR`

An object contains a punctuation-free key/value property.

**Source:** `<a 1>`

**Review attention:** Direct `>` versus `/>` contrast.

**Current proposal:** Valid

**Notes:**
///-> "punctuation" is not a metric. here is quotation behavior, for both tag and content in _elem and _obj context:

for BOTH _elem and _obj contexts:
-> tags do not need backtick quotes if they have no spaces; special characters should parse without backticks (NOTE: this may not be true currently; since we control HSON parsing, though, only spaces in keys should *require* backticks)
-> tags are 1:1 compatible with JSON key strings
-> all string content must be double-quoted in HSON

for _obj context only:
-> false, true, null, and numbers must not be unquoted to retain their types

for _elem context only:
-> unquoted (typed) content will error to the 'no val tags in html' invariant

examples:
```
<keytag "valuecontent"> /// valid and canonical (///-> actually not sure what happens in this case)
<keytag "false" keytag1 "false" keytag2 "false"> /// valid
<`keytag` "valuecontent"> /// valid but unnecessary backticks (///-> actually not sure what happens in this case)

<"keytag" "valuecontent"> /// key is INVALID (double quotes only allowed for content)
<keytag valuecontent> /// value is INVALID (all strings must be quoted)
<keytag "false" "false" "false"> /// INVALID values with no keys
<keytag "false" keytag "false" keytag "false"> /// INVALID duplicated keys (rejects, DOES NOT silently take last key)

<keytag "valuecontent"/> /// valid
<`keytag` "valuecontent"/> /// valid
<keytag "false"/> /// valid
<keytag "false" "false" "false"/> /// valid
<keytag false/> /// value is INVALID (typed HSON _elem content)
<keytag <keytag "false">/> /// INVALID (blending _obj/_elem)
```

## 3. Basic HSON arrays

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.array.empty-bracket -->

**Verdict — V / I / ?:** ` VALID/CORRECT`

An empty bracket array canonicalizes to guillemets.

**Source:** `[]`

**Current proposal:** Valid

**Notes:**
 it sounds like this means 'serializes canonically'? 
the array symbol is obviously not stored in the nodes per se except by the _hson_arr wrapper. 
HSON's parser accepts brackets and guillemet, flexibly. It always serializes as guillemet, yes. It never serializes to bracket and there's no way to change that. 


---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.array.empty-guillemet -->

**Verdict — V / I / ?:** ` VALID`

An empty guillemet array admits.

**Source:** `«»`

**Current proposal:** Valid

**Notes:**
"admits?" sure I guess. "is admitted"?? "is canonical array symnbol?" anyway yes


---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. Negative zero must remain distinct from positive zero. -->
<!-- authored-case:hson.accept.literal.array.negative-zero -->

**Verdict — V / I / ?:** ` VALID/CORRECT`

An array item preserves negative zero.

**Source:** `[-0,0]`

**Review attention:** Negative zero must remain distinct from positive zero.

**Current proposal:** Valid

**Notes:**
where it goes one it goes all


---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.accept.literal.array.primitives -->

**Verdict — V / I / ?:** `VALID/CORRECT `

Arrays remain comma-separated and retain primitive item order.

**Source:** `«1,"two",false,null»` /// I changed this to guillemet

**Current proposal:** Valid

**Notes:**
item order is always preserved by arrays in HSON via ordering, just as with HSON. it is preserved in HTML expressions of JSON by wrapping each item in an ii node which melts on reparsing. the hson:index value on the ii node must determine the order of reconstruction correctly.


---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.accept.literal.array.trailing-comma-bracket -->

**Verdict — V / I / ?:** `VALID `

A bracket-array trailing comma is accepted variation.

**Source:** `[1,2,]`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.array.trailing-comma-guillemet -->

**Verdict — V / I / ?:** `VALID `

A guillemet-array trailing comma is accepted variation.

**Source:** `«1,2,»`

**Current proposal:** Valid

**Notes:**


## 4. Basic HSON elements

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.accept.literal.element.adjacent-strings -->

**Verdict — V / I / ?:** ` VALID`

Two adjacent authored string leaves remain distinct.

**Source:** `<div "a" "b"/>`

**Current proposal:** Valid

**Notes:**
///-> only valid in _hson_elem context; 
 `<div "a" "b">` /// INVALID

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.element.attribute -->

**Verdict — V / I / ?:** `VALID `

An element attribute retains its explicit value.

**Source:** `<input title="value"/>`

**Current proposal:** Valid

**Notes:**
Yes, I'm not sure what's even questionable here
it's explicit value may only ever be a string
the source HSON is valid regardless


---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.element.empty -->

**Verdict — V / I / ?:** `VALID `

A self-closing angle construct denotes an empty HSON element.

**Source:** `<div/>`

**Current proposal:** Valid

**Notes:**
/// <div>  ///-> INVALID _hson_obj must hve a value and a key
---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.element.flag -->

**Verdict — V / I / ?:** `VALID `

A bare name in the element attribute region is a flag.

**Source:** `<input disabled/>`

**Current proposal:** Valid

**Notes:**
only _hson_elem may receive flags or attributes
```ts
 `<input disabled>` ///-> INVALID
 `<input "disabled">` ///-> valid
 `<input null>` ///-> valid
 ```

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.accept.literal.element.quid -->

**Verdict — V / I / ?:** `VALID `

An element QUID remains supported.

**Source:** `<main @0000000000000001/>`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.element.text -->

**Verdict — V / I / ?:** `VALID `

An HSON element may contain quoted string content.

**Source:** `<p "text"/>`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.accept.literal.element.three-empty-strings -->

**Verdict — V / I / ?:** `VALID `

Three adjacent empty authored string leaves remain three.

**Source:** `<div """"""/>`

**Current proposal:** Valid

**Notes:**
I hate it but valid

## 5. Legal compositions

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.basis.root.element-fragment -->

**Verdict — V / I / ?:** `VALID `

A homogeneous root element fragment preserves sibling order.

**Source:** `<a/><b/>`

**Current proposal:** Valid

**Notes:**
the circuit tests don't love it but this is totally valid
*I'd even argue that this might be valid too:*
`<a/><b>`
if they don't share a single root shouldn't they be able to exist side-by-side?


---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.accept.literal.array.nested -->

**Verdict — V / I / ?:** `VALID `

Nested arrays retain indexed membership.

**Source:** `[[1],«2,3»]`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.accept.literal.array.object-item -->

**Verdict — V / I / ?:** `VALID `

An array item may be a HSON object.

**Source:** `[<name "Ada">]`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.accept.literal.element.mixed-content -->

**Verdict — V / I / ?:** ` VALID/CORRECT`

Element strings and nested elements retain their order.

**Source:** `<p "first" <em "middle"/> "last"/>`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.accept.literal.element.nested -->

**Verdict — V / I / ?:** `VALID `

An HSON element may contain a nested element.

**Source:** `<p <em "text"/>/>`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.accept.literal.object.array-value -->

**Verdict — V / I / ?:** `VALid `

An object property may contain an array.

**Source:** `<items «1,2»>`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.accept.literal.object.nested -->

**Verdict — V / I / ?:** `VALID `

An object property may contain a nested HSON object.

**Source:** `<record <field 2>>`

**Current proposal:** Valid

**Notes:**


## 6. Contextual object keys and element flags

```hson
<t true f false n null> /// {t: true, f: false, n: null}
<x true false null/> /// <x true="true" false="false" null="null">
<true 1 false 2 null 3> /// {true: 1, false: 2, null: 3}
```

The same primitive-looking spelling has a different role in an object value,
an object property key, and an element flag position.

<!-- review-meta: source=inline; review=standalone; attention=Primitive-looking name or flag versus typed primitive value. -->
<!-- authored-case:hson.accept.basis.object.primitive-looking-keys -->

**Verdict — V / I / ?:** `VALID/CORRECT `

true, false, and null are ordinary property keys in HSON object key position.

**Source:** `<true 1 false 2 null 3>`

**Review attention:** 
Primitive-looking name ///* <false false> is valid */ 
or 
flag ///* <false false/> is also valid but now it's a flag instead of bool content*/ 
versus 
typed primitive value /// <_hson_val> tags only valid within _hson_obj content; _hson_elem cannot hold typed content

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. Primitive-looking name or flag versus typed primitive value. -->
<!-- authored-case:hson.accept.literal.element.keyword-flags -->

**Verdict — V / I / ?:** ` VALID/CORRECT`

Bare true, false, and null in the element attribute region are flags.

**Source:** `<x true false null/>`

**Review attention:** Primitive-looking name or flag versus typed primitive value.

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.accept.literal.object.typed-keywords -->

**Verdict — V / I / ?:** ` VALID/CORRECT`

true, false, and null in object value position remain typed.

**Source:** `<t true f false n null>`

**Current proposal:** Valid

**Notes:**


## 7. Accepted number spellings

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.basis.number.negative-exponent-sign -->

**Verdict — V / I / ?:** `? `

An exponent may contain a minus sign.

**Source:** `1e-3`

**Current proposal:** Valid

**Notes:**
I defer to JSON spec


---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.basis.number.negative-integer -->

**Verdict — V / I / ?:** `VALId `

A minus may prefix a nonzero JSON integer.

**Source:** `-1`

**Current proposal:** Valid

**Notes:**
<negativeOne -1> is valid 

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.basis.number.positive-exponent-sign -->

**Verdict — V / I / ?:** `? `

An exponent may contain an explicit plus sign.

**Source:** `1e+3`

**Current proposal:** Valid

**Notes:**
defer to JSON


---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.basis.number.positive-fraction -->

**Verdict — V / I / ?:** `VALID `

A fraction retains digits on both sides of the decimal point.

**Source:** `0.5`

**Current proposal:** Valid

**Notes:**
yes
///-> we should accept `.5` as well however, as well as `0.500` if someone tries it
---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.basis.number.uppercase-exponent -->

**Verdict — V / I / ?:** `valid ?`

An uppercase exponent marker is accepted.

**Source:** `1E3`

**Current proposal:** Valid

**Notes:**
accepting in parse; defer to JSON
---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.primitive.exponent -->

**Verdict — V / I / ?:** `? `

Exponent notation admits and canonicalizes by value.

**Source:** `1e3`

**Current proposal:** Valid

**Notes:**
defer to JSON


---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.primitive.negative-fraction -->

**Verdict — V / I / ?:** ` VALID`

A negative finite fraction admits.

**Source:** `-12.5`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Negative zero must remain distinct from positive zero. -->
<!-- authored-case:hson.accept.literal.primitive.negative-zero -->

**Verdict — V / I / ?:** ` VALID`

Negative zero retains exact numeric identity.

**Source:** `-0`

**Review attention:** Negative zero must remain distinct from positive zero.

**Current proposal:** Valid

**Notes:**

defer to JSON

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.primitive.positive-integer -->

**Verdict — V / I / ?:** ` VALID`

A positive finite integer admits.

**Source:** `42`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.primitive.zero -->

**Verdict — V / I / ?:** `VALID `

Zero admits as a typed numeric leaf.

**Source:** `0`

**Current proposal:** Valid

**Notes:**


## 8. Rejected number spellings

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.reject.basis.number.hexadecimal -->

**Verdict — V / I / ?:** ` INVALID`

Hexadecimal spelling is not JSON-compatible HSON number syntax.

**Source:** `0x10`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.reject.basis.number.leading-plus -->

**Verdict — V / I / ?:** ` INVALID`

A JSON-compatible HSON number may not begin with plus.

**Source:** `+1`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.reject.basis.number.leading-zero -->

**Verdict — V / I / ?:** `INVALID `

A nonzero integer may not begin with zero.

**Source:** `01`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.reject.basis.number.missing-exponent-digits -->

**Verdict — V / I / ?:** `INVALID `

An exponent marker requires following digits.

**Source:** `1e`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.reject.basis.number.missing-fraction-digits -->

**Verdict — V / I / ?:** `INVALID `

A decimal point requires following fraction digits.

**Source:** `1.`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.reject.basis.number.missing-integer-before-fraction -->

**Verdict — V / I / ?:** `ACCEPT BUT CANONICALIZE `

A fraction requires an integer component before the decimal point.

**Source:** `.5`

**Current proposal:** Invalid

**Notes:**
accept anything that is functionally 0.5 but serialize canonically


---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.reject.basis.number.missing-signed-exponent-digits -->

**Verdict — V / I / ?:** `INVALID `

An exponent sign requires following digits.

**Source:** `1e+`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.reject.basis.number.named-nan -->

**Verdict — V / I / ?:** `INVALID `

NaN is not an authored finite number.

**Source:** `NaN`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.reject.basis.number.named-negative-infinity -->

**Verdict — V / I / ?:** `INVALID `

Negative Infinity is not an authored finite number.

**Source:** `-Infinity`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.reject.basis.number.named-positive-infinity -->

**Verdict — V / I / ?:** `INVALID `

Infinity is not an authored finite number.

**Source:** `Infinity`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.reject.basis.number.nonfinite-overflow -->

**Verdict — V / I / ?:** `INVALID `

A syntactically valid number that overflows binary64 rejects as nonfinite.

**Source:** `1e309`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.reject.basis.number.numeric-separator -->

**Verdict — V / I / ?:** ` INVALID if JSON-incompatible`

Numeric separators are not JSON-compatible HSON number syntax.

**Source:** `1_0`

**Current proposal:** Invalid

**Notes:**


## 9. Accepted source trivia and comments

<!-- review-meta: source=display; review=standalone; attention=Complex trivia composition. -->
<!-- authored-case:hson.accept.basis.trivia.array-slots -->

**Verdict — V / I / ?:** `CORRECT/VALID `

Array trivia covers after-opener, before-comma, after-comma, before-closer, and a terminated item-boundary comment.

**Source:**

```text
"[ \u00091 \u000D,\u000A// next item\u000A 2 \u000D\u000A]"
```

**Special code units:** index 2: HT U+0009; index 5: CR U+000D; index 7: LF U+000A; index 20: LF U+000A; index 24: CR U+000D; index 25: LF U+000A; all other code units are printable as shown

**Review attention:** Complex trivia composition.

**Current proposal:** Valid

**Notes:**
I think so?


---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.basis.trivia.comment-to-eof -->

**Verdict — V / I / ?:** ` VALID?`

A physical-line comment may supply trailing root trivia through EOF.

**Source:** `42// comment to EOF`

**Current proposal:** Valid

**Notes:**
seems fine?

---

<!-- review-meta: source=display; review=standalone; attention=Implementation-influenced expected output; this pass reviews source validity only, not attribute output order. Complex trivia composition. -->
<!-- authored-case:hson.accept.basis.trivia.element-slots -->

**Verdict — V / I / ?:** `VALID/CORRECT `

Element trivia covers before-name, after-name, around equals, between header items, before and between content, and before slash.

**Source:**

```text
"< \u000Awidget \u0009 title \u000D= \u000A\"value\"\u000D\u000A enabled \u0009 \"a\"// next leaf\u000A \"b\" \u000D />"
```

**Special code units:** index 2: LF U+000A; index 10: HT U+0009; index 18: CR U+000D; index 21: LF U+000A; index 29: CR U+000D; index 30: LF U+000A; index 40: HT U+0009; index 57: LF U+000A; index 63: CR U+000D; all other code units are printable as shown

**Review attention:** Implementation-influenced expected output; this pass reviews source validity only, not attribute output order. Complex trivia composition.

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=display; review=standalone; attention=Complex trivia composition. -->
<!-- authored-case:hson.accept.basis.trivia.object-slots -->

**Verdict — V / I / ?:** `VALID/CORRECT `

Object trivia covers after-open, key/value, sibling, before-close, and consecutive terminated-comment slots.

**Source:**

```text
"< \u0009alpha// first\u000A// second\u000D\u000A 1\u000D beta\u00092 \u000A>"
```

**Special code units:** index 2: HT U+0009; index 16: LF U+000A; index 26: CR U+000D; index 27: LF U+000A; index 30: CR U+000D; index 36: HT U+0009; index 39: LF U+000A; all other code units are printable as shown

**Review attention:** Complex trivia composition.

**Current proposal:** Valid

**Notes:**
hard for me to review Unitype code: I trust the recommendation here


---

<!-- review-meta: source=display; review=standalone; attention=none -->
<!-- authored-case:hson.accept.literal.trivia.space-tab-lf-cr -->

**Verdict — V / I / ?:** `VALID IF PRECEDENT (presumably JSON) `

Grammar trivia is exactly SPACE, HT, LF, and CR.

**Source:**

```text
" \u0009\u000D\u000A42\u000D\u000A"
```

**Special code units:** index 1: HT U+0009; index 2: CR U+000D; index 3: LF U+000A; index 6: CR U+000D; index 7: LF U+000A; all other code units are printable as shown

**Current proposal:** Valid

**Notes:**


## 10. Rejected trivia and unsupported whitespace

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.comment.block -->

**Verdict — V / I / ?:** `TBD `

Block comments are unsupported.

**Source:** `/*x*/1`

**Current proposal:** Invalid

**Notes:**
 I MAY WANT TO PRESERVE/ALLOW COMMENTS 
---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.source.comment-only -->

**Verdict — V / I / ?:** `TBD `

Comment-only source has no semantic value.

**Source:** `// comment`

**Current proposal:** Invalid

**Notes:**
see above
---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.source.whitespace-only -->

**Verdict — V / I / ?:** `INVALID `

Whitespace-only source has no semantic value.

**Source:** `   `

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.whitespace.byte-order-mark -->

**Verdict — V / I / ?:** ` ?`

U+FEFF is not authored-HSON trivia.

**Source:**

```text
"1\uFEFF"
```

**Special code units:** index 1: BYTE ORDER MARK U+FEFF; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

LEAN INVALID--PROPOSAL ACCEPTED


### Family: Unsupported external whitespace

**Shared rule:** Code points outside SPACE, HT, LF, and CR are not authored-HSON trivia.

**Family verdict — V / I / ?:** ` RULE UPHELD (presumably JSON parity?)`

A family verdict applies to every blank override below. An individual override wins.
Blank family and override fields mean not reviewed.

<!-- family:start unsupported-whitespace -->

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u000b -->

**Override — V / I / ?:** ``

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u000B"
```

**Special code units:** index 1: VERTICAL TAB U+000B; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u000c -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u000C"
```

**Special code units:** index 1: FORM FEED U+000C; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u00a0 -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u00A0"
```

**Special code units:** index 1: NO-BREAK SPACE U+00A0; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u1680 -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u1680"
```

**Special code units:** index 1: OGHAM SPACE MARK U+1680; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2000 -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u2000"
```

**Special code units:** index 1: Unicode whitespace U+2000; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2001 -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u2001"
```

**Special code units:** index 1: Unicode whitespace U+2001; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2002 -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u2002"
```

**Special code units:** index 1: Unicode whitespace U+2002; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2003 -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u2003"
```

**Special code units:** index 1: Unicode whitespace U+2003; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2004 -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u2004"
```

**Special code units:** index 1: Unicode whitespace U+2004; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2005 -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u2005"
```

**Special code units:** index 1: Unicode whitespace U+2005; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2006 -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u2006"
```

**Special code units:** index 1: Unicode whitespace U+2006; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2007 -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u2007"
```

**Special code units:** index 1: Unicode whitespace U+2007; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2008 -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u2008"
```

**Special code units:** index 1: Unicode whitespace U+2008; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2009 -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u2009"
```

**Special code units:** index 1: Unicode whitespace U+2009; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u200a -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u200A"
```

**Special code units:** index 1: Unicode whitespace U+200A; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. Exercises U+2028 LINE SEPARATOR. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2028 -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u2028"
```

**Special code units:** index 1: LINE SEPARATOR U+2028; all other code units are printable as shown

**Review attention:** Exercises U+2028 LINE SEPARATOR.

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. Exercises U+2029 PARAGRAPH SEPARATOR. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u2029 -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u2029"
```

**Special code units:** index 1: PARAGRAPH SEPARATOR U+2029; all other code units are printable as shown

**Review attention:** Exercises U+2029 PARAGRAPH SEPARATOR.

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u202f -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u202F"
```

**Special code units:** index 1: NARROW NO-BREAK SPACE U+202F; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u205f -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u205F"
```

**Special code units:** index 1: MEDIUM MATHEMATICAL SPACE U+205F; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:unsupported-whitespace; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.unsupported-whitespace.u3000 -->

**Override — V / I / ?:** ` `

This code point is not valid authored-HSON trivia.

**Source:**

```text
"1\u3000"
```

**Special code units:** index 1: IDEOGRAPHIC SPACE U+3000; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

I can't read any of these really but I trust your judgement. if it's not JSON it's not HSON (unless it's HTML)


<!-- family:end unsupported-whitespace -->


## 11. Accepted quoted-string escapes

### Family: Accepted ordinary quoted-string escape dispatch

**Shared rule:** Each displayed JSON escape is accepted in a quoted HSON string.

**Family verdict — V / I / ?:** `VALID/CORRECT/RULE UPHELD `

A family verdict applies to every blank override below. An individual override wins.
Blank family and override fields mean not reviewed.

<!-- family:start quoted-string-ordinary-dispatch -->

<!-- review-meta: source=inline; review=family:quoted-string-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.quote -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\""`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.backslash -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\\"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.slash -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\/"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.backspace -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\b"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.form-feed -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\f"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.line-feed -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\n"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.carriage-return -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\r"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.tab -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\t"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.escape-before-quote -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"end\t"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.escape-before-container-closer -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `<e "x\t"/>`

**Current proposal:** Valid

**Notes:**

<!-- family:end quoted-string-ordinary-dispatch -->

### Family: Accepted quoted-string Unicode boundaries

**Shared rule:** Each complete four-hex-digit Unicode escape sequence is accepted in a quoted HSON string.

**Family verdict — V / I / ?:** ` `

A family verdict applies to every blank override below. An individual override wins.
Blank family and override fields mean not reviewed.

<!-- family:start quoted-string-unicode-boundaries -->

<!-- review-meta: source=inline; review=family:quoted-string-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.unicode-lowercase -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\u0061"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.unicode-uppercase -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\u006A"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.unicode-mixed-case -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\u00aF"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.unicode-u0000 -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\u0000"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.unicode-u001f -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\u001F"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.unicode-u007f -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\u007F"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.unicode-u0080 -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\u0080"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.unicode-u00ff -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\u00FF"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.unicode-u0100 -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\u0100"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-unicode-boundaries; attention=Exercises U+2028 LINE SEPARATOR. -->
<!-- authored-case:hson.accept.family.quoted-string.unicode-u2028 -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\u2028"`

**Review attention:** Exercises U+2028 LINE SEPARATOR.

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-unicode-boundaries; attention=Exercises U+2029 PARAGRAPH SEPARATOR. -->
<!-- authored-case:hson.accept.family.quoted-string.unicode-u2029 -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\u2029"`

**Review attention:** Exercises U+2029 PARAGRAPH SEPARATOR.

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-unicode-boundaries; attention=Contains an isolated high-surrogate escape. -->
<!-- authored-case:hson.accept.family.quoted-string.unicode-high-surrogate -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\uD800"`

**Review attention:** Contains an isolated high-surrogate escape.

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-unicode-boundaries; attention=Contains an isolated low-surrogate escape. -->
<!-- authored-case:hson.accept.family.quoted-string.unicode-low-surrogate -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\uDC00"`

**Review attention:** Contains an isolated low-surrogate escape.

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.unicode-surrogate-pair -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\uD83D\uDE00"`

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.quoted-string.consecutive-unicode -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a quoted HSON string.

**Source:** `"\u0041\u0042"`

**Current proposal:** Valid

**Notes:**

<!-- family:end quoted-string-unicode-boundaries -->


## 12. Malformed quoted-string escapes

### Family: Malformed quoted-string escapes

**Shared rule:** Each displayed malformed, incomplete, or unsupported quoted-string escape is invalid.

**Family verdict — V / I / ?:** `VALID/CORRECT/RULE UPHELD `

A family verdict applies to every blank override below. An individual override wins.
Blank family and override fields mean not reviewed.

<!-- family:start quoted-string-malformed-escapes -->

<!-- review-meta: source=inline; review=family:quoted-string-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.unicode-zero-hex -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported quoted-string escape is invalid.

**Source:** `"\u"`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.unicode-one-hex -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported quoted-string escape is invalid.

**Source:** `"\u1"`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.unicode-two-hex -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported quoted-string escape is invalid.

**Source:** `"\u12"`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.unicode-three-hex -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported quoted-string escape is invalid.

**Source:** `"\u123"`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.invalid-hex-position-1 -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported quoted-string escape is invalid.

**Source:** `"\uG000"`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.invalid-hex-position-2 -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported quoted-string escape is invalid.

**Source:** `"\u0G00"`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.invalid-hex-position-3 -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported quoted-string escape is invalid.

**Source:** `"\u00G0"`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.invalid-hex-position-4 -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported quoted-string escape is invalid.

**Source:** `"\u000G"`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.unicode-interrupted-space -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported quoted-string escape is invalid.

**Source:** `"\u 000"`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.unicode-interrupted-quote -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported quoted-string escape is invalid.

**Source:** `"\u"000"`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.unicode-interrupted-backslash -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported quoted-string escape is invalid.

**Source:** `"\u\000"`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.unsupported-letter -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported quoted-string escape is invalid.

**Source:** `"\q"`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.eof-during-unicode -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported quoted-string escape is invalid.

**Source:** `"\u12`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:quoted-string-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.trailing-backslash -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported quoted-string escape is invalid.

**Source:** `"bad\`

**Current proposal:** Invalid

**Notes:**

<!-- family:end quoted-string-malformed-escapes -->


## 13. Raw controls in quoted strings

### Family: Raw C0 controls in quoted strings

**Shared rule:** A raw U+0000 through U+001F code unit is invalid inside a quoted string.

**Family verdict — V / I / ?:** `I have no opinion on this--it sounds like INVALID is the recommendation here `

A family verdict applies to every blank override below. An individual override wins.
Blank family and override fields mean not reviewed.

<!-- family:start quoted-string-raw-c0 -->

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0000 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0000b\""
```

**Special code units:** index 2: NUL U+0000; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0001 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0001b\""
```

**Special code units:** index 2: raw C0 control U+0001; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0002 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0002b\""
```

**Special code units:** index 2: raw C0 control U+0002; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0003 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0003b\""
```

**Special code units:** index 2: raw C0 control U+0003; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0004 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0004b\""
```

**Special code units:** index 2: raw C0 control U+0004; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0005 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0005b\""
```

**Special code units:** index 2: raw C0 control U+0005; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0006 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0006b\""
```

**Special code units:** index 2: raw C0 control U+0006; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0007 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0007b\""
```

**Special code units:** index 2: raw C0 control U+0007; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0008 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0008b\""
```

**Special code units:** index 2: BACKSPACE U+0008; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0009 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0009b\""
```

**Special code units:** index 2: HT U+0009; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u000a -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u000Ab\""
```

**Special code units:** index 2: LF U+000A; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u000b -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u000Bb\""
```

**Special code units:** index 2: VERTICAL TAB U+000B; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u000c -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u000Cb\""
```

**Special code units:** index 2: FORM FEED U+000C; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u000d -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u000Db\""
```

**Special code units:** index 2: CR U+000D; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u000e -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u000Eb\""
```

**Special code units:** index 2: raw C0 control U+000E; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u000f -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u000Fb\""
```

**Special code units:** index 2: raw C0 control U+000F; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0010 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0010b\""
```

**Special code units:** index 2: raw C0 control U+0010; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0011 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0011b\""
```

**Special code units:** index 2: raw C0 control U+0011; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0012 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0012b\""
```

**Special code units:** index 2: raw C0 control U+0012; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0013 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0013b\""
```

**Special code units:** index 2: raw C0 control U+0013; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0014 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0014b\""
```

**Special code units:** index 2: raw C0 control U+0014; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0015 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0015b\""
```

**Special code units:** index 2: raw C0 control U+0015; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0016 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0016b\""
```

**Special code units:** index 2: raw C0 control U+0016; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0017 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0017b\""
```

**Special code units:** index 2: raw C0 control U+0017; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0018 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0018b\""
```

**Special code units:** index 2: raw C0 control U+0018; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u0019 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u0019b\""
```

**Special code units:** index 2: raw C0 control U+0019; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u001a -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u001Ab\""
```

**Special code units:** index 2: raw C0 control U+001A; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u001b -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u001Bb\""
```

**Special code units:** index 2: raw C0 control U+001B; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u001c -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u001Cb\""
```

**Special code units:** index 2: raw C0 control U+001C; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u001d -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u001Db\""
```

**Special code units:** index 2: raw C0 control U+001D; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u001e -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u001Eb\""
```

**Special code units:** index 2: raw C0 control U+001E; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:quoted-string-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.quoted-string.raw-u001f -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a quoted HSON string.

**Source:**

```text
"\"a\u001Fb\""
```

**Special code units:** index 2: raw C0 control U+001F; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

<!-- family:end quoted-string-raw-c0 -->


## 14. Accepted backtick names

### Matched contrast: empty decoded-name roles

```hson
<`` 1> /// valid
<``/> /// valid
<e ``="x"/> /// INVALID
<e ``/> /// INVALID
```

An empty decoded object-property key is presently proposed valid; empty element,
attribute, and flag names are presently proposed invalid.

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.accept.basis.backtick-name.element-name -->

**Verdict — V / I / ?:** ` VALID`

A nonempty backtick name is admitted as an HSON element name.

**Source:** ``<`x y`/>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.accept.literal.object.colon-dot-names -->

**Verdict — V / I / ?:** `VALID `

Colon and dot keys canonicalize through backticks.

**Source:** `<:x 1 a.b 2>`

**Current proposal:** Valid

**Notes:**

Just running this through the parsing panels, it seems valid as-is. Which is fine; I'm OK with only requiring backticks to preserve spacing if that's all we need them for. (e.g. camelCase etc should be automatically preserved. )


---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. Empty decoded name; validity depends on the name's grammatical role. -->
<!-- authored-case:hson.accept.literal.object.empty-decoded-key -->

**Verdict — V / I / ?:** `VALID `

An empty decoded object-property key is valid.

**Source:** ```<`` 1>```

**Review attention:** Empty decoded name; validity depends on the name's grammatical role.

**Current proposal:** Valid

**Notes:**
 node: {$_tag: "" } /// {"": 1}



### Family: Accepted ordinary backtick-name escape dispatch

**Shared rule:** Each displayed ordinary escape is accepted in a backtick object-property name.

**HUMAN NOTE:** --> Ok so the sources were provided like this:
 ```<`` 1>```
 ``<`tick\`name` 1>``
???
 I'm not sure why--this seems very wrong but it's also dealing with  questions of backticks and structure and so. I think we got confused here. I think we mean this:
 `<`` 1>`
 `<`tick\`name` 1>`
 and generally these examples seem valid overall. 
 HOWEVER: I am not going comment on these examples individually because the backtickspam is very confusing both to myself and possibly agents. I don't want to say 'valid' to something like this: ```<`` 1>``` and then have to spend the rest of HSON dismabiguating that this ```<`` 1>``` in fact isn't valid but it was trying to be and I knew what it meant. 

**Family verdict — V / I / ?:** `VALID if escape is valid and backticks are still correctly `

A family verdict applies to every blank override below. An individual override wins.
Blank family and override fields mean not reviewed.

<!-- family:start backtick-name-ordinary-dispatch -->

<!-- review-meta: source=inline; review=family:backtick-name-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.escaped-backtick -->

**Override — V / I / ?:** `VALID if escape is valid and backticks are still correctly (which it appears to be here)` 

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`tick\`name` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.escaped-backslash -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`back\\slash` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.backspace -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`back\bspace` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.form-feed -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`form\ffeed` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.line-feed -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`line\nname` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.carriage-return -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`line\rname` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-ordinary-dispatch; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.tab -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`line\tname` 1>``

**Current proposal:** Valid

**Notes:**


/// THESE PROPOSED RULES SEEM CORRECT BUT I WILL NOT COMMENT ON THE OVERRIDES TO AVOID PERCEPTION OF BLESSING THE BACKTICK SYNTAX HERE


<!-- family:end backtick-name-ordinary-dispatch -->

### Family: Accepted backtick-name Unicode boundaries

**Shared rule:** Each complete four-hex-digit Unicode escape sequence is accepted in a backtick object-property name.

**Family verdict — V / I / ?:** `??? valid??? I'm not even sure here -- what do you suggest? `

**USER NOTE:** --> once again the backticks are weird here; it looks like your proposals are correct but I don't want to appear to bless invalid backticks 

A family verdict applies to every blank override below. An individual override wins.
Blank family and override fields mean not reviewed.

<!-- family:start backtick-name-unicode-boundaries -->

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.unicode-lowercase -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`lower\u0061name` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.unicode-uppercase -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`upper\u006Aname` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.unicode-mixed-case -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`mixed\u00aFname` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.unicode-u0000 -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`nul\u0000name` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.unicode-control -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`control\u0001name` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.unicode-u001f -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`unit\u001Fname` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.unicode-u007f -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`unit\u007fname` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.unicode-u0080 -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`unit\u0080name` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.unicode-u00ff -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`unit\u00FFname` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.unicode-u0100 -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`unit\u0100name` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=Exercises U+2028 LINE SEPARATOR. -->
<!-- authored-case:hson.accept.family.backtick-name.unicode-u2028 -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`unit\u2028name` 1>``

**Review attention:** Exercises U+2028 LINE SEPARATOR.

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=Exercises U+2029 PARAGRAPH SEPARATOR. -->
<!-- authored-case:hson.accept.family.backtick-name.unicode-u2029 -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`unit\u2029name` 1>``

**Review attention:** Exercises U+2029 PARAGRAPH SEPARATOR.

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.unicode-lambda -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`lambda\u03bbname` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=Contains an isolated high-surrogate escape. -->
<!-- authored-case:hson.accept.family.backtick-name.unicode-high-surrogate -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`high\uD800name` 1>``

**Review attention:** Contains an isolated high-surrogate escape.

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=Contains an isolated low-surrogate escape. -->
<!-- authored-case:hson.accept.family.backtick-name.unicode-low-surrogate -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`low\uDC00name` 1>``

**Review attention:** Contains an isolated low-surrogate escape.

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.unicode-surrogate-pair -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`pair\uD83D\uDE00name` 1>``

**Current proposal:** Valid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-unicode-boundaries; attention=none -->
<!-- authored-case:hson.accept.family.backtick-name.consecutive-unicode -->

**Override — V / I / ?:** ` `

This displayed escape spelling is accepted inside a backtick object-property name.

**Source:** ``<`pair\u0041\u0042name` 1>``

**Current proposal:** Valid

**Notes:**

<!-- family:end backtick-name-unicode-boundaries -->


## 15. Malformed backtick names

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.reject.basis.backtick-name.attribute-name -->

**Verdict — V / I / ?:** `INVALID `

Backtick names are not admitted as element attribute names.

**Source:** "<e `data key`="value"/>"

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.reject.basis.backtick-name.flag-name -->

**Verdict — V / I / ?:** `INVALID `

Backtick names are not admitted as element flag names.

**Source:** "<e `feature flag`/>"

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. Calibrated diagnostic; review only the rejection verdict here. Exact diagnostic ownership is deferred. -->
<!-- authored-case:hson.reject.family.backtick-name.trailing-backslash -->

**Verdict — V / I / ?:** ` INVALID`

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** "<`name\`"

**Review attention:** Calibrated diagnostic; review only the rejection verdict here. Exact diagnostic ownership is deferred.

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. Calibrated diagnostic; review only the rejection verdict here. Exact diagnostic ownership is deferred. -->
<!-- authored-case:hson.reject.family.backtick-name.unicode-interrupted-backtick -->

**Verdict — V / I / ?:** `INVALID `

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** "<`\u`000` 1>"

**Review attention:** Calibrated diagnostic; review only the rejection verdict here. Exact diagnostic ownership is deferred.

**Current proposal:** Invalid

**Notes:**

### Family: Malformed backtick-name escapes

**Shared rule:** Each displayed malformed, incomplete, or unsupported backtick-name escape is invalid.

**Family verdict — V / I / ?:** ` INVALID`

A family verdict applies to every blank override below. An individual override wins.
Blank family and override fields mean not reviewed.

<!-- family:start backtick-name-malformed-escapes -->

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.unsupported-letter -->

**Override — V / I / ?:** `INVALID `

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** "<`\q` 1>"

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.unsupported-slash -->

**Override — V / I / ?:** ` INVALID`

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** ``<`\/` 1>``

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.unsupported-zero -->

**Override — V / I / ?:** ` INVALID`

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** "<`\0` 1>"

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.unsupported-hex -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** ``<`\x41` 1>``

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.unicode-zero-hex -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** ``<`\u` 1>``

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.unicode-one-hex -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** ``<`\u1` 1>``

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.unicode-two-hex -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** ``<`\u12` 1>``

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.unicode-three-hex -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** ``<`\u123` 1>``

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.invalid-hex-position-1 -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** ``<`\uG000` 1>``

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.invalid-hex-position-2 -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** ``<`\u0G00` 1>``

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.invalid-hex-position-3 -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** ``<`\u00G0` 1>``

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.invalid-hex-position-4 -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** ``<`\u000G` 1>``

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.unicode-interrupted-space -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** ``<`\u 000` 1>``

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.unicode-interrupted-quote -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** ``<`\u"000` 1>``

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.unicode-interrupted-closer -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** ``<`\u>000` 1>``

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.unicode-interrupted-backslash -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** ``<`\u\000` 1>``

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=family:backtick-name-malformed-escapes; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.eof -->

**Override — V / I / ?:** ` `

This displayed malformed or unsupported backtick-name escape is invalid.

**Source:** ``<`name``

**Current proposal:** Invalid

**Notes:**

<!-- family:end backtick-name-malformed-escapes -->


## 16. Raw controls in backtick names

### Family: Raw C0 controls in backtick names

**Shared rule:** A raw U+0000 through U+001F code unit is invalid inside a backtick name.

**Family verdict — V / I / ?:** ` INVALID`

A family verdict applies to every blank override below. An individual override wins.
Blank family and override fields mean not reviewed.

<!-- family:start backtick-name-raw-c0 -->

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0000 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0000b` 1>"
```

**Special code units:** index 3: NUL U+0000; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0001 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0001b` 1>"
```

**Special code units:** index 3: raw C0 control U+0001; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0002 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0002b` 1>"
```

**Special code units:** index 3: raw C0 control U+0002; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0003 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0003b` 1>"
```

**Special code units:** index 3: raw C0 control U+0003; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0004 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0004b` 1>"
```

**Special code units:** index 3: raw C0 control U+0004; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0005 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0005b` 1>"
```

**Special code units:** index 3: raw C0 control U+0005; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0006 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0006b` 1>"
```

**Special code units:** index 3: raw C0 control U+0006; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0007 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0007b` 1>"
```

**Special code units:** index 3: raw C0 control U+0007; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0008 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0008b` 1>"
```

**Special code units:** index 3: BACKSPACE U+0008; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0009 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0009b` 1>"
```

**Special code units:** index 3: HT U+0009; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u000a -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u000Ab` 1>"
```

**Special code units:** index 3: LF U+000A; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u000b -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u000Bb` 1>"
```

**Special code units:** index 3: VERTICAL TAB U+000B; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u000c -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u000Cb` 1>"
```

**Special code units:** index 3: FORM FEED U+000C; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u000d -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u000Db` 1>"
```

**Special code units:** index 3: CR U+000D; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u000e -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u000Eb` 1>"
```

**Special code units:** index 3: raw C0 control U+000E; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u000f -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u000Fb` 1>"
```

**Special code units:** index 3: raw C0 control U+000F; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0010 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0010b` 1>"
```

**Special code units:** index 3: raw C0 control U+0010; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0011 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0011b` 1>"
```

**Special code units:** index 3: raw C0 control U+0011; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0012 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0012b` 1>"
```

**Special code units:** index 3: raw C0 control U+0012; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0013 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0013b` 1>"
```

**Special code units:** index 3: raw C0 control U+0013; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0014 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0014b` 1>"
```

**Special code units:** index 3: raw C0 control U+0014; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0015 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0015b` 1>"
```

**Special code units:** index 3: raw C0 control U+0015; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0016 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0016b` 1>"
```

**Special code units:** index 3: raw C0 control U+0016; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0017 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0017b` 1>"
```

**Special code units:** index 3: raw C0 control U+0017; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0018 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0018b` 1>"
```

**Special code units:** index 3: raw C0 control U+0018; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u0019 -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u0019b` 1>"
```

**Special code units:** index 3: raw C0 control U+0019; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u001a -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u001Ab` 1>"
```

**Special code units:** index 3: raw C0 control U+001A; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u001b -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u001Bb` 1>"
```

**Special code units:** index 3: raw C0 control U+001B; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u001c -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u001Cb` 1>"
```

**Special code units:** index 3: raw C0 control U+001C; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u001d -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u001Db` 1>"
```

**Special code units:** index 3: raw C0 control U+001D; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u001e -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u001Eb` 1>"
```

**Special code units:** index 3: raw C0 control U+001E; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=display; review=family:backtick-name-raw-c0; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.family.backtick-name.raw-u001f -->

**Override — V / I / ?:** ` `

This raw C0 code unit is invalid inside a backtick name.

**Source:**

```text
"<`a\u001Fb` 1>"
```

**Special code units:** index 3: raw C0 control U+001F; all other code units are printable as shown

**Current proposal:** Invalid

**Notes:**

<!-- family:end backtick-name-raw-c0 -->


## 17. Invalid HSON object grammar

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.object.attribute-syntax -->

**Verdict — V / I / ?:** `INVALID `

Object properties do not use attribute equals syntax.

**Source:** `<a title="x" "v">`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.object.comma -->

**Verdict — V / I / ?:** ` INVALID`

Object properties do not use commas.

**Source:** `<a 1, b 2>`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Duplicate declaration behavior. -->
<!-- authored-case:hson.reject.literal.object.duplicate -->

**Verdict — V / I / ?:** `INVALID `

Duplicate decoded object-property keys reject.

**Source:** `<a 1 a 2>`

**Review attention:** Duplicate declaration behavior.

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.object.extra-value -->

**Verdict — V / I / ?:** `INVALID `

An object property has exactly one value.

**Source:** `<a 1 2 3>`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.object.flag -->

**Verdict — V / I / ?:** `INVALID `

An object property cannot omit its value.

**Source:** `<a flag>`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.object.missing-trivia -->

**Verdict — V / I / ?:** `INVALID????????? ? `

A property key and value require trivia.

**Source:** `<a"x">`

**Current proposal:** Invalid

**Notes:**
After some thought -- this must indeed be invalid, because then you would have to allow <afalse> and <anull> and <a1> as <a> tags

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.object.quid -->

**Verdict — V / I / ?:** `INVALID `

Object-property QUIDs do not exist in authored HSON///_obj yes correct only _hson_elem

**Source:** `<a @0000000000000001 1>`

**Current proposal:** Invalid

**Notes:**


## 18. Invalid HSON array grammar

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.array.mismatched-bracket -->

**Verdict — V / I / ?:** `INVALID `

A bracket array must close with a bracket.

**Source:** `[1,2»`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.array.mismatched-guillemet -->

**Verdict — V / I / ?:** ` INVALID`

A guillemet array must close with a guillemet.

**Source:** `«1,2]`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.array.missing-comma -->

**Verdict — V / I / ?:** `INVALID `

Array items require commas.

**Source:** `[1 2]`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.array.missing-item -->

**Verdict — V / I / ?:** `INVALID `

Two array commas cannot omit an item.

**Source:** `[1,,2]`

**Current proposal:** Invalid

**Notes:**


## 19. Invalid HSON element grammar

<!-- review-meta: source=inline; review=standalone; attention=Duplicate declaration behavior. -->
<!-- authored-case:hson.reject.literal.element.duplicate-attribute -->

**Verdict — V / I / ?:** `INVALID `

Duplicate decoded element attributes reject.

**Source:** `<e x="1" x="2"/>`

**Review attention:** Duplicate declaration behavior.

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.element.duplicate-quid -->

**Verdict — V / I / ?:** `INVALID `

An element cannot declare two QUIDs.

**Source:** `<e @0000000000000001 @0000000000000002/>`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.element.flag-after-content -->

**Verdict — V / I / ?:** ` INVALID`

Element flags cannot follow content.

**Source:** `<e "x" late/>`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.element.malformed-closer -->

**Verdict — V / I / ?:** ` VALID???`

Whitespace cannot split an element closer.

**Source:** `<e/ >`

**Current proposal:** Invalid

**Notes:**
Nah? It's just a space? this feels like trivia to me. what's the argument against this? 

///-> a ground rule is emerging: SPACES ARE TRIVIA HERE:
- before: tag, attribute, flag, "content", > /// SPACE HERE ARE VALID
<tag attribute="0" flag "content">
 ^   ^             ^    ^        ^ /// SPACES ARE TRIVIA HERE


SPACES ARE ERRORS HERE:
- within attribute name, on either side of = ///SPACES BETWEEN EQUALS SIGN AND ANYTHING ARE INVALID
- obviously inserted within any whole word or number /// INVALID
<tag attribute="0" flag "content">
              ^^  /// SPACES ARE INVALID AT/BEFORE EITHER CARAT


---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.element.missing-attribute-value -->

**Verdict — V / I / ?:** ` INVALID`

An explicit element attribute requires a value.

**Source:** `<e x=/>`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.element.missing-quid -->

**Verdict — V / I / ?:** ` INVALID`

An element QUID marker requires a persisted QUID.

**Source:** `<e @/>`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. Empty decoded name; validity depends on the name's grammatical role. -->
<!-- authored-case:hson.reject.literal.empty-attribute-name -->

**Verdict — V / I / ?:** `INVALID `

An empty decoded attribute name rejects.

**Source:** ```<e ``="x"/>```

**Review attention:** Empty decoded name; validity depends on the name's grammatical role.

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. Empty decoded name; validity depends on the name's grammatical role. -->
<!-- authored-case:hson.reject.literal.empty-element-name -->

**Verdict — V / I / ?:** `INVALID `

An empty decoded element name rejects.

**Source:** ```<``/>```

**Review attention:** Empty decoded name; validity depends on the name's grammatical role.

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. Empty decoded name; validity depends on the name's grammatical role. -->
<!-- authored-case:hson.reject.literal.empty-flag-name -->

**Verdict — V / I / ?:** `INVALID AS EITHER CONTENT OR FLAG `

An empty decoded flag name rejects.

**Source:** ```<e ``/>```

**Review attention:** Empty decoded name; validity depends on the name's grammatical role.

**Current proposal:** Invalid

**Notes:**
flags may never be backticked or quoted ever regardless

## 20. Root and structural-mode failures

```hson
<a 1>     // current proposal: valid HSON object
<a 1/>    // current proposal: invalid HSON element typed content

<a/><b/>  // current proposal: valid element fragment
<a/><b 2> // current proposal: invalid mixed modes
```

These contrasts make the consequences of `>` versus `/>` and homogeneous
versus mixed root modes visible. The exact descriptors also appear below.

<!-- review-meta: source=inline; review=standalone; attention=Structural-mode crossing or `>` versus `/>` boundary. -->
<!-- authored-case:hson.reject.basis.mode.object-element -->

**Verdict — V / I / ?:** `INVALID `

An HSON object property cannot contain an element-mode value.

**Source:** `<a <e/>>`

**Review attention:** Structural-mode crossing or `>` versus `/>` boundary.

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. Structural-mode crossing or `>` versus `/>` boundary. Direct `>` versus `/>` contrast. -->
<!-- authored-case:hson.reject.literal.element.numeric-content -->

**Verdict — V / I / ?:** `INVALID `

Numeric typed content beneath an HSON element rejects.

**Source:** `<e 1/>`

**Review attention:** Structural-mode crossing or `>` versus `/>` boundary. Direct `>` versus `/>` contrast.

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. Structural-mode crossing or `>` versus `/>` boundary. -->
<!-- authored-case:hson.reject.literal.mode.array-element -->

**Verdict — V / I / ?:** ` INVALID`

An array cannot contain element-mode content.

**Source:** `[<e/>]`

**Review attention:** Structural-mode crossing or `>` versus `/>` boundary.

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. Structural-mode crossing or `>` versus `/>` boundary. -->
<!-- authored-case:hson.reject.literal.mode.element-array -->

**Verdict — V / I / ?:** `INVALID `

An HSON element cannot contain an array.

**Source:** `<e [1]/>`

**Review attention:** Structural-mode crossing or `>` versus `/>` boundary.

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. Structural-mode crossing or `>` versus `/>` boundary. -->
<!-- authored-case:hson.reject.literal.mode.element-object -->

**Verdict — V / I / ?:** ` INVALID`

An HSON element cannot contain object structure.

**Source:** `<e <b 1>/>`

**Review attention:** Structural-mode crossing or `>` versus `/>` boundary.

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.root.bare-name -->

**Verdict — V / I / ?:** `INVALID `

An arbitrary bare name is not a root primitive.

**Source:** `value`

**Current proposal:** Invalid

**Notes:**
bare unquoted string with no wrapper is not valid


---

<!-- review-meta: source=inline; review=standalone; attention=Structural-mode crossing or `>` versus `/>` boundary. -->
<!-- authored-case:hson.reject.literal.root.mixed-modes -->

**Verdict — V / I / ?:** ` VALID`

Element and object root modes cannot mix.

**Source:** `<a/><b 2>`

**Review attention:** Structural-mode crossing or `>` versus `/>` boundary.

**Current proposal:** Invalid

**Notes:**
I am on the fence here. I think eventually they will coexist, some day. Honestly as long as there's never any nesting of obj and elem --just neighbors I wouldn't want to rule this out totally as a whole-graph storage approach. 

UNless there's a footgun I don't see
---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.reject.literal.root.multiple-values -->

**Verdict — V / I / ?:** ` INVALID`

A root contains exactly one semantic value.

**Source:** `1 2`

**Current proposal:** Invalid

**Notes:**



---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. -->
<!-- authored-case:hson.reject.literal.root.trailing-closer -->

**Verdict — V / I / ?:** ` INVALID`

Trailing source after a primitive rejects.

**Source:** `42>`

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=none -->
<!-- authored-case:hson.reject.literal.source.empty -->

**Verdict — V / I / ?:** `INVALID `

Empty source has no semantic value.

**Source:** ``

**Current proposal:** Invalid

**Notes:**


## 21. Legacy and historical cases

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. Metadata or reserved-name behavior. -->
<!-- authored-case:hson.reject.literal.authored-metadata -->

**Verdict — V / I / ?:** `INVALID`

Authored structural metadata names reject.

**Source:** `<e hson:index="0"/>`

**Review attention:** Metadata or reserved-name behavior.

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. Historical or legacy-syntax regression. -->
<!-- authored-case:hson.reject.literal.object.legacy-adjacent -->

**Verdict — V / I / ?:** ` INVALID`

Adjacent angle objects do not merge into one object.

**Source:** `<a 1><b 2>`

**Review attention:** Historical or legacy-syntax regression.

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Historical or legacy-syntax regression. -->
<!-- authored-case:hson.reject.literal.object.legacy-doubled -->

**Verdict — V / I / ?:** ` INVALID`

Legacy doubled-angle object syntax rejects.

**Source:** `<<a 1>>`

**Review attention:** Historical or legacy-syntax regression.

**Current proposal:** Invalid

**Notes:**

---

<!-- review-meta: source=inline; review=standalone; attention=Implementation-derived classification or expectation provenance. Metadata or reserved-name behavior. -->
<!-- authored-case:hson.reject.literal.reserved-name -->

**Verdict — V / I / ?:** `INVALID `

Authored _hson_* element names reject.

**Source:** `<_hson_obj/>`
**Source:** `<_hson_foo/>`

**Review attention:** Metadata or reserved-name behavior.

**Current proposal:** Invalid

**Notes:**

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
