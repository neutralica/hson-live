// hson-transform-api.md

# hson-live 
## Transformater API

The hson object is the public transformation facade for HSON-LIVE.
It provides a fluent, deterministic pipeline for converting between:
*	HTML
*	JSON
*	HSON
*	Live DOM projection (LiveTree)

The API is deliberately linear and explicit. Every transformation follows the same four conceptual stages:
	1.	Select source format
	2.	Select output format
	3.	(Optionally: configure formatting or safety)
	4.	Select render method & render

This design avoids implicit behavior, hidden sanitization, and format-specific shortcuts.

⸻

## Conceptual Model

At the center of all transformations is a stable intermediate representation: HsonNode.

All supported formats—HTML, JSON, SVG, XML-like markup, and HSON itself—are parsed into this shared node graph. All outputs are derived from that graph.

No format is treated as canonical and no transformation path is privileged.

⸻

##  1. Choosing a Source

Every transformation begins by declaring the format of provided input.

This step is mandatory and establishes both parsing semantics and the security model.

### HTML Sources

```ts
hson.fromUntrustedHtml(html: string)
```
Use this for external, user-supplied, or otherwise untrusted HTML.
*	HTML is sanitized via DOMPurify
*	Unsafe elements and attributes are removed
*	The resulting node graph reflects the sanitized markup only

This is the default choice for:
*	CMS input
*	user content
*	third-party embeds
*	stored HTML of unknown provenance

⸻

```
hson.fromTrustedHtml(html: string)
```
Use this only for developer-authored or fully trusted HTML.
*	No sanitization is performed
*	SVG, scripts, and advanced markup are preserved
*	The resulting nodes faithfully represent the input

This path exists to avoid silently degrading internal documents.

⸻

### Data Sources
```ts
hson.fromJson(value: JSONValue)
```
Treats the input strictly as data.
*	No HTML semantics are assumed
*	No sanitization is applied
*	Object structure, arrays, primitives, and ordering are preserved

Optional (destructive) sanitation can be applied via the .sanitizeBEWARE() option. 

⸻

```ts
hson.fromHson(hsonText: string)
```
Parses HSON syntax strings into nodes.

⸻

```ts
hson.fromNode(node: HsonNode)
```
Accepts and validates an existing HsonNode graph.

Useful for:
*	programmatic node construction
*	intermediate transforms
*	advanced pipelines

⸻

### DOM Query Sources

To create LiveTree, hson-live queries the DOM and uses the selected node and all descendants as its target. The target and all elements it contains are parsed into a faithful representation of the existing DOM which is then projected to replace the original. 

```ts
hson.queryDOM(selector: string)
```
Selects an existing DOM subtree and parses it into nodes.

⸻

```ts
hson.queryBody()
```
A convenience wrapper for document.body.

These sources are typically used as entry points for LiveTree workflows.

⸻

## 2. Choosing an Output Representation

Every source method returns an output builder.

### HTML Output
```ts
.toHtml()
```
Prepares an HTML output pipeline.
*	Produces serialized HTML or parsed DOM
*	Honors formatting and sanitization options

⸻

### JSON Output
```ts
.toJson()
```
Produces structured JSON values derived from the node graph.
*	Ordering is preserved
*	Mixed content is represented explicitly
*	No implicit coercion or template flattening occurs

⸻

### HSON Output
```ts
.toHson()
```
Returns HSON’s pared syntax or underlying nodes, depending on finalization.

⸻

### LiveTree Output
```ts
.liveTree()
```
Creates a LiveTree projection of the node graph.

This path diverges slightly in finalization (see below).

⸻

### 3. Optional Configuration

After selecting an output, you may apply optional modifiers.

These affect serialization only, not the underlying node graph.

#### Formatting Controls

* .spaced()

Pretty-prints output for human readability.


* .noBreak()

Forces single-line output.


* .withOptions(options)

Applies fine-grained control over serialization behavior.

⸻

(The specific options depend on the output format and is minimally furnished for now.)

⸻

### Explicit Sanitization Escape Hatch
```ts
.sanitizeBEWARE()
```
Forces sanitization: this method exists for edge cases only.

Use cases:
*	JSON or HSON that may conceal HTML payloads
*	Legacy datasets of unknown provenance
*	Defensive re-sanitization before DOM emission

Important notes:
*	This may destroy non-HTML content
*	Applying it to JSON or HSON is allowed but lossy
*	It is intentionally named to discourage casual use

⸻

### 4. Finalizing the Transformation

The final step materializes the result.

### String Serialization
```ts
.serialize()
```
Returns a string:
*	HTML text
*	JSON text
*	HSON text

⸻

### Structured Output
```ts
.parse()
```
Returns structured data:
*	JSONValue
*	HsonNode

No stringification occurs. To avoid enabling XSS and UI injection, hson-live does not make available a 'mount to DOM' method. 

⸻

### LiveTree Finalization

```ts
.asBranch()
```
For .liveTree() outputs. Creates an unattached LiveTree instance without mutating the DOM.

⸻

```ts
.graft()
```
Replaces the original DOM subtree with LiveTree’s rendered clone.

This is a destructive operation by design and marks the transition to a managed LiveTree lifecycle.

⸻

### Security Model Summary

HTML sources are not interchangeable.

#### Method, Sanitized?, Intended Use
* fromUntrustedHtml, Yes, External / user content
* fromTrustedHtml, No, Developer-authored HTML
* fromJson, No, Data
* fromHson, No, Data
* fromNode, No, Internal graph
* queryDOM, No, Existing DOM

Sanitization is explicit, predictable, and opt-in outside HTML parsing.

⸻

### Design Notes
*	Transformations are deterministic
*	Round-trip conversions do not drift
*	No format is treated as canonical or 'true'
*	Serialization is not a special case—it is a first-class operation
*	The API favors explicit intent over convenience

