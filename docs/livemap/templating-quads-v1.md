## Hson — Templating, Parts, CSS, and QUADs v0.1
**Development changelog | October 2026**

This work introduced reusable document composition directly into LiveMap, expanded document subject addressing, and completed the identity and CSS machinery needed to preserve composed documents through rendering, restoration, and browser grafting.

The principal outcome is **automatic Part composition without a separate public templating API**.

### 1. Governed Part collections

Introduced a new validated form of data Library for reusable document Parts.

- Parts are keyed members of an ordinary governed data Library.
- Each Part contains a single-root document definition and optional CSS.
- Part collections support normal LiveMap governance, validation, capture, and transport.
- Definitions remain inert until instantiated into a document.
- Multiple occurrences can use the same definition independently.

Parts do not introduce a separate Library authority or component runtime.

### 2. Recursive document composition

Built the internal machinery for assembling documents from reusable Parts.

- Supports nested and repeated Part occurrences.
- Resolves Part references by collection Library and member key.
- Preserves the order and structure of inserted content.
- Handles subject correspondence and identity allocation across occurrences.
- Validates composition before publishing the resulting document.
- Rejects missing definitions, invalid configurations, collisions, and unsupported references atomically.

Early development used a private recursive configuration system, including customization and explicit QUAD promotion. This eventually informed a simpler declarative authoring model.

### 3. Automatic Part admission

**Introduced `<hson-part>` as the document composition connector.**

```html
<main>
  <hson-part
    lib="parts"
    at="navigation"
    @:mainNav
  />
</main>
```

LiveMap expands the connector into the selected Part's actual root element.

- Composition occurs automatically during authored document admission.
- Supported subsequent document mutations can insert new Parts.
- Nested connectors expand recursively.
- The connector disappears from the realized document.
- Rendering operates on the already-composed graph.
- No public `.template()` or `.compose()` method is required.

The accepted document remains an ordinary, mutable LiveMap document Library.

Version 0.1 uses **realized-only storage**: the authored source containing connectors must be retained by the application if needed later. Changing a Part definition does not retroactively change existing occurrences.

### 4. Inline Part parameters

Added simple initialization-value substitution using `%{name}` placeholders.

Part definition:

```html
<button>%{label}</button>
```

Invocation:

```html
<hson-part
  lib="parts"
  at="button"
  label="Continue"
/>
```

The composer substitutes values during construction.

Supported scalar types retain their canonical meaning where applicable. Partial string substitution, escaping, missing parameters, and invalid inputs have defined validation behavior.

Parameters are initialization values, not reactive bindings or executable expressions.

### 5. Part-scoped CSS

Expanded managed CSS to support independently styled Part occurrences.

- Each styled occurrence receives an automatically established root identity scope.
- Ordinary CSS selectors are scoped to that occurrence.
- Root selectors, descendant selectors, CSS nesting, and supported conditions retain their expected behavior.
- Repeated occurrences receive independent styling scopes.
- Nested Parts retain their own scopes while participating in the normal CSS cascade.
- Part authors do not need to declare a root QUAD solely for styling.

For example, a Part can contain:

```css
button {
  color: red;
}

button:hover {
  color: blue;
}
```

The composer scopes those rules to the instantiated occurrence rather than applying them document-wide.

### 6. Automatic CSS ownership and cleanup

Added lifecycle ownership for CSS contributed by Part occurrences.

- Generated CSS is installed atomically with the corresponding document structure.
- Moving an occurrence preserves its styling.
- Removing an occurrence removes its owned CSS.
- Removing a parent occurrence also cleans up nested occurrence styles.
- Unrelated managed CSS remains intact.
- Independently authored CSS retains existing strict identity-retirement protections.

This makes inserting and removing styled Parts an ordinary document-editing operation rather than one requiring manual stylesheet management.

### 7. Portable CSS and subject identity

Extended document portability to preserve CSS correspondence across runtime boundaries.

- QUID-dependent CSS can be projected into portable subject correspondence.
- Receiving runtimes issue fresh local identities.
- CSS selectors are translated to those receiving identities.
- Sparse identity allocation avoids issuing QUIDs unnecessarily.
- Capture and rendering remain observational and do not mint identities.
- Repeated capture, restoration, and grafting preserve supported styling behavior.

This work also strengthened ordinary managed subject-CSS portability independently of Parts.

### 8. Public document `.q(name)` access

**Introduced identity-following QUAD lookup on document Libraries.**

```ts
const page = map.lib("page");

const button = page.q("mainNav");
```

The method returns a document location when the authored QUAD exists, or `undefined` otherwise.

- Locations follow their subjects through supported movement and replacement lineage.
- Existing document location operations can read and edit those subjects.
- Child `.at()` locations remain relative to their parent location.
- Retired subjects invalidate old `.q()` handle families.
- Disposal and authority-incarnation replacement invalidate stale handles.
- Lookup does not allocate identities or create authored QUADs.
- Existing LiveMap authority and mutation restrictions remain enforced.

This capability applies to ordinary document Libraries, not data Libraries.

### 9. QUAD promotion and composition naming

Refined the relationship between authored Part addresses and receiving document addresses.

- Part-local QUADs remain local during composition.
- A connector's optional QUAD transfers to the resulting root element.
- Styled roots can receive QUIDs without any authored QUAD.
- Receiving document QUAD uniqueness remains enforced.
- Private configuration promotion was renamed from `as` to `q`, with the old control removed.

No hierarchical QUAD namespace was introduced in v0.1.

### 10. SSR, grafting, and live DOM continuity

Extended the existing server-rendering and browser-grafting machinery to work with composed, styled documents.

- Composed documents render correctly without browser JavaScript.
- Portable identity carriers preserve styling through initial HTML delivery.
- Browser grafting adopts existing Elements rather than rebuilding them.
- LiveTree/Mirror can update native CSS identity carriers when styling requirements change.
- Existing Elements, QUIDs, QUADs, and handles can survive supported replacements that introduce or remove Part CSS.
- Source-free restoration does not require the original Part definitions.

The work included repairs to replacement-lineage preservation, CSS-only mutation detection, and native identity-attribute projection.

### 11. Validation and regression coverage

Added and expanded acceptance coverage for:

- Part collection validation and composition.
- Recursive and repeated occurrences.
- Scalar parameter substitution.
- QUAD continuity and retirement.
- Managed CSS ownership and cleanup.
- CSS nesting, root matching, and selector fidelity.
- Portable capture and restoration.
- LiveMap mutation atomicity.
- SSR without JavaScript.
- LiveTree/Mirror grafting and native Element preservation.

Validation included Node, actual Workers, and real Chrome.

---

### Overall result

The completed work establishes this basic authoring model:

**Define Parts → Author a document containing `<hson-part>` → Admit it to LiveMap → Render or edit the realized document.**

The major user-facing additions are **governed Part collections, automatic `<hson-part>` composition, `%{}` parameters, occurrence-scoped CSS, and document `.q(name)` access**.

The remaining complexity is largely internal: coherent graph construction, CSS ownership, sparse identities, portability, and restoration.

No separate public templating operation, component runtime, hierarchical QUAD registry, or interaction-binding framework was introduced.
