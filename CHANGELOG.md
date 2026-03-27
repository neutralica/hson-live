// hson changelog.md

27MAR2026
LiveTree already offered namespace-aware SVG parsing. New updates incorporate typed, namespaced SVG creation and manipulation natively into LiveTree's .create API:

⸻

Added: Native SVG support in LiveTree
	•	Introduced SVG-aware creation pipeline (create.svg, SVG tag helpers).
	•	Ensures correct namespace propagation (http://www.w3.org/2000/svg) at creation time.
	•	Eliminates need for temporary wrapper <svg> shells during construction.
	•	Aligns SVG creation behavior with HTML creation semantics.

⸻

Fixed: SVG creation + insertion semantics
	•	Resolved mismatch between:
	•	parsed root nodes
	•	appended nodes
	•	returned LiveTree handles
	•	Ensured created SVG elements:
	•	are appended directly (no wrapper leakage)
	•	maintain correct parentage
	•	preserve insertion index behavior (at(), prepend())

⸻

Fixed: appendNodes() structural correctness
	•	Corrected insertion logic to operate on actual child nodes rather than wrapper artifacts.
	•	Ensures:
	•	correct _elem container usage
	•	stable ordering during indexed inserts
	•	consistent DOM ↔ HSON synchronization

⸻

Added: SVG API on LiveTree (tree.svg)
	•	Extended existing svg namespace (previously only inScope()).
	•	Added:
	•	svg.bbox()
	•	svg.must.bbox()
	•	Provides safe access to getBBox() without exposing raw DOM.
	•	Follows existing dom.must.* pattern for error-safe access.

⸻

Extended: DOM geometry API (tree.dom.rect)
	•	Expanded DomRectApi to include:
	•	clientRects()
	•	scrollSize()
	•	clientSize()
	•	Consolidates layout/measurement access under a single API surface.
	•	Reduces need for direct DOM access for common geometry queries.

⸻

Added: SVG <image> support in creation helpers
	•	Ensured image is included in SVG tag helpers.
	•	Enables internal SVG transformations that rely on image replacement workflows.

⸻

Clarified: DOM vs SVG responsibility boundaries
	•	Formalized separation:
	•	tree.dom.* → layout, connectivity, HTML-like behavior
	•	tree.svg.* → SVG-specific geometry and transforms
	•	Avoids mixing coordinate systems and API semantics.

⸻

Internal: Reduced reliance on direct DOM operations
	•	Replaced ad hoc DOM usage patterns with LiveTree-native equivalents where possible:
	•	structured creation (create.*)
	•	controlled geometry access (dom.rect, svg.bbox)
	•	Leaves only unavoidable low-level calls (e.g., getBBox) at the boundary.

⸻

Result
	•	LiveTree now supports SVG as a first-class citizen alongside HTML.
	•	Geometry and layout access are exposed through consistent, typed APIs.
	•	Node creation, insertion, and measurement behave uniformly across namespaces.
	•	Reduced need for direct DOM interaction in higher-level code.

22MAR2026

Transformer Chain — Change Summary

Fixed: Auto-detection misclassification of markup inputs
	•	Adjusted auto entry resolution to reduce false positives between HSON and HTML.
	•	Added strong heuristic: presence of </ biases toward HTML for diagnostic/test inputs.
	•	JSON detection remains highest priority when syntax-valid.
	•	Prevents HTML fixtures from being incorrectly parsed as HSON and vice versa.

⸻

Fixed: Multiline quoted attribute parsing in HSON
	•	Tokenizer now supports quoted attribute values spanning multiple lines.
	•	Header parsing no longer assumes single-line attributes.
	•	Preserves literal newlines and whitespace inside quoted values.
	•	Restored support for inline tail constructs (<>) after regression.

⸻

Fixed: Tokenizer → parser contract for quoted values
	•	Standardized behavior: tokenizer emits inner text for quoted values.
	•	Removed ambiguity between “full JSON literal” vs “inner string” handling.
	•	Simplifies downstream parsing and prevents double-decoding inconsistencies.

⸻

Fixed: unescape_hson_string() decoding behavior
	•	Removed destructive .trim() on quoted content.
	•	Removed incorrect unconditional JSON.parse of inner text.
	•	Implemented explicit escape decoding for:
	•	\", \\, \n, \r, \t, etc.
	•	Preserves literal formatting while correctly interpreting escape sequences.

⸻

Fixed: HSON attribute serialization escaping
	•	Replaced naive quote-only escaping with full JSON-style string escaping.
	•	Ensures correct handling of:
	•	backslashes (\\)
	•	quotes (\")
	•	control characters (\t, \f, etc.)
	•	Applied consistently to:
	•	user attributes
	•	meta/system attributes
	•	Prevents corruption of embedded JSON (e.g., data-json, data-cf-beacon).

⸻

Fixed: Attribute roundtrip stability for JSON-like payloads
	•	Added focused fixtures for:
	•	JSON-in-attr values
	•	escaped quote/backslash cases
	•	Cloudflare-style beacon payloads
	•	Identified HSON serialization as the failing stage.
	•	Verified stable roundtrip across HTML → HSON → JSON → HTML.

⸻

Clarified: Raw-text element handling (script, style)
	•	Failures traced primarily to incorrect source detection and test assumptions.
	•	Not a tokenizer regression.
	•	Highlighted inconsistency: HTML parser returns direct _str without _elem wrapper (known but not blocking).

⸻

Fixed: LiveTree test assumptions (detached vs mounted)
	•	Clarified that asBranch() produces a detached tree with no DOM.
	•	Tests updated to mount branches into sandbox before DOM access.
	•	Eliminated false failures caused by missing DOM handles.

⸻

Fixed: Invalid or misleading test fixtures
	•	Removed or corrected:
	•	metadata fields treated as payload (label, notes)
	•	duplicated test cases
	•	incorrect fixture wiring
	•	mismatched expectations (e.g., QUID reminting)
	•	improper multi-root hydration cases

⸻

Decision: Closing tag formatting remains newline-based
	•	Retained requirement that closing tags (/>) appear on their own line.
	•	Did not implement same-line closer suffix parsing.
	•	Keeps tokenizer simpler and avoids ambiguity in mixed-content lines.

⸻

Result
	•	Stable roundtrip across HSON ⇄ HTML ⇄ JSON for complex payloads.
	•	Correct handling of multiline attributes and embedded structured strings.
	•	Clearer separation of responsibilities between tokenizer, parser, and serializer.
	•	Remaining edge cases reduced to intentional design constraints rather than bugs.


10DEC2025

** first public 'live' release. for previous versions see `hson-unsafe` **

- finished docs v.1
