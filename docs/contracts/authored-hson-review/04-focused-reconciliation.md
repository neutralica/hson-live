# Focused authored-Hson reconciliation

## Proposal disagreements — 3

<!-- authored-case:hson.reject.basis.number.missing-integer-before-fraction -->
**Final verdict — V / I / ?:** ` `

### `.5`

- **Exact source:** `.5`
- **Original human entry:** V
- **Original note:** “accept anything that is functionally 0.5; serialize canonically”
- **Current candidate proposal:** Invalid — a fraction requires an integer component before the decimal point.
- **Plain-English meaning:** Valid means Hson accepts an authored numeric spelling outside JSON lexical grammar and canonicalizes it to `0.5`. Primitive runtime types remain JSON-aligned; only the accepted source spelling expands. Invalid retains exact JSON-number lexical parity.
- **If valid:** `.5` becomes another spelling of the finite number `0.5`.
- **If invalid:** authors must write `0.5`; Hson and JSON keep the same number-token grammar.
- **Smallest valid-side change:** extend numeric token admission for a missing integer component, migrate this corpus case to accepted, and expect canonical `0.5`.
- **Smallest invalid-side change:** no production or corpus change; record the final human verdict as invalid.
- **Neutral recommendation:** none. This is a deliberate choice between an Hson lexical convenience and exact JSON-number lexical parity.

---

<!-- authored-case:hson.reject.literal.element.malformed-closer -->
**Final verdict — V / I / ?:** ` `

### `<e/ >`

- **Exact source:** `<e/ >`
- **Original human entry:** V
- **Original note:** “Nah? It's just a space? this feels like trivia to me. what's the argument against this?

  ///-> a ground rule is emerging: SPACES ARE TRIVIA HERE:
  - before: tag, attribute, flag, "content", > /// SPACE HERE ARE VALID
  `<tag attribute="0" flag "content">`
   `^   ^             ^    ^        ^ /// SPACES ARE TRIVIA HERE`

  SPACES ARE ERRORS HERE:
  - within attribute name, on either side of = ///SPACES BETWEEN EQUALS SIGN AND ANYTHING ARE INVALID
  - obviously inserted within any whole word or number /// INVALID
  `<tag attribute="0" flag "content">`
                 `^^  /// SPACES ARE INVALID AT/BEFORE EITHER CARAT`”
- **Current candidate proposal:** Invalid — whitespace cannot split an element closer.
- **Plain-English meaning:** Valid means trivia may occur between `/` and `>`. Invalid retains the contiguous `/>` closer contract.
- **If valid:** the closer becomes two delimiter tokens with an admitted-trivia gap; the permitted trivia must be chosen explicitly below.
- **If invalid:** `/` and `>` remain one contiguous closer, even though trivia is accepted at other token boundaries.
- **Smallest valid-side change:** teach element-close recognition to cross the selected trivia class, migrate this corpus case to accepted, and add boundary cases for the chosen class.
- **Smallest invalid-side change:** no production or corpus change; record the final human verdict as invalid.
- **Neutral recommendation:** decide the trivia class together with the verdict; accepting only this spelling without a class rule would leave the boundary ambiguous.

**If V, admitted closer trivia — SPACE only / SPACE, HT, LF, CR / comments as well:** ` `

---

<!-- authored-case:hson.reject.literal.root.mixed-modes -->
**Final verdict — V / I / ?:** ` `

### `<a/><b 2>`

- **Exact source:** `<a/><b 2>`
- **Original human entry:** V
- **Original note:** “I am on the fence here. I think eventually they will coexist, some day. Honestly as long as there's never any nesting of obj and elem --just neighbors I wouldn't want to rule this out totally as a whole-graph storage approach.

  UNless there's a footgun I don't see”
- **Current candidate proposal:** Invalid — element and object root modes cannot mix.
- **Plain-English meaning:** This source mixes element and object structure at the root. Homogeneous element fragments such as `<a/><b/>` are already valid. `_hson_root` is currently an internal, nonserializable carrier, so accepting this source requires a public canonical representation for a mixed root or another foundational semantic change; it is not merely a tokenizer relaxation.
- **If valid:** Hson gains a mixed-root semantic model whose identity, equality, serialization, projection, and round-trip behavior must be defined.
- **If invalid:** root structure remains homogeneous: an element fragment or an object/value mode, but not both as siblings.
- **Smallest valid-side change:** first define a public canonical mixed-root representation, then extend parsing, serialization, equality, projection, and corpus expectations around it.
- **Smallest invalid-side change:** no production or corpus change; record the final human verdict as invalid.
- **Neutral recommendation:** reconsider the earlier V unless a mixed-root semantic model is intentionally desired. The current source cannot be admitted safely as a local grammar exception.

## Uncertain cases — 7

<!-- authored-case:hson.accept.literal.object.one-property -->
**Final verdict — V / I / ?:** ` `

### `<a 1>`

- **Exact source:** `<a 1>`
- **Original human entry:** ?
- **Original note:** “Partially correct--only for non-string”
- **Current candidate proposal:** Valid — one object property named `a` owns the typed numeric value `1` and the object closes with `>`.
- **Plain-English meaning:** Under the current ownership model, this is an Hson object property, not element content: `a` owns the following typed value. This decision concerns only the exact source `<a 1>` and does not assume which broader string-valued case the note found unclear.
- **If valid:** the existing one-property object rule remains unchanged.
- **If invalid:** this exact basic object form is removed despite the current key/value ownership model.
- **Smallest valid-side change:** no production or corpus change; record the final human verdict as valid.
- **Smallest invalid-side change:** restrict object-property admission and migrate this accepted corpus case to rejection, with the intended replacement syntax specified.
- **Neutral recommendation:** confirm the exact source separately from any follow-up decision about string-valued object properties.

---

<!-- authored-case:hson.accept.basis.number.negative-exponent-sign -->
**Final verdict — V / I / ?:** ` `

### `1e-3`

- **Exact source:** `1e-3`
- **Original human entry:** ?
- **Original note:** “I defer to JSON spec”
- **Current candidate proposal:** Valid.
- **Plain-English meaning:** `1e-3` is valid under the current JSON-compatible number grammar and canonicalizes numerically to `0.001`.
- **If valid:** signed negative exponents remain ordinary finite-number spellings.
- **If invalid:** Hson diverges from JSON number grammar by forbidding the negative exponent sign.
- **Smallest valid-side change:** no production or corpus change; record the final human verdict as valid.
- **Smallest invalid-side change:** restrict exponent-token admission and migrate this accepted case to rejection.
- **Neutral recommendation:** valid, if JSON-number lexical compatibility remains the rule.

---

<!-- authored-case:hson.accept.basis.number.positive-exponent-sign -->
**Final verdict — V / I / ?:** ` `

### `1e+3`

- **Exact source:** `1e+3`
- **Original human entry:** ?
- **Original note:** “defer to JSON”
- **Current candidate proposal:** Valid.
- **Plain-English meaning:** `1e+3` is valid under the current JSON-compatible number grammar and canonicalizes numerically to `1000`.
- **If valid:** an explicit positive exponent sign remains an ordinary finite-number spelling.
- **If invalid:** Hson diverges from JSON number grammar by forbidding the explicit positive exponent sign.
- **Smallest valid-side change:** no production or corpus change; record the final human verdict as valid.
- **Smallest invalid-side change:** restrict exponent-token admission and migrate this accepted case to rejection.
- **Neutral recommendation:** valid, if JSON-number lexical compatibility remains the rule.

---

<!-- authored-case:hson.accept.literal.primitive.exponent -->
**Final verdict — V / I / ?:** ` `

### `1e3`

- **Exact source:** `1e3`
- **Original human entry:** ?
- **Original note:** “defer to JSON”
- **Current candidate proposal:** Valid.
- **Plain-English meaning:** `1e3` is valid under the current JSON-compatible number grammar and canonicalizes numerically to `1000`.
- **If valid:** ordinary exponent notation remains an accepted finite-number spelling.
- **If invalid:** Hson diverges from JSON number grammar by removing exponent notation.
- **Smallest valid-side change:** no production or corpus change; record the final human verdict as valid.
- **Smallest invalid-side change:** restrict number-token admission and migrate this accepted case to rejection.
- **Neutral recommendation:** valid, if JSON-number lexical compatibility remains the rule.

---

<!-- authored-case:hson.reject.literal.comment.block -->
**Final verdict — V / I / ?:** ` `

### `/*x*/1`

- **Exact source:** `/*x*/1`
- **Original human entry:** ?
- **Original note:** “ TBD - I MAY WANT TO PRESERVE/ALLOW COMMENTS ”
- **Current candidate proposal:** Invalid.
- **Plain-English meaning:** The settled grammar admits physical-line `//` comments as trivia between tokens; block comments are not trivia. This source is rejected before the value `1` can become the root.
- **If valid:** block comments become a second authored trivia form, including rules for termination and placement.
- **If invalid:** only the settled physical-line comment form remains available.
- **Smallest valid-side change:** add block-comment scanning and trivia admission, migrate this case to accepted, and cover unterminated and boundary forms.
- **Smallest invalid-side change:** no production or corpus change; record the final human verdict as invalid.
- **Neutral recommendation:** none; preserving comments does not by itself require both line and block syntax.

---

<!-- authored-case:hson.reject.literal.source.comment-only -->
**Final verdict — V / I / ?:** ` `

### `// comment`

- **Exact source:** `// comment`
- **Original human entry:** ?
- **Original note:** “TBD - see above”
- **Current candidate proposal:** Invalid.
- **Plain-English meaning:** Physical-line comments are already admitted as trivia, but a source containing only trivia has no semantic root value. The settled rule therefore rejects comment-only input, just as it rejects whitespace-only input.
- **If valid:** Hson must define what canonical value, if any, a comment-only document represents; merely retaining comment trivia is insufficient.
- **If invalid:** comments remain preservable only around a semantic value, and empty semantic input remains invalid.
- **Smallest valid-side change:** define an empty/comment-only source model and its canonical representation, then change parser and corpus expectations.
- **Smallest invalid-side change:** no production or corpus change; record the final human verdict as invalid.
- **Neutral recommendation:** invalid unless comment-only documents are intentionally given a semantic representation.

---

<!-- authored-case:hson.reject.literal.whitespace.byte-order-mark -->
**Final verdict — V / I / ?:** ` `

### BOM trivia

- **Exact source:** `"1\uFEFF"` — the final source code unit is BYTE ORDER MARK U+FEFF.
- **Original human entry:** ?
- **Original note:** “PROPOSAL VALUES ACCEPTED”
- **Current candidate proposal:** Invalid.
- **Plain-English meaning:** Settled authored trivia is exactly SPACE U+0020, HT U+0009, LF U+000A, and CR U+000D. U+FEFF is outside that set, so the trailing code unit is not ignored.
- **If valid:** U+FEFF becomes additional source trivia; its permitted positions should be specified.
- **If invalid:** the exact four-code-point trivia set remains closed.
- **Smallest valid-side change:** extend trivia admission for U+FEFF, migrate this case to accepted, and add placement boundaries.
- **Smallest invalid-side change:** no production or corpus change; record the final human verdict as invalid.
- **Neutral recommendation:** invalid if the four-code-point trivia contract is intended to remain exact.

## Unreviewed families — 22

### Quoted-string Unicode boundaries — 15

**Final verdict — V / I / ?:** ` `

- **Current candidate proposal:** Valid — each complete four-hex-digit Unicode escape is decoded into the quoted string.
- **If valid:** no production or corpus change; the family remains accepted, including control code units and isolated surrogate code units.
- **If invalid:** choose row overrides for exceptions, or reject the whole family and change Unicode escape admission plus all 15 corpus cases.
- **Neutral recommendation:** use the family verdict only if every displayed boundary, including isolated surrogates, should share one rule.

| Exact source | Decoded string value | Row override — V / I / ? |
|---|---|---|
| <!-- authored-case:hson.accept.family.quoted-string.unicode-lowercase --> `"\u0061"` | `a` (U+0061) | ` ` |
| <!-- authored-case:hson.accept.family.quoted-string.unicode-uppercase --> `"\u006A"` | `j` (U+006A) | ` ` |
| <!-- authored-case:hson.accept.family.quoted-string.unicode-mixed-case --> `"\u00aF"` | `¯` (U+00AF) | ` ` |
| <!-- authored-case:hson.accept.family.quoted-string.unicode-u0000 --> `"\u0000"` | NUL U+0000 | ` ` |
| <!-- authored-case:hson.accept.family.quoted-string.unicode-u001f --> `"\u001F"` | UNIT SEPARATOR U+001F | ` ` |
| <!-- authored-case:hson.accept.family.quoted-string.unicode-u007f --> `"\u007F"` | DELETE U+007F | ` ` |
| <!-- authored-case:hson.accept.family.quoted-string.unicode-u0080 --> `"\u0080"` | control U+0080 | ` ` |
| <!-- authored-case:hson.accept.family.quoted-string.unicode-u00ff --> `"\u00FF"` | `ÿ` (U+00FF) | ` ` |
| <!-- authored-case:hson.accept.family.quoted-string.unicode-u0100 --> `"\u0100"` | `Ā` (U+0100) | ` ` |
| <!-- authored-case:hson.accept.family.quoted-string.unicode-u2028 --> `"\u2028"` | LINE SEPARATOR U+2028 | ` ` |
| <!-- authored-case:hson.accept.family.quoted-string.unicode-u2029 --> `"\u2029"` | PARAGRAPH SEPARATOR U+2029 | ` ` |
| <!-- authored-case:hson.accept.family.quoted-string.unicode-high-surrogate --> `"\uD800"` | isolated high-surrogate code unit U+D800 | ` ` |
| <!-- authored-case:hson.accept.family.quoted-string.unicode-low-surrogate --> `"\uDC00"` | isolated low-surrogate code unit U+DC00 | ` ` |
| <!-- authored-case:hson.accept.family.quoted-string.unicode-surrogate-pair --> `"\uD83D\uDE00"` | `😀` (U+1F600; code units D83D DE00) | ` ` |
| <!-- authored-case:hson.accept.family.quoted-string.consecutive-unicode --> `"\u0041\u0042"` | `AB` | ` ` |

### Ordinary backtick-name escapes — 7

**Final verdict — V / I / ?:** ` `

- **Current candidate proposal:** Valid — ordinary supported escapes are decoded inside a backtick object-property name.
- **Original family note:** “THESE PROPOSED RULES SEEM CORRECT BUT I WILL NOT COMMENT ON THE OVERRIDES TO AVOID PERCEPTION OF BLESSING THE BACKTICK SYNTAX HERE”
- **If valid:** no production or corpus change; the seven decoded keys remain accepted.
- **If invalid:** choose row overrides for exceptions, or reject the whole family and change backtick-name escape admission plus all seven corpus cases.
- **Neutral recommendation:** decide the family as escape semantics inside already-established backtick-name syntax; use row overrides for any control escape that should differ.

| Exact source | Decoded property key | Row override — V / I / ? |
|---|---|---|
| <!-- authored-case:hson.accept.family.backtick-name.escaped-backtick --> <code>&lt;&#96;tick\&#96;name&#96; 1&gt;</code> | <code>tick&#96;name</code> | ` ` |
| <!-- authored-case:hson.accept.family.backtick-name.escaped-backslash --> <code>&lt;&#96;back\\slash&#96; 1&gt;</code> | <code>back\slash</code> | ` ` |
| <!-- authored-case:hson.accept.family.backtick-name.backspace --> <code>&lt;&#96;back\bspace&#96; 1&gt;</code> | `back` + BACKSPACE U+0008 + `space` | ` ` |
| <!-- authored-case:hson.accept.family.backtick-name.form-feed --> <code>&lt;&#96;form\ffeed&#96; 1&gt;</code> | `form` + FORM FEED U+000C + `feed` | ` ` |
| <!-- authored-case:hson.accept.family.backtick-name.line-feed --> <code>&lt;&#96;line\nname&#96; 1&gt;</code> | `line` + LF U+000A + `name` | ` ` |
| <!-- authored-case:hson.accept.family.backtick-name.carriage-return --> <code>&lt;&#96;line\rname&#96; 1&gt;</code> | `line` + CR U+000D + `name` | ` ` |
| <!-- authored-case:hson.accept.family.backtick-name.tab --> <code>&lt;&#96;line\tname&#96; 1&gt;</code> | `line` + HT U+0009 + `name` | ` ` |
