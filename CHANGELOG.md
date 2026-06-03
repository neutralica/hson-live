// hson changelog.md

## 03JNU2026

## 2.3.2
### changes
• expanded dom.contains:
  + dom.contains.node(DOM Node)
  + dom.contains.target(EventTarget)
  + dom.contains.tree(LiveTree) 
	* dom.contains(tree) still valid
• css custom-property access api: 
  * clarified or consolidated style.var, css.var, get.vars([...]), var.getMany
  * removed redundant getter paths
• stylesheet diagnostics: generated selector/pseudo rules are represented consistently in rendered css snapshots
• fixed hyphen-normalization bug: now preserving animation/keyframe keys exactly
• added managed keyframe teardown for css anim without corrupting preserved animation identifiers.
• LiveDemo: all tests ok

### bugfixes
• fixed stale inline-style state after property and custom-property removal
• fixed pointer-tracking demo code paths that were rewriting managed stylesheets during high-frequency mouse movement


## 21MAY2026
• Added `canvas.pointer(...)` and `canvas.must.pointer(...)`.
• Added `canvas.display.match.watch(...)` for ResizeObserver-backed display/backing-size synchronization.
• Added owner-bound disposable lifecycle cleanup for canvas display watchers.
• LiveDemo: Added lifecycle tests for manual watcher cleanup, automatic cleanup on removal, removeChildren, and deep ancestor detach (70/70 OK)


## 2.3.0

### Added
• initial `LiveTree.canvas` namespace.
• typed `create.canvas()` support.
• canvas helpers for scope detection, mounted canvas access, 2D context access, width, and height.
• `LiveTreeApi` capability interfaces for the public LiveTree surface.
• generated JSON transform fuzz fixtures.

### Changed
• moved form helpers under `tree.form`.
• refactored data helpers to use a lightweight data API factory.

### Breaking
• removed `tree.setFormValue()` and `tree.getFormValue()`.
 --> use `tree.form.setValue()` and `tree.form.getValue()` instead.
 

## 2.2.2

### LiveTree maintenance

• Slimmed and reorganized the main `LiveTree` class.
• Moved repeated public API object literals into small factory helpers where appropriate.
• Standardized lazy getter/cached namespace patterns across LiveTree APIs.
• Reduced special-case typing in helper APIs.
• Improved public interface documentation coverage.
• Consolidated duplicated public API declarations across internal LiveTree type surfaces.

### Data / attributes

• Reworked data handling to behave as a thin `data-*` attribute helper.
• Aligned data behavior with existing `id`, `classlist`, `attr`, and `flag` APIs.
• Removed unnecessary data-specific tree abstraction.
• Kept dataset keys normalized to `data-*` attributes.

### Tests (LiveDemo)

• Kept legacy and new LiveTree tests passing through the API cleanup.
• Added/updated regression coverage for recently changed LiveTree helper surfaces.


## 2.2.1

### HSON syntax

• HSON now supports backtick-quoted keys:

```
  <`a b` "value">
  <__underscored "c">
  <`-hyphen-led` "d">
```

• HTML wire now safely encodes object keys that would not survive XML/DOM parsing:
 • spaces
 • leading underscores
 • camelCase / uppercase
 • UTF and other non-wire-safe characters
• encoded HTML keys now survive browser lowercasing and decode back to their original JSON keys
• VSN tags (`_-obj`, `_-arr`, `_-elem`, etc.) are excluded from key encoding
• underscored tagnames are not permitted in _-elem nodes; they are only possible when source is JSON and are only valid within _-obj nodes. 
•  backtick tags are permitted in _-elem nodes
	• BUG• possible bug: leading underscores are still not permitted within backticks 


### parsing
• tokenizer now rejects malformed empty quoted tags:
 • `<>`
 • `<`` ...>`

• stricter tag-name handling for invalid punctuation cases

### tests
• added transform fixtures for:
 • spaced keys
 • underscored keys
 • nested encoded keys
 • array/object edge cases
 • empty-string keys


## 2.2.0

• Migrated internal VSN tags from `_name` to `_-name`
  (`_-root`, `_-obj`, `_-arr`, `_-elem`, `_-str`, `_-val`, `_-ii`).
• Tightened HSON parsing and fixture validation.
• Updated tests and docs for the new VSN namespace.

Note: serialized data using legacy `_root`, `_obj`, `_elem`, etc. is no longer current.

27MAR2026
LiveTree already offered namespace-aware SVG parsing. New updates incorporate typed, namespaced SVG creation and manipulation natively into LiveTree's .create API:

⸻

• Native SVG support in LiveTree
	•	Introduced SVG-aware creation pipeline (create.svg, SVG tag helpers).
	•	Ensures correct namespace propagation (http://www.w3.org/2000/svg) at creation time.
	•	Eliminates need for temporary wrapper <svg> shells during construction.
	•	Aligns SVG creation behavior with HTML creation semantics.

• SVG creation • insertion semantics
	•	Resolved mismatch between:
	•	parsed root nodes
	•	appended nodes
	•	returned LiveTree handles
	•	Ensured created SVG elements:
	•	are appended directly (no wrapper leakage)
	•	maintain correct parentage
	•	preserve insertion index behavior (at(), prepend())

• appendNodes() structural correctness
	•	Corrected insertion logic to operate on actual child nodes rather than wrapper artifacts.
	•	Ensures:
	•	correct _-elem container usage
	•	stable ordering during indexed inserts
	•	consistent DOM ↔ HSON synchronization

• SVG API on LiveTree (tree.svg)
	•	Extended existing svg namespace (previously only inScope()).
	•	Added:
	•	svg.bbox()
	•	svg.must.bbox()
	•	Provides safe access to getBBox() without exposing raw DOM.
	•	Follows existing dom.must.* pattern for error-safe access.

• extended DOM geometry API (tree.dom.rect)
	•	Expanded DomRectApi to include:
	•	clientRects()
	•	scrollSize()
	•	clientSize()
	•	Consolidates layout/measurement access under a single API surface.
	•	Reduces need for direct DOM access for common geometry queries.

• SVG <image> support in creation helpers
	•	Ensured image is included in SVG tag helpers.
	•	Enables internal SVG transformations that rely on image replacement workflows.

•  DOM vs SVG responsibility boundaries
	•	Formalized separation:
	•	tree.dom.* → layout, connectivity, HTML-like behavior
	•	tree.svg.* → SVG-specific geometry and transforms
	•	Avoids mixing coordinate systems and API semantics.

•  Reduced reliance on direct DOM operations
	•	Replaced ad hoc DOM usage patterns with LiveTree-native equivalents where possible:
	•	structured creation (create.*)
	•	controlled geometry access (dom.rect, svg.bbox)
	•	Leaves only unavoidable low-level calls (e.g., getBBox) at the boundary.
### SUMMARY 
	•	LiveTree now supports SVG as a first-class citizen alongside HTML.
	•	Geometry and layout access are exposed through consistent, typed APIs.
	•	Node creation, insertion, and measurement behave uniformly across namespaces.
	•	Reduced need for direct DOM interaction in higher-level code.

## 22MAR2026

Transformer Chain — Change Summary
• Auto-detection misclassification of markup inputs
	•	Adjusted auto entry resolution to reduce false positives between HSON and HTML.
	•	Added strong heuristic: presence of </ biases toward HTML for diagnostic/test inputs.
	•	JSON detection remains highest priority when syntax-valid.
	•	Prevents HTML fixtures from being incorrectly parsed as HSON and vice versa.

• Multiline quoted attribute parsing in HSON
	•	Tokenizer now supports quoted attribute values spanning multiple lines.
	•	Header parsing no longer assumes single-line attributes.
	•	Preserves literal newlines and whitespace inside quoted values.
	•	Restored support for inline tail constructs (<>) after regression.

• Tokenizer → parser contract for quoted values
	•	Standardized behavior: tokenizer emits inner text for quoted values.
	•	Removed ambiguity between “full JSON literal” vs “inner string” handling.
	•	Simplifies downstream parsing and prevents double-decoding inconsistencies.

• unescape_hson_string() decoding behavior
	•	Removed destructive .trim() on quoted content.
	•	Removed incorrect unconditional JSON.parse of inner text.
	•	Implemented explicit escape decoding for:
	•	\", \\, \n, \r, \t, etc.
	•	Preserves literal formatting while correctly interpreting escape sequences.

• HSON attribute serialization escaping
	•	Replaced naive quote-only escaping with full JSON-style string escaping.
	•	Ensures correct handling of:
	•	backslashes (\\)
	•	quotes (\")
	•	control characters (\t, \f, etc.)
	•	Applied consistently to:
	•	user attributes
	•	meta/system attributes
	•	Prevents corruption of embedded JSON (e.g., data-json, data-cf-beacon).

• Attribute roundtrip stability for JSON-like payloads
	•	Added focused fixtures for:
	•	JSON-in-attr values
	•	escaped quote/backslash cases
	•	Cloudflare-style beacon payloads
	•	Identified HSON serialization as the failing stage.
	•	Verified stable roundtrip across HTML → HSON → JSON → HTML.

•  Raw-text element handling (script, style) clarified
	•	Failures traced primarily to incorrect source detection and test assumptions.
	•	Not a tokenizer regression.
	•	Highlighted inconsistency: HTML parser returns direct _str without _-elem wrapper (known but not blocking).


• Closing tag formatting remains newline-based
	•	Retained requirement that closing tags (/>) appear on their own line.
	•	Did not implement same-line closer suffix parsing.
	•	Keeps tokenizer simpler and avoids ambiguity in mixed-content lines.

### SUMMARY
	•	Stable roundtrip across HSON ⇄ HTML ⇄ JSON confirmed for more complex payloads.
	•	Correct handling of multiline attributes and embedded structured strings.
	•	Clearer separation of responsibilities between tokenizer, parser, and serializer.
	•	Remaining edge cases reduced to intentional design constraints rather than bugs.


10DEC2025

** first public 'live' release. for previous versions see `hson-unsafe` **

• finished docs v.1
