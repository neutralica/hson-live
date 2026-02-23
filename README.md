
### hson-live 2.0 / neutralica @ TERMINAL_GOTHIC · 11JAN2026

```hson
               .x+=:.                                         ..    .       _                    
  .uef^"      z`    ^%                                x .d88"    @88>    u                     
:d88E            .   <k        u.      u.    u.        5888R     %8P    88Nu.   u.             
`888E          .@8Ned8"  ...ue888b   x@88k u@88c.      '888R      .    '88888.o888c      .u    
 888E .z8k   .@^%8888"   888R Y888r ^"8888""8888"       888R    .@88u   ^8888  8888   ud8888.  
 888E~?888L x88:  `)8b.  888R I888>   8888  888R        888R   ''888E`   8888  8888 :888'8888. 
 888E  888E 8888N=*8888  888R I888>   8888  888R        888R     888E    8888  8888 d888 '88%" 
 888E  888E  %8"    R88  888R I888>   8888  888R        888R     888E    8888  8888 8888.+"    
 888E  888E   @8Wou 9%  u8888cJ888    8888  888R  HHHH  888R     888E   .8888b.888P 8888L      
 888E  888E .888888P`    "*888*P"    "*88*" 8888" PPPP .888B .   888&    ^Y8888*""  '8888c. .+ 
m888N= 888> `   ^"F        'Y"         ""   'Y"        ^*888%    R888"     `Y"       "88888%   
 `Y"   888                                               "%       ""                   "YP'    
      J88"                                                                                        
      @%                                                                                            
    :"                      Hypertext Structured Object Notation 
                                          2.0.26                                                                                    
```

# HSON: Hypertext Structured Object Notation


## overview
HSON is a glue format: a structural data representation capable of fully expressing both JSON and HTML within a single syntax.

JSON and HTML are fundamentally different domains--data versus markup--yet both are built from hierarchical, tree-structured relationships.

HSON explicitly models that shared structure, allowing JSON and HTML to be translated losslessly, deterministically, and reversibly into one another, preserving data integrity across any number of round-trip transformations.


## view ≡ state
hson-live extends this model into runtime with LiveTree, an extension that parses the DOM and makes it accessible and manipulable as a JS data structure. Markup values like attributes and text content may be directly manipulated in JS code like a state object; changing these values immediately updates the DOM.

With hson.liveTree, view is not a function of state: view *is* state.  Rather than synchronizing separate representations, they are simply projections of the same node graph. Immediate applications include include lightweight reactive UI, but the same guarantees apply to any HTML or JSON data.

## core
HSON is built around a single, explicit intermediate representation (IR), a node graph capable of representing:

* JSON objects and arrays
* HTML and SVG elements
* mixed markup content (text + elements)
* attributes, values, and ordering
* namespaced markup including XML and SVG

This representation is stable under repeated transformations. Serializing to another format and back does not degrade, reorder, or reinterpret the data. The result is a format that serves as both data and markup without collapsing one into the other or privileging either.

## hson.transform
hson.transform is a set of core transformers responsible for:

* parsing HTML, JSON, SVG, XML, and HSON strings into a shared HsonNode IR
* serializing the nodes from any supported format to any other
* performing repeated round-trip conversions without data loss or structural drift
* preserving mixed content, attributes, ordering, and unique node ids

This includes cases that are often lossy or ambiguous in conventional tooling, such as embedded markup in JSON, boolean attributes, void elements, or SVG namespace handling.

Using hson-live’s transformers, arbitrary HTML can be rendered as a valid JSON representation, manipulated via standard JS object methods, and re-rendered on the DOM in its new form. The inverse — treating structured data as markup to be rendered — works equally well. 

Joining two incompatible notations in a single unified format opens up new ways of creating the web. hson-live's LiveTree extension explores the possibilities this unlocks.



## hson.liveTree
LiveTree is an interface that projects live DOM elements from HsonNodes, using the HsonNode graph as the source of truth and updating the DOM when changes are made. LiveTree allows the DOM to be accessible and editable directly via JS (with a few other unexpected bonuses thrown in).

Rather than maintaining separate virtual ui and state model that must be kept in sync, LiveTree works by:

1) ingesting any existing HTMLElement within document.body (or <body> itself) and parsing it (and all nested content) to HsonNodes
2) re-emitting those nodes as HTML back into the DOM, structurally identical to the original
3) binding a fluent, typed API directly to the underlying node graph that updates the DOM in realtime

Attributes, text content, child nodes, CSS and styles, animations and keyframes, and events and listeners--all are accessible using ordinary JavaScript and TypeScript semantics.

 Once grafted onto document.body, changes to LiveTree's node graph are immediately reflected in the DOM. Complex documents can be created, transformed, and animated without relying on templates, reconciliation layers, or shadow DOM, and without any direct use of low-level DOM construction APIs or the complexity and heft of a framework.

```ts
const tree = hson.queryBody()  // or `.queryDom(/*selector*/)`
      .liveTree()  
        // replace contents of document.body with identical LiveTree projection
      .graft()  

      // LiveTree extends many basic JS document methods
    const branchDiv = tree.create.div()  
        .setText('hello world'); 
        .css.set.backgroundColor("pink")
          // liveTree methods return `this`, enabling complex chained operations

      // liveTree's ListenerManager exposes event listeners and handling
    tree.listen           
          // event listener options are fully represented in liveTree's .listen toolchain 
        .once()           
          // listener teardown/cleanup occurs automatically on node removal
        .onClick(       
          branchDiv.setText('goodbye world') 
          // changes to the node graph are instantaneously expressed in the DOM
         ); 
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
hson-live exposes CSS not as a string-based side channel, but as a typed surface that can be read, written, created, and reasoned about directly, all within JS/TS. Style rules, keyframes, custom properties, and scoped selectors are all constructed and managed programmatically in LiveTree, without sacrificing any of the expressiveness of native CSS.

LiveTree's CssManager uses each a node's "quantum unique ID" (quids) as its selector. Local CSS scoping emerges naturally fcrom this: Rules apply only on the node where they are defined, without requiring Shadow DOM boundaries, naming conventions, or build-time transformations. Cleanup is built-in: rules are automatically deleted from the <hson-_style> stylesheet on node removal. CSS remains CSS, but its lifetime, scope, and validity can be governed programmatically by LiveTree.

hson-live's CssManager, KeyframesManager, StyleManager, and (@)PropertyManager together enable typed style management, deterministic cleanup, dynamic rule composition, and animation systems that can be defined, sequenced, and controlled without fragile string concatenation.


## significance
Treating JSON and HTML as different representations of the same underlying structure removes a long-standing obstacle in web development. hson-live suggests a new paradigm of view and data alignment:

* state and view cannot diverge; there is only one data node structure of which they are both projections
* serialization is no longer an edge operation, but a core function
* reactive systems and interfaces requiring no reconciliation step
* DOM manipulation becomes authoritative and first-class rather than a side effect
* non-JS runtimes (including WASM) gain a clear, stable target for DOM-adjacent interaction


## status and safety
### HSON-LIVE IS EXPERIMENTAL - USE WITH CAUTION
The transformation core is stable, but the surrounding APIs are still evolving. The project is suitable for exploration, prototyping, and controlled environments. ***hson-live is not currently recommended for processing untrusted HTML or for security-critical production use.*** 


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


## demo
The HSON demo site demonstrates LiveTree in a deliberately minimal environment, without frameworks or any other dependencies.
<!-- demo url coming soon -->


## documentation
Detailed documentation of the HSON syntax, transformer behavior, and LiveTree API is available in /src/docs.
