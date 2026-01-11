# hson-live 2.0
# HSON - Hypertext Structured Object Notation
### neutralica · terminal_gothic 11JAN2026

## Overview
HSON is a glue format: a structural data representation capable of fully expressing both JSON and HTML within a single syntax.
JSON and HTML are fundamentally different domains—data versus markup—yet both are built from hierarchical, tree-structured relationships.
HSON explicitly models that shared structure, allowing JSON and HTML to be translated losslessly, deterministically, and reversibly into one another, preserving data integrity across any number of round-trip transformations.
hson-live extends this model into runtime by eliminating the need for separate data and markup representations. Rather than maintaining separate representations and synchronizing between them, both are expressed by the same object graph and projected as needed.
In hson-live, view is not a function of state: view *is* state. Immediate applications include UI, but the same guarantees apply to any data that can be expressed as JSON or markup.

## Core Idea
HSON is built around a single, explicit intermediate representation (IR): a node graph capable of representing:
* JSON objects and arrays
* HTML and SVG elements
* mixed content (text + elements)
* attributes, values, and ordering
* namespaced markup (including XML and SVG)

This representation is stable under repeated transformations. Serializing to another format and back does not degrade, reorder, or reinterpret the data.
The result is a format that is both data and markup, without collapsing one into the other or privileging either.

## hson.transform
hson.transform is a set of core transformers responsible for:
* parsing HTML, JSON, SVG, XML, and HSON strings into a shared HsonNode IR
* serializing the nodes from any supported format to any other
* performing repeated round-trip conversions without data loss or structural drift
* preserving mixed content, attributes, ordering, and unique node ids

This includes cases that are often lossy or ambiguous in conventional tooling, such as embedded markup in JSON, boolean attributes, void elements, or SVG namespace handling.
Using hson-live’s transformers, arbitrary HTML can be rendered as a valid JSON representation, manipulated via standard JS object methods, and re-rendered on the DOM in its new form. The inverse—treating structured data as markup to be rendered—works equally well.

## hson.liveTree
LiveTree is a projection of the HsonNode IR into live DOM elements.
Rather than maintaining a separate virtual model, LiveTree works by:
* ingesting any existing DOM subtree within document.body, parsing it into HsonNodes
* re-emitting those nodes as HTML back into the DOM
* binding a fluent, typed API directly to the underlying node graph, enabling lightweight reactive interfaces

Once grafted, mutations to the IR are immediately reflected in the DOM. Attributes, text content, children, styles, animations, and events are accessed and manipulated using ordinary JavaScript and TypeScript semantics.
Complex documents can be created, transformed, and animated without relying on templates, reconciliation layers, or shadow DOM, and without direct use of low-level DOM construction APIs.

## LiveTree Capabilities
LiveTree supports:
* creating, removing, and rearranging nodes
* reading and writing attributes, text content, and tag names
* scoped CSS manipulation without Shadow DOM
* declarative animation control via CSS keyframes
* typed event listener management with automatic teardown
* SVG creation and animation
* deterministic cleanup of removed nodes

The API is intentionally conservative. It often mirrors established JavaScript document methods and avoids introducing abstractions that stray too far from familiar DOM APIs.

## CSS as a First-Class Structure
hson-live exposes CSS not as a string-based side channel, but as a typed surface that can be read, written, created, and reasoned about directly, all within JS/TS. Style rules, keyframes, custom properties, and scoped selectors are all constructed and managed programmatically in LiveTree, without sacrificing any of the expressiveness of native CSS.
Because styles use nodes' unique IDs as selectors, scoping emerges naturally. Rules apply exactly where they are defined, without requiring Shadow DOM boundaries, naming conventions, or build-time transformations. CSS remains CSS, but its lifetime and scope can be governed programmatically by LiveTree's CssManager.
This approach enables typed style management, deterministic cleanup, and animation systems that can be composed and sequenced without fragile string concatenation.


## Significance
Treating JSON and HTML as different representations of the same underlying structure removes a long-standing boundary in web development.
As a result:
* state and view cannot diverge; there is only one data node structure of which they are both projections
* serialization is no longer an edge operation but a core function
* reactive systems require no reconciliation step
* DOM manipulation becomes authoritative and first-class rather than a side effect
* non-JS runtimes (including WASM) gain a clear, stable target for DOM-adjacent interaction

## Status and Safety
### hson-live is experimental.
The transformation core is stable, but the surrounding APIs are still evolving. The project is suitable for exploration, prototyping, and controlled environments.
It is not currently recommended for processing untrusted HTML or for security-critical production use without additional hardening.

## Installation
```bash
npm install hson-live
```

## Build
hson-live is written in TypeScript.
```ts
npm install
npx tsc
```
Compiled output is written to dist/.

## Demo
The HSON demo site demonstrates LiveTree in a deliberately minimal environment, without frameworks or any other dependencies.
<!-- demo url coming soon -->


## Documentation
Detailed documentation of the HSON syntax, transformer behavior, and LiveTree API is available in /src/docs.


```
               .x+=:.                                            ..    .       _                    
  .uef^"      z`    ^%                                     x .d88"    @88>    u                     
:d88E            .   <k        u.      u.    u.             5888R     %8P    88Nu.   u.             
`888E          .@8Ned8"  ...ue888b   x@88k u@88c.           '888R      .    '88888.o888c      .u    
 888E .z8k   .@^%8888"   888R Y888r ^"8888""8888"            888R    .@88u   ^8888  8888   ud8888.  
 888E~?888L x88:  `)8b.  888R I888>   8888  888R             888R   ''888E`   8888  8888 :888'8888. 
 888E  888E 8888N=*8888  888R I888>   8888  888R             888R     888E    8888  8888 d888 '88%" 
 888E  888E  %8"    R88  888R I888>   8888  888R             888R     888E    8888  8888 8888.+"    
 888E  888E   @8Wou 9%  u8888cJ888    8888  888R  88888888   888R     888E   .8888b.888P 8888L      
 888E  888E .888888P`    "*888*P"    "*88*" 8888" 88888888  .888B .   888&    ^Y8888*""  '8888c. .+ 
m888N= 888> `   ^"F        'Y"         ""   'Y"             ^*888%    R888"     `Y"       "88888%   
 `Y"   888                                                    "%       ""                   "YP'    
      J88"                                                                                          
      @%                                                                                            
    :"                      Hypertext-Structured Object Notation 
                                          2.0                                                                        
```
