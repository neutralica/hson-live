# Authored-Hson source-membership reconciliation

This amendment-aware report reconciles **human-reviewed authored-language membership**.
It does not certify expected graphs, canonical output, or structured diagnostics.
The completed worksheet remains immutable historical input; current syntax comes from the quoted-name amendment.

## Input binding

- Historical worksheet SHA-256: `df17f7de1e9452754b9ab1ddc4d80fdfc82c473f1323ce91a72f9a46ec79db7c`
- Quoted-name amendment SHA-256: `861a7578e08092a4556099fd4f1e7d7f739fac60678ba063e23295632dbd9c57`
- Corpus review fingerprint: `73ba69bef1c48a23506a0984167e8d3ad4c1644c0d0737fa461256ed02789314`
- Historical authored descriptors: 269
- Active authored descriptors: 273

## Historical-to-active ID migration

All 269 historical IDs are recorded in the ledger. Unlisted IDs are identity mappings.

- `hson.accept.basis.backtick-name.element-name` → `hson.accept.basis.quoted-name.element-name`
- `hson.accept.family.backtick-name.escaped-backtick` → `hson.accept.family.quoted-name.escaped-apostrophe`
- `hson.accept.family.backtick-name.escaped-backslash` → `hson.accept.family.quoted-name.escaped-backslash`
- `hson.accept.family.backtick-name.backspace` → `hson.accept.family.quoted-name.backspace`
- `hson.accept.family.backtick-name.form-feed` → `hson.accept.family.quoted-name.form-feed`
- `hson.accept.family.backtick-name.line-feed` → `hson.accept.family.quoted-name.line-feed`
- `hson.accept.family.backtick-name.carriage-return` → `hson.accept.family.quoted-name.carriage-return`
- `hson.accept.family.backtick-name.tab` → `hson.accept.family.quoted-name.tab`
- `hson.accept.family.backtick-name.unicode-lowercase` → `hson.accept.family.quoted-name.unicode-lowercase`
- `hson.accept.family.backtick-name.unicode-uppercase` → `hson.accept.family.quoted-name.unicode-uppercase`
- `hson.accept.family.backtick-name.unicode-mixed-case` → `hson.accept.family.quoted-name.unicode-mixed-case`
- `hson.accept.family.backtick-name.unicode-u0000` → `hson.accept.family.quoted-name.unicode-u0000`
- `hson.accept.family.backtick-name.unicode-control` → `hson.accept.family.quoted-name.unicode-control`
- `hson.accept.family.backtick-name.unicode-u001f` → `hson.accept.family.quoted-name.unicode-u001f`
- `hson.accept.family.backtick-name.unicode-u007f` → `hson.accept.family.quoted-name.unicode-u007f`
- `hson.accept.family.backtick-name.unicode-u0080` → `hson.accept.family.quoted-name.unicode-u0080`
- `hson.accept.family.backtick-name.unicode-u00ff` → `hson.accept.family.quoted-name.unicode-u00ff`
- `hson.accept.family.backtick-name.unicode-u0100` → `hson.accept.family.quoted-name.unicode-u0100`
- `hson.accept.family.backtick-name.unicode-u2028` → `hson.accept.family.quoted-name.unicode-u2028`
- `hson.accept.family.backtick-name.unicode-u2029` → `hson.accept.family.quoted-name.unicode-u2029`
- `hson.accept.family.backtick-name.unicode-lambda` → `hson.accept.family.quoted-name.unicode-lambda`
- `hson.accept.family.backtick-name.unicode-high-surrogate` → `hson.accept.family.quoted-name.unicode-high-surrogate`
- `hson.accept.family.backtick-name.unicode-low-surrogate` → `hson.accept.family.quoted-name.unicode-low-surrogate`
- `hson.accept.family.backtick-name.unicode-surrogate-pair` → `hson.accept.family.quoted-name.unicode-surrogate-pair`
- `hson.accept.family.backtick-name.consecutive-unicode` → `hson.accept.family.quoted-name.consecutive-unicode`
- `hson.reject.basis.backtick-name.attribute-name` → `hson.reject.basis.quoted-name.attribute-name`
- `hson.reject.basis.backtick-name.flag-name` → `hson.reject.basis.quoted-name.flag-name`
- `hson.reject.family.backtick-name.trailing-backslash` → `hson.reject.family.quoted-name.trailing-backslash`
- `hson.reject.family.backtick-name.unicode-interrupted-backtick` → `hson.reject.family.quoted-name.unicode-interrupted-apostrophe`
- `hson.reject.family.backtick-name.unsupported-letter` → `hson.reject.family.quoted-name.unsupported-letter`
- `hson.reject.family.backtick-name.unsupported-slash` → `hson.reject.family.quoted-name.unsupported-slash`
- `hson.reject.family.backtick-name.unsupported-zero` → `hson.reject.family.quoted-name.unsupported-zero`
- `hson.reject.family.backtick-name.unsupported-hex` → `hson.reject.family.quoted-name.unsupported-hex`
- `hson.reject.family.backtick-name.unicode-zero-hex` → `hson.reject.family.quoted-name.unicode-zero-hex`
- `hson.reject.family.backtick-name.unicode-one-hex` → `hson.reject.family.quoted-name.unicode-one-hex`
- `hson.reject.family.backtick-name.unicode-two-hex` → `hson.reject.family.quoted-name.unicode-two-hex`
- `hson.reject.family.backtick-name.unicode-three-hex` → `hson.reject.family.quoted-name.unicode-three-hex`
- `hson.reject.family.backtick-name.invalid-hex-position-1` → `hson.reject.family.quoted-name.invalid-hex-position-1`
- `hson.reject.family.backtick-name.invalid-hex-position-2` → `hson.reject.family.quoted-name.invalid-hex-position-2`
- `hson.reject.family.backtick-name.invalid-hex-position-3` → `hson.reject.family.quoted-name.invalid-hex-position-3`
- `hson.reject.family.backtick-name.invalid-hex-position-4` → `hson.reject.family.quoted-name.invalid-hex-position-4`
- `hson.reject.family.backtick-name.unicode-interrupted-space` → `hson.reject.family.quoted-name.unicode-interrupted-space`
- `hson.reject.family.backtick-name.unicode-interrupted-quote` → `hson.reject.family.quoted-name.unicode-interrupted-quote`
- `hson.reject.family.backtick-name.unicode-interrupted-closer` → `hson.reject.family.quoted-name.unicode-interrupted-closer`
- `hson.reject.family.backtick-name.unicode-interrupted-backslash` → `hson.reject.family.quoted-name.unicode-interrupted-backslash`
- `hson.reject.family.backtick-name.eof` → `hson.reject.family.quoted-name.eof`
- `hson.reject.family.backtick-name.raw-u0000` → `hson.reject.family.quoted-name.raw-u0000`
- `hson.reject.family.backtick-name.raw-u0001` → `hson.reject.family.quoted-name.raw-u0001`
- `hson.reject.family.backtick-name.raw-u0002` → `hson.reject.family.quoted-name.raw-u0002`
- `hson.reject.family.backtick-name.raw-u0003` → `hson.reject.family.quoted-name.raw-u0003`
- `hson.reject.family.backtick-name.raw-u0004` → `hson.reject.family.quoted-name.raw-u0004`
- `hson.reject.family.backtick-name.raw-u0005` → `hson.reject.family.quoted-name.raw-u0005`
- `hson.reject.family.backtick-name.raw-u0006` → `hson.reject.family.quoted-name.raw-u0006`
- `hson.reject.family.backtick-name.raw-u0007` → `hson.reject.family.quoted-name.raw-u0007`
- `hson.reject.family.backtick-name.raw-u0008` → `hson.reject.family.quoted-name.raw-u0008`
- `hson.reject.family.backtick-name.raw-u0009` → `hson.reject.family.quoted-name.raw-u0009`
- `hson.reject.family.backtick-name.raw-u000a` → `hson.reject.family.quoted-name.raw-u000a`
- `hson.reject.family.backtick-name.raw-u000b` → `hson.reject.family.quoted-name.raw-u000b`
- `hson.reject.family.backtick-name.raw-u000c` → `hson.reject.family.quoted-name.raw-u000c`
- `hson.reject.family.backtick-name.raw-u000d` → `hson.reject.family.quoted-name.raw-u000d`
- `hson.reject.family.backtick-name.raw-u000e` → `hson.reject.family.quoted-name.raw-u000e`
- `hson.reject.family.backtick-name.raw-u000f` → `hson.reject.family.quoted-name.raw-u000f`
- `hson.reject.family.backtick-name.raw-u0010` → `hson.reject.family.quoted-name.raw-u0010`
- `hson.reject.family.backtick-name.raw-u0011` → `hson.reject.family.quoted-name.raw-u0011`
- `hson.reject.family.backtick-name.raw-u0012` → `hson.reject.family.quoted-name.raw-u0012`
- `hson.reject.family.backtick-name.raw-u0013` → `hson.reject.family.quoted-name.raw-u0013`
- `hson.reject.family.backtick-name.raw-u0014` → `hson.reject.family.quoted-name.raw-u0014`
- `hson.reject.family.backtick-name.raw-u0015` → `hson.reject.family.quoted-name.raw-u0015`
- `hson.reject.family.backtick-name.raw-u0016` → `hson.reject.family.quoted-name.raw-u0016`
- `hson.reject.family.backtick-name.raw-u0017` → `hson.reject.family.quoted-name.raw-u0017`
- `hson.reject.family.backtick-name.raw-u0018` → `hson.reject.family.quoted-name.raw-u0018`
- `hson.reject.family.backtick-name.raw-u0019` → `hson.reject.family.quoted-name.raw-u0019`
- `hson.reject.family.backtick-name.raw-u001a` → `hson.reject.family.quoted-name.raw-u001a`
- `hson.reject.family.backtick-name.raw-u001b` → `hson.reject.family.quoted-name.raw-u001b`
- `hson.reject.family.backtick-name.raw-u001c` → `hson.reject.family.quoted-name.raw-u001c`
- `hson.reject.family.backtick-name.raw-u001d` → `hson.reject.family.quoted-name.raw-u001d`
- `hson.reject.family.backtick-name.raw-u001e` → `hson.reject.family.quoted-name.raw-u001e`
- `hson.reject.family.backtick-name.raw-u001f` → `hson.reject.family.quoted-name.raw-u001f`

Amendment-only active IDs:

- `hson.accept.family.quoted-name.literal-backtick`
- `hson.reject.literal.legacy-backtick-name`
- `hson.reject.literal.quoted-name.raw-apostrophe`
- `hson.reject.literal.single-quoted-value`

## Summary

| Measure | Count |
|---|---:|
| Human/amendment valid | 85 |
| Human/amendment invalid | 166 |
| Human uncertain | 7 |
| Unreviewed | 15 |
| Direct row verdicts | 103 |
| Family-inherited verdicts | 76 |
| Amendment verdicts | 79 |
| Row overrides | 3 |
| Proposal agreements | 248 |
| Proposal disagreements | 3 |

## Proposal disagreements

### `hson.reject.basis.number.missing-integer-before-fraction`

- Exact active authored source: `".5"`
- Current proposal: invalid
- Human/amendment verdict: valid
- Human note: accept anything that is functionally 0.5; serialize canonically
- Active claim: A fraction requires an integer component before the decimal point.
- Provenance priority: medium
- Recommended owner: **specification correction**

### `hson.reject.literal.element.malformed-closer`

- Exact active authored source: `"<e/ >"`
- Current proposal: invalid
- Human/amendment verdict: valid
- Human note: Nah? It's just a space? this feels like trivia to me. what's the argument against this?<br><br>///-> a ground rule is emerging: SPACES ARE TRIVIA HERE:<br>- before: tag, attribute, flag, "content", > /// SPACE HERE ARE VALID<br><tag attribute="0" flag "content"><br> ^   ^             ^    ^        ^ /// SPACES ARE TRIVIA HERE<br><br><br>SPACES ARE ERRORS HERE:<br>- within attribute name, on either side of = ///SPACES BETWEEN EQUALS SIGN AND ANYTHING ARE INVALID<br>- obviously inserted within any whole word or number /// INVALID<br><tag attribute="0" flag "content"><br>              ^^  /// SPACES ARE INVALID AT/BEFORE EITHER CARAT
- Active claim: Whitespace cannot split an element closer.
- Provenance priority: critical
- Recommended owner: **specification correction**

### `hson.reject.literal.root.mixed-modes`

- Exact active authored source: `"<a/><b 2>"`
- Current proposal: invalid
- Human/amendment verdict: valid
- Human note: I am on the fence here. I think eventually they will coexist, some day. Honestly as long as there's never any nesting of obj and elem --just neighbors I wouldn't want to rule this out totally as a whole-graph storage approach.<br><br>UNless there's a footgun I don't see
- Active claim: Element and object root modes cannot mix.
- Provenance priority: low
- Recommended owner: **specification correction**

## Uncertain cases

### `hson.accept.literal.object.one-property`

- Active source: `"<a 1>"`
- Human note: Partially correct--only for non-string
- Current proposal: valid
- Minimal remaining question: Confirm that `<a 1>` is valid as written and separate that verdict from the broader question of string-valued object properties.

### `hson.accept.basis.number.negative-exponent-sign`

- Active source: `"1e-3"`
- Human note: I defer to JSON spec
- Current proposal: valid
- Minimal remaining question: Confirm whether authored numbers follow JSON by accepting a negative exponent sign.

### `hson.accept.basis.number.positive-exponent-sign`

- Active source: `"1e+3"`
- Human note: defer to JSON
- Current proposal: valid
- Minimal remaining question: Confirm whether authored numbers follow JSON by accepting an explicit positive exponent sign.

### `hson.accept.literal.primitive.exponent`

- Active source: `"1e3"`
- Human note: defer to JSON
- Current proposal: valid
- Minimal remaining question: Confirm whether ordinary exponent notation is admitted under the JSON-number rule.

### `hson.reject.literal.comment.block`

- Active source: `"/*x*/1"`
- Human note:  TBD - I MAY WANT TO PRESERVE/ALLOW COMMENTS
- Current proposal: invalid
- Minimal remaining question: Decide whether block comments remain forbidden or become authored-Hson trivia.

### `hson.reject.literal.source.comment-only`

- Active source: `"// comment"`
- Human note: TBD - see above
- Current proposal: invalid
- Minimal remaining question: Decide whether comment-only input is invalid because it contains no semantic root value.

### `hson.reject.literal.whitespace.byte-order-mark`

- Active source: `"1\uFEFF"`
- Human note: PROPOSAL VALUES ACCEPTED
- Current proposal: invalid
- Minimal remaining question: Decide whether U+FEFF is forbidden or admitted as source trivia.

## Unreviewed cases

### 11. Accepted quoted-string escapes / family `quoted-string-unicode-boundaries`

- `hson.accept.family.quoted-string.unicode-lowercase`
- `hson.accept.family.quoted-string.unicode-uppercase`
- `hson.accept.family.quoted-string.unicode-mixed-case`
- `hson.accept.family.quoted-string.unicode-u0000`
- `hson.accept.family.quoted-string.unicode-u001f`
- `hson.accept.family.quoted-string.unicode-u007f`
- `hson.accept.family.quoted-string.unicode-u0080`
- `hson.accept.family.quoted-string.unicode-u00ff`
- `hson.accept.family.quoted-string.unicode-u0100`
- `hson.accept.family.quoted-string.unicode-u2028`
- `hson.accept.family.quoted-string.unicode-u2029`
- `hson.accept.family.quoted-string.unicode-high-surrogate`
- `hson.accept.family.quoted-string.unicode-low-surrogate`
- `hson.accept.family.quoted-string.unicode-surrogate-pair`
- `hson.accept.family.quoted-string.consecutive-unicode`

## Next focused action

The remaining authored-Hson decisions are separate from this delimiter migration:
`.5` admission, element-closer trivia, comment syntax, and mixed-root design reservation.
