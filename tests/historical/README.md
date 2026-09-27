# Historical solo recovery probes

The `locus-client-recovery.legacy.mjs` and `locus-document-recovery.legacy.mjs` files record the earlier solo Locus/Echo recovery contract. They are archived, excluded from active acceptance scripts, and are not executable from this directory. They include public generated-QUID replay and portable node claims that current admission correctly rejects. Hosted aggregate bootstrap and recovery are covered by `locus-bootstrap-recovery-6d.acceptance.mts`, the Step 6A–6C suites, and the hosted document suites.

The historical solo-Locus implementation remains available through Git history.

`livetree-graft-continuation.legacy.html` preserves the former browser graft/borrowed-Reflect fixture. Its setup fed generated QUID metadata through public `LiveMap.fromNode`, used inline script content now rejected by the document contract, and assumed pre-boundary text positions and old nested-graft errors. The current graft, browser realization, and existing-document suites cover the supported pieces. This archived HTML is not a current browser gate.
