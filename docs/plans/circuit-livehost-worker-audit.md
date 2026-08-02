# HSON diagnostic circuit and LiveHost worker audit

Status: read-only architecture and efficiency audit; no implementation is included.

Audit basis:

- `hson-live` working tree at `153a1f6f7b12cb2ae1735d2c653753c4d60af9cd` plus the pre-existing uncommitted changes present during the audit.
- `hson-demo2` working tree at `4fad6594af3b7f5931b26e83ce1de2b2e3f216b7` plus the pre-existing uncommitted changes present during the audit.
- Both repositories were already dirty. This report treats the checked-out working trees—not only `HEAD`—as authoritative and does not modify or normalize any pre-existing change.

## 1. Executive conclusion

The current diagnostic circuit is useful as a legacy, browser-oriented stress rig, but it is not a sufficiently strict or efficient certification engine for the parsing panel.

The two most important conclusions are:

1. `_circuit_test` does more work than its three-format ring description suggests: a successful default dual, three-lap run performs **24 serializations, 26 canonical parser invocations, and 25 graph comparisons**, before auto-detection overhead. Several of those operations are redundant or can be made cheaper without weakening coverage.
2. The parsing-panel MVP does **not** require a generic LiveHost worker abstraction or a protocol redesign. Existing typed asynchronous actions, results, request identity, deduplication, transient events, and Node hosting are enough. The demo application should initially own a small persistent `worker_threads` executor, task decoder, bounded queue, supersession, timeout, and stale-result fencing. A browser-side final HTML admission check should remain on the main thread because normal Web Workers do not provide `DOMParser`.

The recommended certificate is deliberately narrow:

> The explicit-source universal circuit is stable under strict canonical comparison, and the browser HTML boundary agrees with the universal result for the checked source revision.

It should not claim that the legacy circuit proves all browser and universal parser behavior equivalent. The legacy circuit imports the complete browser `hson` facade, whose HTML constructor uses the browser pipeline, while the worker-safe `hson-live/transform` subpath uses the DOM-free `htmlparser2` pipeline. Those are separate mechanisms with an intended common canonical contract, and the certificate must test that boundary rather than assume it ([circuit import and SPIN](../../src/diagnostics/test-circuit.ts#L17-L55), [browser facade wiring](../../src/hson.ts#L37-L64), [DOM-free facade](../../src/api/transform/transform.facade.ts#L19-L45), [universal HTML parser dependency](../../src/api/transform/parsers/parse-html-string.ts#L1-L3)).

### Recommendation at a glance

| Decision | Recommendation |
|---|---|
| Reuse `_circuit_test` unchanged in the worker | No. Preserve it as a compatibility wrapper, but build a small internal strict step engine. |
| Use `hson-live/transform` in the Node worker | Yes. It is the canonical DOM-free public boundary and already has a worker-oriented entrypoint check ([package exports](../../package.json#L29-L32), [worker check script](../../package.json#L82-L84)). |
| Add a generic worker API to LiveHost now | No. Keep worker execution application-owned until a second real consumer establishes a common contract. |
| Add protocol-level action cancellation now | No for MVP. Use application-level supersession, queue cancellation, cooperative cancellation between circuit legs, timeouts, and client revision fencing. Revisit wire cancellation only with explicit cross-application semantics. |
| Run the entire circuit in the browser main thread | No. Immediate preview stays synchronous; exhaustive work moves to the Node worker. |
| Trust only the Node universal HTML parser | No. Add a final browser HTML admission/strict comparison on the main thread. |

## 2. Audited surface and current call graph

### Public entry points and primary callers

`_circuit_test` and `_compare_nodes` are exported through `hson-live/diagnostics`, not the package root ([diagnostics index](../../src/diagnostics/index.ts#L1-L9), [package export](../../package.json#L61-L64)). Inside `hson-live`, `compare_nodes` is called by the circuit and the separate format test ([format-test caller](../../src/diagnostics/test-format.ts#L85-L101)); the source/reference inventory found no dedicated `hson-live` acceptance caller for `_circuit_test` beyond its export. The demo's transform suite is its substantive test consumer and calls it with explicit direction options, three laps, capture, and verbose diagnostics ([suite builder](../../../hson-demo2/tests/suites/transform/make-transform-suite.ts#L10-L97)); its deterministic hosted-suite registry installs JSON, HTML, HSON, extra, and expected-failure fixture families ([registry](../../../hson-demo2/tests/harness/hosted/deterministic-transform-test-suites.ts#L18-L33)). The generated diagnostic and hosted DOM runners execute that registry ([generated runner](../../../hson-demo2/tests/runners/diagnostics/run-generated-json.node.mts#L1-L25), [hosted compatibility runner](../../../hson-demo2/tests/runners/livehost/run-hosted-dom-compatibility.node.mts#L1-L30)). Hosted runners provide DOM globals around circuit execution, which is necessary for the current browser HTML path.

The current parsing panel does not call the circuit. It parses the selected source once, immediately serializes the other representations, and updates on every input event without a debounce or off-main-thread boundary ([panel update path](../../../hson-demo2/src/app/demos/parse/init-pp.ts#L306-L378), [input listeners](../../../hson-demo2/src/app/demos/parse/init-pp.ts#L427-L433)). That explains why the panel can presently show a successful preview without proving reparse closure.

### Current circuit call graph

```text
_circuit_test(atom, opts)
  -> allocate trace/failures/artifacts/marks
  -> resolve_entry(atom, opts.entry ?? "auto")
       explicit -> coerce_entry
       auto     -> source-shape probes and sometimes a parser probe
  -> runRing(resolved format/text, "cw", times)
       -> safe_parse(entry)
       -> for each lap
            -> for each of 3 rotated formats
                 -> safe_emit(format)
                      -> SPIN[format].emit
                 -> safe_parse(format)
                      -> SPIN[format].parse
                      -> assert_invariants
                 -> compare_nodes(previous, parsed)
            -> safe_emit(entry)                 [closure]
            -> safe_parse(entry)                [closure]
            -> compare_nodes(previous, closure) [closure]
  -> runRing(..., "ccw", times)                 [when dual]
  -> compare_nodes(cw.finalNode, ccw.finalNode)  [when dual]
  -> optional paranoid checkpoint comparisons
  -> finalize report
```

The source for this graph is concentrated in [`test-circuit.ts`](../../src/diagnostics/test-circuit.ts#L58-L278) and [`diagnostics-helpers.ts`](../../src/diagnostics/diagnostics-helpers.ts#L12-L153).

### Format mechanisms used by SPIN

| Format | Emit | Parse | Environment implication |
|---|---|---|---|
| JSON | `hson.fromNode(...).toJson().serialize()` | `hson.fromJson(...).toNode()`, then detach parser carrier | Uses the common Transform facade for JSON. |
| HTML | `hson.fromNode(...).toHtml().serialize()` | `hson.fromTrustedHtml(...).toNode()`, then detach and normalize transport carrier | Uses the complete browser facade. The facade's trusted HTML function is supplied by `transform.browser`, not the DOM-free `/transform` subpath ([browser import](../../src/hson.ts#L1-L5), [browser constructors](../../src/api/transform/transform.browser.ts#L6-L20), [browser parser's `DOMParser`](../../src/api/transform/parsers/parse-html.ts#L105-L145)). |
| HSON | `hson.fromNode(...).toHson().serialize()` | `hson.fromHson(...).toNode()` | Uses the common HSON parser/serializer. |

The browser constructor eventually uses the DOM-based external HTML path; the universal constructor calls `parse_html_string`, which imports `htmlparser2` and performs its own invariant admission ([universal implementation](../../src/api/transform/transform.universal.ts#L80-L107), [universal parser](../../src/api/transform/parsers/parse-html-string.ts#L1-L39)). Therefore, “the current circuit runs in Node” is only true when a DOM host such as jsdom has first installed browser globals. It is not a worker-neutral circuit.

### Transform work hidden under each emit

Every `SPIN` emit starts at public `fromNode`. The universal implementation normalizes, scans QUIDs, checks invariants, and eagerly computes `JSON.stringify(node)` for the frame even when the requested output is HSON or HTML ([`transform_from_node`](../../src/api/transform/transform.universal.ts#L65-L77)). JSON output then eagerly builds a projected JSON value, while terminal text serialization walks the canonical graph again to retain property sequence ([output construction](../../src/api/transform/constructors/construct-output-2.ts#L59-L78), [JSON render](../../src/api/transform/constructors/construct-render-4.ts#L40-L52)). These costs matter because the circuit repeats them 24 times in a default successful run.

## 3. Exact operation graph and default count

### Entry resolution

| Requested entry | Current resolution |
|---|---|
| `json` | A string is retained verbatim; any other accepted atom is `JSON.stringify`-ed and labeled JSON. Validation waits for `runRing` entry admission. |
| `html` | A string is retained verbatim; an `HTMLElement` contributes `outerHTML`; other values fail resolution. |
| `hson` | Only a string is accepted; other values fail resolution. |
| `node` | Requires an `HsonNode`, serializes it once to HSON, and runs the ring as HSON entry. |
| `dom` | Requires an `HTMLElement`, reads `outerHTML`, and runs the ring as HTML entry. |
| `auto` | Node → emitted HSON; element → `outerHTML`; non-string JS → `JSON.stringify`; string → JSON shape/native validation first, closing-tag HTML next, then HSON-first/HTML-fallback for other markup. |

The explicit coercions are implemented in [`coerce_entry`](../../src/diagnostics/diagnostics-helpers.ts#L12-L54); auto behavior is in [`resolve_entry`](../../src/diagnostics/test-circuit.ts#L329-L438). Explicit JSON coercion can accept values that `JSON.stringify` cannot faithfully transport or can return `undefined` for; that is a legacy `FixtureAtom` boundary, not a worker task schema to copy.

### Requested configuration

For:

```text
entry = hson
dual = true
times = 3
verbose = false
capture = false
paranoid = false
stopOnFirstFail = true
```

explicit entry resolution does not parse. On the successful path, the exact graph is:

```text
CW path = [hson, json, html]
  parse entry hson
  lap 0: hson emit/parse/compare -> json emit/parse/compare -> html emit/parse/compare
         -> hson closure emit/parse/compare
  lap 1: hson emit/parse/compare -> json emit/parse/compare -> html emit/parse/compare
         -> hson closure emit/parse/compare
  lap 2: hson emit/parse/compare -> json emit/parse/compare -> html emit/parse/compare
         -> hson closure emit/parse/compare

CCW path = [hson, html, json]
  parse entry hson
  lap 0: hson emit/parse/compare -> html emit/parse/compare -> json emit/parse/compare
         -> hson closure emit/parse/compare
  lap 1: hson emit/parse/compare -> html emit/parse/compare -> json emit/parse/compare
         -> hson closure emit/parse/compare
  lap 2: hson emit/parse/compare -> html emit/parse/compare -> json emit/parse/compare
         -> hson closure emit/parse/compare

final: compare CW final node with CCW final node
```

`runRing` rotates a fixed directional ring to the entry format and performs all three format legs plus an additional entry-format closure each lap ([ring selection and loop](../../src/diagnostics/test-circuit.ts#L71-L121), [closure](../../src/diagnostics/test-circuit.ts#L123-L140)). The top level invokes both directions unconditionally in dual mode and performs the final comparison ([dual execution](../../src/diagnostics/test-circuit.ts#L202-L229)).

### Successful-path totals

| Scope | Serializations | Canonical parser invocations | Graph comparisons |
|---|---:|---:|---:|
| One direction, entry admission | 0 | 1 | 0 |
| One direction, three laps × three format legs | 9 | 9 | 9 |
| One direction, three closures | 3 | 3 | 3 |
| One direction total | 12 | 13 | 12 |
| Two directions | 24 | 26 | 24 |
| Final CW/CCW comparison | 0 | 0 | 1 |
| **Grand total** | **24** | **26** | **25** |

For HSON entry, the two directions together perform 12 HSON serializations and 14 HSON parses (the latter includes two entry admissions), plus six serializations and six parses for each of JSON and HTML.

The returned final text is the last closure text, and the returned final node is already the parse of that closure. There is no additional hidden “final reparse” after `runRing`; the required final reparses are the three per-direction closure parses ([closure assignment](../../src/diagnostics/test-circuit.ts#L123-L145)).

These totals are maxima for the successful path. A **main-leg** emit or parse exception stops that direction. A closure emit/parse exception only records failure and skips the dependent closure work; the loop continues into later laps because the closure branch has no failure return. With `stopOnFirstFail: true`, a main-leg or closure comparison failure stops that direction. Dual mode still starts CCW after CW has failed and still performs the final CW/CCW comparison, because the two calls are unconditional ([main-leg failure exits](../../src/diagnostics/test-circuit.ts#L89-L114), [closure control flow](../../src/diagnostics/test-circuit.ts#L123-L140), [dual calls](../../src/diagnostics/test-circuit.ts#L220-L229)). A modern engine should define whether “stop first” is direction-local or run-global; for an interactive certificate it should be run-global.

### Entry-specific rotated paths

| Explicit entry | CW path | CCW path |
|---|---|---|
| JSON | `json → html → hson` | `json → hson → html` |
| HTML | `html → hson → json` | `html → json → hson` |
| HSON | `hson → json → html` | `hson → html → json` |

All have the same base counts. The HTML legs in this legacy implementation are browser-facade legs, regardless of the entry format.

### Actual no-options defaults and auto-detection overhead

The implementation defaults are `dual=true`, `times=3`, `entry="auto"`, and **`stopOnFirstFail=false`** ([defaults](../../src/diagnostics/test-circuit.ts#L168-L181)). The `LoopOpts` type comment says the stop default is true, so documentation and runtime disagree ([diagnostic types](../../src/types/diagnostics.types.ts#L90-L113)). Runtime behavior is authoritative for compatibility.

There is no single no-options parser/serialization total until the input atom resolves, because `entry:auto` performs input-class-dependent probes or coercion. The ring base is always 24 serializations, 26 canonical parses, and 25 comparisons on success; the following table gives the exact resolution delta.

Starting from the 24/26/25 base, successful auto resolution adds:

| Auto input | Extra work before the ring | Effective parser-attempt total |
|---|---|---:|
| Valid JSON string | Native `JSON.parse`, then one `SPIN.json.parse` and invariant check | 27 canonical + 1 native JSON parse |
| HSON-like string accepted as HSON | One `SPIN.hson.parse` and invariant check | 27 canonical |
| HTML containing `</` accepted as HTML | One `SPIN.html.parse` and invariant check | 27 canonical |
| Markup where HSON probe fails and HTML fallback succeeds | One failed HSON parser attempt, then one HTML parse | 28 canonical attempts |
| `HsonNode` | One HSON serialization to establish entry text | 25 serializations |
| `HTMLElement` | An `outerHTML` read | Base parser count |
| Other JSON-like JS value | One `JSON.stringify` | Base parser count |

The ordering is JSON first, closing-tag HTML next, then HSON before HTML for other markup ([shape tests](../../src/diagnostics/test-circuit.ts#L284-L327), [resolution](../../src/diagnostics/test-circuit.ts#L329-L438)). Explicit-source UI jobs should never pay or depend on this heuristic.

Even with `verbose=false`, `_circuit_test` pushes one forced debug trace entry by calling `step_ok` with a separate `{verbose:true}` options object ([forced trace](../../src/diagnostics/test-circuit.ts#L168-L176)). Therefore a “quiet” successful report still owns a trace array and exposes a trace item.

### Exact option effects

| Option | Actual current meaning |
|---|---|
| `dual` | Defaults true. Runs a complete CW ring and a complete CCW ring from separately parsed entry text, then compares their final nodes. With false, `dir` selects one direction and defaults CW. |
| `times` | Defaults 3 and is truncated/clamped to 1…10,000. Each “lap” is three rotated format emit/parse/compare legs **plus** a fourth entry-format closure emit/parse/compare ([clamp](../../src/diagnostics/diagnostics-helpers.ts#L155-L160)). |
| `paranoid` | Records entry admission, every main-leg parse, and every closure parse for both directions, then compares marks sharing `(lap, format, phase)`. For the requested successful run this retains 26 node marks and attempts 12 extra cross-direction comparisons; the entry/lap-0 key collision prevents a distinct entry comparison. It does not replace normal leg or final comparisons. |
| `capture` | Stores two artifacts for every main format leg: one immediately after emit (text + pretty `JSON.stringify` of the pre-parse graph) and one after parse (the same text + `make_string` of the parsed graph). It does not capture entry or closure operations, and the artifact schema does not retain direction. The requested three-lap dual run therefore retains 36 artifact records ([emit capture](../../src/diagnostics/diagnostics-helpers.ts#L55-L78), [parse-side capture](../../src/diagnostics/test-circuit.ts#L94-L107)). |
| `verbose` | Controls successful trace construction in helpers; failures are always retained separately. A successful three-lap dual run with `verbose:true`, no paranoid mode, creates 88 trace steps: one forced debug step, 43 per direction, and one final dual step. With false it still creates the one forced debug step. |
| `stopOnFirstFail` | Runtime default is false. True stops a direction at its first graph mismatch. Main-leg emit/parse exceptions stop that direction regardless, but closure emit/parse exceptions continue to later laps. It does not prevent CCW after CW failure, nor the final dual comparison. In paranoid checking, the expression separately defaults to true and stops only the paranoid-key loop after a mismatch; missing marks continue ([paranoid loop](../../src/diagnostics/test-circuit.ts#L231-L256)). |

`capture` and `verbose` do not remove validation. `paranoid` only adds cross-direction checks and retention. The incomplete validation risks come from comparator semantics, checkpoint-key collision, environment coverage, and direction-local failure handling—not from capture being disabled.

## 4. Correctness audit

### What the circuit genuinely establishes

On a successful leg, the implementation establishes that:

1. the current canonical graph could be serialized through the selected public facade;
2. the emitted text could be parsed by that facade's selected parser;
3. the resulting graph passed `assert_invariants`; and
4. `compare_nodes` considered the previous and parsed graphs equivalent.

The per-lap closure additionally proves that the graph can return to the entry representation and be parsed again. Dual mode probes path dependence by changing the order of JSON/HTML/HSON transitions and comparing final graphs ([circuit contract](../../src/diagnostics/test-circuit.ts#L152-L160), [final comparison](../../src/diagnostics/test-circuit.ts#L223-L229)). These are valuable properties. The weaknesses are in the equality definition, environment selection, failure policy, and reporting—not in the basic idea of repeated source-sensitive closure.

### False-success risks

| Risk | Why the legacy circuit may pass incorrectly | Evidence / correction |
|---|---|---|
| Object property order | Object children are inserted into `Map<string,HsonNode>` and compared by key, so order is ignored. | [`compareChildrenByKeyForObj`](../../src/diagnostics/compare-nodes.test.ts#L86-L107). The strict canonical comparator detects content ordering ([strict array comparison](../../src/core/canonical-hson-equal.ts#L100-L132)). |
| Duplicate property names | Repeated tags overwrite earlier entries in those maps, so duplicate count/value changes can disappear in an already-constructed graph. | Same map construction at [lines 93–96](../../src/diagnostics/compare-nodes.test.ts#L93-L96). Current ordered JSON admission tracks order and duplicate identity so duplicates can be rejected; certification must not weaken that contract ([worker acceptance](../../tests/transform-worker.acceptance.mts#L79-L95)). |
| Metadata and QUIDs | `compare` checks tags, attrs, and semantic children but never `$_meta`. | [`compare`](../../src/diagnostics/compare-nodes.test.ts#L154-L179). The strict comparator has metadata, QUID, and array-index difference kinds and checks metadata presence/value ([difference kinds](../../src/core/canonical-hson-equal.ts#L4-L20), [metadata comparison](../../src/core/canonical-hson-equal.ts#L201-L227)). |
| `-0` versus `0` | Leaf and primitive comparison uses `===`; JavaScript considers the two equal. | [leaf equality](../../src/diagnostics/compare-nodes.test.ts#L41-L69), [plain primitive equality](../../src/diagnostics/compare-nodes.test.ts#L192-L210). The strict comparator uses `Object.is` and reports `negative-zero-mismatch` ([strict scalar comparison](../../src/core/canonical-hson-equal.ts#L230-L247)). |
| CR/LF changes outside HTML | The circuit calls `compare_nodes(a,b,false)` without options, so the comparator's default `allow_html_newline_norm:true` applies to JSON and HSON legs too. | [comparator default](../../src/diagnostics/compare-nodes.test.ts#L310-L321), [circuit call](../../src/diagnostics/test-circuit.ts#L109-L116). A strict certificate should do no comparison-time normalization. |
| Structural-mode drift | Trivial `_hson_elem` wrappers and a sole element child are treated as semantically transparent. This can hide representation changes that the current canonical contract classifies as structural-mode differences. | [wrapper helpers](../../src/diagnostics/compare-nodes.test.ts#L25-L39), [use in comparison](../../src/diagnostics/compare-nodes.test.ts#L154-L175), [strict structural mode](../../src/core/canonical-hson-equal.ts#L172-L199). |
| Inherited/dangerous keys | Attribute and plain-object presence uses `k in object`, and object-valued attributes are copied into a normal `{}` before stringification. Inherited keys and names such as `__proto__` can make the comparison view diverge from own-field semantics. | [attribute comparison](../../src/diagnostics/compare-nodes.test.ts#L109-L139), [plain objects](../../src/diagnostics/compare-nodes.test.ts#L181-L210). The strict comparator uses `Object.hasOwn` ([strict record comparison](../../src/core/canonical-hson-equal.ts#L135-L169)). |
| Browser/universal conflation | The circuit covers only the browser HTML admission mechanism. A passing result says nothing direct about the DOM-free worker parser. | [SPIN HTML](../../src/diagnostics/test-circuit.ts#L40-L49), [facade distinction](../../src/hson.ts#L37-L64), [universal facade promise](../../src/api/transform/transform.facade.ts#L30-L45). |
| Non-string source admission | A Node input is first serialized to HSON; an element input is first reduced to `outerHTML`. The circuit compares from that derived text baseline, not against the complete original runtime object. | [auto resolution](../../src/diagnostics/test-circuit.ts#L338-L350), [explicit coercion](../../src/diagnostics/diagnostics-helpers.ts#L12-L50). |

The strict comparator already present in core is the correct starting point. It returns the first deterministic difference, preserves order, uses own-field checks, distinguishes negative zero, checks metadata/QUID/index, and explicitly performs no normalization or repair ([strict API contract](../../src/core/canonical-hson-equal.ts#L267-L285)). A new engine should depend on that internal primitive. It should not broaden the public diagnostics surface merely to reuse it.

### False-failure and ambiguity risks

1. **Wrapper collapse is internally inconsistent.** The comparator records a tag mismatch before collapsing a trivial element wrapper, so a pair documented as semantically equivalent can still retain a failure ([tag check and collapse order](../../src/diagnostics/compare-nodes.test.ts#L154-L165), [documented equivalence](../../src/diagnostics/compare-nodes.test.ts#L219-L237)).
2. **DOM host behavior is part of the result.** Browser engines and jsdom can differ in HTML recovery, case handling, whitespace, and malformed markup. The legacy circuit has no environment identity in its certificate and no universal/browser cross-check.
3. **Auto mode is intentionally heuristic.** Closing tags force HTML; other markup tries HSON first and HTML second. Valid-looking but ambiguous source can be assigned a mode the author did not intend ([auto resolution](../../src/diagnostics/test-circuit.ts#L352-L430)). The panel already knows its selected editor and should send that explicit format.
4. **Stop behavior is inconsistent.** The core default is false, paranoid checking separately defaults its stop expression to true, and dual mode does not stop globally ([core default](../../src/diagnostics/test-circuit.ts#L168-L178), [paranoid stop](../../src/diagnostics/test-circuit.ts#L231-L256)).
5. **Paranoid checkpoint identity collides.** Entry admission is recorded as lap `0`, entry format, phase `parse`; the first same-format leg in lap 0 uses the same key. Map construction keeps only the later node ([entry mark and leg mark](../../src/diagnostics/test-circuit.ts#L65-L66), [checkpoint map](../../src/diagnostics/test-circuit.ts#L231-L249)).

### Unicode, negative zero, ordering, and mode policy

- Isolated surrogate code units and control strings must travel in explicitly escaped transport fields, never as assumed well-formed HTML text. The HTML serializer has a dedicated string transport and the universal parser decodes it; the certificate should include both accepted closure and rejection fixtures rather than normalize strings.
- Negative zero must be represented in LiveHost results by a tagged witness or textual diagnostic, because ordinary JSON encoding of a raw number collapses `-0` to `0`. The result envelope itself may remain normal LiveHost JSON.
- Property ordering and duplicate-name behavior are semantic for current Transform certification. The worker should compare canonical graphs strictly and return a compact first-difference witness plus optional bounded artifacts.
- No equality routine should infer or repair structural mode. Admission/normalization belongs at parser boundaries; comparison only observes.

## 5. Efficiency audit

The table distinguishes necessary source-sensitive work from accidental overhead. “Benefit” is expected relative impact, not a performance promise; it must be measured with the benchmark plan in section 13.

| Current work | Location | Necessary or risky? | Recommended treatment | Expected benefit |
|---|---|---|---|---|
| Parse the same entry independently for CW and CCW | [`runRing` entry](../../src/diagnostics/test-circuit.ts#L58-L69), [dual calls](../../src/diagnostics/test-circuit.ts#L220-L221) | Redundant if parsers and the engine do not mutate the admitted graph. Preparing once changes failure reporting and could permit cross-direction contamination if mutation exists. | New engine: prepare once, freeze or assert non-mutation, and give each direction an immutable baseline. Compatibility wrapper may preserve legacy behavior. | Saves one full parser/invariant pass per dual job. |
| Three format legs **plus** a closure leg per lap | [main loop and closure](../../src/diagnostics/test-circuit.ts#L82-L140) | Source-sensitive closure is necessary; the exact four-step scheduling is not obviously minimal. Closure to entry is followed next lap by another same-entry emit/parse. | Define modern lap semantics explicitly. Preserve the legacy wrapper. Prototype a three-transition cycle with a single end-of-cycle entry assertion, then prove it catches the same fixture failures before adoption. | Potentially removes up to one quarter of recurring emit/parse/compare work. Higher semantic risk than other optimizations. |
| `fromNode` normalization, QUID scan, invariants, and `JSON.stringify` on every emit | [`transform_from_node`](../../src/api/transform/transform.universal.ts#L65-L77) | Public-facade coverage is valuable, but the input-string allocation is unrelated to HSON/HTML output. Bypassing all public logic could hide facade regressions. | First remove or defer unused frame text in Transform itself. If an internal engine uses direct codecs, retain a separate public-facade coverage mode. | Avoids 24 graph stringifications and repeated admission work in the requested successful run. |
| JSON `.toJson()` creates a value projection, then `.serialize()` walks the graph separately | [JSON selection](../../src/api/transform/constructors/construct-output-2.ts#L59-L68), [JSON terminal](../../src/api/transform/constructors/construct-render-4.ts#L40-L50) | The two representations serve different public terminals, but text-only callers should not need both. | Make projection lazy or select a text-only internal terminal while preserving `.value()` behavior. | Removes six unused projections in the requested HSON-entry run. |
| Parser invariant check plus `safe_parse` invariant check | [`safe_parse`](../../src/diagnostics/diagnostics-helpers.ts#L84-L104), [universal parser example](../../src/api/transform/parsers/parse-html-string.ts#L1-L3) | Rechecking after detach/transport normalization can be justified for JSON/HTML. An unchanged HSON result is more clearly redundant. | State an invariant boundary contract per parser. Check only after the final normalization stage, or keep an optional paranoid recheck. | One deep validation walk per parse where safely removed. |
| Comparator constructs all diffs although the circuit reads only `diffs[0]` | [full traversal](../../src/diagnostics/compare-nodes.test.ts#L72-L107), [first-only consumption](../../src/diagnostics/test-circuit.ts#L109-L113) | Not needed for pass/fail or the current report. Full diff lists can help an offline debugger. | Use `canonical_hson_graph_difference` for first deterministic failure; generate bounded expanded diagnostics only on demand. | Stops at first difference and reduces failure-path allocation. |
| Capture stores the emitted text and a graph snapshot in `safe_emit`, then stores the same text and parsed graph again after parse | [pre-parse capture](../../src/diagnostics/diagnostics-helpers.ts#L55-L78), [post-parse capture](../../src/diagnostics/test-circuit.ts#L94-L107) | Both before/after graphs can be useful, but the schema omits direction and duplicates large strings. Closure artifacts are not captured. | New engine: one bounded per-step record with IDs, source hash/length, optional before/after witnesses, and explicit direction/phase. Keep legacy report shape in wrapper. | With `times=3, dual=true, capture=true`, avoids much of 36 artifact records' duplicate payload. |
| Allocate top-level and per-direction arrays even when capture/paranoid are off | [top-level arrays](../../src/diagnostics/test-circuit.ts#L162-L166), [dual arrays](../../src/diagnostics/test-circuit.ts#L202-L218) | Low-risk overhead; usually small compared with parsing. | Allocate lazily only when requested. | Small allocation/GC reduction. |
| Rebuild small diagnostic option objects | Forced debug, final dual reporting, and each paranoid result create short object literals rather than reuse the established core options ([forced debug](../../src/diagnostics/test-circuit.ts#L168-L176), [dual/paranoid reporting](../../src/diagnostics/test-circuit.ts#L223-L255)). | Redundant but tiny. Reusing an object is safe only if no helper mutates it. | In a new engine, pass an immutable reporter once. Do not prioritize this ahead of parser/string/comparator costs. | Very small allocation reduction. |
| Forced debug trace even when quiet | [forced `step_ok`](../../src/diagnostics/test-circuit.ts#L168-L176) | Accidental reporting overhead and contract surprise. | Compatibility decision: either preserve in wrapper or fix as a documented bug; modern engine must be truly quiet. | Small but unambiguous. |
| Auto resolution reparses a source later parsed by each direction | [resolution probes](../../src/diagnostics/test-circuit.ts#L323-L430) | Needed only for heuristic mode selection. | Panel jobs always use explicit source format. Keep auto only in legacy/manual diagnostics. | Saves one or two parser attempts and removes ambiguity. |
| Continue after comparison failures, closure parser failures, and a first-direction failure | [comparison behavior](../../src/diagnostics/test-circuit.ts#L109-L117), [closure behavior](../../src/diagnostics/test-circuit.ts#L123-L140), [dual behavior](../../src/diagnostics/test-circuit.ts#L220-L229) | Useful for exhaustive offline diagnostics only when intentional; `stopOnFirstFail` does not control every failure site. | Interactive engine uses run-global fail-fast by default and an explicit exhaustive mode for debugging. | Large reduction on failing inputs. |
| Retain only `carryText` normally | [carry state](../../src/diagnostics/test-circuit.ts#L80-L81), [updates](../../src/diagnostics/test-circuit.ts#L119-L139) | This is already efficient. | Preserve. Store hashes/snips for other intermediates unless explicitly requested. | Avoids introducing a regression. |

The closure parse itself should **not** be removed simply because the emitted text exists. Serialization success and string equality do not prove that a source-sensitive parser reconstructs the same canonical graph. Optimize scheduling and duplicate admission around the closure, not the last required parse.

The circuit does not accidentally compare detached public JSON values: its carried state remains `HsonNode` throughout. The inefficiency is that the public JSON output builder materializes a projected JavaScript value that the text-only circuit never consumes before the serializer walks the canonical graph again ([JSON builder](../../src/api/transform/constructors/construct-output-2.ts#L59-L68), [JSON serializer](../../src/api/transform/constructors/construct-render-4.ts#L40-L50)).

## 6. Proposed decomposition of the diagnostic circuit

Keep the existing public `_circuit_test` behavior stable unless deliberately versioned. Introduce internal pieces with single responsibilities:

| Internal responsibility | Inputs | Output | Notes |
|---|---|---|---|
| `prepareExplicitSource` | explicit format + source text | admitted immutable baseline, normalized source identity, admission diagnostics | No `auto` in panel jobs. Universal and browser implementations remain distinct. |
| `emitFormat` | canonical graph + format | exact source text + byte count/hash | Directly source-sensitive; no comparison or capture policy. |
| `parseFormat` | format + text + parser implementation identity | canonical graph | Admission owns detach/normalization/invariants exactly once. |
| `compareCanonical` | two canonical graphs | first structured difference or equal | Backed by the existing strict core comparator; no repair. |
| `runDirection` | immutable baseline + ordered formats + lap policy + cancellation probe | direction result and bounded step records | Checks cancellation between synchronous legs. |
| `runDualCircuit` | prepared source + run policy | certificate candidate | Defines run-global failure and CW/CCW comparison. |
| `encodeDiagnosticResult` | internal result | fixed JSON-safe LiveHost envelope | Tags negative zero and other non-JSON witnesses; bounds snippets/artifacts. |
| Legacy adapter | `FixtureAtom`, `LoopOpts` | existing `LoopReport` | Preserves old defaults, report fields, and browser behavior until explicitly migrated. |

The new step engine should be internal to `hson-live` at first. The existing transform oracle is a better structural model than `_circuit_test`: it already separates parsing, strict graph comparison, closure, and cycle execution ([oracle comparison/closure](../../src/_tests/transform-oracle.ts#L192-L214), [oracle cycles](../../src/_tests/transform-oracle.ts#L318-L443)). It does not by itself implement the legacy three-format directional ring, so it should inform the decomposition rather than be reused blindly.

Minimum engine invariants:

- source format is explicit;
- baseline admission happens once per parser implementation;
- every emitted source that matters is reparsed before success;
- comparison is strict and reports first deterministic divergence;
- no compare-time normalization, ordering, wrapper repair, or metadata projection;
- cancellation/supersession is checked between every parser, serializer, and comparator call;
- result size, trace size, source bytes, lap count, and wall time are bounded;
- environment/parser identities are recorded in the certificate;
- a result is tied to source revision and content hash.

### Conceptual immutable shapes and retained state

These are design shapes, not proposed public TypeScript names:

| Shape | Immutable contents | Lifetime |
|---|---|---|
| Prepared entry | explicit format, exact source, source hash/byte length, parser/environment identity, admitted canonical baseline, admission source-location metadata | Entire run; shared read-only by directions |
| Run policy | direction(s), lap count/schedule version, fail-fast/exhaustive mode, reporting bounds, cancellation probe, implementation identity | Entire run |
| Leg input | direction, lap/step index, source graph, target format | One leg |
| Leg result | target format, emitted source identity, parsed graph or structured failure, timings, source-location context | Graph advances to next leg; large emitted text may be discarded after hashing/report bounding |
| Direction result | success/failure/superseded state, final graph, final entry-format text identity, operation counts, first failure, bounded step summaries | Until dual comparison/report construction |
| Circuit result | version/identities, source revision/hash, directional outcomes, strict final comparison, counts/timings, bounded diagnostics | Encoded to LiveHost-safe result |

Only the current canonical graph, current source text while it is being parsed, immutable prepared baseline, first failure, counters/timings, and bounded report records must carry between laps. Discard parser carriers, temporary projected JavaScript values, full comparator traversals, and unrequested intermediate text immediately. A failure should be a discriminated result (`parse`, `serialize`, `invariant`, `compare`, `cancelled`, `timeout`, `internal`) with direction/lap/step/format, portable error code, original-source location when available, generated-source location when the failure belongs to an intermediate, and a bounded source witness. Generated offsets must be labeled as generated; they must not be rewritten as original-source coordinates without an explicit source map.

One directional lap can be a pure, synchronous, environment-neutral state transition **if** all format codecs are injected and are non-mutating. The Node worker supplies the universal HTML codec; a browser compatibility wrapper supplies the browser HTML codec. Yield/cancel boundaries occur immediately before and after each synchronous emit, parse, invariant admission, and comparison. The engine cannot preempt inside one of those calls, so the longest individual call defines cooperative cancellation latency. Browser HTML parsing remains an injected boundary capability and must not be imported by the environment-neutral engine.

## 7. LiveHost capability matrix

### Current capabilities

| Capability | Classification | Evidence | Suitability for panel MVP |
|---|---|---|---|
| Asynchronous action execution | Implemented and usable | Action handlers may return `Promise<JsonValue | void>` ([handler types](../../src/types/livehost.types.ts#L900-L932)). | Sufficient. |
| Typed action payload validation | Implemented and usable | Shared options accept action schemas/decoders ([shared options](../../src/types/livehost.types.ts#L946-L962)). | Use a fixed `runParsingCircuit` decoder. |
| JSON-safe action result delivery | Implemented and usable | Ack/error envelopes carry `result`, request/attempt IDs, completion revision, and delivery ([message types](../../src/types/livehost.types.ts#L665-L724)); host validates result JSON-safety before success ([execution](../../src/api/livehost/livehost.core.ts#L748-L814)). | Sufficient with an application-owned result decoder/tagged witness codec. |
| Request correlation and retry identities | Implemented and usable | Action messages distinguish action ID, request ID, attempt ID, client ID, and retry ([action message](../../src/types/livehost.types.ts#L553-L582)). | Sufficient; panel revision/job ID remains a domain field. |
| Pending join, terminal dedupe/cache, status query | Implemented and usable | Dedupe options/diagnostics are public ([dedupe types](../../src/types/livehost.types.ts#L1002-L1040)); action execution joins pending duplicates and caches terminal outcomes. | Useful for retry, not a substitute for cancellation or queue policy. |
| Transient progress events | Implemented and usable | Server events carry event name and JSON payload ([event envelope](../../src/types/livehost.types.ts#L652-L656)); action context exposes `emit_event` ([context](../../src/types/livehost.types.ts#L845-L855)). | Sufficient for best-effort live progress. Include revision/request/job IDs because events are not durable outcomes. |
| Connection/session cleanup | Implemented but unsuitable as work cancellation | Session grace, attachment, fencing, and diagnostics exist ([session types](../../src/types/livehost.types.ts#L1042-L1112)); detachment cleans recovery/listeners and detaches subscriptions ([connection teardown](../../src/api/livehost/livehost.core.ts#L1785-L1837)). | Running handlers receive no cancellation signal and can outlive transport detachment. |
| Action lifecycle tracing | Implemented but unsuitable for delegated trace propagation | Shared host options accept a trace sink ([host options](../../src/types/livehost.types.ts#L946-L962)); action execution opens spans and records outcomes ([handler execution](../../src/api/livehost/livehost.core.ts#L748-L814)). | Useful host-side. Handler context has no trace/span field for propagating into a worker. |
| Browser WebSocket adapter | Implemented and usable | Exported as `create_browser_livehost_socket` ([public index](../../src/api/livehost/index.ts#L28-L34)). | Sufficient for the browser client/host connection. |
| Node WebSocket adapter and application host | Implemented and usable | Node entrypoint exports the socket adapter and `start_node_application_host` ([Node index](../../src/api/livehost/node/index.ts#L1-L50)). | Sufficient server host; it does not execute or manage workers. |
| Node transport limits/backpressure | Implemented but unsuitable as worker limits | Node host defines connection, payload, message-rate, heartbeat, and buffered-amount policies ([limit types/defaults](../../src/api/livehost/node/livehost.node-application-host.ts#L90-L181)). | Protects WebSocket resources, not the worker queue or task CPU. |
| Authority activity/idle lifecycle | Implemented but unsuitable as per-session work limits | Host activity kinds include action execution ([activity](../../src/api/livehost/livehost.activity.ts#L8-L66)); the authority registry uses activity and idle state in bounded lifecycle management ([registry](../../src/api/livehost/livehost.authority-registry.ts#L151-L385)). | Helps authority ownership; it is not a per-user job quota. |
| Action cancellation / `AbortSignal` | Absent | Action context contains map, mutate, seq, origin, and event emission only ([context](../../src/types/livehost.types.ts#L845-L855)); the client action message union has no cancel message ([client messages](../../src/types/livehost.types.ts#L553-L632)). | Application-level supersession is required for MVP. |
| Action supersession | Absent | No message/context field or core policy identifies a newer action as replacing an older one. | Application domain key and revision policy. |
| Action deadline/timeout | Absent | No deadline or signal is carried in handler context or action envelope. | Application executor must enforce queue and execution deadlines. |
| Per-session work limits | Absent | Session diagnostics cover transport/subscription lifecycle, not action concurrency/CPU/queue quotas. | Application executor must bound per-panel/client work. |
| Node `worker_threads` spawning/pool | Absent | The environment-neutral and Node public indexes expose no Worker or pool executor ([LiveHost index](../../src/api/livehost/index.ts#L1-L73), [Node index](../../src/api/livehost/node/index.ts#L1-L50)). | Application must own `worker_threads`. |
| Browser Worker adaptation | Documented direction only | Guide discusses worker ports as possible transport adapters, but exports only a browser WebSocket adapter. | Not needed for recommended MVP. |
| Node `MessagePort` adaptation | Documented direction only | Transport-neutral socket shape could be adapted, but no adapter/export exists. | Not worker execution and not needed for MVP. |
| Process IPC adaptation | Documented direction only | Guide names process IPC as a possible adapter; Node exports provide WebSocket/application hosting only. | Defer. |
| Worker crash recovery | Absent | No worker lifecycle exists to observe or replace. | Application pool responsibility. |
| Worker result validation | Implemented but unsuitable as task-schema validation | LiveHost validates generic JSON-safe values, not circuit result versions/fields. | Application result decoder required. |
| Worker queue/backpressure | Absent | Node backpressure is socket buffered-amount policy; there is no task executor surface. | Application responsibility. |
| Structured tracing across delegated work | Implemented but unsuitable | Host tracing correlates action lifecycle and dedupe; no handler trace context or worker adapter carries it onward. | Copy application correlation IDs privately. |
| Reconnectable long-running jobs | Implemented but unsuitable | Pending/terminal dedupe status can be queried, but progress is transient and sessions do not own pending work. | MVP may recover terminal status, but must not promise replayed progress or work ownership. |

The design document itself describes worker ports or process IPC as possible transport adapters, not as implemented worker execution, and separately lists pending action ownership, cancellation, backpressure, and quota as future work ([transport direction](../hson-livehost.md#L184-L201), [session/future-work boundary](../hson-livehost.md#L151-L164)). Implementation is authoritative where that document's roadmap is stale.

LiveHost currently creates or manages **none** of Web Workers, Node `worker_threads`, or child processes. Transport neutrality only means another `LiveHostSocketLike` could be supplied; it neither schedules computation nor grants worker lifecycle semantics.

### Concurrency and teardown implications

The socket listener launches `void handle_message(raw)`, and `handle_message` awaits action execution internally ([message dispatch](../../src/api/livehost/livehost.core.ts#L1663-L1779)). Multiple incoming messages can therefore overlap; LiveHost does not serialize all action handler CPU. A worker executor must own its own bounded queue and must not assume action arrival order equals worker completion order.

On disconnect, the client rejects its local pending action promises ([client disconnect](../../src/api/livehost/livehost.client.ts#L883-L900)), while the host detaches the transport/session subscriptions ([host detach](../../src/api/livehost/livehost.core.ts#L1785-L1837)). A running host handler is not aborted. Dedupe can retain or join its terminal outcome, but no `AbortSignal` reaches application or worker code. Consequently:

- stale-result fencing is mandatory even if application-level cancellation is excellent;
- queued superseded jobs should be removed immediately;
- running jobs should cooperatively stop between circuit legs;
- a hard timeout may terminate and replace a wedged worker;
- action completion after disconnect must be treated as an application policy decision, not an automatic LiveHost guarantee.

## 8. Recommended parsing-panel MVP

### User-visible flow

1. **Immediate preview remains local and synchronous.** On each edit, the panel continues to parse the explicitly selected format with the browser facade and updates the three representations/preview. This preserves responsiveness for ordinary inputs and gives immediate syntax feedback.
2. **Debounce certification.** After a short idle debounce, increment a monotonic panel revision and submit one `runParsingCircuit` LiveHost action containing explicit entry format, source, revision, source hash, bounded lap policy, and result-schema version. Never use `entry:auto`.
3. **Application-owned Node worker.** The `hson-demo2` Node-hosted application routes the action into a persistent worker-thread executor. A pool size of one is a valid first pool: it proves lifecycle, queue, cancellation, and replacement before concurrency tuning. The worker imports `hson-live/transform`, not the browser umbrella.
4. **Universal strict circuit.** The worker performs explicit-source admission and the optimized strict circuit using the internal engine, reporting bounded progress after legs/laps. It returns a JSON-safe certificate candidate, canonical result identity, final emitted HTML boundary source (or a bounded set of distinct HTML boundary sources), and first-difference witness on failure.
5. **Browser boundary check.** For the still-current revision only, the main thread parses the returned HTML boundary through the browser `hson.fromTrustedHtml`, converts it to an exact canonical representation, and compares it with the worker's expected canonical result. For an HTML entry, it also compares the browser's immediate admission baseline with the worker's universal admission baseline.
6. **Publish certificate.** The UI shows success only if the universal circuit succeeds and the browser boundary agrees. Every event/result is ignored unless client ID, request ID, job ID, revision, source hash, and schema version match the current panel state.

The worker-safe Transform surface is already deliberately DOM-free and accepts HTML strings only ([facade contract](../../src/api/transform/transform.facade.ts#L30-L45)). Its acceptance setup compiles a worker entrypoint without DOM library types as part of the package's public-entrypoint check ([check script](../../package.json#L82-L84)). This is the appropriate execution boundary.

### Browser HTML boundary: exact policy

A normal Web Worker has no `DOMParser`, and the Node universal parser is intentionally not a browser DOM parser. Therefore a main-thread browser check is not optional if the UI claims browser fidelity.

Minimum defensible policy:

- Worker returns `expectedCanonicalHson` and `htmlBoundaryText` in a bounded, versioned envelope.
- Browser parses `htmlBoundaryText` through the browser facade and serializes the resulting admitted graph to canonical HSON.
- Browser compares exact canonical HSON text/graph with the worker expectation; it does not use the permissive legacy `_compare_nodes`.
- A stale revision never changes certificate state, even if the browser parse or network reply cannot be cancelled.

Checking only the last HTML boundary is sufficient **only if** the worker proves that all earlier HTML boundary emissions have converged to the same canonical source/result under the strict universal engine. If distinct HTML boundary texts occur across directions/laps, return a bounded list and check each distinct source in the browser. This avoids turning “one convenient final parse” into an unsupported equivalence claim.

### Cancellation and supersession without protocol changes

Use a panel/application domain key such as `(clientId, panelInstanceId)`:

- a newly admitted revision marks older queued jobs superseded and removes them;
- a shared cancellation flag/port lets a running worker observe supersession between synchronous legs;
- superseded actions settle with a typed application result such as `state:"superseded"`, rather than hanging;
- a wall-clock deadline terminates and replaces a non-responsive worker;
- UI fencing remains the final guard, because cancellation races are unavoidable;
- dedupe request IDs remain stable for retries of the same logical revision, while attempt IDs remain transport attempts.

This provides real resource reclamation without adding a LiveHost cancel message whose ownership, authorization, reconnect, dedupe, and terminal-outcome semantics have not yet been designed.

### Result envelope constraints

The action result should contain only bounded JSON values:

- protocol/schema version;
- client/panel/job/revision/request identity;
- explicit entry format, source byte length, and content hash;
- implementation identities (`universal-htmlparser2`, browser-boundary pending/completed, package/version/commit if available);
- counts and timings by parser/serializer/comparator;
- pass/fail/superseded/timed-out/worker-crashed state;
- first structured difference with path/kind;
- tagged primitive witnesses, including negative zero;
- bounded snippets or hashes, never unlimited copies of every intermediate graph/source.

LiveHost's generic JSON validation is the correct transport boundary. The application must additionally decode this task-specific schema before rendering it.

### MVP placement by package/runtime layer

| Layer | MVP ownership |
|---|---|
| `hson-live` core | Internal strict circuit engine, immutable step/result model, strict canonical comparison, universal codec injection points, bounded diagnostic encoding. No worker imports. |
| `hson-live/livehost` | **No new facility required.** Use existing actions, payload schemas, results, IDs/dedupe/status, transient events, sessions, and tracing. |
| `hson-live/livehost/node` | **No new facility required.** Use the existing Node application host and WebSocket adapter. Do not place the first application worker pool here. |
| `hson-demo2` application | Register action/event schemas; own persistent worker pool, queue/coalescing, task/result decoders, deadlines, crash replacement, progress forwarding, and shutdown. |
| Browser panel | Immediate browser preview, explicit format, debounce, revision/source hash, LiveHost request, stale fencing, browser HTML boundary parse/compare, and result/error rendering. |
| Worker module | Import `hson-live/transform`; run strict stepped circuit; check cancellation between legs; produce bounded progress/result envelopes; never import browser DOM APIs. |

State mutation, canonical recovery/history, subscriptions, bootstrap snapshots, persistent authorities, and document mutation are existing LiveHost facilities but are unrelated to worker execution itself. The panel may use ordinary application state around the feature; those facilities should not be cited as reasons to generalize a worker API.

## 9. Ownership table: MVP and long-term boundaries

| Concern | Why existing application code is insufficient | Correct layer now | Wire change? | Public API now? | Minimum semantics | Failure/disposal behavior | Wait for second consumer? |
|---|---|---|---|---|---|---|---|
| Persistent worker lifecycle | No production LiveHost or demo application component currently creates a worker executor. | `hson-demo2` Node application | No | No | Lazy/eager start, ready state, bounded shutdown, replacement | Reject queued jobs on shutdown; terminate stuck worker after grace | **No**—required for MVP, but keep application-private |
| Worker pool sizing | Node host transport limits do not bound task CPU. | `hson-demo2` executor | No | No | Start with size 1; configurable upper bound; measured tuning | Never spawn unbounded workers | No, private MVP need |
| Task decoder/result decoder | LiveHost checks generic JSON, not circuit semantics. | `hson-demo2` action boundary; reusable codec may later move inward | No | No | Versioned exact fields, byte/lap limits, exhaustive result states | Reject before enqueue; never trust worker payload | **Yes** before generalizing |
| Queue and backpressure | WebSocket buffered-amount policy does not limit worker backlog. | `hson-demo2` executor | No | No | Bounded global and per-panel queues; latest-revision coalescing | Typed busy/superseded result; no silent drop | **Yes** before generic API |
| Supersession | LiveHost has no domain concept of “newer editor revision.” | `hson-demo2` panel + action/executor | No | No | Monotonic revision and content hash; cancel older same-key jobs | Old result is fenced and settles superseded | Domain-specific; should remain app-owned |
| Cooperative cancellation | Action context has no signal. | `hson-demo2` executor/worker protocol | No | No | Check between legs; shared flag or control message | Bounded cancellation latency equal to longest synchronous leg | **Yes** before LiveHost API |
| Hard execution timeout | LiveHost has no action deadline. | `hson-demo2` executor | No | No | Queue deadline plus execution deadline | Terminate/recreate worker; typed timeout result | **Yes** before generalizing |
| Worker crash replacement | Node host manages sockets, not worker threads. | `hson-demo2` executor | No | No | Detect exit/error, attribute current job, bounded restart rate | Fail current job; requeue only if explicitly idempotent; circuit breaker on repeated crashes | **Yes** before generic API |
| Progress | LiveHost events are transient and connection-scoped. | Existing LiveHost event + `hson-demo2` event schema | No | No | Include all identities; monotonic step index; best-effort only | Lost progress does not alter terminal result | No generic addition needed |
| Durable job status | Dedupe retains pending/terminal action status but not domain progress/job ownership. | Existing action status for MVP; application store only if product requires resumability | No initially | No | Stable request ID and terminal result | Reconnect can query terminal status; do not promise progress replay | **Yes** before new durable-job API |
| Trace propagation to worker | Host traces action lifecycle but context exposes no trace/span ID. | Private `hson-demo2` task envelope initially | No | No | Correlation IDs copied into worker records | Worker trace is bounded and merged as child-like application diagnostics | **Yes** before LiveHost context field |
| Protocol-level action cancel | No cancel message, authorization rule, dedupe transition, or reconnect semantics exist. | Not MVP; possible future LiveHost core protocol | **Yes** | Yes if adopted | Authenticated cancel, target identity, idempotence, race outcome, terminal state, session ownership | Must define cancel-after-complete, disconnect, retry, and handler refusal | **Yes—mandatory** |
| Environment-neutral executor contract | One application/one task does not establish a useful generic abstraction. | Future `hson-live/livehost` core types only | No by itself | Only after validation | Submit/result/progress/cancel/lifecycle without Node types | Explicit disposal and ownership | **Yes—mandatory** |
| Node `worker_threads` adapter | Environment-specific creation and transfer semantics must not leak into browser entrypoint. | Future `hson-live/livehost/node` | No by itself | Only after generic contract exists | Bounded pool, queue, timeout, crash policy, structured clone | Deterministic shutdown/replacement and no orphan work | **Yes—mandatory** |
| Browser Worker/MessagePort adapter | Not needed for the recommended MVP and has different DOM constraints. | Future browser/application adapter | No by itself | Not now | Same neutral executor semantics if proven useful | Worker termination and port closure | **Yes—mandatory** |
| Child-process/IPC adapter | Stronger isolation has startup/ops costs and no demonstrated requirement. | Future `hson-live/livehost/node` or deployment layer | Possibly adapter messages, not LiveHost wire | Not now | Explicit trust/isolation and resource envelope | Kill process tree, bounded restart, no orphan IPC | **Yes—mandatory** |

## 10. General LiveHost gaps revealed by this use case

These are gaps, not an instruction to add APIs now:

1. **Cancellation semantics:** no host-to-handler `AbortSignal`, client cancel message, cancel authorization, dedupe terminal state, or reconnect rule.
2. **Deadlines:** no action queue deadline, execution timeout, or deadline propagation.
3. **Pending-work session ownership:** sessions preserve subscriptions through grace but do not define whether work continues, transfers, or cancels on detach/expiry.
4. **Per-session and per-action resource limits:** Node hosting protects transport bytes/rates/connections, not action concurrency, CPU, memory, or queued work.
5. **Durable progress:** events are transient, while retained action status is terminal/pending only.
6. **Structured task-result decoding:** action payload schemas exist, but result schemas remain application-owned.
7. **Delegated trace context:** LiveHost creates internal traces but does not expose a safe child-trace context to handlers/executors.
8. **Executor lifecycle vocabulary:** no neutral submit/progress/cancel/dispose contract from which Worker, worker-thread, or process adapters could be built.
9. **Crash policy:** no generic distinction among handler exception, executor failure, worker crash, timeout, and host shutdown.
10. **Supersession/coalescing:** likely domain-specific; a generic API should not assume editor “latest wins” semantics.

The parsing MVP can address items 2, 4, 6, 7, 9, and 10 privately; it can approximate cancellation for its own executor. It should not quietly define the cross-application semantics of items 1, 3, 5, or 8.

## 11. Cross-runtime execution comparison

| Design | Main-thread responsiveness | Cancellation | Parser fidelity | Network dependency | Failure containment | Complexity | Verdict |
|---|---|---|---|---|---|---|---|
| Browser-only, sliced between legs | Better than one monolith, but each synchronous parse/serialize/compare still blocks | Cooperative only between legs; stale fencing | Browser HTML is exact; does not independently cover universal Node parser | None for local execution | Same page/runtime; a pathological leg still blocks UI | Moderate scheduling complexity | Useful fallback/offline mode, not the primary certificate |
| Node worker, universal parser only | Good | Cooperative between legs plus hard worker termination | Strong universal coverage; no browser DOM fidelity | Requires LiveHost/WebSocket in deployed architecture | Worker crash isolated from host event loop if managed correctly | Moderate | Good back-end result, insufficient browser claim |
| Node worker + final browser HTML boundary | Good except one bounded final browser parse | Worker cancellation plus stale fencing for uninterruptible main-thread boundary | Covers universal circuit and explicitly checks browser agreement | Requires LiveHost for remote Node execution | Worker isolation plus narrow browser boundary | Higher but bounded | **Recommended MVP** |
| Remote Node child process/service | Good | Hard process termination possible | Universal only unless browser boundary is added | Process IPC and/or network; more operational failure modes | Strongest isolation | Highest startup, deployment, observability, and cleanup cost | Defer unless untrusted inputs or hard isolation demand it |

Browser-only slicing is not true preemption: if a single HTML parse is slow, yielding between legs does not shorten that block. Node worker execution removes repeated work from the UI, while the one final browser boundary is bounded, revision-fenced, and directly relevant to what the panel will render.

## 12. Smallest implementation sequence

No phase requires a generic worker adapter.

### Phase 0 — lock semantics before optimizing

- Add focused tests for operation scheduling, actual defaults, strict ordering/duplicates, metadata/QUID/index, negative zero, isolated surrogates/control strings, dangerous keys, structural mode, failure stop scope, and browser/universal divergences.
- Record legacy `_circuit_test` reports for representative fixtures so its compatibility wrapper can be judged intentionally.
- Add the benchmark harness described below before changing operation count.

### Phase 1 — internal strict engine in `hson-live`

- Decompose explicit admission, emit, parse, compare, direction, and result encoding.
- Use `canonical_hson_graph_difference` internally.
- Prepare once where non-mutation is proven.
- Make run-global fail-fast the interactive policy; keep exhaustive mode explicit.
- Preserve `_circuit_test` and its public report shape through an adapter unless a separate breaking change is approved.
- Do not export a worker abstraction.

### Phase 2 — private demo executor and LiveHost action

- Add one persistent Node worker (a pool of one), versioned task/result decoders, bounded queue/source/lap limits, cooperative cancellation, execution timeout, crash replacement, and controlled shutdown inside `hson-demo2`.
- Register one typed LiveHost action and transient progress event.
- Keep circuit source/task definitions application-private until another consumer exists.

### Phase 3 — panel integration and browser boundary

- Preserve immediate browser preview.
- Debounce exhaustive jobs, issue monotonic revisions, coalesce superseded queued work, and fence all progress/results.
- Run strict browser HTML admission comparison for the current revision only.
- Label the two claims separately in the UI: universal circuit and browser boundary.

### Phase 4 — tune from measurements

- Increase pool size above one only if queue delay and host CPU measurements justify it.
- Decide whether every distinct HTML boundary or only a proven converged final boundary needs browser admission.
- Tune debounce, maximum source size, lap count, deadlines, result bounds, and restart circuit breaker from real data.

### Phase 5 — second-consumer review

- If another application needs delegated work, extract an environment-neutral executor contract into `/livehost` and a Node `worker_threads` adapter into `/livehost/node`.
- Only then evaluate protocol cancellation, pending-work session ownership, durable progress, and public task/result codec hooks as coherent features.

## 13. Benchmark and evidence plan

The goal is to compare semantics-preserving variants, not to set budgets before measurement.

### Variants

1. legacy `_circuit_test`, browser HTML path under the current hosted DOM runtime;
2. legacy schedule using universal `/transform` HTML admission;
3. new strict engine with the same four-operations-per-lap schedule;
4. new strict engine with prepared-once admission and redundant allocations removed;
5. candidate reduced schedule, only if fixture equivalence is demonstrated;
6. browser-only sliced execution;
7. Node worker universal execution;
8. Node worker plus browser boundary end-to-end.

### Required input classes

- tiny valid HSON;
- tiny invalid HSON, including early and near-end failures;
- ordinary JSON;
- ordinary HTML;
- tiny scalars: null, booleans, integers, floats, `0`, `-0`, empty/non-empty strings;
- medium and large nested objects/arrays, including deep and wide shapes;
- deeply nested input and a wide object as independently parameterized sweeps;
- a large text value with controlled byte/code-unit/code-point counts;
- repeated rapid edits with controllable cadence and supersession ratio;
- malformed near-end input sized to force nearly complete tokenization;
- ordered integer-like and ordinary property names;
- duplicate property names where source formats admit them;
- metadata, QUID, canonical array indexes, root-carrier, and structural-mode cases;
- HTML attributes, styles, mixed content, void tags, raw-text tags, malformed/recovery cases;
- HSON authored syntax families and rejection fixtures;
- isolated high/low surrogates, astral pairs, CR/LF/CRLF, NUL and other control strings;
- dangerous names such as `__proto__`, `constructor`, and `prototype` in every admitted position;
- first-leg, mid-lap, closure, and final-direction mismatches;
- parser/serializer exceptions, oversized input/result, timeout, worker crash, disconnect, retry, dedupe join, and rapid supersession bursts.

### Measurements

- immediate browser parse/preview latency measured separately from certification;
- configured versus observed debounce delay;
- wall time and CPU time per job, per direction, per format, and per operation;
- queue wait and worker dispatch delay;
- parser, serializer, invariant, comparator, and result-encoding duration;
- main-thread long tasks and input-to-preview latency;
- debounce-to-certificate latency, including network and browser-boundary time;
- event-loop utilization on Node host;
- worker startup/warm-up, queue wait, execution, replacement, and shutdown time;
- worker result transfer time, LiveHost result transfer time, and browser result decode time;
- browser final HTML parse and strict comparison time;
- allocations/peak heap, peak retained bytes, and bytes copied across worker and LiveHost boundaries;
- counts of serializations, parses, invariant walks, comparisons, captured artifacts, and bytes retained;
- cancellation latency, superseded work avoided, stale results received/ignored;
- throughput and tail latency under one panel, many panels, and reconnect/retry bursts;
- semantic detection matrix: which seeded faults each variant catches or misses.

Use warm and cold runs, fixed fixture seeds, repeated samples, and environment identity (browser engine/version, Node version, package commit, parser implementation). Report distributions—especially median and tail percentiles—without declaring acceptance budgets until representative panel workloads are observed.

## 14. Unresolved decisions

1. **What is one lap?** Keep legacy three legs plus closure, or define a minimal three-transition cycle? This changes operation counts and possibly detection power; decide with fault-seeded fixtures.
2. **What is the canonical certificate operand?** Strict graph difference is the primary truth; decide whether exact canonical HSON text is also required for all steps or only for cross-runtime transport.
3. **How many browser HTML boundaries?** One converged final boundary is cheaper; every distinct boundary is a stronger source-sensitive claim. Measure divergence and source convergence first.
4. **Does run-global fail-fast replace exhaustive diagnostics in the panel only, or become a new general default?** Keep compatibility until explicitly chosen.
5. **How should browser-specific normalization be represented?** It must be an explicit admission result or named exception, never a comparator default silently applied to JSON/HSON.
6. **What survives disconnect?** MVP can let idempotent work finish and expose terminal dedupe status, or cancel app-owned work on session expiry. The UI must not imply resumable progress unless implemented.
7. **What is the exact superseded outcome contract?** It should settle deterministically without being confused with user error, timeout, crash, or validation failure.
8. **How are source locations translated after generated intermediate formats?** Store source-format/step identity and bounded snippets; do not pretend generated JSON/HTML offsets map directly to original HSON.
9. **What pool size, input limit, lap limit, and timeout are appropriate?** Decide from Phase 4 measurements, not intuition.
10. **Can Transform defer `fromNode` frame text and JSON projection without affecting public consumers?** Audit callers and add contract tests before changing those lazy/eager boundaries.
11. **Should legacy `_compare_nodes` be repaired or frozen?** Tightening it may break tests that rely on semantic wrapper/newline tolerance. Prefer new strict engine usage first, then handle legacy behavior as an explicit compatibility decision.
12. **Does a second application need the same executor semantics?** Until yes, no public generic adapter is justified.

## 15. Explicit generic-adapter recommendation

**Do not add a generic worker/process adapter to LiveHost for this MVP.**

Build the first executor inside `hson-demo2`. The parsing circuit has unusually specific semantics—latest-editor-revision wins, explicit HSON/JSON/HTML source modes, synchronous non-preemptible legs, strict graph witnesses, browser DOM boundary verification, and bounded diagnostic artifacts. Generalizing these as LiveHost semantics now would entangle application policy with transport, sessions, dedupe, authorization, and runtime-specific worker lifecycle.

If a second consumer appears, the extraction boundary should be:

- **`hson-live/livehost` (environment neutral):** executor/task lifecycle interfaces, progress/result/cancellation vocabulary, ownership and disposal semantics, and possibly handler trace/deadline context. No `node:` imports, Worker globals, MessagePort assumptions, or parsing-specific schemas.
- **`hson-live/livehost/node` (Node specific):** `worker_threads` pool implementation, queue/backpressure, structured-clone validation, deadlines, hard termination, crash replacement, restart circuit breaker, and bounded shutdown.
- **Application:** task names and codecs, authorization, supersession key, retry/idempotence rules, result rendering, source limits, and browser boundary logic.

Protocol-level cancel should be a separate design, not a side effect of extracting the executor. It must define authenticated target identity, handler cooperation, cancellation races, cancel-after-complete, dedupe/status outcomes, disconnect/session-expiry behavior, retry, and whether cancellation is advisory or guaranteed. Until those semantics are demanded by more than this panel, private application cancellation plus stale fencing is the smaller and safer boundary.

## Audited files and symbols

Primary `hson-live` sources:

- [`src/diagnostics/test-circuit.ts`](../../src/diagnostics/test-circuit.ts): `SPIN`, `runRing`, `_circuit_test`, `resolve_entry` and auto-detection helpers.
- [`src/diagnostics/diagnostics-helpers.ts`](../../src/diagnostics/diagnostics-helpers.ts): `coerce_entry`, `safe_emit`, `safe_parse`, capture/trace/finalize helpers.
- [`src/diagnostics/compare-nodes.test.ts`](../../src/diagnostics/compare-nodes.test.ts) and [`src/diagnostics/test-format.ts`](../../src/diagnostics/test-format.ts): `compare_nodes`, its semantic comparison helpers, and the additional format-test caller.
- [`src/types/diagnostics.types.ts`](../../src/types/diagnostics.types.ts): circuit inputs, options, marks, artifacts, and reports.
- [`src/diagnostics/index.ts`](../../src/diagnostics/index.ts) and [`package.json`](../../package.json): public diagnostic and subsystem exports.
- [`src/hson.ts`](../../src/hson.ts), [`transform.browser.ts`](../../src/api/transform/transform.browser.ts), [`construct-source-1.ts`](../../src/api/transform/constructors/construct-source-1.ts), [`transform.facade.ts`](../../src/api/transform/transform.facade.ts), and [`transform.universal.ts`](../../src/api/transform/transform.universal.ts): browser/universal facade split and source construction.
- [`parse-html.ts`](../../src/api/transform/parsers/parse-html.ts), [`parse-html-string.ts`](../../src/api/transform/parsers/parse-html-string.ts), [`ordered-json.ts`](../../src/api/transform/utils/json-utils/ordered-json.ts), [`serialize-hson.ts`](../../src/api/transform/serializers/serialize-hson.ts), and [`serialize-html.ts`](../../src/api/transform/serializers/serialize-html.ts): browser DOM parsing, universal string parsing, and source-sensitive transport behavior.
- [`construct-output-2.ts`](../../src/api/transform/constructors/construct-output-2.ts) and [`construct-render-4.ts`](../../src/api/transform/constructors/construct-render-4.ts): eager output construction and terminal serialization.
- [`canonical-hson-equal.ts`](../../src/core/canonical-hson-equal.ts): strict canonical graph comparator.
- [`transform-oracle.ts`](../../src/_tests/transform-oracle.ts) and [`transform-worker.acceptance.mts`](../../tests/transform-worker.acceptance.mts): current strict oracle and worker-safe Transform evidence.
- [`src/api/livehost/index.ts`](../../src/api/livehost/index.ts), [`src/api/livehost/node/index.ts`](../../src/api/livehost/node/index.ts), and [`package.json`](../../package.json): LiveHost public boundaries.
- [`livehost.types.ts`](../../src/types/livehost.types.ts): socket, protocol, action, result, dedupe, session, client, and handler contracts.
- [`livehost.core.ts`](../../src/api/livehost/livehost.core.ts): action validation/authorization/execution, dedupe dispatch, event emission, connection and host teardown.
- [`livehost.actions.ts`](../../src/api/livehost/livehost.actions.ts): pending request joining, terminal retention, status, and disposal.
- [`livehost.client.ts`](../../src/api/livehost/livehost.client.ts): action/retry/status client lifecycle and disconnect rejection.
- [`livehost.protocol.ts`](../../src/api/livehost/livehost.protocol.ts): strict wire decoders and JSON-value admission.
- [`livehost.session.ts`](../../src/api/livehost/livehost.session.ts): session attach/detach/grace/expiry ownership.
- [`livehost.browser-socket.ts`](../../src/api/livehost/livehost.browser-socket.ts) and [`livehost.node-socket.ts`](../../src/api/livehost/node/livehost.node-socket.ts): implemented WebSocket adapters.
- [`livehost.node-application-host.ts`](../../src/api/livehost/node/livehost.node-application-host.ts): Node application hosting, limits, heartbeats, backpressure, and shutdown.
- [`livehost.authority-registry.ts`](../../src/api/livehost/livehost.authority-registry.ts) and [`livehost.activity.ts`](../../src/api/livehost/livehost.activity.ts): authority bounds, idle eviction, and activity accounting.
- [`docs/hson-livehost.md`](../hson-livehost.md): documented current/future boundary, checked against implementation.

Primary `hson-demo2` integration sources:

- [`src/app/demos/parse/init-pp.ts`](../../../hson-demo2/src/app/demos/parse/init-pp.ts): parsing panel construction, immediate update path, and input listeners.
- [`tests/suites/transform/make-transform-suite.ts`](../../../hson-demo2/tests/suites/transform/make-transform-suite.ts): current circuit caller and option choices.
- [`tests/harness/hosted/deterministic-transform-test-suites.ts`](../../../hson-demo2/tests/harness/hosted/deterministic-transform-test-suites.ts): hosted deterministic suite registry.
- [`tests/runners/diagnostics/run-generated-json.node.mts`](../../../hson-demo2/tests/runners/diagnostics/run-generated-json.node.mts) and [`tests/runners/livehost/run-hosted-dom-compatibility.node.mts`](../../../hson-demo2/tests/runners/livehost/run-hosted-dom-compatibility.node.mts): direct generated/hosted circuit runners and DOM-host boundary.
- [`tests/harness/hosted/hosted-test-application.ts`](../../../hson-demo2/tests/harness/hosted/hosted-test-application.ts): typed async LiveHost action registration and report state.
- [`tests/harness/hosted/hosted-test-action.ts`](../../../hson-demo2/tests/harness/hosted/hosted-test-action.ts): progress events and asynchronous hosted test execution.
- [`tests/harness/runtimes/node/server/node-hosted-tests-application.ts`](../../../hson-demo2/tests/harness/runtimes/node/server/node-hosted-tests-application.ts): demo LiveHost application registration, socket adaptation, metrics, and disposal.
- [`tests/harness/runtimes/node/server/hosted-test-server.ts`](../../../hson-demo2/tests/harness/runtimes/node/server/hosted-test-server.ts): Node host startup.
- [`tests/harness/runtimes/node/livehost-node-executor.ts`](../../../hson-demo2/tests/harness/runtimes/node/livehost-node-executor.ts): current executor boundary, which explicitly reports cancellation as unsupported.

An exhaustive production-source search for `worker_threads`, `new Worker`, `MessagePort`, `child_process`, and `process.send` found no LiveHost worker/process implementation. Matches in `hson-demo2` are test/runtime launch infrastructure rather than a LiveHost public or production executor. The export inventories above corroborate that boundary.
