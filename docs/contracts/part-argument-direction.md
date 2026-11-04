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
For Data receivers, non-string arguments enter through exact Data admission and
are serialized by `.write()`; existing serialized strings retain their composition
validation timing. Document receivers require serialized strings. Ordinary
parameters retain scalar transport regardless of the supplied value's shape.

On invocations, `for:` and `per:` are reserved iterator prefixes and take
precedence over outgoing type suffixes. Thus `for:data=^{blocks}` declares an
array iterator whose value alias is `data`; `per:doc=^{settings}` declares an
object iterator whose key alias is `doc`. They cannot send structured arguments
named `for` or `per`. A structured receiving declaration using `%{for}` or
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

Scalar parameters remain unprefixed, with existing direct `%{...}` substitution.
This change adds no scalar declarations, expression evaluation, new argument
kinds, binding/shadowing rules, or optionality rules. `part:optional`, `for:each`,
`per:entry`, inherited and qualified selectors, dynamic selection, structural
Document insertion, immutable Parts, complete Documents, occurrence identity,
CSS scope, Scout delivery, and Echo synchronization retain their existing
contracts.

VS Code completion emits the outgoing suffix syntax. Navigation and local
reference coloring target the receiving name after the colon; the existing
receiving/sending palette follows argument names, with kind segments retaining
the qualifier color. Static diagnostics use the shared grammar and contract.
