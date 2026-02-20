// hson-transform.md

# hson-live 
# Transformation API

The hson object is the public transformation facade for HSON-LIVE.
It provides a fluent, deterministic pipeline for converting between:
	•	HTML
	•	JSON
	•	HSON
	•	Live DOM structures (LiveTree)

The API is deliberately linear and explicit. Every transformation follows the same four conceptual stages:
	1.	Choose a source
	2.	Choose an output representation
	3.	Optionally configure formatting or safety
	4.	Materialize the result

This design avoids implicit behavior, hidden sanitization, and format-specific shortcuts.

⸻

## Conceptual Model

At the center of all transformations is a stable intermediate representation: HsonNode.

All supported formats—HTML, JSON, SVG, XML-like markup, and HSON itself—are parsed into this shared node graph. All outputs are derived from that graph.

No format is treated as canonical. No transformation path is privileged.

⸻

##  1. Choosing a Source

Every transformation begins by declaring what kind of input you are providing.

This step is mandatory and establishes both parsing semantics and the security model.

### HTML Sources

hson.fromUntrustedHtml(html: string)

Use this for external, user-supplied, or otherwise untrusted HTML.
	•	HTML is sanitized via DOMPurify
	•	Unsafe elements and attributes are removed
	•	The resulting node graph reflects the sanitized markup only

This is the default choice for:
	•	CMS input
	•	user content
	•	third-party embeds
	•	stored HTML of unknown provenance

⸻


hson.fromTrustedHtml(html: string)

Use this only for developer-authored or fully trusted HTML.
	•	No sanitization is performed
	•	SVG, scripts, and advanced markup are preserved
	•	The resulting nodes faithfully represent the input

This path exists to avoid silently degrading internal documents.

⸻

### Data Sources

hson.fromJson(value: JSONValue)

Treats the input strictly as data.
	•	No HTML semantics are assumed
	•	No sanitization is applied
	•	Object structure, arrays, primitives, and ordering are preserved

⸻


hson.fromHson(hsonText: string)

Parses HSON’s pared syntax directly into nodes.

⸻


hson.fromNode(node: HsonNode)

Starts from an already-constructed node graph.

This is useful for:
	•	programmatic node construction
	•	intermediate transforms
	•	advanced pipelines

⸻

### DOM Query Sources

hson.queryDOM(selector: string)

Selects an existing DOM subtree and parses it into nodes.

⸻


hson.queryBody()

A convenience wrapper for document.body.

These sources are typically used as entry points for LiveTree workflows.

⸻

## 2. Choosing an Output Representation

Every source method returns an output builder.

### HTML Output

.toHtml()

Prepares an HTML output pipeline.
	•	Produces serialized HTML or parsed DOM
	•	Honors formatting and sanitization options

⸻

### JSON Output

.toJson()

Produces structured JSON values derived from the node graph.
	•	Ordering is preserved
	•	Mixed content is represented explicitly
	•	No implicit coercion or template flattening occurs

⸻

### HSON Output

.toHson()

Returns HSON’s pared syntax or underlying nodes, depending on finalization.

⸻

### LiveTree Output

.liveTree()

Creates a LiveTree projection of the node graph.

This path diverges slightly in finalization (see below).

⸻

### 3. Optional Configuration

After selecting an output, you may apply optional modifiers.

These affect serialization only, not the underlying node graph.

### Formatting Controls

.spaced()

Pretty-prints output for human readability.

⸻


.noBreak()

Forces single-line output.

⸻


.withOptions(options)

Applies fine-grained control over serialization behavior.

(The specific options depend on the output format and is minimally furnished for now.)

⸻

### Explicit Sanitization Escape Hatch

.sanitizeBEWARE()

Forces sanitization: this method exists for edge cases only.

Use cases:
	•	JSON or HSON that may conceal HTML payloads
	•	Legacy datasets of unknown provenance
	•	Defensive re-sanitization before DOM emission

Important notes:
	•	This may destroy non-HTML content
	•	Applying it to JSON or HSON is allowed but lossy
	•	It is intentionally named to discourage casual use

⸻

### 4. Finalizing the Transformation

The final step materializes the result.

### String Serialization

.serialize()

Returns a string:
	•	HTML text
	•	JSON text
	•	HSON text

⸻

### Structured Output

.parse()

Returns structured data:
	•	JSONValue
	•	HsonNode

No stringification occurs.

⸻

### LiveTree Finalization

For .liveTree() outputs:

.asBranch()

Creates a LiveTree instance without mutating the DOM.

⸻


.graft()

Replaces the original DOM subtree with LiveTree’s rendered clone.

This is a destructive operation by design and marks the transition to a managed LiveTree lifecycle.

⸻

### Security Model Summary

HTML sources are not interchangeable.

Method	Sanitized	Intended Use
fromUntrustedHtml	Yes	External / user content
fromTrustedHtml	No	Developer-authored HTML
fromJson	No	Data
fromHson	No	Data
fromNode	No	Internal graph
queryDOM	No	Existing DOM

Sanitization is explicit, predictable, and opt-in outside HTML parsing.

⸻

### Design Notes
	•	Transformations are deterministic
	•	Round-trip conversions do not drift
	•	No format is treated as canonical or 'true'
	•	Serialization is not a special case—it is a first-class operation
	•	The API favors explicit intent over convenience

This API is designed to be boring and simple.
