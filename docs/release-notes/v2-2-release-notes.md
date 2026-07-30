
# 2.2.0 — Key Encoding + VSN Alignment Release

This release focuses on canonicalizing internal VSN naming, improving transform fidelity across JSON ↔ HSON ↔ HTML, and expanding support for real-world JSON object keys that do not map cleanly onto markup syntax.

It also completes the migration to the new `_-` VSN convention across runtime, transforms, tests, and diagnostics.

⸻

## Added

### HSON: Backtick-quoted tags (object only)

+ HSON now supports quoted tag names using backtick delimiters when a JSON key contains characters that cannot be represented as an XML-compliant tag name.

Examples:
<`a b` "value">
<`key with spaces` <`another key` "content">>

This allows HSON to preserve JSON object keys containing:
- spaces
- reserved punctuation
- UTF and other non-wire-safe characters

Quoted tags are decoded during parsing and preserved as raw keys in the node graph. 

Within HSON, backtick-quoted keys are only permitted in _hson_obj nodes; JSON keys may contain spaces or quoted characters that are invalid HTML tag names and must be encoded. 

For _hson_elem nodes, tag names must be fully XML-compliant. Nonstandard characters within an _hson_elem context are not accepted or encoded and backticks may not be used in tags ending with `/>`.

⸻

### HSON: Underscored tags

+ HSON now accepts underscored tag names. The VSN detection guard, which formerly reserved all use of underscores for HSON's internal structural VSNs, has been adjusted to look for the HSON prefix flag `_-`; any other underscores are now accepted and parsed the same as any other tag name. 

<_tax “10%”>
<__name “content”>

These are stored as they appear in the HSON node graph without requiring special characters or encoding. 

⸻

### HTML: object-key encoding in tag name

+ Added HTML-safe key encoding for _hson_obj property keys (=== tags) that cannot survive XML/DOM parsing unchanged, such as the above string tags with spaces.

Keys are now encoded automatically during HTML serialization, including:
- spaced keys
- camelCase keys
- uppercase characters
- UTF and other unsupported tag characters

Encoded keys are transparently decoded during HTML parsing. Tag names are stored in the node graph as the string literal; nonstandard keys/tags are HTML-encoded (HTML), backtick-wrapped (HSON), or quoted (JSON standard behavior) at time of serialization, depending on the output format chosen.

Tags beginning with the HSON encoding prefix `_-_-` are interpreted as encoded user tags to be decoded before node construction. Non-wire-safe characters are encoded using lowercase hexadecimal code points.

This change preserves non-XML-compliant JSON keys across the HTML transform path while preserving user data exactly in the node graph.

⸻


### Tests: Expanded transform fixtures

Added new regression coverage for:
- spaced object keys
- underscored object keys
- nested encoded keys
- arrays containing encoded objects
- empty-string object keys
- mixed object/array nesting with encoded keys

These fixtures exercise all transform directions:
- JSON → HSON → HTML
- JSON → HTML → HSON
- clockwise / counter-clockwise ring traversal

⸻

## Improved

### Browser-safe HTML roundtripping

HTML key encoding survives browser and DOM normalization behaviors, including automatic lowercasing of tag names (except for camelCase tags, which are now detected and preserved).

Encoded keys are emitted using lowercase-safe wire representations to ensure:
- stable DOM parsing
- stable XML parsing
- lossless recovery of original JSON keys

⸻

### HSON tokenizer strictness

The tokenizer is now stricter about malformed tag names.

New rejections include:
- empty quoted tag names
- malformed quoted identifiers
- invalid punctuation in bare tag names
- unsupported period-only tags

Examples now rejected:
<`` “value”>
<…>
<test+plus “”>

⸻

### Internal VSN migration

Completed migration of all internal VSN tags from legacy `_` prefixes to canonical `_-` prefixes:

_root  → _hson_root
_obj   → _hson_obj
_arr   → _hson_arr
_elem  → _hson_elem
_str   → _hson_str
_val   → _hson_val
_ii    → _hson_ii


This applies consistently across:
- transforms
- serializers
- diagnostics
- fixtures
- LiveTree projections
- documentation

⸻

## Safety

### Reserved VSN protection

Reserved internal VSN tags are excluded from HTML key encoding. This prevents internal runtime tags from being mistaken for user data and guarantees stable serializer behavior.

⸻

## Internal

- added HSON key quoting helpers
- added HTML key encode/decode helpers
- separated wire encoding from canonical node storage
- expanded transform diagnostics for encoded-key failures
- updated regression suites and fixture naming
- removed remaining legacy VSN references