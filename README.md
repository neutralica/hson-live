#### hson-live 2.0.26 / terminalgothic.com

# HSON: Hypertext Structured Object Notation
### hson-live — a unified format for HTML markup and JSON data

## overview
HSON is a glue format: a structural representation capable of fully expressing both JSON and HTML within a unified syntax resembling a pared-down form of HTML.

JSON and HTML occupy different domains — data and markup — but both are built from hierarchical, tree-structured relationships. In JSON, structure emerges from key:value associations; in HTML it arises from parent–child relationships between elements. HSON formalizes the correspondence between these two patterns, representing both within the same underlying node graph.

By expressing either format through a common structure, HSON enables JSON and HTML to be translated into one another losslessly, deterministically, and reversibly, preserving data integrity across any number of round-trip transformations. This capability opens up interesting possibilities.

### JSON:
```ts
{
  "key1": {
    "key2": "value"
  }
}
```
### HSON:
```ts
<key1  
  <key2  "value">
>
```
### HTML:
```ts
<parent>
  <child>text node</child>
</parent>
```
### HSON:
```ts
<parent
  <child "text node"/>
/>
```

hson-live provides 7 parsers and serializers for converting any JSON or XML-valid HTML to HSON and back. It also provides a diagnostic suite to verify data integrity and stability across multiple transformations. 

## core
HSON's syntax expresses an explicit intermediate representation (IR), a node graph capable of representing:

* JSON objects and arrays
* HTML and SVG elements
* mixed markup content (text + elements)
* attributes, values, and ordering
* namespaced markup including XML and SVG

This representation is stable under repeated transformations. Serializing to another format and back does not degrade, reorder, or reinterpret the data. The result is a format that serves as both data and markup without collapsing one into the other or privileging either.

## hson.transform
hson.transform is a set of core transformers responsible for:
- parsing HTML, JSON, SVG, XML, and HSON strings into a shared HsonNode intermediate representation (IR)
- serializing that node graph from any supported format to any other
- performing repeated round-trip conversions without structural drift
- preserving mixed content, attributes, ordering, and unique node identifiers

This includes cases that are often lossy or ambiguous in conventional tooling, such as embedded markup in JSON, boolean attributes, void elements, or SVG namespace handling.

Using hson-live’s transformers, arbitrary HTML can be rendered as valid JSON, manipulated using standard JavaScript object operations, and then re-rendered to the DOM. The inverse — treating structured data as markup to be rendered — works equally well, without altering the underlying user data.

Unifying two previously incompatible notations in one representation opens up new avenues for creating web content. hson-live's LiveTree extension explores these possibilities.


## hson.liveTree
LiveTree is an interface that projects live DOM elements from HsonNodes, using the HsonNode graph as the source of truth and updating the DOM when changes are made.

Rather than maintaining separate virtual UI and state models that must be kept in sync, LiveTree works by:
1.	ingesting any existing HTMLElement within document.body (or <body> itself) and parsing it — along with all nested content — into a HsonNode graph
2.	re-emitting those nodes back into the DOM as HTML that is structurally identical to the original document
3.	binding a fluent, typed API to the underlying node graph that synchronously reflects node graph mutations to the DOM


HTML attributes, text content, child nodes, CSS rules and styles, animations and keyframes, and event listeners are all accessible and mutable through a unified JS/TS interface that minimizes null checks and type friction.

Once grafted onto document.body, mutations to LiveTree’s node graph are immediately reflected in the DOM. Complex documents can be created, transformed, and animated without relying on intermediary abstractions such as:
-! templates
-! reconciliation layers
-! shadow DOM
-! direct use of low-level DOM construction APIs
-! large UI frameworks


### API example
```ts
const tree = hson.queryBody()  // or `.queryDom(/*selector*/)`
    .liveTree. // initialize LiveTree creation
    .graft();  // replace document.body with identical LiveTree projection

// LiveTree extends many basic JS document methods
const branchDiv = tree.create.div()
    .setText("hello world")
      // methods return `this`, enabling complex chained operations
    .css.set.backgroundColor("pink");

// liveTree's ListenerManager exposes event listeners and handling
tree.listen
      // listener teardown/cleanup occurs automatically on node removal
    .once()
      // event listener options are fully represented in liveTree's .listen toolchain 
    .onClick(() => {
          // changes to the node graph are rendered to the DOM in realtime
        branchDiv.setText("goodbye world")
            .css.set.backgroundColor("blue");
    }); 
```


## LiveTree capabilities
LiveTree supports:

* creating, removing, and rearranging nodes and child nodes
* reading and writing attributes, text content, and tag names
* scoped CSS manipulation without Shadow DOM
* declarative animation control via CSS keyframes
* typed event listener management with automatic teardown
* SVG creation and animation
* deterministic cleanup of removed nodes

The API is intentionally conservative. It often mirrors established JavaScript document methods and avoids introducing abstractions that stray too far from familiar DOM APIs.

## first-class CSS
hson-live exposes CSS not as a string-based side channel, but as a typed surface that can be read, written, created, and reasoned about directly, all within JS/TS. Style rules, keyframes, custom properties, and scoped selectors are constructed and managed programmatically in LiveTree, without sacrificing any of the expressiveness of native CSS.

LiveTree's CssManager uses each node's "quantum unique ID" (QUID) as its selector. Local CSS scoping emerges naturally from this. Rules apply only on the node where they are defined, without requiring Shadow DOM boundaries, complex naming conventions, or build-time transformations. 

hson-live's CssManager, KeyframesManager, StyleManager, and (@)PropertyManager together enable typed style management, deterministic cleanup, dynamic rule composition, and animation systems that can be defined, sequenced, and controlled without fragile string concatenation.

Cleanup is built-in: rules are automatically deleted from the <hson-_style> stylesheet on node removal. CSS remains CSS, but its lifetime, scope, and validity can be governed programmatically by LiveTree.


## significance
Treating JSON and HTML as representations of the same underlying structure offers a novel solution to a long-standing challenge: how best to align UI and state data. hson-live suggests a new paradigm:

* state and view cannot diverge; there is only one data node structure of which they are both projections
* serialization is not an edge case operation but core functionality
* responsive interfaces require no reconciliation step; they are always up to date
* DOM manipulation becomes authoritative and first-class rather than a side effect
* non-JS runtimes (including WASM) gain a clear, stable target for DOM-adjacent interaction


## status and safety

### HSON-LIVE IS EXPERIMENTAL - USE WITH CAUTION

The transformation core is stable, but the surrounding APIs are still evolving. The project is suitable for exploration, prototyping, and controlled environments. 

!!!hson-live is not currently recommended for use with untrusted HTML or for security-critical production use.


## installation

```bash
npm install hson-live
```


## build
hson-live is written in TypeScript.

```ts
npm install
npx tsc
```

Compiled output is written to dist/.


## demo site
The HSON demo site demonstrates LiveTree in a deliberately minimal environment, without frameworks or any other dependencies. Test it at:

### www.terminalgothic.com


## documentation
Detailed documentation of the HSON syntax, transformer behavior, and LiveTree API is available in /src/docs or at @`www.terminalgothic.com[about]`

## License
hson-live is licensed under the Public Parity License 7.0.
See LICENSE for details.

© 2026 Neutralica. All rights reserved except as granted under the Public Parity License 7.0.