CHANGELOG

2.1.0 — Stability Release

This release focuses on parser robustness, HTML normalization, and strengthening LiveTree’s projection guarantees. It also introduces significantly expanded internal regression coverage.

⸻

Added

HTML normalization preflight pipeline

Additional preprocessing utilities for transforming real-world HTML into XML-compatible form before parsing.

New helpers include handling for:
	•	optional end tags (li, p, td, tr, etc.)
	•	self-closing tag expansion
	•	comment stripping
	•	entity expansion
	•	attribute quoting normalization
	•	illegal attribute mangling safeguards

These transformations allow the HTML parser to safely ingest imperfect or browser-style markup while still relying on XML parsing internally.

⸻

Expanded diagnostics and invariants

Additional diagnostic utilities were added or expanded to verify structural integrity of nodes and trees:
	•	node comparison utilities
	•	invariant checks
	•	loop and traversal verification helpers

These tools support internal testing and debugging of the tree model.

⸻

Improved

HTML parsing resilience

The HTML ingestion pipeline was hardened to better tolerate malformed input while still producing valid HSON structures.

Improvements include:
	•	stronger attribute parsing
	•	safer handling of raw-text elements (script, style)
	•	improved escaping and entity handling
	•	better handling of optional closing tags

⸻

HTML serialization

Improved consistency in HTML serialization:
	•	normalized attribute output
	•	stable attribute ordering
	•	improved handling of style attributes
	•	safer serialization of raw-text nodes

⸻

LiveTree DOM projection

Strengthened guarantees that LiveTree nodes correctly correspond to DOM elements during projection.

Improvements include:
	•	more reliable DOM mounting behavior
	•	improved graft and branch creation logic
	•	additional runtime checks around projected elements

⸻

CSS scoping behavior

Improvements to the QUID-based CSS scoping system:
	•	more reliable CSS rule generation
	•	improved linkage between nodes and scoped CSS rules
	•	additional runtime checks verifying DOM projection state

⸻

Safety Utilities

Expanded and hardened helper utilities used during parsing and serialization:
	•	attribute deduplication
	•	HTML sanitization helpers
	•	URL screening
	•	CDATA wrapping
	•	safer HTML mounting utilities

⸻

Internal
	•	cleanup and reorganization of parser utility modules
	•	improved separation between tokenization, parsing, and normalization layers
	•	additional type definitions and guard utilities
    