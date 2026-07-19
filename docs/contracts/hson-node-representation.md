# HsonNode compact representation

HSON 3.0 stores only `$_tag` and `$_content` on a node with no attributes or
metadata. `$_content` remains required. `$_attrs` and `$_meta` are optional
storage containers whose absence means the same thing as an empty plain object;
canonical construction and mutation prefer absence.

## Construction and mutation rules

- `CREATE_NODE()` omits an optional container when it is absent or has no own
  enumerable entries. Populated input containers retain their existing shallow
  ownership behavior.
- Attribute, form, style, and metadata writers create a container immediately
  before the first real write.
- Attribute, style, LiveMap-node, and QUID deletion paths delete the container
  property after removing its final entry.
- Reads use optional access and never call the write-side materialization
  helpers.
- Cloning copies only populated containers. LiveTree identity reminting may then
  create populated QUID metadata on the clone.
- An explicitly authored `style` attribute may retain `$_attrs.style = {}` as a
  semantic attribute entry for wire round trips; deleting the style through a
  mutation API removes that entry and then prunes `$_attrs` when otherwise empty.

The unsafe handle exposed through `map.debug.node(path)` retains the existing
`LiveMapNodeHandle.attrs()` behavior: it returns one shared frozen empty
read-only view when the resolved node has no stored attrs; a missing node still
returns `undefined`. The view is not installed on the node.

The internal parser staging helpers `split_attrs_meta()` and
`parse_html_attrs()` still use mutable empty accumulators while parsing. Those
objects are not installed on a node unless populated. Serializer helpers may
also create ephemeral empty output maps; no public node API materializes an
empty storage container for inspection.

## Construction-path audit

- Canonical factory: changed to emit one of the four exact shapes: required
  fields only, attrs only, metadata only, or both.
- HSON token, JSON, and HTML parsers: obsolete explicit empty metadata arguments
  were removed; populated parser accumulators remain deliberate.
- SVG DOM conversion: migrated its two direct node literals to `CREATE_NODE()`.
- Root/object unwrap helpers and form VSN construction: removed explicit empty
  bags.
- LiveTree detached creation and LiveMap JSON construction already used the
  canonical factory; their populated SVG attrs and array-index metadata remain
  intentional.
- LiveMap cloning/overwrite and LiveTree branch cloning now remove absent or
  empty optional storage instead of copying placeholders.
- The diagnostics `_bad` node literal remains an intentional failure sentinel.
- Demo render constants remain serialized application fixtures with populated
  attributes. Lifecycle and representation tests retain a few direct literals
  specifically to exercise malformed or explicitly empty compatibility shapes.

## Invariants

Invariant validation accepts absent containers and empty plain-object
containers. It rejects non-plain node objects, missing/non-array `$_content`,
array/null/class-instance containers, malformed attribute or metadata values,
illegal metadata keys, legacy `$_meta.attrs`/`flags`, and populated attrs on VSN
nodes.

## Measurements

The benchmark uses fresh processes, six forced collections before and after
construction, and the median of five runs. The pre-change build was exported
from the same Git index and compiled with the same dependencies. Projection
uses the same JSDOM fixture and bundled Node runtime for both builds.

| Retained scenario | Before | After | Own props before → after | Serialized bytes before → after |
| --- | ---: | ---: | ---: | ---: |
| 1,000 simple nodes | 282,304 B | 157,248 B | 4 → 2 | 55 → 30 |
| 100,000 simple nodes | 20,877,072 B | 8,081,064 B | 4 → 2 | 55 → 30 |
| 1,000 nodes with attrs | 283,448 B | 263,264 B | 4 → 3 | 65 → 53 |
| 1,000 nodes with metadata | 284,096 B | 221,616 B | 4 → 3 | 67 → 54 |
| 1,000 nodes with both | 283,728 B | 286,552 B | 4 → 4 | 77 → 77 |
| 100 parse-heavy fixtures | 12,827,584 B | 5,789,216 B | root 4 → 2 | 2,894 → 2,894 |
| 100 LiveTree projections | 19,389,160 B | 18,232,808 B | root 4 → 3 | 988 → 988 |

Nodes that genuinely need both containers have no expected representation
reduction; the measured retained-heap delta for that cell was approximately 1%
and is treated as neutral. Projection roots retain metadata because LiveTree
persists their QUID, but omit the otherwise empty attrs bag.

Median construction times in milliseconds were: simple 1,000 `0.136 → 0.207`,
simple 100,000 `160.40 → 15.00`, attrs `0.984 → 0.590`, metadata
`0.183 → 0.336`, both `0.253 → 0.500`, parse-heavy `257.49 → 86.10`, and
projection `66.67 → 67.44`. Sub-millisecond cells and the bimodal 100,000-node
baseline are sensitive to JIT/process scheduling; retained shape and heap are
the representation claims, not those micro-timings.

Run after `npm run build`:

```sh
node --expose-gc benchmarks/hson-node-representation.mjs 1000 simple
node --expose-gc benchmarks/hson-node-representation.mjs 100 parse
```

The projection harness lives in `hson-demo2/benchmarks` because JSDOM is a demo
test dependency rather than an hson-live runtime dependency.
