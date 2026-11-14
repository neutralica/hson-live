# Directional Part arguments

Receiving declarations on a governed Part definition root use `type:local`:

```hson
<section hson:part data:blocks=%{incomingBlocks} doc:nav=%{incomingNav}
  <p title=^{blocks.title}/>
  <hson-part ^{nav}/>
/>
```

`data:blocks` introduces the local `blocks`; `doc:nav` introduces `nav`.
The incoming interface names are `incomingBlocks` and `incomingNav`. Locals
use `^{...}` and incoming references retain the existing `%{...}` rules.
Same-name bindings use `data:blocks=%{blocks}` and `doc:nav=%{nav}`.

Outgoing structured arguments on a Part invocation use `parameter:type`:

```hson
<hson-part at=components/column
  incomingBlocks:data=^{slide.blocks}
  incomingNav:doc=^{nav}
/>
```

The names before the colon select the receiving interface's parameters. Sending
does not bind names in the caller. Literal structured arguments retain serialized
Data/Document string transport; local forwarding retains its declared kind.
`.write({ incomingBlocks, incomingNav })` accepts the same plain argument record
and emits `incomingBlocks:data` and `incomingNav:doc` from the receiving contract.
For Data receivers, supported JavaScript values and authenticated carriers enter through exact Data admission and are serialized by `.write()`. Ordinary strings are literal Data; serialized JSON/Hson requires `Hson.data.fromSource()` before writing. Authored `name:data="..."` attributes remain encoded-source transport. Document receivers require serialized strings. Ordinary
parameters retain scalar transport regardless of the supplied value's shape.

On invocations, `for:` and `per:` are reserved iterator prefixes and take
precedence over outgoing type suffixes. Thus `for:data=^{blocks}` declares an
array iterator whose value alias is `data`; `per:doc=^{settings}` declares an
object iterator whose key alias is `doc`. They cannot send qualified arguments
named `for` or `per`. A qualified receiving declaration using `%{for}` or
`%{per}`, including an optional reference, rejects at contract admission with
guidance to rename the incoming parameter. Local bindings may still be named
`for` or `per`, and bare `for` / `per` retain ordinary scalar argument behavior.
`lib` and `at` are selectors on actual invocations; ordinary element attributes
and receiving local names do not become selectors.

Recognized structured arguments such as `one:data`, `only:data`, and `onload:doc`
are Part arguments, including when they forward a local reference. They are not
HTML event-handler attributes. Actual HTML handler placeholders and unsupported
scalar placeholder interpolation retain their existing restrictions.

This intentionally reverses the former directional grammar. A governed definition
using `blocks:data=%{incomingBlocks}` rejects with `type:local` migration guidance.
An invocation using `data:incomingBlocks=...` rejects with `parameter:type`
guidance. There are no compatibility aliases. Overlapping spellings such as
`data:data`, `data:doc`, and `doc:data` follow the new positional rules; source
migration must review them contextually because their spelling alone cannot
identify former intent. Name/kind contract checks still apply. Ordinary HTML
attributes outside governed Part contexts retain their spelling and values.

Explicit scalar declarations use the same direction:

```hson
<section hson:part str:heading=%{title} num:total=%{count}
  <h2 "^{heading}"/>
  <span "Count: ^{total}"/>
/>
```

```hson
<hson-part at=components/card title:str="Hello" count:num="1.25e2"/>
```

A `:str` operand accepts quoted text, a whole reference resolving to a string,
or quoted interpolation of existing primitive values. A whole reference keeps
its type; use mixed text explicitly if the desired result is text. To author
literal placeholder-looking text in `:str`, escape its opening sigil using
the usual Hson string escape (for example, `"\u0025{title}"`). A string passed
to `.write()` is literal, including any placeholder-looking characters.
JavaScript template substitutions cannot form Part references across a
substitution boundary. Author the full reference in a single literal fragment.

A `:num` operand accepts a quoted JSON number or a whole reference resolving
to a finite JavaScript number. Fraction and exponent spellings are supported;
negative zero survives binding and forwarding and displays as `0` in text.
Partial interpolation, nonfinite values, and strings obtained through lookups
do not qualify as numbers. Ordinary literal attributes still require quotes.
`.write({ title: "Hello", count: 125 })` checks the JavaScript types and emits
the matching qualifiers. A trailing `?` on the receiving reference allows the
argument to be absent; supplied values must still pass their type check.

A typed scalar receiving input may also be read through a whole incoming
`%{name}` reference in the Part body. The declared local remains available
through `^{local}`. Structured Data and Document forwarding retain their
established representation rules. Receiving declarations use a recognized
qualifier prefix. Ordinary namespaced attributes such as `hx:label=%{label}`
can still use scalar substitution. On an `hson-part` connector, an unknown
argument suffix is an error.

The remaining unqualified scalar surface is an outgoing `name=value`, an
implicit `%{name}` input without a receiving declaration, and the matching
`.write({ name: value })` path. Existing primitive handling (including boolean
and null values where formerly admitted, and string transport from ordinary
authored attributes or unqualified writes), optional uses, and interpolation
remain in place. The unqualified surface is pending a separate language decision.
A shared argument vocabulary for Events and Queries is outside this milestone.

VS Code completion emits the outgoing suffix syntax. Navigation and local
reference coloring target the receiving name after the colon; the existing
receiving/sending palette follows argument names, with kind segments retaining
the qualifier color. Static diagnostics use the shared grammar and contract.
