# Authored-HSON source-membership reconciliation

This report reconciles only **human-reviewed authored-language membership**.
It does not certify expected graphs, canonical output, or structured diagnostics.

## Input binding

- Worksheet SHA-256: `df17f7de1e9452754b9ab1ddc4d80fdfc82c473f1323ce91a72f9a46ec79db7c`
- Corpus review fingerprint: `b4dc3e488ebabceb47e5a1f0704f3f1df84513ca05aefeda9a8724ad386afae9`
- Authored descriptors: 269

## Summary

| Measure | Count |
|---|---:|
| Human valid | 77 |
| Human invalid | 163 |
| Human uncertain | 7 |
| Unreviewed | 22 |
| Row verdicts | 108 |
| Family-inherited verdicts | 139 |
| Row overrides | 3 |
| Proposal agreements | 237 |
| Proposal disagreements | 3 |

## Proposal disagreements

### `hson.reject.basis.number.missing-integer-before-fraction`

- Exact authored source: `".5"`
- Current proposal: invalid
- Human verdict: valid
- Human note: accept anything that is functionally 0.5; serialize canonically
- Candidate claim: A fraction requires an integer component before the decimal point.
- Provenance priority: medium
- Recommended owner: **specification correction**

### `hson.reject.literal.element.malformed-closer`

- Exact authored source: `"<e/ >"`
- Current proposal: invalid
- Human verdict: valid
- Human note: Nah? It's just a space? this feels like trivia to me. what's the argument against this?<br><br>///-> a ground rule is emerging: SPACES ARE TRIVIA HERE:<br>- before: tag, attribute, flag, "content", > /// SPACE HERE ARE VALID<br><tag attribute="0" flag "content"><br> ^   ^             ^    ^        ^ /// SPACES ARE TRIVIA HERE<br><br><br>SPACES ARE ERRORS HERE:<br>- within attribute name, on either side of = ///SPACES BETWEEN EQUALS SIGN AND ANYTHING ARE INVALID<br>- obviously inserted within any whole word or number /// INVALID<br><tag attribute="0" flag "content"><br>              ^^  /// SPACES ARE INVALID AT/BEFORE EITHER CARAT
- Candidate claim: Whitespace cannot split an element closer.
- Provenance priority: critical
- Recommended owner: **specification correction**

### `hson.reject.literal.root.mixed-modes`

- Exact authored source: `"<a/><b 2>"`
- Current proposal: invalid
- Human verdict: valid
- Human note: I am on the fence here. I think eventually they will coexist, some day. Honestly as long as there's never any nesting of obj and elem --just neighbors I wouldn't want to rule this out totally as a whole-graph storage approach.<br><br>UNless there's a footgun I don't see
- Candidate claim: Element and object root modes cannot mix.
- Provenance priority: low
- Recommended owner: **specification correction**

## Uncertain cases

### `hson.accept.literal.object.one-property`

- Source: `"<a 1>"`
- Human note: Partially correct--only for non-string
- Current proposal: valid
- Minimal remaining question: Confirm that `<a 1>` is valid as written and separate that verdict from the broader question of string-valued object properties.

### `hson.accept.basis.number.negative-exponent-sign`

- Source: `"1e-3"`
- Human note: I defer to JSON spec
- Current proposal: valid
- Minimal remaining question: Confirm whether authored numbers follow JSON by accepting a negative exponent sign.

### `hson.accept.basis.number.positive-exponent-sign`

- Source: `"1e+3"`
- Human note: defer to JSON
- Current proposal: valid
- Minimal remaining question: Confirm whether authored numbers follow JSON by accepting an explicit positive exponent sign.

### `hson.accept.literal.primitive.exponent`

- Source: `"1e3"`
- Human note: defer to JSON
- Current proposal: valid
- Minimal remaining question: Confirm whether ordinary exponent notation is admitted under the JSON-number rule.

### `hson.reject.literal.comment.block`

- Source: `"/*x*/1"`
- Human note:  TBD - I MAY WANT TO PRESERVE/ALLOW COMMENTS
- Current proposal: invalid
- Minimal remaining question: Decide whether block comments remain forbidden or become authored-HSON trivia.

### `hson.reject.literal.source.comment-only`

- Source: `"// comment"`
- Human note: TBD - see above
- Current proposal: invalid
- Minimal remaining question: Decide whether comment-only input is invalid because it contains no semantic root value.

### `hson.reject.literal.whitespace.byte-order-mark`

- Source: `"1\uFEFF"`
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

### 14. Accepted backtick names / family `backtick-name-ordinary-dispatch`

- `hson.accept.family.backtick-name.escaped-backtick`
- `hson.accept.family.backtick-name.escaped-backslash`
- `hson.accept.family.backtick-name.backspace`
- `hson.accept.family.backtick-name.form-feed`
- `hson.accept.family.backtick-name.line-feed`
- `hson.accept.family.backtick-name.carriage-return`
- `hson.accept.family.backtick-name.tab`

## Next focused action

Resolve the three proposal disagreements, seven uncertain cases, and two entirely unreviewed
accepted-family groups. Only then reconcile expected graphs and canonical outputs for sources
whose authored-language validity has human approval.
