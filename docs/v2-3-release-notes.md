## 2.3.0

### Added
- initial `LiveTree.canvas` namespace.
- typed `create.canvas()` support.
- canvas helpers for scope detection, mounted canvas access, 2D context access, width, and height.
- `LiveTreeApi` capability interfaces for the public LiveTree surface.
- generated JSON transform fuzz fixtures.

### Changed
- moved form helpers under `tree.form`.
- refactored data helpers to use a lightweight data API factory.

### Breaking
- removed `tree.setFormValue()` and `tree.getFormValue()`.
 --> use `tree.form.setValue()` and `tree.form.getValue()` instead.