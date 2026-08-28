# HSON authoring diagnostic language review catalog

This is the copy-review surface, not a proposed language redesign. Edit prose in [the editor bank](../editors/vscode-hson/src/diagnostic-messages.ts), then consciously update its exact tests and this catalog. Core/runtime-owned strings stay at their listed owners. No public API, protocol, provenance, validation rule, code action, or color styling is changed by this pass.

Each `bank.*` ID is the exact exported formatter/constant name. Each entry gives the trigger, range and limitation from its immediately preceding source comment, plus authoring/Schema context and fix classification. Rendered text blocks preserve capitalization, punctuation and leading spaces. Fragments are not standalone diagnostic sentences. Missing-evidence probes do not claim that current validators emit those combinations.

Current HSON syntax: `<age 37 name "Ada">` is a projected object, `[1, "x"]` an array, `<button disabled/>` a document element, and `<main <button/>/>` nested content. Object members are NOT separate sibling angle pairs. In Schema examples, `define` means `hson.liveMap.schema.define`; `s` is its callback parameter. Trusted examples use a registered binding and `HSON.validate(ReviewSchema, value)` unless stated otherwise.

Precision: “exact” means a mapped span, not necessarily a single offending token. Syntax uses legacy `point`/`eof`, described as exact point/EOF; `fallback` is unresolved body/document coverage. Substitutions use `substitution-expression`: exact host expression span with semantic, NOT character-exact evaluated-value attribution. Anchors refer to existing closes/names/coverage. Infrastructure has no source squiggle. Successful exact placement adds no prose.

Future fixes only: safe = deterministic under the stated strict conditions; suggestion only = requires intent or can destroy information; none = no general authored-text repair. No fixes are implemented.

## 1. HSON syntax and admission

### bank.hsonValidationFailed

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:129](../editors/vscode-hson/src/diagnostic-messages.ts#L129).
- Trigger / placement / semantic limit: The standalone/static adapter has Transform details but no local Error instance. Uses point/EOF or whole-source fallback; real local TransformErrors pass verbatim.
- Authored example: ``<age +1>``.
- Schema / infrastructure condition: `none; synthetic adapter fallback, normal parser error is inherited`.
- Precision: unresolved (or exact point/EOF with details).
- Related: none unless Transform source roles map
- Future fix: none.
- Evidence limitations: Local read_transform_error_details currently requires instanceof TransformError, which extends Error. This fallback is defensive rather than a normal reachable branch.

Variant `fallback`:

```text
HSON validation failed.
```

### bank.hsonAdmissionFailed

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:133](../editors/vscode-hson/src/diagnostic-messages.ts#L133).
- Trigger / placement / semantic limit: The tagged admission adapter has Transform details but no local Error instance. Uses literal point/EOF or body fallback; this is not a new admission rule.
- Authored example: ``HSON`<age 1>```.
- Schema / infrastructure condition: `none; synthetic adapter fallback`.
- Precision: unresolved (or literal point/EOF with details).
- Related: none unless Transform source roles map
- Future fix: none.
- Evidence limitations: Same local TransformError-instance limitation as hsonValidationFailed. Runtime has an independently owned fallback with equal text.

Variant `fallback`:

```text
HSON admission failed.
```

## 2. Projected Schema — values and members

### bank.diagnosticSubject

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:8](../editors/vscode-hson/src/diagnostic-messages.ts#L8).
- Trigger / placement / semantic limit: A Schema issue identifies an attribute or the final path segment, or neither. Used inside exact/anchor/unresolved diagnostics; a numeric path is not a name.
- Authored example: ``<age "37"> / [1] / <button count="bad"/>``.
- Schema / infrastructure condition: `s.object({age:s.number}) / s.tuple(s.number,s.string) / s.button(s.attrs({count:s.number}))`.
- Precision: exact / anchor / unresolved.
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: none.
- Evidence limitations: Final path component only, not a full property path; document numeric paths are printed as numbers.

Variant `root`:

```text
this value
```

Variant `member`:

```text
`age`
```

Variant `index`:

```text
`1`
```

Variant `attribute`:

```text
attribute `count`
```

### bank.primitiveTypeMismatch

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:81](../editors/vscode-hson/src/diagnostic-messages.ts#L81).
- Trigger / placement / semantic limit: TYPE_MISMATCH has recognized primitive/container kind descriptions on both sides. Usually on the value; attributes remain strings even when authored unquoted.
- Authored example: ``<age "37">; <name 37>``.
- Schema / infrastructure condition: `s.object({age:s.number}); s.object({name:s.string})`.
- Precision: exact.
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: safe under strict scalar-only conditions; otherwise suggestion only.
- Evidence limitations: Only six recognized expected/received kind strings. No coercion implied. Attribute raw values remain strings; unquoting attributes is NOT a repair.

Variant `number`:

```text
Expected `age` to be a number, but this value is an HSON string.
```

Variant `string`:

```text
Expected `name` to be a string, but this value is an HSON number.
```

Variant `array`:

```text
Expected this value to be an array, but this value is an HSON object.
```

Variant `object`:

```text
Expected this value to be an object, but this value is an HSON array.
```

Variant `null`:

```text
Expected this value to be null, but this value is an HSON boolean.
```

Variant `boolean`:

```text
Expected this value to be a boolean, but this value is an HSON null.
```

### bank.requiredValueMissing

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:56](../editors/vscode-hson/src/diagnostic-messages.ts#L56).
- Trigger / placement / semantic limit: MISSING_REQUIRED covers projected members, tuple positions and document gaps. Anchored to existing parent source; the path does not describe a complex child.
- Authored example: ``<>; [1]; <main/>; <button/>``.
- Schema / infrastructure condition: `s.object({age:s.number}); s.tuple(s.number,s.string); s.main(s.button()); s.button(s.attrs({id:s.string}))`.
- Precision: anchor.
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: suggestion only.
- Evidence limitations: No default value, complex missing-child description, typed count or allowed structure arrives. Shared by ordinary attributes and document content.

Variant `member`:

```text
Required `age` is missing.
```

Variant `position`:

```text
Required `1` is missing.
```

### bank.exactMemberUnknown

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:62](../editors/vscode-hson/src/diagnostic-messages.ts#L62).
- Trigger / placement / semantic limit: UNKNOWN_KEY identifies a projected member or an ordinary attribute. Usually on its name; the issue does not carry the full allowed-key set.
- Authored example: ``<extra 1>; <button extra="x"/>``.
- Schema / infrastructure condition: `s.object.exact({}); s.button(s.attrs.exact({}))`.
- Precision: exact.
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: suggestion only.
- Evidence limitations: No allowed keys; removal may destroy authored data.

Variant `member`:

```text
`extra` is not allowed by this exact Schema.
```

Variant `attribute`:

```text
attribute `extra` is not allowed by this exact Schema.
```

## 3. Projected Schema — tuples, literals, alternatives

### bank.literalMismatch

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:75](../editors/vscode-hson/src/diagnostic-messages.ts#L75).
- Trigger / placement / semantic limit: INVALID_LITERAL supplies preformatted expected and received descriptions. Usually on the value; no structured list of allowed literals crosses transport.
- Authored example: ``<state "pending">``.
- Schema / infrastructure condition: `s.object({state:s.literal("draft","published")})`.
- Precision: exact.
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: suggestion only.
- Evidence limitations: Expected is a rendered description, not structured alternatives. Quotes and vertical bars cannot safely be parsed into choices. Undefined-evidence variants document legacy defensive behavior, not an actual literal requirement.

Variant `finite-alternatives`:

```text
Expected `state` to equal "draft" | "published"; found "pending".
```

Variant `missing-evidence`:

```text
Expected this value to equal undefined; found undefined.
```

### bank.schemaTypeMismatch

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:87](../editors/vscode-hson/src/diagnostic-messages.ts#L87).
- Trigger / placement / semantic limit: TYPE_MISMATCH lacks two recognized kind descriptions (including root/pick errors). Uses the existing exact/anchor/unresolved range; missing descriptions stay neutral.
- Authored example: ``true; 1; <main "bad"/>``.
- Schema / infrastructure condition: `s.pick(s.string,s.number); s.tuple(s.button()); s.main(s.button())`.
- Precision: exact / unresolved.
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: suggestion only (root/branch choice); none for absent evidence.
- Evidence limitations: Branch summaries are only strings; attribute predicate exceptions lose expected/received. No type or source repair inferred.

Variant `root`:

```text
Expected this value: fragment document root; received projected root.
```

Variant `fallback`:

```text
Expected attribute `count`: a compatible Schema value; received an incompatible value.
```

### bank.schemaValidationFailed

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:93](../editors/vscode-hson/src/diagnostic-messages.ts#L93).
- Trigger / placement / semantic limit: No specialized editor wording exists for this issue code, including surplus items. Uses the lowerer's range; the code must not be interpreted as an inferred fix.
- Authored example: ``[1, "extra"]; 1``.
- Schema / infrastructure condition: `s.tuple(s.number); unsupported root capability / UNKNOWN_PATH defensive issue`.
- Precision: exact / unresolved.
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: suggestion only for surplus deletion; none for invalid Schema/path.
- Evidence limitations: Surplus items and invalid Schema/path share the code-only fallback. Unsupported capability is normally rejected at registration before validation.

Variant `surplus`:

```text
Schema validation failed for `1` (TUPLE_INDEX_OUT_OF_RANGE).
```

Variant `unknown-path`:

```text
Schema validation failed for `ghost` (UNKNOWN_PATH).
```

Variant `invalid-schema`:

```text
Schema validation failed for this value (INVALID_SCHEMA).
```

## 4. Document Schema — tags and content

### bank.documentTagMismatch

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:44](../editors/vscode-hson/src/diagnostic-messages.ts#L44).
- Trigger / placement / semantic limit: The private tag sidecar identifies a document element tag mismatch. Usually on the element's coverage; expected/received are formatted by the core.
- Authored example: ``<span/>``.
- Schema / infrastructure condition: `s.button()`.
- Precision: exact (whole element coverage).
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: suggestion only.
- Evidence limitations: Tag sidecar proves tag semantics. The current lowerer does not select just the tag name.

Variant `tag`:

```text
Expected element tag "button"; found "span".
```

## 5. Document Schema — attributes and flags

### bank.requiredFlagMissing

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:50](../editors/vscode-hson/src/diagnostic-messages.ts#L50).
- Trigger / placement / semantic limit: MISSING_REQUIRED carries the private flag sidecar and attributeName. Anchored to the element close/name/coverage; there is no authored flag token.
- Authored example: ``<button/>``.
- Schema / infrastructure condition: `s.button(s.attrs({disabled:s.flag}))`.
- Precision: anchor (usually />).
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: safe under strict absent-flag / known-owner / current-Schema conditions.
- Evidence limitations: Insertion requires a current truthful owning header; no code action implemented.

Variant `flag`:

```text
Required flag `disabled` is missing.
```

## 6. Constraints and substitution expressions

### bank.constraintFailed

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:68](../editors/vscode-hson/src/diagnostic-messages.ts#L68).
- Trigger / placement / semantic limit: INVALID_CONSTRAINT follows successful base validation and a false predicate. Usually on the value; labels are metadata, not executable repair instructions.
- Authored example: ``<age -1>``.
- Schema / infrastructure condition: `s.object({age:s.number.constrain("positive age",n=>n>0)}) / unlabeled overload`.
- Precision: exact.
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: none.
- Evidence limitations: Label is private sidecar metadata. Empty string is a label. Base failure suppresses predicate label; false and throw follow different paths.

Variant `labeled`:

```text
`age` does not satisfy constraint “positive age”.
```

Variant `unlabeled`:

```text
`age` does not satisfy its Schema constraint.
```

Variant `empty-label`:

```text
`age` does not satisfy constraint “”.
```

### bank.substitutionEvaluation

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:14](../editors/vscode-hson/src/diagnostic-messages.ts#L14).
- Trigger / placement / semantic limit: Trusted capture associates a scalar with one substitution expression. Attached to that expression, not its evaluated characters or literal segments.
- Authored example: ``HSON`<age ${age}>` with age = "37"``.
- Schema / infrastructure condition: `s.object({age:s.number})`.
- Precision: exact expression span, semantic (not character-exact evaluated token).
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: none.
- Evidence limitations: Host origin scalarKind, then received, then value. Null has separate existing wording.

Variant `string`:

```text
This expression evaluated to an HSON string
```

Variant `null`:

```text
This expression evaluated to HSON null
```

Variant `fallback`:

```text
This expression evaluated to an HSON value
```

### bank.substitutionTypeMismatch

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:20](../editors/vscode-hson/src/diagnostic-messages.ts#L20).
- Trigger / placement / semantic limit: TYPE_MISMATCH belongs to a captured substitution expression. Expected is the existing Schema description, not a reconstructed contract.
- Authored example: ``HSON`<age ${age}>` with age = "37"``.
- Schema / infrastructure condition: `s.object({age:s.number})`.
- Precision: exact expression span, semantic.
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: suggestion only.
- Evidence limitations: Producing expression is not a string-literal HSON token; unquoting it is not a general safe repair.

Variant `number`:

```text
This expression evaluated to an HSON string, but the Schema requires number here.
```

Variant `fallback`:

```text
This expression evaluated to HSON null, but the Schema requires a different value here.
```

### bank.substitutionLiteralMismatch

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:26](../editors/vscode-hson/src/diagnostic-messages.ts#L26).
- Trigger / placement / semantic limit: INVALID_LITERAL belongs to a captured substitution expression. The expression range is used; expected may describe several literals as text.
- Authored example: ``HSON`<state ${state}>` with state = "pending"``.
- Schema / infrastructure condition: `s.object({state:s.literal("draft","published")})`.
- Precision: exact expression span, semantic.
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: suggestion only.
- Evidence limitations: No evaluated-value display or structured alternative list. Missing-evidence variant is retained defensively, not claimed as a valid literal.

Variant `literal`:

```text
This expression evaluated to an HSON string, but the Schema requires literal "draft" here.
```

Variant `missing-evidence`:

```text
This expression evaluated to an HSON string, but the Schema requires literal undefined here.
```

### bank.substitutionConstraintFailed

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:32](../editors/vscode-hson/src/diagnostic-messages.ts#L32).
- Trigger / placement / semantic limit: A captured substitution fails its predicate after base validation succeeds. The expression range is used; without a label no predicate intent is known.
- Authored example: ``HSON`<age ${age}>` with age = -1``.
- Schema / infrastructure condition: `s.object({age:s.number.constrain("positive age",n=>n>0)}) / unlabeled`.
- Precision: exact expression span, semantic.
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: none.
- Evidence limitations: Label does not prove a repair or permit executing the predicate to infer one.

Variant `labeled`:

```text
This expression evaluated to an HSON number that does not satisfy constraint “positive age”.
```

Variant `unlabeled`:

```text
This expression evaluated to an HSON number that does not satisfy its Schema constraint.
```

### bank.substitutionValidationFailed

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:38](../editors/vscode-hson/src/diagnostic-messages.ts#L38).
- Trigger / placement / semantic limit: A substitution issue has no specialized wording for its code. Attached to the expression; the code is retained without inferring a repair.
- Authored example: ``HSON`${value}```.
- Schema / infrastructure condition: `synthetic unrecognized issue code for a captured scalar`.
- Precision: exact expression span, semantic.
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: none.
- Evidence limitations: Retains code; not every fallback combination is currently emitted.

Variant `generic`:

```text
This expression evaluated to an HSON string that fails Schema validation (INVALID_SCHEMA).
```

## 7. Missing structure / anchored diagnostics

### bank.anchoredLocationNote

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:99](../editors/vscode-hson/src/diagnostic-messages.ts#L99).
- Trigger / placement / semantic limit: Lowering located existing parent source for absent required structure. Appended on anchor ranges only; it does not claim the missing token exists.
- Authored example: ``<>; [1]; <main/>``.
- Schema / infrastructure condition: `required projected member / tuple position / document child`.
- Precision: anchor.
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: suggestion only (flag may be conditionally safe).
- Evidence limitations: Source precision is authoritative. No text inserted, no nonexistent token underlined.

Variant `anchor`:

```text
 (Anchored to existing source; required structure is absent.)
```

## 8. Unresolved source locations and diagnostic composition

### bank.unresolvedLocationNote

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:103](../editors/vscode-hson/src/diagnostic-messages.ts#L103).
- Trigger / placement / semantic limit: A Schema range could not be mapped truthfully to a character-exact host span. Appended on occurrence-level fallback; static fromHson also uses this legacy text.
- Authored example: ``HSON`<age "37">`; fromHson('<age "37">')``.
- Schema / infrastructure condition: `same mismatch with unavailable/out-of-bounds source evidence`.
- Precision: unresolved.
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: none.
- Evidence limitations: Legacy Template-level term also covers static fromHson occurrences; standalone syntax fallback has no suffix.

Variant `unresolved`:

```text
 (Template-level diagnostic; exact source location unavailable.)
```

### bank.compositeLocationNote

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:107](../editors/vscode-hson/src/diagnostic-messages.ts#L107).
- Trigger / placement / semantic limit: A reconstructed-source span crosses more than one interpolation origin. The mapped host span is explicitly non-character-exact, even if offsets exist.
- Authored example: ``HSON`<a ${a} b ${b}>```.
- Schema / infrastructure condition: `constraint on a container spanning literal and substitution origins`.
- Precision: unresolved / composite host span.
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: none.
- Evidence limitations: Mapped host extent is not character-exact reconstructed source. Composite takes priority over anchor.

Variant `composite`:

```text
 (Range spans multiple source origins; not a character-exact location.)
```

### bank.schemaDiagnostic

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:111](../editors/vscode-hson/src/diagnostic-messages.ts#L111).
- Trigger / placement / semantic limit: A discovered validation association supplies its Schema label and rendered issue. Wraps any precision without adding validation evidence or changing the range.
- Authored example: ``HSON`<age "37">```.
- Schema / infrastructure condition: `UserSchema requested by validate/use`.
- Precision: exact / anchor / unresolved.
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: none (wrapper only).
- Evidence limitations: Label is discovered association metadata, not an invented identity.

Variant `exact`:

```text
[UserSchema] Required `age` is missing.
```

## 9. Trusted Schema availability

### bank.schemaStatusLabel

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:145](../editors/vscode-hson/src/diagnostic-messages.ts#L145).
- Trigger / placement / semantic limit: The active document's status is displayed, defaulting to off without a record. Status-bar text only; absence of errors must not imply validation success.
- Authored example: ``HSON`<age "37">```.
- Schema / infrastructure condition: `trusted off/waiting/current/stale/ambiguous/unavailable/failed`.
- Precision: status/infrastructure.
- Related: none
- Future fix: none.
- Evidence limitations: No separate loading, runtime-mismatch, timed-out or crashed enum; these use waiting or runtime-failed with tooltip details.

Variant `missing-state`:

```text
HSON Schema: off
```

### bank.currentSchemaStatus

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:151](../editors/vscode-hson/src/diagnostic-messages.ts#L151).
- Trigger / placement / semantic limit: Current source was checked against trusted runtime evidence. Status tooltip only; predicates can be stateful and this is not a certificate.
- Authored example: ``HSON`<age 37>` / HSON`<age "37">```.
- Schema / infrastructure condition: `current valid or invalid registered validation`.
- Precision: status/infrastructure.
- Related: none
- Future fix: none.
- Evidence limitations: Invalid also receives current-evidence tooltip; not a universal validity certificate.

Variant `current`:

```text
Current authored source checked using trusted runtime evidence. Stateful predicates may change.
```

### bank.unavailableSchemaStatus

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:155](../editors/vscode-hson/src/diagnostic-messages.ts#L155).
- Trigger / placement / semantic limit: No current valid/invalid result supplies the default status explanation. Status tooltip only; off/waiting/stale/ambiguous/unavailable/failure share this text.
- Authored example: ``HSON`<age "37">```.
- Schema / infrastructure condition: `off/waiting/stale/ambiguous/unavailable/runtime-failed without detail`.
- Precision: status/infrastructure.
- Related: none
- Future fix: none.
- Evidence limitations: No separate stock tooltip for each noncurrent state. Trust and enablement checked before execution.

Variant `not-current`:

```text
Trusted Schema diagnostics require Workspace Trust, explicit enablement, and a current registered source binding. No diagnostics does not mean Schema passed.
```

### bank.schemaStatusTooltip

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:159](../editors/vscode-hson/src/diagnostic-messages.ts#L159).
- Trigger / placement / semantic limit: An optional runtime message overrides the default status explanation verbatim. Tooltip only; even an empty supplied message is preserved, with no English parsing.
- Authored example: ``HSON`<age "37">```.
- Schema / infrastructure condition: `any status, optional runtime-provided message`.
- Precision: status/infrastructure.
- Related: none
- Future fix: none.
- Evidence limitations: Supplied message overrides even current/off; empty string preserved; no inferred cause.

Variant `current`:

```text
Current authored source checked using trusted runtime evidence. Stateful predicates may change.
```

Variant `missing-state`:

```text
Trusted Schema diagnostics require Workspace Trust, explicit enablement, and a current registered source binding. No diagnostics does not mean Schema passed.
```

Variant `runtime-override`:

```text
predicate exploded
```

Variant `empty-override`:

```text

```

## 10. Trusted runtime failures and output

### bank.schemaRuntimeFailed

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:137](../editors/vscode-hson/src/diagnostic-messages.ts#L137).
- Trigger / placement / semantic limit: The trusted client caught a non-Error value while validating. Status tooltip only; no source diagnostic or exception detail is invented.
- Authored example: ``HSON`<age 37>```.
- Schema / infrastructure condition: `client validate catches non-Error`.
- Precision: status/infrastructure.
- Related: none
- Future fix: none.
- Evidence limitations: Error instances retain their own message; non-Error causes not stringified.

Variant `fallback`:

```text
Trusted Schema runtime failed.
```

### bank.runtimeFailed

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:141](../editors/vscode-hson/src/diagnostic-messages.ts#L141).
- Trigger / placement / semantic limit: The diagnostic controller's client promise rejected with a non-Error value. Status tooltip only; this remains distinct from the trusted-client fallback.
- Authored example: ``HSON`<age 37>```.
- Schema / infrastructure condition: `controller client promise rejects with non-Error`.
- Precision: status/infrastructure.
- Related: none
- Future fix: none.
- Evidence limitations: Distinct controller fallback, not runtime replacement.

Variant `fallback`:

```text
Runtime failed.
```

### bank.unexpectedDiagnosticsFailure

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:165](../editors/vscode-hson/src/diagnostic-messages.ts#L165).
- Trigger / placement / semantic limit: Syntax production threw outside the recognized TransformError path. Extension-host console only; the underlying error is logged separately.
- Authored example: ``<age +1>``.
- Schema / infrastructure condition: `unexpected producer failure, not recognized TransformError`.
- Precision: status/infrastructure (extension-host console).
- Related: none
- Future fix: none.
- Evidence limitations: Path interpolated; exception logged separately. Normal syntax failures do not go here.

Variant `file`:

```text
HSON diagnostics failed for /project/user.ts
```

### bank.slowSchemaRequest

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:171](../editors/vscode-hson/src/diagnostic-messages.ts#L171).
- Trigger / placement / semantic limit: Measured trusted validation end-to-end time is at least two seconds. Diagnostics output channel only; the threshold does not imply a timeout.
- Authored example: ``<age 37>``.
- Schema / infrastructure condition: `validation elapsed >= 2000ms`.
- Precision: status/infrastructure (output channel).
- Related: none
- Future fix: none.
- Evidence limitations: Slow is not necessarily failed or timed out. Timings are separate JSON records.

Variant `slow`:

```text
Slow trusted diagnostic request (>= 2 seconds); includes cold load if this is the first request.
```

### bank.missingPackagedGrammar

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:181](../editors/vscode-hson/src/diagnostic-messages.ts#L181).
- Trigger / placement / semantic limit: The packaged grammar registry returned no grammar after loading its resources. Infrastructure error only; not an authored syntax error or a color-setting change.
- Authored example: ``HSON`<age 37>```.
- Schema / infrastructure condition: `registry returned no packaged grammar`.
- Precision: status/infrastructure.
- Related: none
- Future fix: none.
- Evidence limitations: Package failure, not syntax diagnostic. No scope/grammar/token/theme/color behavior changed.

Variant `missing`:

```text
Missing packaged HSON grammar
```

## 11. Related information / validation-site references

### bank.schemaRequestRelated

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:117](../editors/vscode-hson/src/diagnostic-messages.ts#L117).
- Trigger / placement / semantic limit: Discovery proved a validate or map.schema.use association for this occurrence. Related range is the call, not the primary diagnostic or Schema declaration.
- Authored example: ``HSON`<age "37">`; HSON.validate(UserSchema,value); map.schema.use(UserSchema)``.
- Schema / infrastructure condition: `discovered UserSchema binding`.
- Precision: exact call range (related information).
- Related: Schema requested by this validate call (ReviewSchema). / Schema requested by this map.schema.use call (ReviewSchema).
- Future fix: none.
- Evidence limitations: Only validate and map.schema.use labels exist. No Schema-declaration related label emitted.

Variant `validate`:

```text
Schema requested by this validate call (UserSchema).
```

Variant `use`:

```text
Schema requested by this map.schema.use call (UserSchema).
```

### bank.hsonSourceRelated

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:123](../editors/vscode-hson/src/diagnostic-messages.ts#L123).
- Trigger / placement / semantic limit: TransformError contains a related source role whose offset maps successfully. Related range points at that source token; role names are inherited, not inferred.
- Authored example: ``<age 1 age 2>``.
- Schema / infrastructure condition: `duplicate object's first declaration`.
- Precision: exact point (related information).
- Related: this is the related source label
- Future fix: suggestion only.
- Evidence limitations: Role inherited from TransformError.details.related; no fabricated related source.

Variant `first-declaration`:

```text
Related HSON source (first-declaration).
```

## 12. Adjacent completion presentation (not validation)

### bank.schemaCompletionDetail

- Category / owner: A — editor-owned.
- Source: [diagnostic-messages.ts:175](../editors/vscode-hson/src/diagnostic-messages.ts#L175).
- Trigger / placement / semantic limit: A completion candidate provides its core-owned detail description. Completion menu only, not a diagnostic; the description passes through verbatim.
- Authored example: ``< >``.
- Schema / infrastructure condition: `current completion evidence (required member sample)`.
- Precision: status/infrastructure (completion menu at replacement range).
- Related: none
- Future fix: suggestion only.
- Evidence limitations: Only prefix editor-owned. Core detail descriptions separately listed; not a diagnostic/code action.

Variant `detail`:

```text
HSON Schema: required member
```

## 13. End-to-end review examples — core vs actual editor rendering

These execute the real parser, Schema validator, private sidecar, source lowerer and editor presenter. JSON blocks are exact test snapshots. `core` remains inherited and `message` is adapted; `slice` is actual selected text. Each uses the related validate-call range. The equivalent map.schema.use label is tested separately. Scenario IDs are not additional bank entries.

### scenario.number-string

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<age "37">`.
- Schema: `define(s => s.object({ age: s.number }))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: safe only for an exact projected string scalar whose decoded value admits the required finite primitive; otherwise suggestion only.
- Evidence limitation: Only existing code/path/expected/received/attributeName, sidecars and precision are used; no English parsing.

<!-- scenario:number-string -->
```json
[
  {
    "core": "LiveMap schema expected number at [\"age\"], received string",
    "message": "[ReviewSchema] Expected `age` to be a number, but this value is an HSON string.",
    "precision": "exact",
    "slice": "\"37\"",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.string-number

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<name 37>`.
- Schema: `define(s => s.object({ name: s.string }))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: Only existing code/path/expected/received/attributeName, sidecars and precision are used; no English parsing.

<!-- scenario:string-number -->
```json
[
  {
    "core": "LiveMap schema expected string at [\"name\"], received number",
    "message": "[ReviewSchema] Expected `name` to be a string, but this value is an HSON number.",
    "precision": "exact",
    "slice": "37",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.missing-member

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<>`.
- Schema: `define(s => s.object({ age: s.number }))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: Only existing code/path/expected/received/attributeName, sidecars and precision are used; no English parsing.

<!-- scenario:missing-member -->
```json
[
  {
    "core": "LiveMap schema expected number at [\"age\"], received missing",
    "message": "[ReviewSchema] Required `age` is missing. (Anchored to existing source; required structure is absent.)",
    "precision": "anchor",
    "slice": ">",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.unknown-member

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<extra 1>`.
- Schema: `define(s => s.object.exact({}))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: Only existing code/path/expected/received/attributeName, sidecars and precision are used; no English parsing.

<!-- scenario:unknown-member -->
```json
[
  {
    "core": "LiveMap schema does not allow key \"extra\" at [\"extra\"]",
    "message": "[ReviewSchema] `extra` is not allowed by this exact Schema.",
    "precision": "exact",
    "slice": "extra",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.finite-literals

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<state "pending">`.
- Schema: `define(s => s.object({ state: s.literal("draft", "published") }))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: Allowed alternatives arrive as a description string, not a typed array.

<!-- scenario:finite-literals -->
```json
[
  {
    "core": "LiveMap schema expected \"draft\" | \"published\" at [\"state\"], received \"pending\"",
    "message": "[ReviewSchema] Expected `state` to equal \"draft\" | \"published\"; found \"pending\".",
    "precision": "exact",
    "slice": "\"pending\"",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.tuple-missing

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `[1]`.
- Schema: `define(s => s.tuple(s.number, s.string))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: Only existing code/path/expected/received/attributeName, sidecars and precision are used; no English parsing.

<!-- scenario:tuple-missing -->
```json
[
  {
    "core": "LiveMap schema expected string at [1], received missing",
    "message": "[ReviewSchema] Required `1` is missing. (Anchored to existing source; required structure is absent.)",
    "precision": "anchor",
    "slice": "]",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.tuple-extra

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `[1, "extra"]`.
- Schema: `define(s => s.tuple(s.number))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: Only existing code/path/expected/received/attributeName, sidecars and precision are used; no English parsing.

<!-- scenario:tuple-extra -->
```json
[
  {
    "core": "LiveMap schema does not allow tuple index 1 at [1]",
    "message": "[ReviewSchema] Schema validation failed for `1` (TUPLE_INDEX_OUT_OF_RANGE).",
    "precision": "exact",
    "slice": "\"extra\"",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.constraint-labeled

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<age -1>`.
- Schema: `define(s => s.object({ age: s.number.constrain("positive age", n => n > 0) }))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: none.
- Evidence limitation: Predicate intent unavailable without a meaningful label; no general repair follows even from a label.

<!-- scenario:constraint-labeled -->
```json
[
  {
    "core": "LiveMap schema expected positive age at [\"age\"], received -1",
    "message": "[ReviewSchema] `age` does not satisfy constraint “positive age”.",
    "precision": "exact",
    "slice": "-1",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.constraint-unlabeled

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<age -1>`.
- Schema: `define(s => s.object({ age: s.number.constrain(n => n > 0) }))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: none.
- Evidence limitation: Predicate intent unavailable without a meaningful label; no general repair follows even from a label.

<!-- scenario:constraint-unlabeled -->
```json
[
  {
    "core": "LiveMap schema expected constraint at [\"age\"], received -1",
    "message": "[ReviewSchema] `age` does not satisfy its Schema constraint.",
    "precision": "exact",
    "slice": "-1",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.pick

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `true`.
- Schema: `define(s => s.pick(s.string, s.number))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: Aggregate description only; no branch evidence in protocol.

<!-- scenario:pick -->
```json
[
  {
    "core": "LiveMap schema expected string | number at [], received boolean",
    "message": "[ReviewSchema] Expected this value: string | number; received boolean.",
    "precision": "exact",
    "slice": "true",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.wrong-tag

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<span/>`.
- Schema: `define(s => s.button())`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: Only existing code/path/expected/received/attributeName, sidecars and precision are used; no English parsing.

<!-- scenario:wrong-tag -->
```json
[
  {
    "core": "Expected tag \"button\" at []; received \"span\".",
    "message": "[ReviewSchema] Expected element tag \"button\"; found \"span\".",
    "precision": "exact",
    "slice": "<span/>",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.wrong-item-kind

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<main "bad"/>`.
- Schema: `define(s => s.main(s.button()))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: Only existing code/path/expected/received/attributeName, sidecars and precision are used; no English parsing.

<!-- scenario:wrong-item-kind -->
```json
[
  {
    "core": "Expected element at [0]; received text.",
    "message": "[ReviewSchema] Expected `0`: element; received text.",
    "precision": "exact",
    "slice": "\"bad\"",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.missing-child

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<main/>`.
- Schema: `define(s => s.main(s.button()))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: No typed count, surplus span or missing-child contract arrives; expected/received contain length descriptions.

<!-- scenario:missing-child -->
```json
[
  {
    "core": "Expected closed sequence length 1 at []; received length 0.",
    "message": "[ReviewSchema] Required `0` is missing. (Anchored to existing source; required structure is absent.)",
    "precision": "anchor",
    "slice": "/>",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.unexpected-child

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<main <button/>/>`.
- Schema: `define(s => s.main(s.empty))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: No typed count, surplus span or missing-child contract arrives; expected/received contain length descriptions.

<!-- scenario:unexpected-child -->
```json
[
  {
    "core": "Expected closed sequence length 0 at []; received length 1.",
    "message": "[ReviewSchema] Schema validation failed for this value (TUPLE_INDEX_OUT_OF_RANGE).",
    "precision": "exact",
    "slice": "<main <button/>/>",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.invalid-attribute

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<button count="bad"/>`.
- Schema: `define(s => s.button(s.attrs({ count: s.number })))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: Only existing code/path/expected/received/attributeName, sidecars and precision are used; no English parsing.

<!-- scenario:invalid-attribute -->
```json
[
  {
    "core": "Attribute \"count\" at [] is invalid: LiveMap schema expected number at [], received string",
    "message": "[ReviewSchema] Expected attribute `count` to be a number, but this value is an HSON string.",
    "precision": "exact",
    "slice": "\"bad\"",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.unknown-attribute

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<button extra="x"/>`.
- Schema: `define(s => s.button(s.attrs.exact({})))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: Only existing code/path/expected/received/attributeName, sidecars and precision are used; no English parsing.

<!-- scenario:unknown-attribute -->
```json
[
  {
    "core": "Attribute \"extra\" is not declared by the exact attrs schema at [].",
    "message": "[ReviewSchema] attribute `extra` is not allowed by this exact Schema.",
    "precision": "exact",
    "slice": "extra",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.missing-attribute

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<button/>`.
- Schema: `define(s => s.button(s.attrs({ id: s.string })))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: Only existing code/path/expected/received/attributeName, sidecars and precision are used; no English parsing.

<!-- scenario:missing-attribute -->
```json
[
  {
    "core": "Required attribute \"id\" is missing at [].",
    "message": "[ReviewSchema] Required attribute `id` is missing. (Anchored to existing source; required structure is absent.)",
    "precision": "anchor",
    "slice": "/>",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.missing-flag

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<button/>`.
- Schema: `define(s => s.button(s.attrs({ disabled: s.flag })))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: safe under strict absent-flag/current-owner conditions.
- Evidence limitation: Only existing code/path/expected/received/attributeName, sidecars and precision are used; no English parsing.

<!-- scenario:missing-flag -->
```json
[
  {
    "core": "Required attribute \"disabled\" is missing at [].",
    "message": "[ReviewSchema] Required flag `disabled` is missing. (Anchored to existing source; required structure is absent.)",
    "precision": "anchor",
    "slice": "/>",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.repeat-short

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<div <button/>/>`.
- Schema: `define(s => s.div(s.repeat(2, s.button())))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: No typed count, surplus span or missing-child contract arrives; expected/received contain length descriptions.

<!-- scenario:repeat-short -->
```json
[
  {
    "core": "Expected counted repeat length 2 at []; received length 1.",
    "message": "[ReviewSchema] Required `1` is missing. (Anchored to existing source; required structure is absent.)",
    "precision": "anchor",
    "slice": "/>",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.repeat-long

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<div <button/> <button/>/>`.
- Schema: `define(s => s.div(s.repeat(1, s.button())))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: No typed count, surplus span or missing-child contract arrives; expected/received contain length descriptions.

<!-- scenario:repeat-long -->
```json
[
  {
    "core": "Expected counted repeat length 1 at []; received length 2.",
    "message": "[ReviewSchema] Schema validation failed for this value (TUPLE_INDEX_OUT_OF_RANGE).",
    "precision": "exact",
    "slice": "<div <button/> <button/>/>",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.attribute-throw

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `<button count="bad"/>`.
- Schema: `define(s => s.button(s.attrs({ count: s.string.constrain("never throws?", () => { throw new Error("predicate exploded"); }) })))`.
- Trigger: admitted source violates the shown Schema (predicate throws; caught by attribute validation).
- Precision and related: actual lowerer/presenter values below.
- Future fix: none.
- Evidence limitation: Exception and label discarded; TYPE_MISMATCH has no expected/received.

<!-- scenario:attribute-throw -->
```json
[
  {
    "core": "Attribute \"count\" at [] is invalid: Attribute value is not admitted by its schema.",
    "message": "[ReviewSchema] Expected attribute `count`: a compatible Schema value; received an incompatible value.",
    "precision": "exact",
    "slice": "\"bad\"",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.root-mismatch

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `1`.
- Schema: `define(s => s.tuple(s.button()))`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: suggestion only.
- Evidence limitation: Only existing code/path/expected/received/attributeName, sidecars and precision are used; no English parsing.

<!-- scenario:root-mismatch -->
```json
[
  {
    "core": "Expected fragment document root; received projected root.",
    "message": "[ReviewSchema] Expected this value: fragment document root; received projected root.",
    "precision": "exact",
    "slice": "1",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.invalid-capability

- Category / owner: B core issue; A adapted editor text.
- Authored HSON: `1`.
- Schema: `({})`.
- Trigger: admitted source violates the shown Schema.
- Precision and related: actual lowerer/presenter values below.
- Future fix: none.
- Evidence limitation: Only existing code/path/expected/received/attributeName, sidecars and precision are used; no English parsing.

<!-- scenario:invalid-capability -->
```json
[
  {
    "core": "Expected a complete-root-capable owned Schema; received unsupported Schema.",
    "message": "[ReviewSchema] Schema validation failed for this value (INVALID_SCHEMA).",
    "precision": "exact",
    "slice": "1",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.tagged

- Category / owner: B core issue, adapted by A editor bank.
- Authored HSON: `<kind "other">`.
- Schema: `define(s => s.tagged("kind", { draft: s.object({}), published: s.object({}) }))`.
- Trigger: no alternative admits the authored value.
- Precision / related: actual mapped values below.
- Future fix: suggestion only.
- Evidence limitation: closest-branch failures do not prove that this branch is the only valid choice. Projected tagged validation returns the closest branch without an aggregate alternative list. Document pick returns its aggregate issue PLUS the closest branch's issues. The editor has no branch provenance, and cannot safely rewrite these into global requirements. This potentially misleading wording is retained pending structured branch evidence; no new evidence or semantics were invented.

<!-- scenario:tagged -->
```json
[
  {
    "core": "LiveMap schema expected \"draft\" at [\"kind\"], received \"other\"",
    "message": "[ReviewSchema] Expected `kind` to equal \"draft\"; found \"other\".",
    "precision": "exact",
    "slice": "\"other\"",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

### scenario.document-pick

- Category / owner: B core issue, adapted by A editor bank.
- Authored HSON: `<main <em/>/>`.
- Schema: `define(s => s.main(s.pick(s.button(), s.span())))`.
- Trigger: no alternative admits the authored value.
- Precision / related: actual mapped values below.
- Future fix: suggestion only.
- Evidence limitation: closest-branch failures do not prove that this branch is the only valid choice. Projected tagged validation returns the closest branch without an aggregate alternative list. Document pick returns its aggregate issue PLUS the closest branch's issues. The editor has no branch provenance, and cannot safely rewrite these into global requirements. This potentially misleading wording is retained pending structured branch evidence; no new evidence or semantics were invented.

<!-- scenario:document-pick -->
```json
[
  {
    "core": "Expected an allowed document item at [0]; received element <em>; no pick branch matched.",
    "message": "[ReviewSchema] Expected `0`: an allowed document item; received element <em>.",
    "precision": "exact",
    "slice": "<em/>",
    "related": "Schema requested by this validate call (ReviewSchema)."
  },
  {
    "core": "Expected tag \"button\" at [0]; received \"em\".",
    "message": "[ReviewSchema] Expected element tag \"button\"; found \"em\".",
    "precision": "exact",
    "slice": "<em/>",
    "related": "Schema requested by this validate call (ReviewSchema)."
  }
]
```

## 14. Syntax examples — authoritative inherited messages

Each record comes from the actual standalone editor adapter. Category B message, with A related-source labeling. Schema: not applicable. Precision is exact point/EOF as recorded. Future fix: suggestion only unless a separate strict repair proof exists. A tokenizer point is often the opening delimiter or first name character, not the entire erroneous construct. Incomplete source does not necessarily point at EOF. These samples do not replace the complete baseline templates below.

### syntax.invalid-primitive

- Authored HSON: "+1".
- Trigger: invalid primitive; exact code and message below.
- Owner: `src/api/transform/parsers/tokenize-hson.ts`, wrapped by `src/core/errors.ts:91`; inherited verbatim.
- Precision / related: actual adapter output below.
- Evidence limit / fix: only the emitted point and role evidence is available; suggestion only, no correction inferred.

<!-- syntax:invalid-primitive -->
```json
[
  {
    "message": "[ERR: transform = tokenize-hson()]:\n  -> invalid HSON number \"+1\" at 1:1 (index 0)",
    "code": "HSON_NUMBER_LEADING_PLUS",
    "precision": "point",
    "slice": "+",
    "related": []
  }
]
```

### syntax.unsupported-quote

- Authored HSON: "'bad'".
- Trigger: unsupported quote; exact code and message below.
- Owner: `src/api/transform/parsers/tokenize-hson.ts`, wrapped by `src/core/errors.ts:91`; inherited verbatim.
- Precision / related: actual adapter output below.
- Evidence limit / fix: only the emitted point and role evidence is available; suggestion only, no correction inferred.

<!-- syntax:unsupported-quote -->
```json
[
  {
    "message": "[ERR: transform = tokenize-hson()]:\n  -> unsupported quote delimiter (use double quotes only) at 1:1 (index 0)",
    "code": "HSON_QUOTE_KIND_UNSUPPORTED",
    "precision": "point",
    "slice": "'",
    "related": []
  }
]
```

### syntax.malformed-member

- Authored HSON: "<age>".
- Trigger: malformed member; exact code and message below.
- Owner: `src/api/transform/parsers/tokenize-hson.ts`, wrapped by `src/core/errors.ts:91`; inherited verbatim.
- Precision / related: actual adapter output below.
- Evidence limit / fix: only the emitted point and role evidence is available; suggestion only, no correction inferred.

<!-- syntax:malformed-member -->
```json
[
  {
    "message": "[ERR: transform = tokenize-hson()]:\n  -> object member \"age\" is missing its value at 1:2 (index 1)",
    "code": "missing-object-member-value",
    "precision": "point",
    "slice": "a",
    "related": []
  }
]
```

### syntax.incomplete-source

- Authored HSON: "<age 1".
- Trigger: incomplete source; exact code and message below.
- Owner: `src/api/transform/parsers/tokenize-hson.ts`, wrapped by `src/core/errors.ts:91`; inherited verbatim.
- Precision / related: actual adapter output below.
- Evidence limit / fix: only the emitted point and role evidence is available; suggestion only, no correction inferred.

<!-- syntax:incomplete-source -->
```json
[
  {
    "message": "[ERR: transform = tokenize-hson()]:\n  -> unterminated angle construct at 1:1 (index 0)",
    "code": "HSON_CONTAINER_UNTERMINATED",
    "precision": "point",
    "slice": "<",
    "related": []
  }
]
```

### syntax.empty-source

- Authored HSON: "".
- Trigger: empty source; exact code and message below.
- Owner: `src/api/transform/parsers/parse-hson.ts:43`, wrapped by `src/core/errors.ts:91`; inherited verbatim.
- Precision / related: actual adapter output below.
- Evidence limit / fix: only the emitted point and role evidence is available; suggestion only, no correction inferred.

<!-- syntax:empty-source -->
```json
[
  {
    "message": "[ERR: transform = parse_hson()]:\n  -> empty, whitespace-only, or comment-only HSON source has no semantic value",
    "code": "HSON_SOURCE_EMPTY",
    "precision": "eof",
    "slice": "",
    "related": []
  }
]
```

### syntax.duplicate-member

- Authored HSON: "<age 1 age 2>".
- Trigger: duplicate member; exact code and message below.
- Owner: `src/api/transform/parsers/tokenize-hson.ts`, wrapped by `src/core/errors.ts:91`; inherited verbatim.
- Precision / related: actual adapter output below.
- Evidence limit / fix: only the emitted point and role evidence is available; suggestion only, no correction inferred.

<!-- syntax:duplicate-member -->
```json
[
  {
    "message": "[ERR: transform = tokenize-hson()]:\n  -> [duplicate-object-member] duplicate HSON object member \"age\"; first declared at 1:2 (index 1) at 1:8 (index 7)",
    "code": "HSON_OBJECT_DUPLICATE_MEMBER",
    "precision": "point",
    "slice": "a",
    "related": [
      {
        "message": "Related HSON source (first-declaration).",
        "slice": "a"
      }
    ]
  }
]
```

### syntax.duplicate-attribute

- Authored HSON: "<button id=a id=b/>".
- Trigger: duplicate attribute; exact code and message below.
- Owner: `src/api/transform/parsers/tokenize-hson.ts`, wrapped by `src/core/errors.ts:91`; inherited verbatim.
- Precision / related: actual adapter output below.
- Evidence limit / fix: only the emitted point and role evidence is available; suggestion only, no correction inferred.

<!-- syntax:duplicate-attribute -->
```json
[
  {
    "message": "[ERR: transform = tokenize-hson()]:\n  -> [duplicate-attribute] duplicate HSON attribute \"id\"; first declared at 1:9 (index 8) at 1:14 (index 13)",
    "code": "HSON_ELEMENT_DUPLICATE_ATTRIBUTE",
    "precision": "point",
    "slice": "i",
    "related": [
      {
        "message": "Related HSON source (first-declaration).",
        "slice": "i"
      }
    ]
  }
]
```

### syntax.unexpected-closer

- Authored HSON: ">".
- Trigger: unexpected closer; exact code and message below.
- Owner: `src/api/transform/parsers/tokenize-hson.ts`, wrapped by `src/core/errors.ts:91`; inherited verbatim.
- Precision / related: actual adapter output below.
- Evidence limit / fix: only the emitted point and role evidence is available; suggestion only, no correction inferred.

<!-- syntax:unexpected-closer -->
```json
[
  {
    "message": "[ERR: transform = tokenize-hson()]:\n  -> unexpected structural closer \">\" at 1:1 (index 0)",
    "code": "HSON_TOKENIZATION_ERROR",
    "precision": "point",
    "slice": ">",
    "related": []
  }
]
```

## 15. Status / availability review and exact labels

Every row below is an authoring example with valid HSON `<age 37>`; the differing condition is infrastructure, not authored invalidity. Owner A for the label/stock tooltip, C for supplied runtime messages. Precision: status/infrastructure. Related information: none. Future deterministic authored fix: none. A missing diagnostic is never proof of Schema validity.

| State | Trigger | Exact status-bar text | Tooltip without supplied detail |
| --- | --- | --- | --- |
| off | Explicit enablement off or workspace untrusted | HSON Schema: off | bank.unavailableSchemaStatus |
| waiting | Debounce, startup/load, or fresh interpolation evaluation pending | HSON Schema: waiting | bank.unavailableSchemaStatus |
| current-valid | At least one current check; no invalid result, no higher-priority unavailable state | HSON Schema: current-valid | bank.currentSchemaStatus |
| current-invalid | Current check produced one or more invalid diagnostics | HSON Schema: current-invalid | bank.currentSchemaStatus |
| stale | Revision/generation retired, or dirty provider prevents current evidence | HSON Schema: stale | bank.unavailableSchemaStatus |
| ambiguous | Multiple registrations, applications, or captures occupy the relationship | HSON Schema: ambiguous | bank.unavailableSchemaStatus |
| unavailable | No configured client, discoverable association, current binding, or usable result | HSON Schema: unavailable | bank.unavailableSchemaStatus |
| runtime-failed | Runtime/IPC/load/validation execution failed | HSON Schema: runtime-failed | bank.unavailableSchemaStatus |

Supplied `message` always overrides those defaults, including empty string. Exact current runtime payloads and their triggering source conditions are in the “Trusted runtime and availability” census section. There are no additional stock messages “Schema loading”, “Schema timed out”, “Schema crashed”, or “Schema declaration here”.

### Runtime exemplars

All use `<age 37>` with an otherwise registered number Schema unless noted; category C, inherited verbatim as tooltip, precision status/infrastructure, related none, no authored-text fix. These are representative rendered values; the complete dynamic formatter is in the baseline.

| Stable owner reference | Condition / evidence | Representative exact tooltip |
| --- | --- | --- |
| runtime.handle generation check | request belongs to retired generation | Stale runtime generation. |
| runtime.associateSource object set | one binding maps to two Schema objects | Source binding maps to different Schema objects. |
| runtime.load registration conflict | same handle points to different objects | Conflicting Schema handles. |
| runtime.associateSource no binding | requested Schema has no matching current registration | No current registered source binding. |
| runtime.load configured runtime | configured facade lacks validator runtime identity | Configured runtime is not the D1 validator's supported runtime instance. |
| node-supervisor request timeout | elapsed deadline is 1000ms in this example; actual elapsed time is rounded | Trusted Schema request timed out after 1000ms. |
| node-supervisor disconnect listener | worker crash/disconnect; no cause inferred from the event | Trusted Schema runtime disconnected. |
| node-supervisor retirement | explicit retirement invalidates current generation | Trusted Schema runtime retired. |
| node-supervisor restart budget | bounded replacement attempts exhausted | Trusted Schema runtime restart budget exhausted; create a new owner to retry. |
| runtime.load non-Error throw | module throws `42`, no Error.message | Project module failed to load. |
| runtime.validate non-Error throw | non-attribute constraint callback throws `42` | Schema validation threw unexpectedly. |
| runtime.validate Error throw | non-attribute predicate throws `new Error("predicate exploded")` | predicate exploded |
| node-runtime-entry catch | dispatcher rejects with non-Error | Runtime failure. |
| node-supervisor trust gate | either trust gate false when calling supervisor directly | Trusted Schema diagnostics require Workspace Trust and explicit enablement. |

Timeout and crash retain `runtime-failed`, not an authored Schema violation. Error instances from Node, IPC, module loading and user predicates carry arbitrary verbatim text; their values cannot have a finite literal inventory. Non-Error values use the fixed boundary fallback. Public `HSON.validate` failure throws `HSON Schema validation failed.` from `src/internal/schema-hson-validation/validate-canonical-hson.ts:13`; that public text stays D-owned when observed through module/callback failure. Its issues are independently validated/formatted for editor diagnostics.

### Suppressed and adapted language (reachability audit)

- `runtime.ts:199` returns candidate parser Error.message or `Candidate HSON is invalid.` with `CANDIDATE_INVALID`. The client sets unavailable but does NOT copy that response.message into the tooltip. Secure syntax/admission diagnostics are the user-facing source error. Cataloged as runtime-owned, not an additional live Schema diagnostic.
- `runtime.ts:63` retains partial module load Error.message or `Project module failed to load.` after captured evaluations. The client receives it as loaded.loadFailure. This is a second call site for the same runtime fallback at line 125; it can accompany remaining captured diagnostics without certifying that the module finished.
- `runtime.complete` failures “No current completion contract.”, “No current interpolation evidence.” and “Completion contract retired.” are mapped to completion availability; the current completion provider does not display their message. “Completion traversal bound” is caught in the query and yields unavailable, not a user-visible diagnostic.
- `lifecycle-evidence.ts:125` “Unrecognized projected Schema capability.” and document schema-use root-mode errors are caught into attachment evidence. The runtime does NOT transport that attachment Error.message as a source diagnostic. The subsequent graph validation supplies structured issues.
- No current normal complete-root validation emits UNKNOWN_PATH. Its core validator/selection APIs own it; the editor's code-only fallback is defensive and covered without inventing a source path. INVALID_SCHEMA recursion/constraint guards are similarly defensive for recognized builders.
- Serializer/invariant defenses are reachable shared code but many cannot be produced by an admitted HSON graph. They remain B/D-owned and are listed, not portrayed as ordinary author mistakes. Non-Transform errors in secure syntax go to unexpected console output; recognized TransformErrors map using existing source evidence or body fallback.
- `map-transform-error.ts` returns machine reason codes (source missing, invalid index/descriptor, coordinate warnings), not English diagnostics. The current extension adapters supply the messages. No extra English precision labels are hidden there.
- Schema-declaration range metadata exists for binding discovery, but there is NO current declaration-related diagnostic label. Related information currently targets only the validation/use call and Transform first-declaration roles.

## 16. Structured evidence and outstanding copy-quality gaps

Source evidence is authoritative: `TrustedSchemaDiagnostic` in `src/internal/trusted-schema-diagnostics/protocol.ts` transports code, path, expected, received, attributeName, range and optional hostOrigin/tag/flag/constraintLabel sidecars. `issue-presentation.ts` stores the tag/flag/label evidence in a WeakMap; runtime copies it before transport. Projected/document lowerers supply exact/anchor/unresolved ranges. Discovery supplies schemaLabel and callRange/mapFlow. No editor message reads or parses `issue.message`.

| Evidence gap | Current behavior | Needed for later polish (not implemented) |
| --- | --- | --- |
| Projected pick/tagged alternatives | Closest object branch can be shown as if it were the only required literal | Branch identity, aggregate alternatives, and relation of branch issues to the overall failure |
| Document pick | Aggregate plus selected closest branch; two messages may cover one element | Structured alternative and child-contract evidence |
| Missing complex child/member | Last path segment only; `Required 0`/member name, anchor suffix | Missing child/member contract and distinguish position from member |
| Repeat/closed sequence counts | expected/received contain `length N`; current renderer ignores them for missing/surplus codes | Typed expected/actual count, count-rule kind, missing index/surplus span |
| Unknown exact key | Name only, no allowed-key set | Allowed keys as structured data; no parsing Schema prose |
| Finite literals | expected is already formatted with ` \| ` separators; literal values may themselves contain separators | Structured literal array, not parsing this string |
| Constraint without label | Generic “its Schema constraint” | Meaningful optional metadata; do not require labels or change API |
| Caught attribute predicate exception | TYPE_MISMATCH with no expected/received/label; underlying exception discarded | Internal exception-vs-invalid evidence and optional label preservation; semantic change requires its own pass |
| Partial literal/flag/tag evidence | Defensive probes preserve current `undefined` interpolation | Explicit optional-evidence fallback contract; current normal producers supply these fields |
| Source mapping unavailable | Whole occurrence; static fromHson also gets legacy “Template-level” | Optional truthful occurrence-kind wording using existing source kind |
| Runtime unavailable | Several distinct causes share stock tooltip | Structured availability reason if later desired; do not infer from absence |
| Document tag | Whole-element coverage even when prose names the tag | Tag-name provenance selection, separate placement decision |

Constraint labels: successful base validation followed by false predicate produces INVALID_CONSTRAINT plus the outer failing constraint label. An unlabeled predicate produces no label and generic wording. An empty label remains present, rendering empty curly quotes. A failed base type or inner constraint does not inherit an unrelated outer label. Projected predicate throws escape as runtime execution failures; caught attribute predicate throws lose the label and are currently generic type mismatches. Richer domain wording cannot be justified from an unlabeled function's source.

### Core description vocabulary (inherited field formatting)

Owner/category B: `src/api/livemap/livemap.schema.ts:1708` (`schema_kind_label`, `json_value_type_label`, `projected_admission_received`) and `src/api/livemap/livemap.document.schema.ts:785` (`describe_item`, `describe_root`). These are structured-field descriptions, not English-message parsing. Literal alternatives are individually JSON-serialized and joined with ` | `; picks join branch descriptions the same way, falling back to `pick` for no descriptions. Undefined recursion uses `recurse`; constraints use their label or `constraint`; nullable kinds use `${node.kind} | null`; other kinds use their kind string. Received kinds are `null`, `array` or `typeof value`; invalid projected admission uses `undefined`, `non-finite number`, or the lowercase error code with underscores replaced by spaces. Document descriptions include `text`, `element <${tag}>`, `structural node <${tag}>`, and root descriptions `<${root.$_tag}>`. A type string here is not a typed allowed-value/branch list. Representative sources and complete rendered results are in the Schema scenarios. Precision and related information come from the issue's consumer; suggestion only, except no general fix for invalid internal descriptions.

## 17. Future fix inventory — no code actions implemented

| Family | Classification | Strict limitation |
| --- | --- | --- |
| Projected quoted numeric/boolean/null scalar | safe possible | Existing exact scalar range, decoded string is exactly an admitted finite primitive of the required kind; preserve negative zero and escaping; not attributes or substitution expressions; revalidation may still fail constraints |
| Missing flag | safe possible | Proven missing flag, current owning element and Schema, unambiguous insertion position; not a guessed ordinary attribute |
| Literal choice, wrong tag/type/root, branch choice | suggestion only | User intent chooses among values/contracts |
| Missing complex member/child/tuple item or count shortfall | suggestion only | No default structure/value is provided |
| Unknown member/attribute, extra item/child | suggestion only | Removal is destructive; never automatic |
| Invalid syntax / quoting / incomplete source | suggestion only | Multiple plausible parses/intentions; no general unique repair |
| Arbitrary labeled/unlabeled constraint | none | Labels describe metadata, not a repair algorithm |
| Caught predicate exception / runtime load, crash, timeout, trust or stale state | none | Infrastructure or code issue, not a mechanically repairable authored token |
| Exact/anchor/unresolved notes and related-site wrappers | none | Placement/context only |

## 18. Adjacent authoring text retained at its owner

These are not diagnostics, but are included so copy reviewers do not miss user-visible completion or trust explanations. Category A manifest-owned metadata or B core-completion detail. They remain outside the diagnostic bank because VS Code reads declarative package metadata and the core completion query owns its detail contract. No second executable copy was introduced.

### completion.details

Owner `src/internal/schema-completion/query.ts:82,114,167,177,199`. Trigger: eligible declarative literal/member/tag/attribute/flag completion at `< >` or `<button />` with a matching Schema. Range: current completion replacement span; not a diagnostic. Related: none. Fix: suggestion only. Limit: these are declarations, not proof predicates will pass. The editor prepends bank.schemaCompletionDetail.

```ts
"declarative literal (constraints still validate)"
`${required ? "required" : "optional/branch-dependent"} member${nodes.some(n => !n.exact) ? " (known declaration; open object)" : ""}`
`<${node.tag}> element (multiple contracts; choose attrs/content explicitly)`
`<${node.tag}> element`
`${rule.optional ? "optional" : "required"} ${rule.flag ? "flag" : "attribute"}${element.attrs?.exact ? "" : " (known declaration; open attrs)"}`
```

### manifest.trust-and-settings

Owner `editors/vscode-hson/package.json` at `capabilities.untrustedWorkspaces.description` and `contributes.configuration`. Trigger: Restricted Mode/settings UI, any source such as `<age 37>`. Schema condition: configuration only. Precision: status/infrastructure. Related: none. Fix: none. Language is declarative manifest metadata, not a source diagnostic.

```text
Syntax tooling works in Restricted Mode. Trusted Schema diagnostics execute project code only with Workspace Trust and explicit enablement.
HSON trusted Schema diagnostics
Explicitly allow trusted project Schema execution. Also requires Workspace Trust. Not a sandbox.
Trusted Schema registration module path relative to the workspace folder. Prefer a Schema-only module, not the application entrypoint.
Path to the project's hson.js facade (same runtime instance as its private D1 entry).
Optional private D1 Node entry path; defaults beside hson.js under internal/trusted-schema-diagnostics.
Explicit trusted Node loader arguments, if required by the configured project runtime.
```

Diagnostic source labels are `HSON` (syntax/runtime admission) and `HSON Schema` (Schema problems). Output channel label: `HSON Schema diagnostics`. They identify product surfaces, not error assertions. Timing output is JSON field data, not additional English prose.

## 19. Separate color work — deliberately deferred

Normal/theme-respecting default highlighting remains unchanged. A possible optional named colorway is separate future work. Recorded minimum visual requirement before authoring closure: H blue, S yellow, O orange, N green. This pass changes no grammar, semantic scope, theme mapping, styling or color setting.

## 20. Review maintenance and test reconciliation

Run `npm run test:schema-d2-presentation`. It runs the existing presentation suite plus direct message-bank cases, exact composed/related/precision tests, real Schema and syntax catalog snapshots, and runtime/supervisor wording checks. Every exported bank ID must be unique, tested, and present in the catalog; every catalog bank ID must exist. Each direct sample's exact text block must appear under its own ID. Every bank export must have an immediately preceding maintainer comment. Scenario snapshots assert core and editor messages, source slices/precision, and related text.

The catalog is intentionally a static review document, not a generated language source. No public export or launcher was added: helper test modules join the existing registered presentation suite, leaving the 169-script / 161-launcher diagnostics inventory unchanged. Runtime timeout interpolation uses an exact anchored template assertion because measured milliseconds are intentionally variable. Other exact tests use literal expectations or explicit catalog snapshots. The baseline below remains pinned historical evidence; core/runtime files were not edited.

## 21. Implementation and completion report

1. Pre-edit census: clean `821ab89`, 66 modules inspected and 390 emission/formatting sites recorded below, followed by the manual reachability/description/manifest audit above. This is a source-site inventory, not a claim of 390 unique sentences. No prior bank/catalog pass was found; D6 and baseline-repair documentation explicitly deferred it.
2. Files added: this catalog; `editors/vscode-hson/src/diagnostic-messages.ts`; `tests/hson-message-bank-review.mts`; `tests/hson-message-scenarios.mts`; `tests/hson-runtime-message-review.mts`.
3. Files changed: `editors/vscode-hson/src/{document-diagnostics,extension,highlighting,schema-diagnostics,schema-presentation,tag-admission,trusted-schema-client}.ts` and `tests/schema-d2-presentation.acceptance.mts`. The highlighting edit only imports its infrastructure-error message.
4. Final editor bank: `editors/vscode-hson/src/diagnostic-messages.ts`. Final review catalog: `docs/hson-authoring-message-catalog.md`.
5. Stable IDs: all 33 names below; source comments directly precede every entry. No generated registry or giant anonymous switch.
6. Ownership retained: tokenizer/parser/serializer, canonical invariant and QUID/number errors, Schema issue strings and constructors, public HSON/LiveMap errors, trusted-runtime/supervisor/registration strings, declarative package metadata and core completion detail. Editor formatting uses existing evidence only; core English is not parsed.
7. Exact current inventory: bank variants in sections 1–12, core/adapted snapshots in 13–14, status/runtime inventory and suppression notes in 15, inherited description vocabulary in 16, adjacent text in 18, and the complete pinned source expressions below. Interpolated values and external Error.message remain variable inputs.
8. Representative entries: number/string mismatch, missing/unknown member, finite literals, tuples, tagged/pick, both constraint-label forms, document tags/content/attrs/flags, counted repeats, caught attribute throw, root capability, syntax, exact/anchor/unresolved/composite/expression placement, status, timeout and crash.
9. Evidence: issue code, path, expected/received, attributeName, tag/flag/constraintLabel WeakMap sidecars, lowerer precision/range, hostOrigin scalar kind/range, discovery schemaLabel/callRange/mapFlow, runtime status and supplied message. No new protocol evidence.
10. Gaps: branches/tagged alternatives; complex missing children; typed repeat/count/surplus evidence; allowed exact keys; structured literal arrays; unlabeled constraints; caught attribute exceptions; legacy missing-evidence and Template-level fallbacks. See section 16.
11. Constraint labels: retained for false predicates after base success; unlabeled remains generic; empty label stays explicit; caught attribute throws lose label/exception; no label/API requirement introduced.
12. Future fixes: strict projected scalar unquoting and absent-flag insertion may be safe; literals/structure/removal require suggestions; constraints/runtime/placement have no general repair. No code actions.
13. Exact message suite: `npm run test:schema-d2-presentation` — **137 checks passed**: 20 existing presentation, 7 composed/evidence tests, 58 direct bank variants, 8 statuses, 2 reconciliation/comment checks, 25 real Schema scenarios, 8 syntax snapshots, 9 runtime/supervisor checks.
14. Reconciliation: exported bank names equal unique catalog headings and tested IDs; literal expected text is present under its own heading; source exports require preceding comments. Scenario snapshots compare exact core/editor strings, precision, selected source and related information. Runtime elapsed milliseconds use an anchored dynamic-template assertion.
15. Regressions: all commands listed below passed. Real VS Code **1.95.3**, trusted and Restricted Mode, passed D2–D6 integration. Non-failing host output included an unrelated parent-directory file-watch permission warning, chat-registry fetch failure, font/IPC-path warnings, and utility-process shutdown notices; both test runs exited successfully. No unrelated hosted certification run.
16. Public API impact: **none**. No `src/` library file, package export, Schema/HSON/LiveMap API, public error, diagnostic protocol, provenance type, LiveTree prototype or runtime identity changed. No color treatment implemented.
17. Git status: 8 modified tracked files, 5 new untracked files; all scoped above. No staging or commit. Ignored extension build/test artifacts refreshed. `git diff --check` passed.
18. Suggested commit (not executed): `refactor(vscode): centralize authoring diagnostic messages and add review catalog`.

Stable bank IDs (prefix each with `bank.` in the catalog):

```text
hsonValidationFailed
hsonAdmissionFailed
diagnosticSubject
primitiveTypeMismatch
requiredValueMissing
exactMemberUnknown
literalMismatch
schemaTypeMismatch
schemaValidationFailed
documentTagMismatch
requiredFlagMissing
constraintFailed
substitutionEvaluation
substitutionTypeMismatch
substitutionLiteralMismatch
substitutionConstraintFailed
substitutionValidationFailed
anchoredLocationNote
unresolvedLocationNote
compositeLocationNote
schemaDiagnostic
schemaStatusLabel
currentSchemaStatus
unavailableSchemaStatus
schemaStatusTooltip
schemaRuntimeFailed
runtimeFailed
unexpectedDiagnosticsFailure
slowSchemaRequest
missingPackagedGrammar
schemaRequestRelated
hsonSourceRelated
schemaCompletionDetail
```

### Regression commands / results

Repository root — all PASS:

```sh
npm run check
npm run test:schema-d2-presentation
npm run test:trusted-schema-d1
npm run test:schema-d2-discovery
npm run test:schema-d2-runtime
npm run test:schema-d2-editor
npm run test:schema-d3-discovery
npm run test:schema-d3-runtime
npm run test:schema-d3-editor
npm run test:schema-d4-editor
npm run test:schema-d4-performance
npm run test:hson-d5-mapping
npm run test:trusted-d5-capture
npm run test:schema-d5-editor
npm run test:schema-d5-performance
npm run test:schema-editor-completion
npm run test:schema-projected-completion
npm run test:schema-document-completion
npm run test:schema-completion-performance
npm run test:diagnostics-inventory
npm run test:public-boundaries
npm run test:root-compatibility
npm run test:hson-authoring-package
npm run test:livemap-projected-schema-source-lowering
npm run test:livemap-document-schema-source-lowering
npm run test:embedded-hson-diagnostic-mapping
npm run test:hson-tagged-template
npm run test:hson-tokenizer
git diff --check
```

`editors/vscode-hson` — all PASS:

```sh
npm run check
npm run build
npm run test:unit
npm run test:integration
```

The extension unit suite passed 32 checks. Diagnostics inventory remained 169 test scripts / 161 registered launchers; public boundaries passed 6 checks; root compatibility retained 109 runtime exports; authoring package checks passed 10. No new package test script or public launcher needed.

## Pre-edit census — immutable baseline at `821ab89`

Recorded before production edits on 2026-08-28. The worktree was clean. D6 and baseline-repair notes explicitly deferred this pass; no prior bank/catalog implementation was found.

The mechanical sweep followed local runtime imports from HSON admission, parsing, and serialization, and scanned editor, trusted-runtime, and Schema owners: 66 modules, 390 emission/formatting sites (not unique rendered sentences). It inspected TypeScript AST calls to `_throw_transform_err`, lexer `fail`, Schema `issue`/`validation_issue`, runtime `error`, Error constructors, message/reason fields, editor return/placement/status expressions, and invariant accumulation. Call sites, repeated uses, interpolated wrappers, and defensive paths are deliberately retained. A subsequent manual reachability audit and concrete examples appear above. External module, Node/IPC, and user callback Error.message text are unbounded inputs, not finite bank entries.

Source locations below are pinned to the pre-edit revision; use the stable editor IDs above for the current owners. Expressions in TypeScript fences are exact source templates, including punctuation and every conditional branch, not proposed wording. `${...}` denotes runtime substitution, not literal user-facing characters. Transform payloads acquire `[ERR: transform = ${functionName}()]:\n  -> ${message}${ctxLine}`; lexer payloads first acquire ` at ${pos.line}:${pos.col} (index ${pos.index})`. `ctxLine` is empty or `\n  :: ${ctx}`. Schema issue.message is NOT read by the editor; its structured fields drive the bank instead.

Ownership: A = editor/presentation; B = core Transform/Schema; C = trusted runtime/status; D = public API/runtime defensive errors (not editor-owned). “Inherited” never authorizes editing these strings in the bank.

Per-site authored contexts illustrate the semantic family, not a claim that every defensive emission is independently reachable from those bytes. Earlier admission guards may win. The executable examples above are exact verified reproductions. Programmatic corrupt graphs, cursor states and malformed Schema builders have no truthful authored-source-only reproducer; these are marked N/A/context-only rather than invented.

### Census: Editor presentation — pre-migration

#### baseline.000

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/document-diagnostics.ts:79` at pre-edit `821ab89`.
- Trigger: `relatedFromDetails`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
`Related HSON source (${item.role}).`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.001

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/document-diagnostics.ts:99` at pre-edit `821ab89`.
- Trigger: `transform_error_to_standalone_diagnostic`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
error instanceof Error ? error.message : "HSON validation failed."
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.002

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/document-diagnostics.ts:153` at pre-edit `821ab89`.
- Trigger: `staticTransformDiagnostic`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
`Related HSON source (${item.role}).`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.003

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/document-diagnostics.ts:156` at pre-edit `821ab89`.
- Trigger: `staticTransformDiagnostic`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
error instanceof Error ? error.message : "HSON validation failed."
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.004

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/extension.ts:47` at pre-edit `821ab89`.
- Trigger: `activate`; emission `console.error`.
- Rendered payload / exact formatter expression:

```ts
`HSON diagnostics failed for ${document.fileName}`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.005

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/extension.ts:113` at pre-edit `821ab89`.
- Trigger: `activate`; emission `statusBar.text`.
- Rendered payload / exact formatter expression:

```ts
`HSON Schema: ${state?.status ?? "off"}`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.006

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/extension.ts:114` at pre-edit `821ab89`.
- Trigger: `activate`; emission `statusBar.tooltip`.
- Rendered payload / exact formatter expression:

```ts
state?.message ?? (state?.status === "current-valid" || state?.status === "current-invalid"
      ? "Current authored source checked using trusted runtime evidence. Stateful predicates may change."
      : "Trusted Schema diagnostics require Workspace Trust, explicit enablement, and a current registered source binding. No diagnostics does not mean Schema passed.")
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.007

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/extension.ts:173` at pre-edit `821ab89`.
- Trigger: `measure / result.measurement.endToEndMs >= 2_000`; emission `output.appendLine`.
- Rendered payload / exact formatter expression:

```ts
"Slow trusted diagnostic request (>= 2 seconds); includes cold load if this is the first request."
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.008

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/extension.ts:201` at pre-edit `821ab89`.
- Trigger: `provideCompletionItems`; emission `item.detail`.
- Rendered payload / exact formatter expression:

```ts
`HSON Schema: ${spec.detail}`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.009

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/highlighting.ts:33` at pre-edit `821ab89`.
- Trigger: `load_hson_grammar / !grammar`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"Missing packaged HSON grammar"
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.010

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-diagnostics.ts:45` at pre-edit `821ab89`.
- Trigger: `start_schema_diagnostics`; emission `options.status`.
- Rendered payload / exact formatter expression:

```ts
result.message
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.011

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-diagnostics.ts:50` at pre-edit `821ab89`.
- Trigger: `start_schema_diagnostics`; emission `options.status`.
- Rendered payload / exact formatter expression:

```ts
error instanceof Error ? error.message : "Runtime failed."
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.012

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-diagnostics.ts:65` at pre-edit `821ab89`.
- Trigger: `retire`; emission `options.status`.
- Rendered payload / exact formatter expression:

```ts
message
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.013

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:9` at pre-edit `821ab89`.
- Trigger: `schema_diagnostic_message / issue.hostOrigin?.kind === "substitution-expression"`; emission `evaluated`.
- Rendered payload / exact formatter expression:

```ts
`This expression evaluated to ${kind === "null" ? "HSON null" : `an HSON ${kind}`}`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.014

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:10` at pre-edit `821ab89`.
- Trigger: `schema_diagnostic_message / issue.hostOrigin?.kind === "substitution-expression" / issue.code === "TYPE_MISMATCH"`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
`${evaluated}, but the Schema requires ${issue.expected ?? "a different value"} here.`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.015

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:11` at pre-edit `821ab89`.
- Trigger: `schema_diagnostic_message / issue.hostOrigin?.kind === "substitution-expression" / issue.code === "INVALID_LITERAL"`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
`${evaluated}, but the Schema requires literal ${issue.expected} here.`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.016

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:12` at pre-edit `821ab89`.
- Trigger: `schema_diagnostic_message / issue.hostOrigin?.kind === "substitution-expression" / issue.code === "INVALID_CONSTRAINT"`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
`${evaluated} that does not satisfy ${issue.constraintLabel === undefined ? "its Schema constraint" : `constraint “${issue.constraintLabel}”`}.`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.017

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:13` at pre-edit `821ab89`.
- Trigger: `schema_diagnostic_message / issue.hostOrigin?.kind === "substitution-expression"`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
`${evaluated} that fails Schema validation (${issue.code}).`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.018

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:16` at pre-edit `821ab89`.
- Trigger: `schema_diagnostic_message`; emission `subject`.
- Rendered payload / exact formatter expression:

```ts
name === undefined ? "this value" : issue.attributeName === undefined ? `\`${name}\`` : `attribute \`${name}\``
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.019

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:17` at pre-edit `821ab89`.
- Trigger: `schema_diagnostic_message / issue.subject === "tag"`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
`Expected element tag ${issue.expected}; found ${issue.received}.`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.020

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:18` at pre-edit `821ab89`.
- Trigger: `schema_diagnostic_message / issue.subject === "flag" && issue.code === "MISSING_REQUIRED"`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
`Required flag \`${issue.attributeName}\` is missing.`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.021

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:19` at pre-edit `821ab89`.
- Trigger: `schema_diagnostic_message / issue.code === "MISSING_REQUIRED"`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
`Required ${subject} is missing.`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.022

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:20` at pre-edit `821ab89`.
- Trigger: `schema_diagnostic_message / issue.code === "UNKNOWN_KEY"`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
`${subject} is not allowed by this exact Schema.`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.023

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:21` at pre-edit `821ab89`.
- Trigger: `schema_diagnostic_message / issue.code === "INVALID_CONSTRAINT"`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
issue.constraintLabel === undefined
    ? `${subject} does not satisfy its Schema constraint.`
    : `${subject} does not satisfy constraint “${issue.constraintLabel}”.`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.024

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:24` at pre-edit `821ab89`.
- Trigger: `schema_diagnostic_message / issue.code === "INVALID_LITERAL"`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
`Expected ${subject} to equal ${issue.expected}; found ${issue.received}.`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.025

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:28` at pre-edit `821ab89`.
- Trigger: `schema_diagnostic_message / issue.code === "TYPE_MISMATCH" / ["number", "string", "boolean", "object", "array", "null"].includes(issue.expected ?? "")       && ["number", "string", "boolean", "object", "array", "null"].includes(issue.received ?? "")`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
`Expected ${subject} to be ${issue.expected === "null" ? "null" : `${issue.expected === "object" || issue.expected === "array" ? "an" : "a"} ${issue.expected}`}, but this value is an HSON ${issue.received}.`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.026

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:30` at pre-edit `821ab89`.
- Trigger: `schema_diagnostic_message / issue.code === "TYPE_MISMATCH"`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
`Expected ${subject}: ${issue.expected ?? "a compatible Schema value"}; received ${issue.received ?? "an incompatible value"}.`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.027

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:32` at pre-edit `821ab89`.
- Trigger: `schema_diagnostic_message`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
`Schema validation failed for ${subject} (${issue.code}).`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.028

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:43` at pre-edit `821ab89`.
- Trigger: `present_schema_diagnostic`; emission `locationNote`.
- Rendered payload / exact formatter expression:

```ts
issue.hostOrigin?.kind === "composite" ? " (Range spans multiple source origins; not a character-exact location.)"
    : precision === "anchor" ? " (Anchored to existing source; required structure is absent.)"
    : precision === "unresolved" ? " (Template-level diagnostic; exact source location unavailable.)" : ""
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.029

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:46` at pre-edit `821ab89`.
- Trigger: `present_schema_diagnostic`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
{
    message: `[${association.schemaLabel}] ${schema_diagnostic_message(issue)}${locationNote}`,
    range: mapped ?? occurrenceRange,
    precision, source: "HSON", code: issue.code,
    hostOrigin: issue.hostOrigin?.kind,
    related: [{ range: association.callRange, message: `Schema requested by this ${association.mapFlow === undefined ? "validate" : "map.schema.use"} call (${association.schemaLabel}).` }],
  }
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.030

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:47` at pre-edit `821ab89`.
- Trigger: `present_schema_diagnostic`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
`[${association.schemaLabel}] ${schema_diagnostic_message(issue)}${locationNote}`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.031

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/schema-presentation.ts:51` at pre-edit `821ab89`.
- Trigger: `present_schema_diagnostic`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
`Schema requested by this ${association.mapFlow === undefined ? "validate" : "map.schema.use"} call (${association.schemaLabel}).`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.032

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/tag-admission.ts:22` at pre-edit `821ab89`.
- Trigger: `diagnostic`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
error instanceof Error ? error.message : "HSON admission failed."
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.033

- Representative authored context: ``<age "37"> (see migrated bank entry for exact source/infrastructure condition)``.
- Schema condition: number member or infrastructure state specified in the matching bank entry.
- Owner/category: A; `editors/vscode-hson/src/tag-admission.ts:27` at pre-edit `821ab89`.
- Trigger: `diagnostic`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
`Related HSON source (${item.role}).`
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.034

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: A; `editors/vscode-hson/src/trusted-schema-client.ts:108` at pre-edit `821ab89`.
- Trigger: `validate / capture.failure !== undefined`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
failure.message
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.035

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: A; `editors/vscode-hson/src/trusted-schema-client.ts:174` at pre-edit `821ab89`.
- Trigger: `validate`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
error instanceof Error ? error.message : "Trusted Schema runtime failed."
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.036

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: A; `editors/vscode-hson/src/trusted-schema-client.ts:233` at pre-edit `821ab89`.
- Trigger: `failure`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
response.message
```

- Surface: Editor-owned before migration; see current stable bank entries for ownership and variants.
- Precision: exact / anchor / unresolved / status (see current bank entry).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

### Census: Public Schema construction and capability errors

#### baseline.037

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.document.schema.ts:240` at pre-edit `821ab89`.
- Trigger: `make_document_element_schema / tag !== undefined && (typeof tag !== "string" || tag.length === 0 || tag.startsWith("_hson_"))`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Document element schema tag must be a non-empty ordinary element tag."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.038

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.document.schema.ts:245` at pre-edit `821ab89`.
- Trigger: `make_document_element_schema / children.some((child) => document_attrs_node(child) !== undefined)`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Document attrs schema must appear at most once and as the first tag operand."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.039

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.document.schema.ts:334` at pre-edit `821ab89`.
- Trigger: `make_document_counted_repeat_schema / !Number.isSafeInteger(count) || count < 0`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Document repeat count must be a nonnegative safe integer."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.040

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.document.schema.ts:397` at pre-edit `821ab89`.
- Trigger: `require_item_node`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Document schema composition requires a document item schema."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.041

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.document.schema.ts:445` at pre-edit `821ab89`.
- Trigger: `require_document_root_schema / (typeof value !== "object" && typeof value !== "function") || value === null`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Document map schema.use(...) requires an element or fragment root schema."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.042

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.document.schema.ts:448` at pre-edit `821ab89`.
- Trigger: `require_document_root_schema / node === undefined`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Document map schema.use(...) requires an element or fragment root schema."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.043

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.document.schema.ts:451` at pre-edit `821ab89`.
- Trigger: `require_document_root_schema / mode !== undefined && mode !== rootMode`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
`Document schema root mode mismatch: expected ${mode}; received ${rootMode}.`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.060

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:659` at pre-edit `821ab89`.
- Trigger: `document_schema_children / !values.every((value): value is object => (     (typeof value === "object" && value !== null) || typeof value === "function"   ))`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Document element children must be document schema expressions."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.061

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:680` at pre-edit `821ab89`.
- Trigger: `make_attrs_schema / !is_public_attr_name(name)`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
`Document attrs schema name ${JSON.stringify(name)} is not a canonical public attribute name.`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.063

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:704` at pre-edit `821ab89`.
- Trigger: `make_attrs_schema / !is_attr_value_schema_node(node)`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
`Document attribute ${JSON.stringify(name)} requires a primitive/unknown attr-value schema.`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.065

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:737` at pre-edit `821ab89`.
- Trigger: `schema_attr_shape_entries / typeof shape !== "object" || shape === null || Array.isArray(shape)`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Document attrs schema shape must be a plain object."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.066

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:741` at pre-edit `821ab89`.
- Trigger: `schema_attr_shape_entries / prototype !== Object.prototype && prototype !== null`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Document attrs schema shape must use Object.prototype or null."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.067

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:746` at pre-edit `821ab89`.
- Trigger: `schema_attr_shape_entries / descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Document attrs schema properties must be enumerable data properties."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.069

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:783` at pre-edit `821ab89`.
- Trigger: `make_schema_tag_family / !Reflect.deleteProperty(target, "name") || !Reflect.deleteProperty(target, "length")`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Unable to initialize the document tag schema family."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.070

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:858` at pre-edit `821ab89`.
- Trigger: `values.length === 0`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Schema literal requires at least one value."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.071

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:914` at pre-edit `821ab89`.
- Trigger: `define_schema_expression / projectedRoot === undefined && !hasDocumentCapability && !hasAttrsCapability`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"schema.define(...) callback must return one recognized schema expression."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.072

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:932` at pre-edit `821ab89`.
- Trigger: `projected_schema_surface`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`LiveMap schema has no rule for ${format_schema_path(path)}`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.074

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:1035` at pre-edit `821ab89`.
- Trigger: `normalize_schema_constraint_arguments`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Schema.constrain requires a predicate or a diagnostic label followed by a predicate."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.075

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:1056` at pre-edit `821ab89`.
- Trigger: `make_unified_pick / choices.length === 0`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Schema pick requires at least one choice."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.076

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:1063` at pre-edit `821ab89`.
- Trigger: `make_unified_pick / !projected && document_item_node(target) === undefined && document_content_node(target) === undefined`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Schema pick choices do not share a compatible schema capability."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.077

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:1075` at pre-edit `821ab89`.
- Trigger: `make_unified_tuple / !projected && document_content_node(target) === undefined`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Schema tuple items do not share a compatible schema capability."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.078

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:1108` at pre-edit `821ab89`.
- Trigger: `make_partial_schema_input / node.kind !== "object" || node.props === undefined`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
`${deep ? "deepPartial" : "partial"} requires an object schema expression.`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.079

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:1146` at pre-edit `821ab89`.
- Trigger: `make_tagged_schema_choices / node.kind !== "object" || node.props === undefined || node.optional || node.nullable`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
`LiveMap tagged schema variant ${JSON.stringify(tag)} must be an unmodified object schema expression.`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.080

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:1158` at pre-edit `821ab89`.
- Trigger: `make_tagged_schema_choices / choices.length === 0`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Schema tagged variants require at least one branch."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.081

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:1168` at pre-edit `821ab89`.
- Trigger: `normalize_schema_input / document_item_node(input) !== undefined || document_content_node(input) !== undefined`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Projected schema composition received a document-only schema expression."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.082

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:1170` at pre-edit `821ab89`.
- Trigger: `normalize_schema_input`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Projected schema composition received an unrecognized schema expression."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.083

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:1226` at pre-edit `821ab89`.
- Trigger: `schema_shape_entries / prototype !== Object.prototype && prototype !== null`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"LiveMap schema shape must use Object.prototype or null."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.084

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:1230` at pre-edit `821ab89`.
- Trigger: `schema_shape_entries / typeof key !== "string"`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"LiveMap schema shape cannot contain symbol keys."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.085

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:1233` at pre-edit `821ab89`.
- Trigger: `schema_shape_entries / descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
`LiveMap schema shape property ${JSON.stringify(key)} must be an enumerable data property.`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.086

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:1243` at pre-edit `821ab89`.
- Trigger: `schema_variant_entries / prototype !== Object.prototype && prototype !== null`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"LiveMap tagged schema variants must use Object.prototype or null."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.087

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:1247` at pre-edit `821ab89`.
- Trigger: `schema_variant_entries / typeof key !== "string"`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"LiveMap tagged schema variants cannot contain symbol keys."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.088

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:1250` at pre-edit `821ab89`.
- Trigger: `schema_variant_entries / descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
`LiveMap tagged schema variant ${JSON.stringify(key)} must be an enumerable data property.`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.089

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/api/livemap/livemap.schema.ts:1253` at pre-edit `821ab89`.
- Trigger: `schema_variant_entries / !is_schema_input(descriptor.value)`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
`LiveMap tagged schema variant ${JSON.stringify(key)} must be a projected schema expression.`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

### Census: Document Schema — tags, content, attributes, flags

#### baseline.044

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.document.schema.ts:468` at pre-edit `821ab89`.
- Trigger: `validate_livemap_document_schema_root / schemaMode !== mode`; emission `issue`.
- Rendered payload / exact formatter expression:

```ts
`Expected ${schemaMode} document root; received ${mode} document root.`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.045

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.document.schema.ts:482` at pre-edit `821ab89`.
- Trigger: `validate_livemap_document_schema_root / schemaNode.kind === "element" / elementRoot === undefined`; emission `issue`.
- Rendered payload / exact formatter expression:

```ts
"Expected element document root."
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.046

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.document.schema.ts:491` at pre-edit `821ab89`.
- Trigger: `validate_livemap_document_schema_root / children === undefined`; emission `issue`.
- Rendered payload / exact formatter expression:

```ts
"Expected fragment document root."
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.047

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.document.schema.ts:517` at pre-edit `821ab89`.
- Trigger: `validate_item / schema.kind === "text"`; emission `issue`.
- Rendered payload / exact formatter expression:

```ts
`Expected text at ${JSON.stringify(path)}; received ${describe_item(value)}.`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.048

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.document.schema.ts:530` at pre-edit `821ab89`.
- Trigger: `validate_item / !is_ordinary_element_node(value)`; emission `issue`.
- Rendered payload / exact formatter expression:

```ts
`Expected element at ${JSON.stringify(path)}; received ${describe_item(value)}.`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.049

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.document.schema.ts:541` at pre-edit `821ab89`.
- Trigger: `validate_item / schema.tag !== undefined && schema.tag !== value.$_tag`; emission `issue`.
- Rendered payload / exact formatter expression:

```ts
`Expected tag ${JSON.stringify(schema.tag)} at ${JSON.stringify(path)}; received ${JSON.stringify(value.$_tag)}.`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.050

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.document.schema.ts:557` at pre-edit `821ab89`.
- Trigger: `validate_item / children === undefined`; emission `issue`.
- Rendered payload / exact formatter expression:

```ts
`Element at ${JSON.stringify(path)} does not expose canonical logical content.`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.051

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.document.schema.ts:577` at pre-edit `821ab89`.
- Trigger: `validate_attrs / attrs === undefined`; emission `issue`.
- Rendered payload / exact formatter expression:

```ts
`Element at ${JSON.stringify(path)} does not expose canonical attributes.`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.052

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.document.schema.ts:590` at pre-edit `821ab89`.
- Trigger: `validate_attrs / !Object.prototype.hasOwnProperty.call(attrs, name) / !rule.optional`; emission `issue`.
- Rendered payload / exact formatter expression:

```ts
`Required attribute ${JSON.stringify(name)} is missing at ${JSON.stringify(path)}.`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.053

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.document.schema.ts:604` at pre-edit `821ab89`.
- Trigger: `validate_attrs / !validation.ok`; emission `issue`.
- Rendered payload / exact formatter expression:

```ts
`Attribute ${JSON.stringify(name)} at ${JSON.stringify(path)} is invalid: ${problem.message}`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.054

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.document.schema.ts:618` at pre-edit `821ab89`.
- Trigger: `validate_attrs / schema.exact`; emission `issue`.
- Rendered payload / exact formatter expression:

```ts
`Attribute ${JSON.stringify(name)} is not declared by the exact attrs schema at ${JSON.stringify(path)}.`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.055

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.document.schema.ts:653` at pre-edit `821ab89`.
- Trigger: `validate_content / schema.kind === "repeat" / schema.count !== undefined && children.length !== schema.count`; emission `issue`.
- Rendered payload / exact formatter expression:

```ts
`Expected counted repeat length ${schema.count} at ${JSON.stringify(path)}; received length ${children.length}.`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.056

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.document.schema.ts:678` at pre-edit `821ab89`.
- Trigger: `validate_content / children.length !== schema.items.length`; emission `issue`.
- Rendered payload / exact formatter expression:

```ts
`Expected closed sequence length ${schema.items.length} at ${JSON.stringify(path)}; received length ${children.length}.`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.057

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.document.schema.ts:710` at pre-edit `821ab89`.
- Trigger: `validate_pick`; emission `issue`.
- Rendered payload / exact formatter expression:

```ts
`Expected ${expected} at ${JSON.stringify(path)}; received ${received}; no pick branch matched.`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.058

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.document.schema.ts:789` at pre-edit `821ab89`.
- Trigger: `describe_item`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
`structural node <${value.$_tag}>`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.059

- Representative authored context: ``<main <button count="bad"/>/>``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.document.schema.ts:793` at pre-edit `821ab89`.
- Trigger: `describe_root`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
`<${root.$_tag}>`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

### Census: Projected Schema — values, members, tuples, literals, constraints

#### baseline.062

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.schema.ts:694` at pre-edit `821ab89`.
- Trigger: `make_attrs_schema / is_flag_schema(input)`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
`Expected canonical flag value ${JSON.stringify(name)}; received ${JSON.stringify(value)}.`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.064

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.schema.ts:718` at pre-edit `821ab89`.
- Trigger: `make_attrs_schema / admitted === undefined`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
"Value is not canonical for this attribute name."
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.068

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.schema.ts:771` at pre-edit `821ab89`.
- Trigger: `validate_attr_schema_node`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
"Attribute value is not admitted by its schema."
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.073

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.schema.ts:973` at pre-edit `821ab89`.
- Trigger: `validate_livemap_schema_projected_value / node === undefined`; emission `validation_issue`.
- Rendered payload / exact formatter expression:

```ts
`LiveMap schema has no rule for ${format_schema_path(path)}`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.090

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.schema.ts:1396` at pre-edit `821ab89`.
- Trigger: `validate_public_schema_value / node === undefined`; emission `validation_issue`.
- Rendered payload / exact formatter expression:

```ts
`LiveMap schema has no rule for ${format_schema_path(path)}`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.091

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.schema.ts:1414` at pre-edit `821ab89`.
- Trigger: `admit_public_schema_value`; emission `validation_issue`.
- Rendered payload / exact formatter expression:

```ts
`LiveMap schema received an invalid projected value at ${format_schema_path(error.path)} (${error.code})`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.092

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.schema.ts:1534` at pre-edit `821ab89`.
- Trigger: `validate_recurse_node / node.recurse === undefined`; emission `validation_issue`.
- Rendered payload / exact formatter expression:

```ts
`LiveMap schema recursion rule is not defined at ${format_schema_path(path)}`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.093

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.schema.ts:1545` at pre-edit `821ab89`.
- Trigger: `validate_constrain_node / node.base === undefined || node.validate === undefined`; emission `validation_issue`.
- Rendered payload / exact formatter expression:

```ts
`LiveMap schema constraint is not defined at ${format_schema_path(path)}`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.094

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.schema.ts:1595` at pre-edit `821ab89`.
- Trigger: `validate_tuple_node / value.length > items.length`; emission `validation_issue`.
- Rendered payload / exact formatter expression:

```ts
`LiveMap schema does not allow tuple index ${index} at ${format_schema_path([...path, index])}`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.095

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.schema.ts:1626` at pre-edit `821ab89`.
- Trigger: `validate_object_node / node.exact / !props.has(key)`; emission `validation_issue`.
- Rendered payload / exact formatter expression:

```ts
`LiveMap schema does not allow key ${JSON.stringify(key)} at ${format_schema_path([...path, key])}`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.096

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.schema.ts:1655` at pre-edit `821ab89`.
- Trigger: `expected_schema_value_issue`; emission `validation_issue`.
- Rendered payload / exact formatter expression:

```ts
`LiveMap schema expected ${expected} at ${format_schema_path(path)}, received ${received}`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.097

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.schema.ts:1715` at pre-edit `821ab89`.
- Trigger: `schema_kind_label`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
node.kind
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.098

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/api/livemap/livemap.schema.ts:1728` at pre-edit `821ab89`.
- Trigger: `projected_admission_received`; emission `return`.
- Rendered payload / exact formatter expression:

```ts
error.code.toLowerCase().replaceAll("_", " ")
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: Validation/use-site label in section 11 when adapted; none in the core error itself.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

### Census: HSON syntax and admission

#### baseline.099

- Representative authored context: ``HSON`<age ${value}>` with a nonprimitive value, or invalid cooked template / manual non-tag invocation``.
- Schema condition: none; admission only.
- Owner/category: B; `src/api/transform/hson-admission.ts:32` at pre-edit `821ab89`.
- Trigger: `encode_hson_template_substitution / value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean"`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`HSON tagged-template substitutions must be primitive string, number, boolean, or null values; substitution ${index + 1} received ${typeof value}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.100

- Representative authored context: ``HSON`<age ${value}>` with a nonprimitive value, or invalid cooked template / manual non-tag invocation``.
- Schema condition: none; admission only.
- Owner/category: B; `src/api/transform/hson-admission.ts:57` at pre-edit `821ab89`.
- Trigger: `reconstructTaggedSource / strings.raw.length !== substitutions.length + 1`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"invalid HSON tagged-template segment/substitution arity"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.101

- Representative authored context: ``HSON`<age ${value}>` with a nonprimitive value, or invalid cooked template / manual non-tag invocation``.
- Schema condition: none; admission only.
- Owner/category: B; `src/api/transform/hson-admission.ts:93` at pre-edit `821ab89`.
- Trigger: `admit_hson / !isTemplateStringsArray(source)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"HSON must be used as a tagged template: HSON`...`"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.102

- Representative authored context: ``"" (empty source)``.
- Schema condition: none; parser contract.
- Owner/category: B; `src/api/transform/parsers/parse-hson.ts:43` at pre-edit `821ab89`.
- Trigger: `parse_hson_attached / newTokens.length === 0`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"empty, whitespace-only, or comment-only HSON source has no semantic value"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.103

- Representative authored context: ``<age 1> <name "Ada"> / <button [1]/> (root/mode family; earlier guards may win)``.
- Schema condition: none; parser contract.
- Owner/category: B; `src/api/transform/parsers/parse-tokens.ts:124` at pre-edit `821ab89`.
- Trigger: `_take / expected && tok.kind !== expected`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`expected ${expected}, got ${tok.kind}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.104

- Representative authored context: ``<age 1> <name "Ada"> / <button [1]/> (root/mode family; earlier guards may win)``.
- Schema condition: none; parser contract.
- Owner/category: B; `src/api/transform/parsers/parse-tokens.ts:154` at pre-edit `821ab89`.
- Trigger: `readTag / !isTokenOpen(tok)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`expected OPEN, got ${tok?.kind ?? "eof"}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.105

- Representative authored context: ``<age 1> <name "Ada"> / <button [1]/> (root/mode family; earlier guards may win)``.
- Schema condition: none; parser contract.
- Owner/category: B; `src/api/transform/parsers/parse-tokens.ts:230` at pre-edit `821ab89`.
- Trigger: `readTag`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`unexpected token ${t.kind} inside <${open.tag}>`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.106

- Representative authored context: ``<age 1> <name "Ada"> / <button [1]/> (root/mode family; earlier guards may win)``.
- Schema condition: none; parser contract.
- Owner/category: B; `src/api/transform/parsers/parse-tokens.ts:235` at pre-edit `821ab89`.
- Trigger: `readTag / sawClose === null`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`missing CLOSE for <${open.tag}>`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.107

- Representative authored context: ``<age 1> <name "Ada"> / <button [1]/> (root/mode family; earlier guards may win)``.
- Schema condition: none; parser contract.
- Owner/category: B; `src/api/transform/parsers/parse-tokens.ts:243` at pre-edit `821ab89`.
- Trigger: `readTag / !isVSN / incompatible`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`structural mode crossing: <${open.tag}> closes as ${closeKind} but child <${incompatible.tag}> closes as ${incompatible.closeKind} at ${incompatible.open.pos.line}:${incompatible.open.pos.col}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.108

- Representative authored context: ``<age 1> <name "Ada"> / <button [1]/> (root/mode family; earlier guards may win)``.
- Schema condition: none; parser contract.
- Owner/category: B; `src/api/transform/parsers/parse-tokens.ts:252` at pre-edit `821ab89`.
- Trigger: `readTag / !isVSN / closeKind === CLOSE_KIND.elem && (sawNestedArray || sawEmptyObject)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`structural mode crossing: element branch <${open.tag}> cannot contain object/array structure at ${open.pos.line}:${open.pos.col}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.109

- Representative authored context: ``<age 1> <name "Ada"> / <button [1]/> (root/mode family; earlier guards may win)``.
- Schema condition: none; parser contract.
- Owner/category: B; `src/api/transform/parsers/parse-tokens.ts:313` at pre-edit `821ab89`.
- Trigger: `readTag / closeKind === CLOSE_KIND.obj / !(c.length === 1 && (c[0].$_tag === OBJ_TAG || c[0].$_tag === ARR_TAG))`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"object semantics must yield a single _hson_obj/_hson_arr child"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.110

- Representative authored context: ``<age 1> <name "Ada"> / <button [1]/> (root/mode family; earlier guards may win)``.
- Schema condition: none; parser contract.
- Owner/category: B; `src/api/transform/parsers/parse-tokens.ts:333` at pre-edit `821ab89`.
- Trigger: `readTag / closeKind === CLOSE_KIND.obj / !(c.length === 0 || (c.length === 1 && c[0].$_tag === ELEM_TAG))`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"element semantics must yield a single _hson_elem child"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.111

- Representative authored context: ``<age 1> <name "Ada"> / <button [1]/> (root/mode family; earlier guards may win)``.
- Schema condition: none; parser contract.
- Owner/category: B; `src/api/transform/parsers/parse-tokens.ts:347` at pre-edit `821ab89`.
- Trigger: `readArray / !arrOpen || arrOpen.kind !== TOKEN_KIND.ARR_OPEN`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`expected ARR_OPEN, got ${arrOpen?.kind ?? "eof"}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.112

- Representative authored context: ``<age 1> <name "Ada"> / <button [1]/> (root/mode family; earlier guards may win)``.
- Schema condition: none; parser contract.
- Owner/category: B; `src/api/transform/parsers/parse-tokens.ts:377` at pre-edit `821ab89`.
- Trigger: `readArray / t.kind === TOKEN_KIND.EMPTY_OBJ / t.kind === TOKEN_KIND.TEXT / t.kind === TOKEN_KIND.OPEN / child.closeKind === CLOSE_KIND.elem`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`_hson_arr cannot contain an element-mode value at ${child.open.pos.line}:${child.open.pos.col}; arrays cannot cross object/element structural modes`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.113

- Representative authored context: ``<age 1> <name "Ada"> / <button [1]/> (root/mode family; earlier guards may win)``.
- Schema condition: none; parser contract.
- Owner/category: B; `src/api/transform/parsers/parse-tokens.ts:389` at pre-edit `821ab89`.
- Trigger: `readArray / t.kind === TOKEN_KIND.EMPTY_OBJ / t.kind === TOKEN_KIND.TEXT / t.kind === TOKEN_KIND.OPEN / t.kind === TOKEN_KIND.ARR_OPEN`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`unexpected ${t.kind} in array`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.114

- Representative authored context: ``<age 1> <name "Ada"> / <button [1]/> (root/mode family; earlier guards may win)``.
- Schema condition: none; parser contract.
- Owner/category: B; `src/api/transform/parsers/parse-tokens.ts:445` at pre-edit `821ab89`.
- Trigger: `parse_tokens`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`unexpected top-level token ${t.kind}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.115

- Representative authored context: ``<age 1> <name "Ada"> / <button [1]/> (root/mode family; earlier guards may win)``.
- Schema condition: none; parser contract.
- Owner/category: B; `src/api/transform/parsers/parse-tokens.ts:496` at pre-edit `821ab89`.
- Trigger: `parse_tokens / containsValueLeaf || (containsStringLeaf && !options.allowTopLevelTextFragment)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"a top-level primitive must be the sole semantic HSON value"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.116

- Representative authored context: ``<age 1> <name "Ada"> / <button [1]/> (root/mode family; earlier guards may win)``.
- Schema condition: none; parser contract.
- Owner/category: B; `src/api/transform/parsers/parse-tokens.ts:516` at pre-edit `821ab89`.
- Trigger: `parse_tokens / !allObj && !allElem`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`mixed top-level structural modes are invalid (${topCloseKinds.join(", ")})${conflict === undefined ? "" : ` at ${conflict.line}:${conflict.col} (index ${conflict.index})`}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.117

- Representative authored context: ``<age 1> <name "Ada"> / <button [1]/> (root/mode family; earlier guards may win)``.
- Schema condition: none; parser contract.
- Owner/category: B; `src/api/transform/parsers/parse-tokens.ts:531` at pre-edit `821ab89`.
- Trigger: `parse_tokens / allObj`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`multiple top-level object values are invalid; one object angle pair must contain every member${second === undefined ? "" : ` at ${second.line}:${second.col} (index ${second.index})`}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.118

- Representative authored context: ``N/A: programmatic invalid initial depth; nested-array authoring family``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:50` at pre-edit `821ab89`.
- Trigger: `tokenize_hson / depth < 0 || depth >= MAX_NESTING`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`stopping potentially infinite loop (depth must be between 0 and ${MAX_NESTING - 1})`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.119

- Representative authored context: ``'bad'``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:111` at pre-edit `821ab89`.
- Trigger: `scan / ch === "<" / ch === "«" || ch === "[" / ch === '"' / ch === "'"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unsupported quote delimiter (use double quotes only)`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.120

- Representative authored context: ``>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:119` at pre-edit `821ab89`.
- Trigger: `scan / ch === "<" / ch === "«" || ch === "[" / ch === '"' / ch === "'" / ch === "'" / ch === ">" || ch === "/" || ch === "]" || ch === "»"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
this.tokens.length === 0
            ? `unexpected structural closer "${ch}"`
            : `trailing source begins with unexpected structural closer "${ch}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.121

- Representative authored context: ``+1``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:131` at pre-edit `821ab89`.
- Trigger: `scan / ch === "<" / ch === "«" || ch === "[" / ch === '"' / ch === "'" / ch === "'" / ch === ">" || ch === "/" || ch === "]" || ch === "»" / !isPrimitiveLiteral(raw)`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
numericDefect === undefined
              ? `unexpected bare token outside tag header: "${raw}"`
              : `invalid HSON number "${raw}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.122

- Representative authored context: ``<``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:190` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / this.atEnd()`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unterminated object`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.123

- Representative authored context: ``<@ >``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:197` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / this.peek() === "@" / this.atEnd() || isHsonTrivia(this.peek()) || this.peek() === ">"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`missing persisted QUID value after "@"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.124

- Representative authored context: ``<@bad age 1>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:201` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / this.peek() === "@" / !is_persisted_quid(value)`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`invalid persisted QUID "${value}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.125

- Representative authored context: ``<@012345678age 1>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:206` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / this.peek() === "@" / this.peek() !== ">" && !separated`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`required trivia is missing after persisted object QUID declaration`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.126

- Representative authored context: ``<age 1, name "Ada">``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:235` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / this.peek() === ","`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`object members do not use commas`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.127

- Representative authored context: ``<1>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:241` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / this.peek() === '"' || this.peek() === "[" || this.peek() === "«"         || this.peek() === "+" || this.peek() === "-" || /\d/.test(this.peek())`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unexpected object value where a member name is required`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.128

- Representative authored context: ``<age @012345678 1>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:248` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / this.peek() === "@"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`object members cannot author persisted QUID declarations`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.129

- Representative authored context: ``<<age 1>>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:255` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / this.peek() === "<"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`legacy doubled object syntax is not supported; expected an object member name`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.130

- Representative authored context: ``<age 1/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:262` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / this.startsWith("/>")`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`objects must close with ">", not "/>"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.131

- Representative authored context: ``<>>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:265` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / this.peek() === ">"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unexpected object closer; expected an object member name`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.132

- Representative authored context: ``<age 1 age 2>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:276` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / first !== undefined`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`[duplicate-object-member] duplicate HSON object member "${name}"; first declared at ${first.line}:${first.col} (index ${first.index})`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.133

- Representative authored context: ``<age>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:288` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / this.atEnd() || this.peek() === ">"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`object member "${name}" is missing its value`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.134

- Representative authored context: ``<age"37">``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:291` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / !separatedFromValue`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`required trivia is missing between object member name and value`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.135

- Representative authored context: ``<age @012345678>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:298` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / this.peek() === "@"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`object members cannot author persisted QUID declarations`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.136

- Representative authored context: ``<age 1``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:320` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / this.atEnd()`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unterminated object`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.137

- Representative authored context: ``<age 1,>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:332` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / this.peek() === ","`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`object members do not use commas`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.138

- Representative authored context: ``<age 1name "Ada">``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:335` at pre-edit `821ab89`.
- Trigger: `scanObjectAfterOpen / !separated`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`required trivia is missing between sibling object members`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.139

- Representative authored context: ``<child <button/>>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:359` at pre-edit `821ab89`.
- Trigger: `scanObjectMemberValue / ch === "<" / this.classifyAngleCloser(pos) !== CLOSE_KIND.obj`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`object member "${memberName}" cannot contain an element-mode value`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.140

- Representative authored context: ``<age 'bad'>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:373` at pre-edit `821ab89`.
- Trigger: `scanObjectMemberValue / ch === "'"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unsupported quote delimiter (use double quotes only)`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.141

- Representative authored context: ``<age=1>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:383` at pre-edit `821ab89`.
- Trigger: `scanObjectMemberValue / !isPrimitiveLiteral(raw) / this.peek() === "="`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`object member "${memberName}" cannot use authored metadata or attribute syntax`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.142

- Representative authored context: ``<age bad>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:392` at pre-edit `821ab89`.
- Trigger: `scanObjectMemberValue / !isPrimitiveLiteral(raw)`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`invalid bare object value "${raw}" for member "${memberName}"; quote string values`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.143

- Representative authored context: ``<``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:411` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen / this.atEnd()`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unterminated angle construct`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.144

- Representative authored context: ``</>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:414` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen / this.startsWith("/>")`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`missing tag name before "/>"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.145

- Representative authored context: ``<''/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:424` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen / tag.length === 0`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`element name must not decode to the empty string`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.146

- Representative authored context: ``<button``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:450` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen / this.atEnd()`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unterminated tag <${tag}>`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.147

- Representative authored context: ``<button "text" @012345678/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:470` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen / ch === "@" / contentStarted`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`persisted QUID declaration is forbidden after content begins`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.148

- Representative authored context: ``<button @ />``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:478` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen / ch === "@" / this.atEnd() || isHsonTrivia(this.peek()) || this.startsWith("/>") || this.peek() === ">"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`missing persisted QUID value after "@"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.149

- Representative authored context: ``<button @bad/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:482` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen / ch === "@" / !is_persisted_quid(value)`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`invalid persisted QUID "${value}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.150

- Representative authored context: ``<button @012345678 @012345678/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:485` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen / ch === "@" / quid !== undefined`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`duplicate persisted QUID declaration`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.151

- Representative authored context: ``<button "text" id=x/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:504` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen / is_hson_bare_name_start(ch) / contentStarted`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`element header item "${name}" is forbidden after content begins`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.152

- Representative authored context: ``<button hson:quid=x/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:513` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen / is_hson_bare_name_start(ch) / name.startsWith("hson:")`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`authored HSON metadata must not use element attribute syntax`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.153

- Representative authored context: ``<button +1/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:541` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen / ch === "+" || ch === "-" || /\d/.test(ch) / !isPrimitiveLiteral(raw)`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`invalid primitive content "${raw}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.154

- Representative authored context: ``<button 1/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:550` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen / ch === "+" || ch === "-" || /\d/.test(ch)`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`typed primitive content "${raw}" is forbidden in element mode`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.155

- Representative authored context: ``<button <age 1>/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:572` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen / ch === "<" / this.classifyAngleCloser(childPos) !== CLOSE_KIND.elem`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`structural mode crossing: element <${tag}> cannot contain an object-mode value`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.156

- Representative authored context: ``<button [1]/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:585` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen / ch === "«" || ch === "["`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`structural mode crossing: element branch <${tag}> cannot contain object/array structure (array value)`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.157

- Representative authored context: ``<button 'disabled'/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:593` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen / ch === "'"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`single-quoted names are valid only in the element-name position, not as attributes or flags`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.158

- Representative authored context: ``<button "text" bare/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:607` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen / contentStarted`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unexpected bare token in <${tag}> content: "${raw}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.159

- Representative authored context: ``<button =/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:614` at pre-edit `821ab89`.
- Trigger: `scanElementAfterOpen`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unexpected token "${ch}" in <${tag}> element header`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.160

- Representative authored context: ``[@ ]``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:631` at pre-edit `821ab89`.
- Trigger: `scanArray / this.peek() === "@" / this.atEnd() || isHsonTrivia(this.peek()) || this.peek() === closer`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`missing persisted QUID value after "@"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.161

- Representative authored context: ``[@bad 1]``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:635` at pre-edit `821ab89`.
- Trigger: `scanArray / this.peek() === "@" / !is_persisted_quid(value)`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`invalid persisted QUID "${value}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.162

- Representative authored context: ``[@0123456781]``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:640` at pre-edit `821ab89`.
- Trigger: `scanArray / this.peek() === "@" / this.peek() !== closer && !separated`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`required trivia is missing after persisted array QUID declaration`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.163

- Representative authored context: ``[1``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:659` at pre-edit `821ab89`.
- Trigger: `scanArray / this.atEnd()`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unterminated ${opener}${closer} array`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.164

- Representative authored context: ``[1»``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:674` at pre-edit `821ab89`.
- Trigger: `scanArray / this.peek() === (closer === "]" ? "»" : "]")`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`mismatched array closer "${this.peek()}"; expected "${closer}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.165

- Representative authored context: ``[1 2]``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:683` at pre-edit `821ab89`.
- Trigger: `scanArray / !expectItem / this.peek() !== ","`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`expected "," or "${closer}" after array item`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.166

- Representative authored context: ``[,1] / [1,,2]``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:695` at pre-edit `821ab89`.
- Trigger: `scanArray / this.peek() === ","`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
sawItem ? `missing array item between commas` : `unexpected comma before first array item`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.167

- Representative authored context: ``['bad']``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:733` at pre-edit `821ab89`.
- Trigger: `scanArrayItem / ch === "'"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unsupported quote delimiter (use double quotes only)`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.168

- Representative authored context: ``[bare]``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:744` at pre-edit `821ab89`.
- Trigger: `scanArrayItem / !isPrimitiveLiteral(raw)`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unexpected bare array item: "${raw}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.169

- Representative authored context: ``<button id=/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:764` at pre-edit `821ab89`.
- Trigger: `scanAttributeValue / this.atEnd() || this.startsWith("/>") || this.peek() === ">"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`missing attribute value for "${name}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.170

- Representative authored context: ``<button id='bad'/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:768` at pre-edit `821ab89`.
- Trigger: `scanAttributeValue / this.peek() === "'"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unsupported single-quoted attribute value (use double quotes only)`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.171

- Representative authored context: ``<button id=/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:805` at pre-edit `821ab89`.
- Trigger: `scanAttributeValue / !text`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`missing attribute value for "${name}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.172

- Representative authored context: ``<button id=a=b/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:807` at pre-edit `821ab89`.
- Trigger: `scanAttributeValue / text.includes("=")`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`malformed unquoted attribute value for "${name}": "${text}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.173

- Representative authored context: ``"raw\ncontrol" (physical newline)``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:843` at pre-edit `821ab89`.
- Trigger: `scanContentString / ch.charCodeAt(0) < 0x20`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`[invalid-json-string] unescaped control character in content string`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.174

- Representative authored context: ``"unterminated``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:854` at pre-edit `821ab89`.
- Trigger: `scanContentString`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
final === "'" ? `mixed quote boundary in quoted string` : `unterminated quoted string`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.175

- Representative authored context: ``<button id="raw\ncontrol"/> (physical newline)``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:881` at pre-edit `821ab89`.
- Trigger: `scanAttributeString / ch.charCodeAt(0) < 0x20`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`[invalid-json-string] unescaped control character in quoted attribute "${name}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.176

- Representative authored context: ``<button id="unterminated/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:892` at pre-edit `821ab89`.
- Trigger: `scanAttributeString`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
final === "'"
        ? `mixed quote boundary in quoted attribute "${name}"`
        : `unterminated quoted attribute value for "${name}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.177

- Representative authored context: ``<'bad\``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:917` at pre-edit `821ab89`.
- Trigger: `scanQuotedName / ch === "\\" / this.atEnd() || this.peek().charCodeAt(0) < 0x20`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`[invalid-name-escape] invalid quoted-name escape termination`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.178

- Representative authored context: ``<'\u12xz' 1>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:936` at pre-edit `821ab89`.
- Trigger: `scanQuotedName / ch === "\\" / escaped === "'" / escaped === "\\" / escaped === "b" / escaped === "f" / escaped === "n" / escaped === "r" / escaped === "t" / escaped === "u" / !/^[0-9A-Fa-f]$/.test(digit)`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`[invalid-name-escape] malformed unicode escape ${JSON.stringify(`\\u${hex}`)} in quoted HSON name`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.179

- Representative authored context: ``<'\q' 1>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:947` at pre-edit `821ab89`.
- Trigger: `scanQuotedName / ch === "\\" / escaped === "'" / escaped === "\\" / escaped === "b" / escaped === "f" / escaped === "n" / escaped === "r" / escaped === "t" / escaped === "u"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`[invalid-name-escape] unsupported quoted-name escape ${JSON.stringify(`\\${escaped}`)}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.180

- Representative authored context: ``<'raw\nname' 1> (physical newline)``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:957` at pre-edit `821ab89`.
- Trigger: `scanQuotedName / ch.charCodeAt(0) < 0x20`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`raw control character is forbidden in single-quoted HSON name`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.181

- Representative authored context: ``<'unterminated``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:967` at pre-edit `821ab89`.
- Trigger: `scanQuotedName`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unterminated single-quoted HSON name`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.182

- Representative authored context: ``"bad\``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:974` at pre-edit `821ab89`.
- Trigger: `scanJsonEscape / this.atEnd() || this.isNewline()`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`[invalid-json-escape] invalid escape termination in ${context}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.183

- Representative authored context: ``"\u12xz"``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:985` at pre-edit `821ab89`.
- Trigger: `scanJsonEscape / escaped === "u" / !/^[0-9A-Fa-f]$/.test(digit)`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`[invalid-json-escape] malformed unicode escape ${JSON.stringify(`\\u${hex}`)} in ${context}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.184

- Representative authored context: ``"\q"``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:996` at pre-edit `821ab89`.
- Trigger: `scanJsonEscape`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`[invalid-json-escape] unsupported escape ${JSON.stringify(`\\${escaped}`)} in ${context}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.185

- Representative authored context: ``<button id=a id=b/>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1009` at pre-edit `821ab89`.
- Trigger: `assertUniqueAttribute / first !== undefined`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`[duplicate-attribute] duplicate HSON attribute "${attr.name}"; first declared at ${first.line}:${first.col} (index ${first.index})`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.186

- Representative authored context: ``<: 1>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1023` at pre-edit `821ab89`.
- Trigger: `scanBareName / !is_hson_bare_name_start(first)`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`malformed ${where}: expected a bare name or single-quoted name`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.187

- Representative authored context: ``<@>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1052` at pre-edit `821ab89`.
- Trigger: `scanBareToken / !out`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unexpected token "${this.peek()}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.188

- Representative authored context: ``<name "bad\``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1072` at pre-edit `821ab89`.
- Trigger: `classifyAngleCloser / quoted !== undefined / ch === "\\" / cursor + 1 >= this.source.length || next.charCodeAt(0) < 0x20`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
quoted === `"`
                ? `[invalid-json-escape] invalid escape termination in quoted HSON string`
                : `[invalid-name-escape] invalid quoted-name escape termination`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.189

- Representative authored context: ``<name "raw\ncontrol"> (physical newline)``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1084` at pre-edit `821ab89`.
- Trigger: `classifyAngleCloser / quoted !== undefined / ch.charCodeAt(0) < 0x20`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
quoted === `"`
              ? `unescaped control character in quoted HSON string`
              : `raw control character in single-quoted HSON name`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.190

- Representative authored context: ``<age\u00a037> (nonbreaking space)``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1124` at pre-edit `821ab89`.
- Trigger: `classifyAngleCloser / expectAttributeValue / isUnsupportedWhitespace(ch)`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unsupported whitespace character U+${ch.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.191

- Representative authored context: ``/* comment */ 1``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1163` at pre-edit `821ab89`.
- Trigger: `classifyAngleCloser / ch === "/" && next === "*"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`block comments are not supported in authored HSON`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.192

- Representative authored context: ``1\u00a0 (nonbreaking space)``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1171` at pre-edit `821ab89`.
- Trigger: `classifyAngleCloser / isUnsupportedWhitespace(ch)`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unsupported whitespace character U+${ch.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.193

- Representative authored context: ``<button / >``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1182` at pre-edit `821ab89`.
- Trigger: `classifyAngleCloser / ch === "/" && next !== ">" && stack.at(-1) === "<" / this.source[afterSlash] === ">"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`element closer must be the adjacent token "/>"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.194

- Representative authored context: ``<name "unterminated``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1244` at pre-edit `821ab89`.
- Trigger: `classifyAngleCloser / quoted === '"'`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
final === "'" ? `mixed quote boundary in quoted string` : `unterminated quoted string`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.195

- Representative authored context: ``<'unterminated``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1251` at pre-edit `821ab89`.
- Trigger: `classifyAngleCloser / quoted === "'"`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unterminated single-quoted HSON name`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.196

- Representative authored context: ``<age 1``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1253` at pre-edit `821ab89`.
- Trigger: `classifyAngleCloser`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unterminated angle construct`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.197

- Representative authored context: ``1\u00a0 (nonbreaking space)``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1262` at pre-edit `821ab89`.
- Trigger: `skipTrivia / isUnsupportedWhitespace(this.peek())`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unsupported whitespace character U+${ch.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.198

- Representative authored context: ``/* comment */ 1``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1269` at pre-edit `821ab89`.
- Trigger: `skipTrivia / this.startsWith("/*")`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`block comments are not supported in authored HSON`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.199

- Representative authored context: ``nested arrays at MAX_NESTING``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1304` at pre-edit `821ab89`.
- Trigger: `assertNesting / depth >= MAX_NESTING`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`stopping potentially infinite loop (depth >= ${MAX_NESTING})`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.200

- Representative authored context: ``1e9999``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1310` at pre-edit `821ab89`.
- Trigger: `assertFiniteNumberLiteral / NUMBER_LITERAL.test(raw) && !Number.isFinite(Number(raw))`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`HSON number must be finite: "${raw}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.201

- Representative authored context: ``N/A defensive cursor past end; incomplete-source family``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1363` at pre-edit `821ab89`.
- Trigger: `consume / this.atEnd()`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`unexpected end of input`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.202

- Representative authored context: ``N/A defensive expect mismatch; malformed-container family``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1387` at pre-edit `821ab89`.
- Trigger: `consumeExpected / this.peek() !== expected`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`expected "${expected}", got "${this.peek() || "eof"}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.203

- Representative authored context: ``<`age` 1>``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1393` at pre-edit `821ab89`.
- Trigger: `rejectLegacyBacktick`; emission `this.fail`.
- Rendered payload / exact formatter expression:

```ts
`legacy backtick-delimited HSON names are invalid; use a single-quoted name`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.204

- Representative authored context: ``+1 (wrapper example)``.
- Schema condition: not applicable; lexical admission condition shown below.
- Owner/category: B; `src/api/transform/parsers/tokenize-hson.ts:1406` at pre-edit `821ab89`.
- Trigger: `fail`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`${message} at ${pos.line}:${pos.col} (index ${pos.index})`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: `Related HSON source (first-declaration).` only when emitted related-role evidence maps; otherwise none.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

### Census: Transform serialization, canonical invariants, and supporting core errors

#### baseline.205

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:51` at pre-edit `821ab89`.
- Trigger: `enter / seen.has(node)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"serialize-hson: cycle detected in node graph"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.206

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:92` at pre-edit `821ab89`.
- Trigger: `effectiveMeta / !policy.valid`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`serialize-hson: metadata key "${key}" is invalid on <${nodeTag}>: ${policy.reason}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.207

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:100` at pre-edit `821ab89`.
- Trigger: `effectiveMeta / !policy.definition.validateValue(value)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`serialize-hson: invalid value for metadata "${key}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.208

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:117` at pre-edit `821ab89`.
- Trigger: `serializeAttribute / !is_valid_hson_attribute_name(name)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`serialize-hson: invalid attribute name "${name}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.209

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:128` at pre-edit `821ab89`.
- Trigger: `serializeAttribute / typeof value !== "string"`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`serialize-hson: canonical ordinary attribute "${name}" must be a string`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.210

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:161` at pre-edit `821ab89`.
- Trigger: `emitLeaf / node.$_content.length !== 1`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`serialize-hson: ${node.$_tag} must contain exactly one primitive`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.211

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:170` at pre-edit `821ab89`.
- Trigger: `emitLeaf / node.$_tag === STR_TAG / typeof value !== "string"`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"serialize-hson: _hson_str must contain a string"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.212

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:179` at pre-edit `821ab89`.
- Trigger: `emitLeaf / !(typeof value === "number" || typeof value === "boolean" || value === null)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"serialize-hson: _hson_val must contain number|boolean|null"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.213

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:185` at pre-edit `821ab89`.
- Trigger: `emitLeaf / typeof value === "number" && !Number.isFinite(value)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`serialize-hson: invalid HSON number ${String(value)}; numbers must be finite`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.214

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:197` at pre-edit `821ab89`.
- Trigger: `arrayItemNode / wrapper.$_tag !== II_TAG`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"serialize-hson: only _hson_ii allowed directly under _hson_arr"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.215

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:204` at pre-edit `821ab89`.
- Trigger: `arrayItemNode / content.length !== 1 || !is_Node(content[0])`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"serialize-hson: _hson_ii must contain exactly one child node"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.216

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:218` at pre-edit `821ab89`.
- Trigger: `emitArray / node.$_attrs && Object.keys(node.$_attrs).length !== 0`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"serialize-hson: _hson_arr may not carry $_attrs"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.217

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:228` at pre-edit `821ab89`.
- Trigger: `emitArray / !is_Node(wrapper)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"serialize-hson: non-node item in _hson_arr"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.218

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:256` at pre-edit `821ab89`.
- Trigger: `emitObjectMember / property.$_attrs && Object.keys(property.$_attrs).length !== 0`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`serialize-hson: object member <${property.$_tag}> cannot carry attributes or flags`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.219

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:269` at pre-edit `821ab89`.
- Trigger: `emitObjectMember / property.$_meta && Object.keys(property.$_meta).length !== 0`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`serialize-hson: object member <${property.$_tag}> cannot carry metadata or a QUID`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.220

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:282` at pre-edit `821ab89`.
- Trigger: `emitObjectMember / property.$_content.length !== 1 || !is_Node(property.$_content[0])`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`serialize-hson: object member <${property.$_tag}> must own exactly one canonical value`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.221

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:308` at pre-edit `821ab89`.
- Trigger: `emitObject / node.$_attrs && Object.keys(node.$_attrs).length !== 0`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"serialize-hson: _hson_obj may not carry $_attrs"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.222

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:323` at pre-edit `821ab89`.
- Trigger: `emitObject / node.$_content.length === 1     && is_Node(node.$_content[0])     && (node.$_content[0].$_tag === STR_TAG || node.$_content[0].$_tag === VAL_TAG)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"serialize-hson: detached scalar _hson_obj carrier is not a canonical semantic object value"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.223

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:331` at pre-edit `821ab89`.
- Trigger: `emitObject / !is_Node(property)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"serialize-hson: non-node in _hson_obj.$_content"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.224

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:337` at pre-edit `821ab89`.
- Trigger: `emitObject / EVERY_VSN.includes(property.$_tag)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`serialize-hson: _hson_obj must contain ordinary named members, found ${property.$_tag}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.225

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:366` at pre-edit `821ab89`.
- Trigger: `emitElementCluster / node.$_attrs && Object.keys(node.$_attrs).length !== 0`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"serialize-hson: _hson_elem may not carry $_attrs"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.226

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:377` at pre-edit `821ab89`.
- Trigger: `emitElementCluster / !(ctx.options.ownedElementTextFragment && isRootSemanticValue)     && node.$_content.length === 1     && is_Node(node.$_content[0])     && (node.$_content[0].$_tag === STR_TAG || node.$_content[0].$_tag === VAL_TAG)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"serialize-hson: detached scalar _hson_elem carrier is not a canonical semantic element value"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.227

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:384` at pre-edit `821ab89`.
- Trigger: `emitElementCluster / !is_Node(child)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"serialize-hson: non-node in _hson_elem.$_content"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.228

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:448` at pre-edit `821ab89`.
- Trigger: `emitStandardNode / quid !== undefined && !is_persisted_quid(quid)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`serialize-hson: invalid quid`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.229

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:480` at pre-edit `821ab89`.
- Trigger: `emitNode / node.$_tag.startsWith(HSON_SYS_PREFIX) && !EVERY_VSN.includes(node.$_tag)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`serialize-hson: unknown VSN-like tag <${node.$_tag}>`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.230

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:492` at pre-edit `821ab89`.
- Trigger: `emitNode / node.$_tag === II_TAG / content.length !== 1 || !is_Node(content[0])`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"serialize-hson: _hson_ii must contain exactly one child node"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.231

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:518` at pre-edit `821ab89`.
- Trigger: `serialize_hson_with_ownership / !is_Node(root)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"serialize-hson: root must be a HsonNode"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.232

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/serializers/serialize-hson.ts:524` at pre-edit `821ab89`.
- Trigger: `serialize_hson_with_ownership / root.$_tag === ROOT_TAG`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
"serialize-hson: _hson_root is an internal attachment carrier and cannot be serialized"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.233

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/utils/attrs-utils/serialize-style.ts:53` at pre-edit `821ab89`.
- Trigger: `serialize_style / rendered === undefined`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"Inline style contains an invalid declaration value."
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.234

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/utils/hson-utils/hson-source-name.ts:18` at pre-edit `821ab89`.
- Trigger: `assert_authored_hson_source_name`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`[authored-reserved-name] authored HSON name "${name}" is reserved for internal structural nodes at ${pos.line}:${pos.col} (index ${pos.index})`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.235

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/utils/hson-utils/quid-ingress.ts:14` at pre-edit `821ab89`.
- Trigger: `throw_quid_ingress_error`; emission `description`.
- Rendered payload / exact formatter expression:

```ts
cause.code === "MALFORMED_QUID"
    ? "quid must be a canonical persisted QUID"
    : cause.code === "INELIGIBLE_QUID"
      ? "persisted QUID on an ineligible HSON structural node"
      : `duplicate quid "${String(cause.value)}" (Duplicate QUID claim)`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.236

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/utils/hson-utils/quid-ingress.ts:19` at pre-edit `821ab89`.
- Trigger: `throw_quid_ingress_error`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`${description}: ${cause.message}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.237

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/utils/hson-utils/unescape-hson.ts:16` at pre-edit `821ab89`.
- Trigger: `unescape_hson_string / typeof value !== "string"`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"HSON string literal did not parse to string"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.238

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/utils/node-utils/detach-hson-root-value.ts:16` at pre-edit `821ab89`.
- Trigger: `detach_hson_root_value / !is_Node(root) || root.$_tag !== ROOT_TAG`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`expected an internal ${ROOT_TAG} attachment carrier`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.239

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/utils/node-utils/detach-hson-root-value.ts:22` at pre-edit `821ab89`.
- Trigger: `detach_hson_root_value / !Array.isArray(root.$_content)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`${ROOT_TAG} must carry an array $_content`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.240

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/utils/node-utils/detach-hson-root-value.ts:28` at pre-edit `821ab89`.
- Trigger: `detach_hson_root_value / root.$_content.length !== 1`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`${ROOT_TAG} must contain exactly one semantic node; observed ${root.$_content.length}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.241

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/utils/node-utils/detach-hson-root-value.ts:35` at pre-edit `821ab89`.
- Trigger: `detach_hson_root_value / !is_Node(semantic)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`${ROOT_TAG} semantic content must be a HsonNode`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.242

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/api/transform/utils/primitive-utils/coerce-string.utils.ts:42` at pre-edit `821ab89`.
- Trigger: `coerce / trimmed.startsWith('"') && trimmed.endsWith('"')`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`error in coercion: ${msg}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.243

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:54` at pre-edit `821ab89`.
- Trigger: `assert_invariants / errs.length`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`invariant violation(s):\n  - ${msg}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.244

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:76` at pre-edit `821ab89`.
- Trigger: `walk / Object.hasOwn(n, "$_attrs")     && is_plain_record(n.$_attrs)     && Object.keys(n.$_attrs).length === 0`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: empty $_attrs is not canonical; omit the attribute container`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.245

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:86` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag.startsWith(HSON_SYS_PREFIX) && !EVERY_VSN.includes(n.$_tag)`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: unknown VSN-like tag "${n.$_tag}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.246

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:94` at pre-edit `821ab89`.
- Trigger: `walk / n.$_meta / Object.hasOwn(n.$_meta, HSON_META_QUID)`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: quid must be a canonical persisted QUID on an eligible standard tag`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.247

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:100` at pre-edit `821ab89`.
- Trigger: `walk / n.$_meta / !policy.valid`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}@meta:${JSON.stringify(k)}: ${policy.reason}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.248

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:109` at pre-edit `821ab89`.
- Trigger: `walk / n.$_meta / !hson_metadata_value_is_valid(k, value)`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}@meta:${JSON.stringify(k)}: invalid metadata value`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.249

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:115` at pre-edit `821ab89`.
- Trigger: `walk / isVSN(n.$_tag) && n.$_attrs && Object.keys(n.$_attrs as HsonAttrs).length`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: VSN "${n.$_tag}" must not have $_attrs`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.250

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:123` at pre-edit `821ab89`.
- Trigger: `walk / !isVSN(n.$_tag) && n.$_attrs / metadataCandidate !== undefined`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
policy.valid
            ? `${here}@attrs:${JSON.stringify(key)}: reserved metadata must be stored in $_meta`
            : `${here}@attrs:${JSON.stringify(key)}: ${policy.reason}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.251

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:133` at pre-edit `821ab89`.
- Trigger: `walk / !isVSN(n.$_tag) && n.$_attrs / lowerKey.startsWith(HSON_META_TRANSIT_PREFIX)`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}@attrs:${JSON.stringify(key)}: private HSON metadata transit name is forbidden`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.252

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:136` at pre-edit `821ab89`.
- Trigger: `walk / !isVSN(n.$_tag) && n.$_attrs / lowerKey.startsWith(_TRANSIT_PREFIX)`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}@attrs:${JSON.stringify(key)}: private ordinary-attribute transit name is forbidden`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.253

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:139` at pre-edit `821ab89`.
- Trigger: `walk / !isVSN(n.$_tag) && n.$_attrs / !is_valid_hson_attribute_name(key)`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}@attrs:${JSON.stringify(key)}: invalid HSON attribute name`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.254

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:147` at pre-edit `821ab89`.
- Trigger: `walk / !isVSN(n.$_tag) / structure.kind === "invalid"`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: ${structure.reason}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.255

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:151` at pre-edit `821ab89`.
- Trigger: `walk / !isVSN(n.$_tag) / structure.kind === "legacy-empty-element-wrapper"`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: empty _hson_elem is not valid retained canonical state; use $_content: []`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.256

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:155` at pre-edit `821ab89`.
- Trigger: `walk / !isVSN(n.$_tag) / parentTag === ELEM_TAG && structure.kind !== "empty-element" && structure.kind !== "element"`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: element branch requires recursively element-structured ordinary nodes (found ${structure.kind})`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.257

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:162` at pre-edit `821ab89`.
- Trigger: `walk / !isVSN(n.$_tag) / parentTag === OBJ_TAG       && structure.kind !== "object"       && structure.kind !== "object-scalar"       && structure.kind !== "array"`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: object property must retain an object scalar, _hson_obj, or _hson_arr relationship (found ${structure.kind})`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.258

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:173` at pre-edit `821ab89`.
- Trigger: `walk / !isVSN(n.$_tag) / parentTag === II_TAG`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: ordinary node must be wrapped by _hson_obj before array membership`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.259

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:184` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === STR_TAG || n.$_tag === VAL_TAG / c.length !== 1`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: ${n.$_tag} must have exactly one item in $_content`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.260

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:188` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === STR_TAG || n.$_tag === VAL_TAG / c.length !== 1 / n.$_tag === STR_TAG && typeof v !== "string"`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: _hson_str payload must be string`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.261

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:192` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === STR_TAG || n.$_tag === VAL_TAG / c.length !== 1 / n.$_tag === VAL_TAG / typeof v === "number" && !Number.isFinite(v)`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}/$_content[0]: invalid HSON number ${String(v)}; numbers must be finite`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.262

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:198` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === STR_TAG || n.$_tag === VAL_TAG / c.length !== 1 / n.$_tag === VAL_TAG / !validPayload`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}/$_content[0]: _hson_val payload must be a finite number, boolean, or null (found ${String(v)})`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.263

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:211` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === II_TAG / parentTag !== ARR_TAG`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: _hson_ii must appear directly under _hson_arr`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.264

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:212` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === II_TAG / n.$_attrs && Object.keys(n.$_attrs).length`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: _hson_ii must not have $_attrs`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.265

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:215` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === II_TAG / cc.length !== 1`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: _hson_ii must contain exactly one child node`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.266

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:217` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === II_TAG / !is_Node(only)`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: _hson_ii child must be a node (found primitive/null)`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.267

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:219` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === II_TAG / is_Node(only) && !isVSN(only.$_tag)`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: direct ordinary _hson_ii child must be wrapped by _hson_obj`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.268

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:222` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === II_TAG / is_Node(only) && only.$_tag === ELEM_TAG`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: _hson_arr cannot contain an element-mode value; arrays cannot cross object/element structural modes`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.269

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:230` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === ARR_TAG / !indexAnalysis.valid`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: ${indexAnalysis.reason}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.270

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:233` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === ARR_TAG / !indexAnalysis.valid / indexAnalysis.reordered`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: physical _hson_ii order must match canonical index order`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.271

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:240` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === ARR_TAG / !is_Node(k)`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${childPath}: primitive/null outside _hson_str/_hson_val`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.272

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:241` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === ARR_TAG / k.$_tag !== II_TAG`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${childPath}: only _hson_ii allowed directly under _hson_arr`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.273

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:253` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === ELEM_TAG / kids.length === 0`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: empty _hson_elem is not valid retained canonical state`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.274

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:262` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === ELEM_TAG / !is_Node(k)`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${childPath}: primitive/null outside _hson_str`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.275

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:268` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === ELEM_TAG / k.$_tag === VAL_TAG`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${childPath}: _hson_elem cannot contain _hson_val; quote scalar text as _hson_str instead`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.276

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:274` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === ELEM_TAG / k.$_tag === OBJ_TAG || k.$_tag === ARR_TAG || k.$_tag === II_TAG`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${childPath}: _hson_elem cannot contain ${k.$_tag} (only _hson_str or normal element tags allowed)`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.277

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:288` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === ROOT_TAG / kids.length > 1`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: _hson_root must contain at most one child`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.278

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:292` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === ROOT_TAG / kids.length === 1 / !is_Node(only)`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: _hson_root child must be a node; found: primitive (${only})`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.279

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:298` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === ROOT_TAG / kids.length === 1 / !is_Node(only) / !(only.$_tag === OBJ_TAG         || only.$_tag === ELEM_TAG         || only.$_tag === ARR_TAG         || only.$_tag === STR_TAG         || only.$_tag === VAL_TAG)`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}: _hson_root child must be one of _hson_obj/_hson_elem/_hson_arr/_hson_str/_hson_val`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.280

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:312` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === OBJ_TAG / !is_Node(p)`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${pHere}: [ERR: OBJ001] primitive/null outside _hson_str/_hson_val`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.281

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:318` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === OBJ_TAG / p.$_attrs && Object.keys(p.$_attrs).length`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${pHere}: [ERR: OBJ002] _hson_obj children must not have $_attrs`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.282

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:323` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === OBJ_TAG / p.$_tag === ELEM_TAG`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${pHere}: [ERR: OBJ004] _hson_elem is not allowed directly under _hson_obj`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.283

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:334` at pre-edit `821ab89`.
- Trigger: `walk / n.$_tag === OBJ_TAG / !p.$_tag.startsWith(HSON_SYS_PREFIX) / seen.has(p.$_tag)`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${pHere}: [ERR: OBJ003] duplicate property tag "${p.$_tag}" inside _hson_obj`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.284

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:354` at pre-edit `821ab89`.
- Trigger: `walk / is_Node(k)`; emission `push`.
- Rendered payload / exact formatter expression:

```ts
`${here}/[${i}]: primitive outside _hson_str/_hson_val`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.285

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/assert-invariants.ts:402` at pre-edit `821ab89`.
- Trigger: `assertNewShapeQuick / !is_plain_record(node)`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[NEW-only] node must be a plain object in ${where} at ${frame.path || "/"}`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.286

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/assert-invariants.ts:407` at pre-edit `821ab89`.
- Trigger: `assertNewShapeQuick / tagProperty === undefined || !tagProperty.present || typeof tagProperty.value !== "string"`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[NEW-only] node has invalid $_tag in ${where}`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.287

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/assert-invariants.ts:413` at pre-edit `821ab89`.
- Trigger: `assertNewShapeQuick / contentProperty === undefined || !contentProperty.present || !Array.isArray(contentProperty.value)`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[NEW-only] node <${tag}> must carry an array $_content in ${where}`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.288

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/assert-invariants.ts:418` at pre-edit `821ab89`.
- Trigger: `assertNewShapeQuick / contentItems === undefined`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[NEW-only] node <${tag}> must carry dense enumerable own data items in $_content in ${where}`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.289

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/assert-invariants.ts:423` at pre-edit `821ab89`.
- Trigger: `assertNewShapeQuick / origin !== undefined`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[NEW-only] cycle detected in ${where} at ${here} (reference returns to ${origin})`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.290

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/assert-invariants.ts:432` at pre-edit `821ab89`.
- Trigger: `assertNewShapeQuick / metaProperty === undefined`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[NEW-only] $_meta must be an enumerable own data property when present in ${where} at <${tag}>`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.291

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/assert-invariants.ts:435` at pre-edit `821ab89`.
- Trigger: `assertNewShapeQuick / attrsProperty === undefined`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[NEW-only] $_attrs must be an enumerable own data property when present in ${where} at <${tag}>`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.292

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/assert-invariants.ts:443` at pre-edit `821ab89`.
- Trigger: `assertNewShapeQuick / hasMeta && !is_plain_record(metaValue)`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[NEW-only] $_meta must be a plain object when present in ${where} at <${tag}>`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.293

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/assert-invariants.ts:446` at pre-edit `821ab89`.
- Trigger: `assertNewShapeQuick / hasAttrs && !is_plain_record(attrsValue)`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[NEW-only] $_attrs must be a plain object when present in ${where} at <${tag}>`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.294

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/assert-invariants.ts:455` at pre-edit `821ab89`.
- Trigger: `assertNewShapeQuick / metaEntries === undefined`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[NEW-only] $_meta entries must be enumerable own data properties in ${where} at <${tag}>`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.295

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/assert-invariants.ts:458` at pre-edit `821ab89`.
- Trigger: `assertNewShapeQuick / attrsEntries === undefined`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[NEW-only] $_attrs entries must be enumerable own data properties in ${where} at <${tag}>`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.296

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/assert-invariants.ts:464` at pre-edit `821ab89`.
- Trigger: `assertNewShapeQuick / meta && (       has_inherited_property(meta, HSON_META_QUID)       || has_inherited_property(meta, HSON_META_INDEX)     )`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[NEW-only] $_meta must not inherit canonical metadata fields in ${where} at <${tag}>`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.297

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/assert-invariants.ts:468` at pre-edit `821ab89`.
- Trigger: `assertNewShapeQuick / metaEntries.some(([key]) => key === "attrs" || key === "flags")`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[NEW-only] old-shaped meta in ${where} at <${tag ?? "?"}>
  Found $_meta.attrs or $_meta.flags`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.298

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/assert-invariants.ts:476` at pre-edit `821ab89`.
- Trigger: `assertNewShapeQuick / typeof tag === "string" / policy.valid && !policy.definition.validateValue(value)`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[NEW-only] invalid metadata value for "${key}" in ${where} at <${tag}>`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.299

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/assert-invariants.ts:485` at pre-edit `821ab89`.
- Trigger: `assertNewShapeQuick / !validPrimitive && !validStyle`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[NEW-only] malformed attribute value for "${key}" in ${where} at <${tag}>`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.300

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/assert-invariants.ts:490` at pre-edit `821ab89`.
- Trigger: `assertNewShapeQuick / tag && isVSN(tag) && attrsEntries.length`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
` VSN <${tag}> with $_attrs :  ${where}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.301

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/errors.ts:90` at pre-edit `821ab89`.
- Trigger: `_throw_transform_err`; emission `ctxLine`.
- Rendered payload / exact formatter expression:

```ts
ctx ? `\n  :: ${ctx}` : ""
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.302

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/errors.ts:91` at pre-edit `821ab89`.
- Trigger: `_throw_transform_err`; emission `errorMessage`.
- Rendered payload / exact formatter expression:

```ts
`[ERR: transform = ${functionName}()]:\n  -> ${message}${ctxLine}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.303

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/errors.ts:92` at pre-edit `821ab89`.
- Trigger: `_throw_transform_err`; emission `new TransformError`.
- Rendered payload / exact formatter expression:

```ts
errorMessage
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.304

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/hson-array-indexes.ts:63` at pre-edit `821ab89`.
- Trigger: `analyze_hson_array_indexes / !is_Node(child) || child.$_tag !== II_TAG`; emission `reason`.
- Rendered payload / exact formatter expression:

```ts
`only ${II_TAG} nodes may appear directly under _hson_arr`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.305

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/hson-array-indexes.ts:71` at pre-edit `821ab89`.
- Trigger: `analyze_hson_array_indexes / typeof rawIndex !== "string"`; emission `reason`.
- Rendered payload / exact formatter expression:

```ts
`${II_TAG} at physical position ${physicalPosition} must carry "${HSON_META_INDEX}" as a string in $_meta`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.306

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/hson-array-indexes.ts:79` at pre-edit `821ab89`.
- Trigger: `analyze_hson_array_indexes / canonicalPosition === undefined`; emission `reason`.
- Rendered payload / exact formatter expression:

```ts
`${II_TAG} index ${JSON.stringify(rawIndex)} is not an exact canonical index for ${content.length} sibling(s)`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.307

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/hson-array-indexes.ts:85` at pre-edit `821ab89`.
- Trigger: `analyze_hson_array_indexes / canonical[canonicalPosition] !== undefined`; emission `reason`.
- Rendered payload / exact formatter expression:

```ts
`duplicate ${II_TAG} index ${JSON.stringify(rawIndex)}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.308

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/hson-array-indexes.ts:95` at pre-edit `821ab89`.
- Trigger: `analyze_hson_array_indexes / canonical[position] === undefined`; emission `reason`.
- Rendered payload / exact formatter expression:

```ts
`missing ${II_TAG} index ${JSON.stringify(String(position))}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.309

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/hson-array-indexes.ts:123` at pre-edit `821ab89`.
- Trigger: `normalize_hson_array_index_order`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[HSON array indexes] ${message} in ${where} at ${path || "/"}`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.310

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/hson-array-indexes.ts:151` at pre-edit `821ab89`.
- Trigger: `normalize_hson_array_index_order / active.has(node)`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[HSON array indexes] cycle detected in ${where} at ${path}`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.311

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/hson-array-indexes.ts:170` at pre-edit `821ab89`.
- Trigger: `normalize_hson_array_index_order / tag === ARR_TAG / !analysis.valid`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`[HSON array indexes] ${analysis.reason} in ${where} at ${path}/${tag}`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.312

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/hson-metadata.ts:109` at pre-edit `821ab89`.
- Trigger: `hson_metadata_policy / definition === undefined`; emission `reason`.
- Rendered payload / exact formatter expression:

```ts
"unknown canonical metadata key"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.313

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/hson-metadata.ts:116` at pre-edit `821ab89`.
- Trigger: `hson_metadata_policy / nodeKind === undefined || !definition.allowedNodeKinds.includes(nodeKind)`; emission `reason`.
- Rendered payload / exact formatter expression:

```ts
`metadata "${key}" is not defined for node "${nodeTag}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.314

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/hson-metadata.ts:149` at pre-edit `821ab89`.
- Trigger: `admit_hson_metadata_markup / candidate === undefined || key === undefined`; emission `reason`.
- Rendered payload / exact formatter expression:

```ts
`unknown HSON metadata markup name "${markupName}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.315

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/hson-metadata.ts:157` at pre-edit `821ab89`.
- Trigger: `admit_hson_metadata_markup / !policy.definition.validateValue(value)`; emission `reason`.
- Rendered payload / exact formatter expression:

```ts
`invalid value for HSON metadata "${markupName}"`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.316

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/hson-node-quid.ts:26` at pre-edit `821ab89`.
- Trigger: `encode_persisted_quid / bytes.length !== PERSISTED_QUID_RANDOM_BYTE_LENGTH`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
`persisted QUID encoding requires exactly ${PERSISTED_QUID_RANDOM_BYTE_LENGTH} bytes`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.317

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/hson-node-quid.ts:80` at pre-edit `821ab89`.
- Trigger: `mint_hson_node_quid / !globalThis.crypto?.getRandomValues`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"secure QUID generation is unavailable"
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.318

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/hson-node-quid.ts:95` at pre-edit `821ab89`.
- Trigger: `assert_hson_node_quid_eligible`; emission `new HsonNodeQuidValidationError`.
- Rendered payload / exact formatter expression:

```ts
`Cannot ${operation} QUID metadata on ineligible HSON structural node "${node.$_tag}".`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.319

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/hson-node-quid.ts:126` at pre-edit `821ab89`.
- Trigger: `read_hson_node_quid / !is_persisted_quid(value)`; emission `new HsonNodeQuidValidationError`.
- Rendered payload / exact formatter expression:

```ts
`Invalid persisted QUID "${String(value)}".`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.320

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/hson-node-quid.ts:151` at pre-edit `821ab89`.
- Trigger: `assign_hson_node_quid / !is_persisted_quid(quid)`; emission `new HsonNodeQuidValidationError`.
- Rendered payload / exact formatter expression:

```ts
`Invalid persisted QUID "${String(quid)}".`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.321

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/hson-node-quid.ts:215` at pre-edit `821ab89`.
- Trigger: `collect_hson_node_quid_claims`; emission `new HsonNodeQuidValidationError`.
- Rendered payload / exact formatter expression:

```ts
`${cause.message} at ${current.path}.`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.322

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: D; `src/core/hson-node-quid.ts:255` at pre-edit `821ab89`.
- Trigger: `index_unique_hson_node_quid_claims / prior !== undefined && prior.node !== claim.node`; emission `new HsonNodeQuidValidationError`.
- Rendered payload / exact formatter expression:

```ts
`Duplicate persisted QUID "${claim.quid}" at ${prior.path} and ${claim.path}.`
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.323

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/hson-number.ts:20` at pre-edit `821ab89`.
- Trigger: `admitHsonNumber / typeof value !== "number"`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`HSON numbers must be primitive JavaScript numbers; received ${typeof value}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.324

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/hson-number.ts:29` at pre-edit `821ab89`.
- Trigger: `admitHsonNumber / !Number.isFinite(value)`; emission `_throw_transform_err`.
- Rendered payload / exact formatter expression:

```ts
`invalid HSON number ${String(value)}; numbers must be finite`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.325

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/hson-structural-mode.ts:23` at pre-edit `821ab89`.
- Trigger: `classify_ordinary_hson_structure / EVERY_VSN.includes(node.$_tag)`; emission `reason`.
- Rendered payload / exact formatter expression:

```ts
"structural classification requires an ordinary node"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.326

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/hson-structural-mode.ts:31` at pre-edit `821ab89`.
- Trigger: `classify_ordinary_hson_structure / content.length !== 1 || !is_Node(content[0])`; emission `reason`.
- Rendered payload / exact formatter expression:

```ts
"ordinary node must contain no content or exactly one structural wrapper"
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

#### baseline.327

- Representative authored context: ``N/A for malformed internal graph/API defenses; <age 1> is admitted normally, not a reproducer``.
- Schema condition: none; canonical graph, value, metadata/QUID or serialization contract shown below.
- Owner/category: B; `src/core/hson-structural-mode.ts:48` at pre-edit `821ab89`.
- Trigger: `classify_ordinary_hson_structure`; emission `reason`.
- Rendered payload / exact formatter expression:

```ts
`ordinary node content must be ${ELEM_TAG}, ${OBJ_TAG}, or ${ARR_TAG}`
```

- Surface: Verbatim TransformError when recognized by the syntax/admission adapter; non-Transform exceptions go to unexpected-failure output or trusted runtime status.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

### Census: Schema root capability and validation boundary

#### baseline.328

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/internal/schema-hson-validation/validate-canonical-hson.ts:10` at pre-edit `821ab89`.
- Trigger: `validate_canonical_hson / typeof canonical !== "string"`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"validate requires an HsonCanonical string."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.329

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: D; `src/internal/schema-hson-validation/validate-canonical-hson.ts:13` at pre-edit `821ab89`.
- Trigger: `validate_canonical_hson / !result.ok`; emission `new LiveMapSchemaError`.
- Rendered payload / exact formatter expression:

```ts
"HSON Schema validation failed."
```

- Surface: Not a normal source diagnostic; may propagate verbatim through trusted project/module or callback failure. Defensive helpers may be unreachable for admitted source.
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.330

- Representative authored context: ``<age "37"> / [1]``.
- Schema condition: see exact validator/constructor condition below and paired executable Schema scenarios above; invalid constructor/rule guards have no source-only reproducer.
- Owner/category: B; `src/internal/schema-hson-validation/validate-schema-hson-graph.ts:28` at pre-edit `821ab89`.
- Trigger: `failure`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
`Expected ${expected}; received ${received}.`
```

- Surface: Adapted: issue.message is discarded; code/path/expected/received/attributeName and sidecars are authoritative.
- Precision: exact point when source evidence exists; otherwise unresolved (whole source/body).
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: suggestion only by default; strict safe cases and no-general-fix constraints are identified in the review examples.
- Evidence limitation: Source expressions below are evidence of existing language, not permission to parse prose or invent missing semantic fields.

### Census: Trusted runtime and availability

#### baseline.331

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/dev-registration.ts:15` at pre-edit `821ab89`.
- Trigger: `register_trusted_schema_for_development / !id || (typeof schema !== "object" && typeof schema !== "function") || schema === null`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Trusted Schema development registration requires an id and an actual Schema object."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.332

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/interpolation-capture.ts:65` at pre-edit `821ab89`.
- Trigger: `capture_interpolation / captures.length >= MAX_CAPTURES / !overflow && strings.raw.length === site.literals.length && strings.raw.every((s, i) => s === site.literals[i]?.raw) / !overflow`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
cause instanceof Error ? cause.message : "HSON admission failed."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.333

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/lifecycle-evidence.ts:43` at pre-edit `821ab89`.
- Trigger: `capture_trusted_schema_template / strings.length !== 1 || values.length !== 0`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"D1 requires a substitution-free authored template."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.334

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/lifecycle-evidence.ts:57` at pre-edit `821ab89`.
- Trigger: `construct_trusted_schema_application / !CAPTURED_TEMPLATES.has(template)`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"Unknown D1 template capture."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.335

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/lifecycle-evidence.ts:90` at pre-edit `821ab89`.
- Trigger: `construct_trusted_schema_static_application / !CAPTURED_TEMPLATES.has(template)`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"Unknown static source occurrence capture."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.336

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/lifecycle-evidence.ts:100` at pre-edit `821ab89`.
- Trigger: `attempt_trusted_schema_attachment / constructedRevision === undefined`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"Unknown D1 direct application."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.337

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/lifecycle-evidence.ts:125` at pre-edit `821ab89`.
- Trigger: `attempt_trusted_schema_attachment / map.mode === "element" / map.mode === "fragment" / !is_owned_projected_schema(schema)`; emission `new TypeError`.
- Rendered payload / exact formatter expression:

```ts
"Unrecognized projected Schema capability."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.338

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/node-runtime-entry.ts:10` at pre-edit `821ab89`.
- Trigger: ``; emission `message`.
- Rendered payload / exact formatter expression:

```ts
cause instanceof Error ? cause.message : "Runtime failure."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.339

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/node-supervisor.ts:57` at pre-edit `821ab89`.
- Trigger: `options.maxRestarts !== undefined && (!Number.isSafeInteger(options.maxRestarts) || options.maxRestarts < 0)`; emission `new RangeError`.
- Rendered payload / exact formatter expression:

```ts
"maxRestarts must be a nonnegative safe integer."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.340

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/node-supervisor.ts:84` at pre-edit `821ab89`.
- Trigger: `launch / this.#generation > 0 / this.#restarts >= this.#options.maxRestarts`; emission `new TrustedSchemaInfrastructureError`.
- Rendered payload / exact formatter expression:

```ts
"Trusted Schema runtime restart budget exhausted; create a new owner to retry."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.341

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/node-supervisor.ts:95` at pre-edit `821ab89`.
- Trigger: `launch / this.#child === child`; emission `new TrustedSchemaInfrastructureError`.
- Rendered payload / exact formatter expression:

```ts
"Trusted Schema runtime disconnected."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.342

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/node-supervisor.ts:102` at pre-edit `821ab89`.
- Trigger: `launch / started.type !== "ready"`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
started.message ?? "Trusted Schema runtime did not start."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.343

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/node-supervisor.ts:117` at pre-edit `821ab89`.
- Trigger: `dispatch / child === undefined`; emission `new TrustedSchemaInfrastructureError`.
- Rendered payload / exact formatter expression:

```ts
"Trusted Schema runtime is unavailable."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.344

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/node-supervisor.ts:130` at pre-edit `821ab89`.
- Trigger: `dispatch`; emission `new TrustedSchemaInfrastructureError`.
- Rendered payload / exact formatter expression:

```ts
`Trusted Schema request timed out after ${Math.round(performance.now() - started)}ms.`
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.345

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/node-supervisor.ts:137` at pre-edit `821ab89`.
- Trigger: `dispatch`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"Trusted Schema IPC send failed."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.346

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/node-supervisor.ts:141` at pre-edit `821ab89`.
- Trigger: `terminate`; emission `new TrustedSchemaInfrastructureError`.
- Rendered payload / exact formatter expression:

```ts
"Trusted Schema runtime retired."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.347

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/node-supervisor.ts:152` at pre-edit `821ab89`.
- Trigger: `require_trust / this.#disposed`; emission `new TrustedSchemaInfrastructureError`.
- Rendered payload / exact formatter expression:

```ts
"Trusted Schema supervisor is disposed."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.348

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/node-supervisor.ts:153` at pre-edit `821ab89`.
- Trigger: `require_trust / !this.#options.trust.workspaceTrusted || !this.#options.trust.enabled`; emission `new TrustedSchemaInfrastructureError`.
- Rendered payload / exact formatter expression:

```ts
"Trusted Schema diagnostics require Workspace Trust and explicit enablement."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.349

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:33` at pre-edit `821ab89`.
- Trigger: `handle / request.protocolVersion !== TRUSTED_SCHEMA_DIAGNOSTICS_PROTOCOL_VERSION`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Unsupported trusted Schema diagnostics protocol."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.350

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:34` at pre-edit `821ab89`.
- Trigger: `handle / request.runtimeGeneration !== this.#generation`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Stale runtime generation."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.351

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:46` at pre-edit `821ab89`.
- Trigger: `handle`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Unrecognized trusted Schema diagnostics request."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.352

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:50` at pre-edit `821ab89`.
- Trigger: `load / this.#loadAttempted`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"D1 requires a new generation to load another project."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.353

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:54` at pre-edit `821ab89`.
- Trigger: `load / !is_trusted_schema_runtime(configured.hson)`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Configured runtime is not the D1 validator's supported runtime instance."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.354

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:68` at pre-edit `821ab89`.
- Trigger: `load / project.hson !== undefined && !is_trusted_schema_runtime(project.hson)`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Project runtime identity differs from the validator."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.355

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:70` at pre-edit `821ab89`.
- Trigger: `load / exported !== undefined && (typeof exported !== "object" || exported === null)`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"trustedSchemas must be an object."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.356

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:71` at pre-edit `821ab89`.
- Trigger: `load / exported !== undefined && !is_trusted_schema_runtime(project.hson)`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Exported Schemas require explicit project runtime-origin evidence."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.357

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:75` at pre-edit `821ab89`.
- Trigger: `load / exported !== undefined / !is_owned_trusted_schema(schema)`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Exported Schema is not owned by the validator's capability registries."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.358

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:81` at pre-edit `821ab89`.
- Trigger: `load / !is_trusted_schema_runtime(registration.origin) || !is_owned_trusted_schema(registration.schema)`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Development registration has missing or incompatible runtime-origin evidence."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.359

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:82` at pre-edit `821ab89`.
- Trigger: `load / schemas.has(registration.id) && schemas.get(registration.id) !== registration.schema`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Conflicting Schema handles."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.360

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:85` at pre-edit `821ab89`.
- Trigger: `load / registration.sourceBinding !== undefined / !valid_schema_source_binding(registration.sourceBinding)`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Invalid source binding metadata."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.361

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:92` at pre-edit `821ab89`.
- Trigger: `load / project.trustedSchemaBindings !== undefined / !Array.isArray(project.trustedSchemaBindings)`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"trustedSchemaBindings must be an array."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.362

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:94` at pre-edit `821ab89`.
- Trigger: `load / project.trustedSchemaBindings !== undefined / !record || !schemas.has(record.schemaId) || !valid_schema_source_binding(record.binding) || record.binding.exportName === undefined`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Invalid exported source binding metadata."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.363

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:101` at pre-edit `821ab89`.
- Trigger: `load / record.binding.exportName !== undefined / owner[record.binding.exportName] !== schemas.get(record.schemaId)`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Source export differs from registered Schema object."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.364

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:106` at pre-edit `821ab89`.
- Trigger: `load / !is_trusted_schema_runtime(proposal.origin)`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Application runtime identity differs."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.365

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:114` at pre-edit `821ab89`.
- Trigger: `load / proposal.evidence.mapFlow !== undefined && proposal.evidence.binding !== undefined / schemas.get(proposal.evidence.schemaId) !== proposal.schema`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Application Schema identity does not match its declared runtime capability."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.366

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:125` at pre-edit `821ab89`.
- Trigger: `load`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
cause instanceof Error ? cause.message : "Project module failed to load."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.367

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:133` at pre-edit `821ab89`.
- Trigger: `associate / proposal === undefined || proposal.evidence.correspondence !== "direct"`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"No proven direct construction/attachment correspondence."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.368

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:144` at pre-edit `821ab89`.
- Trigger: `associateSource / objects.size > 1`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Source binding maps to different Schema objects."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.369

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:146` at pre-edit `821ab89`.
- Trigger: `associateSource / schema === undefined || !matches.some(record => record.schemaId === request.schemaId)`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"No current registered source binding."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.370

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:151` at pre-edit `821ab89`.
- Trigger: `associateSource / interpolation !== undefined / captures.length > 1`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Multiple evaluated templates occupy this source relationship."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.371

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:155` at pre-edit `821ab89`.
- Trigger: `associateSource / interpolation !== undefined / captures.length !== 1 || captures[0].evaluationId !== interpolation.evaluationId || captures[0].canonical === undefined         || (request.directSource.mapFlow === undefined && request.directSource.templateId !== captures[0].site.templateId)         || (request.directSource.mapFlow !== undefined && lifecycle?.evidence.evaluationId !== interpolation.evaluationId)`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"No exact current template evaluation."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.372

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:162` at pre-edit `821ab89`.
- Trigger: `associateSource / request.directSource.mapFlow !== undefined || request.lifecycleId !== undefined / proposals.length > 1`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Multiple runtime applications occupy this source relationship."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.373

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:168` at pre-edit `821ab89`.
- Trigger: `associateSource / request.directSource.mapFlow !== undefined || request.lifecycleId !== undefined / lifecycle === undefined || request.directSource.mapFlow === undefined || lifecycle.schema !== schema         || request.directSource.templateId !== request.directSource.mapFlow.templateId || request.directSource.callId !== request.directSource.mapFlow.callId         || !same_map_flow(lifecycle.evidence.mapFlow, request.directSource.mapFlow)         || lifecycle.evidence.binding === undefined || !same_schema_source_binding(lifecycle.evidence.binding, request.directSource.binding)         || lifecycle.evidence.correspondence !== "direct" || lifecycle.evidence.validationAttempted !== true || lifecycle.isCurrent?.() === false`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"No current source-bound map validation attempt."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.374

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:191` at pre-edit `821ab89`.
- Trigger: `validate / capture !== undefined && this.#captures.filter(c => c.site.templateId === capture.site.templateId && c.site.sourceRevision === capture.site.sourceRevision).length !== 1`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Template evaluated again after association."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.375

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:199` at pre-edit `821ab89`.
- Trigger: `validate`; emission `message`.
- Rendered payload / exact formatter expression:

```ts
cause instanceof Error ? cause.message : "Candidate HSON is invalid."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.376

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:209` at pre-edit `821ab89`.
- Trigger: `validate`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
cause instanceof Error ? cause.message : "Schema validation threw unexpectedly."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.377

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:213` at pre-edit `821ab89`.
- Trigger: `validate / capture !== undefined / current.length !== 1 || current[0].evaluationId !== capture.evaluationId`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Template evidence changed during validation."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.378

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:236` at pre-edit `821ab89`.
- Trigger: `complete / direct === undefined || !same_direct_source(direct.evidence, request.directSource)       || direct.evidence.templateRevision !== request.templateRevision || direct.evidence.documentRevision !== request.candidateRevision       || direct.schemaId !== request.schemaId || this.#schemas.get(request.schemaId) !== direct.schema       || direct.lifecycle?.isCurrent?.() === false`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"No current completion contract."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.379

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:243` at pre-edit `821ab89`.
- Trigger: `complete / !interpolationCurrent()`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"No current interpolation evidence."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.380

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/runtime.ts:245` at pre-edit `821ab89`.
- Trigger: `complete / direct.lifecycle?.isCurrent?.() === false || !interpolationCurrent()`; emission `this.error`.
- Rendered payload / exact formatter expression:

```ts
"Completion contract retired."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.381

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/source-lifecycle.ts:25` at pre-edit `821ab89`.
- Trigger: `interpolation / tag !== HSON`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"Unsupported authored tag runtime identity."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.382

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/source-lifecycle.ts:38` at pre-edit `821ab89`.
- Trigger: `tag / tag !== HSON`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"Unsupported authored tag runtime identity."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.383

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/source-lifecycle.ts:46` at pre-edit `821ab89`.
- Trigger: `construct / constructor !== hsonLiveMap.fromHson`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"Unsupported LiveMap construction runtime identity."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.384

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/source-lifecycle.ts:54` at pre-edit `821ab89`.
- Trigger: `construct / template === undefined || template.kind !== "tagged" || canonical !== template.canonical`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"Missing exact authored occurrence capture."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.385

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/source-lifecycle.ts:61` at pre-edit `821ab89`.
- Trigger: `constructStatic / constructor !== hsonLiveMap.fromHson`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"Unsupported LiveMap construction runtime identity."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.386

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/source-lifecycle.ts:63` at pre-edit `821ab89`.
- Trigger: `constructStatic / typeof source !== "string"`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"Static fromHson construction did not receive a string."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.387

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/source-lifecycle.ts:66` at pre-edit `821ab89`.
- Trigger: `constructStatic / template.kind !== "static" || template.source !== source`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"Static source occurrence changed during trusted module execution."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.388

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/source-lifecycle.ts:81` at pre-edit `821ab89`.
- Trigger: `use / site !== undefined && interpolationIds.has(site.mapFlow.templateId) && captured === undefined / actual === undefined`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"Missing actual map construction."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.

#### baseline.389

- Representative authored context: ``<age 37> (valid context; failure is runtime state, not these bytes)``.
- Schema condition: registered number Schema unless configuration/capability is rejected first.
- Owner/category: C; `src/internal/trusted-schema-diagnostics/source-lifecycle.ts:85` at pre-edit `821ab89`.
- Trigger: `use / site === undefined || captured === undefined || captured.constructionId !== site.mapFlow.constructionId           || captured.application.template !== templates.get(site.mapFlow.templateId)`; emission `new Error`.
- Rendered payload / exact formatter expression:

```ts
"Missing actual map/source lifecycle."
```

- Surface: Verbatim in status tooltip when carried as response.message / caught Error.message; lifecycle and completion-only failures may be suppressed (see reachability notes).
- Precision: status/infrastructure.
- Related: None unless the consuming adapter supplies the shared related-role or validation/use-site label.
- Future fix: none (infrastructure/API state is not an authored-text repair).
- Evidence limitation: No source range or repair evidence is implied by this error. Error.message may be arbitrary caller/host text.
