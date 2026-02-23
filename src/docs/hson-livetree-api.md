// hson-livetree-api.md

# hson.livetree
LiveTree API (Current)

Overview

LiveTree is a mutable handle to a single HsonNode.
It provides structured, opt-in access to DOM synchronization, styling, data, events, and traversal while remaining safe to use without a DOM (Node/test/runtime-agnostic).

A LiveTree always represents one node and operates relative to a host root.

⸻

Construction

constructor(input: HsonNode | LiveTree)

Creates a LiveTree handle.
*	If constructed from a HsonNode, the node becomes both the reference node and host root.
*	If constructed from another LiveTree, the new instance points at the same node and adopts the same host root.

⸻

Identity & Core Accessors

- node: HsonNode

Returns the resolved node.
Throws if the reference cannot be resolved.

- quid: string
Returns the node’s QUID (stable identity token).

- hostRootNode(): HsonNode
Returns the current host root node.

- adoptRoots(root: HsonNode): this
Replaces the host root and returns this.

⸻

DOM Access

- dom: LiveTreeDom
Returns the lazily-created DOM helper API for this node.
*	Cached per LiveTree
*	Created only on first access

- asDomElement(): Element | undefined
Returns the underlying DOM element if it exists.
Returns undefined if the node is not mounted or no DOM is available.

⸻

Tree Mutation

- append
Alias for append_branch.
Appends child node(s) to this node and mirrors to DOM when present.

- empty
Alias for empty_contents.
Removes all content from this node.

- removeChildren(): number
Removes all child nodes (ignores primitives).
Returns the number of nodes removed.

- removeSelf(): number
Removes this node from its parent.
Returns the number of nodes removed.

⸻

Querying

- find
Finds a single descendant node.
Provided by make_find_for(this).
Returns a LiveTree or undefined depending on method used.

- findAll
Finds multiple descendant nodes.
Returns a multi-selection object (TreeSelector) supporting iteration and broadcast APIs.

⸻

Creation Helpers

- create: LiveTreeCreateHelper
Fluent helper for creating and appending new nodes under this tree.

⸻

Styling

Inline Style (element-local)

- style: StyleSetter<LiveTree>
Returns the inline style setter for this node.
*	Lazily created
*	Applies styles via style="" semantics
*	Coexists with QUID-scoped CSS

⸻

QUID-Scoped CSS (stylesheet)

- css: CssHandle
Returns a cached QUID-scoped CSS handle.
*	Rules are written to a managed <style> element
*	Selectors use [_quid="…"]
*	Safe to call before DOM mount
*	Supports animations, keyframes, and @property

The handle exposes:
*	Style setter methods (setProp, setMany, remove, clear)
*	atProperty
*	keyframes
*	anim
*	Debug helpers (if enabled)

see: css-manager-api.md

⸻

Data Attributes

- data: DataManager

Manages data-* attributes.
*	Lazily created
*	Keeps node attrs and DOM dataset in sync
*	Supports single and multi-set operations

⸻

Attributes & Flags

- getAttr(name: string): Primitive | undefined

Returns an attribute value or undefined.

- removeAttr(name: string): LiveTree

Removes an attribute and returns this.

- setAttrs(...)

Overloads:

- setAttrs(name: string, value: string | boolean | null): LiveTree
- setAttrs(map: Record<string, string | boolean | null>): LiveTree
null removes the attribute
Returns this

- setFlags(...names: string[]): LiveTree
Sets boolean attributes (HTML flag semantics).

- removeFlags(...names: string[]): LiveTree
Clears boolean attributes.

⸻

Text & Form Helpers

- text(value: Primitive): LiveTree

Replaces node content with a primitive leaf.

getText(): string

Returns textual content.

setFormValue(value: string, opts?): LiveTree

Sets form-related value and mirrors to DOM/attrs.

Options:
*	silent?: boolean
*	strict?: boolean

getFormValue(): string

Returns current form value.

⸻

ID & Class APIs

id: IdApi

Cached helper for the id attribute.

get(): string | undefined
set(id: string): LiveTree
clear(): LiveTree


⸻

classlist: ClassApi

Cached helper for the class attribute.

get(): string | undefined
has(name: string): boolean
set(cls: string | string[]): LiveTree
add(...names: string[]): LiveTree
remove(...names: string[]): LiveTree
toggle(name: string, force?): LiveTree
clear(): LiveTree


⸻

DOM Event Listeners

listen: ListenerBuilder

Fluent, typed DOM event registration.
*	Supports mouse, pointer, keyboard, focus, animation, transition, clipboard, custom events
*	Supports options (once, passive, capture, etc.)
*	Returns detachable listener handles

⸻

Tree-Local Events

events: TreeEvents

Lightweight pub/sub system scoped to this LiveTree.

Typical surface:

on(type, handler): unsubscribe
once(type, handler): unsubscribe
emit(type, payload): void

Used for application-level signaling independent of DOM events.

⸻

Lifecycle Notes
*	All sub-APIs are lazy
*	DOM interaction is best-effort
*	Safe to use in Node / test environments
*	QUID-scoped CSS survives pre-mount usage

⸻
