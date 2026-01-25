// ----------------------------------------------
// A custom property name must start with `--`.
// ----------------------------------------------
export type CssCustomPropName = `--${string}`;

// ----------------------------------------------
//  tight syntax list @property 
// ----------------------------------------------
export type PropertySyntax =
  | "<number>"
  | "<length>"
  | "<angle>"
  | "<time>"
  | "<percentage>"
  | "<color>"
  | "<length-percentage>"
  | "<angle-percentage>"
  | "<number-percentage>"
  | "<ident>"
  | "*";

// ----------------------------------------------
// Canonical normalized registration shape.
// ----------------------------------------------
export type PropertyRegistration = Readonly<{
  // The custom property being registered (e.g. "--angle").
  name: CssCustomPropName;

  // The declared value grammar for the custom property.
  syn: PropertySyntax;

  // Whether the custom property inherits.
  // (default false at the API boundary, but store explicit boolean here.)
  inh: boolean;

  // The initial value for the custom property.
  // Required unless syn === "*" (can still allow it for "*", though).
  init?: string;
}>;

// ----------------------------------------------
// Compact input option 1: object input.
// Allows omitting inh (defaults false) and init when syn === "*".
// ----------------------------------------------
export type PropertyInputObject = Readonly<{
  name: CssCustomPropName;
  syn: PropertySyntax;
  inh?: boolean;
  init?: string;
}>;

// ----------------------------------------------
// Compact input option 2: tuple input (terse for bulk).
//  - ["--angle", "<angle>", "0deg"]          // inh defaults false
//  - ["--angle", "<angle>", "0deg", true]    // explicit inh
//  - ["--blob",  "*"]                         // init optional for "*"
//  - ["--blob",  "*", "anything"]             // still allowed if you want
// ----------------------------------------------
export type PropertyInputTuple =
  | readonly [CssCustomPropName, PropertySyntax]
  | readonly [CssCustomPropName, PropertySyntax, string]
  | readonly [CssCustomPropName, PropertySyntax, string, boolean];

// ----------------------------------------------
// Public input union.
// ----------------------------------------------
export type PropertyInput = PropertyInputObject | PropertyInputTuple;

// ----------------------------------------------
// A small interface for your manager.
// Keep the surface area minimal and “CSS-shaped”.
// ----------------------------------------------
export interface PropertyManager {
  // Register or replace a property registration (idempotent by name).
  register(input: PropertyInput): void;

  // Bulk register (nice for “dozens at the top”).
  registerMany(inputs: readonly PropertyInput[]): void;

  // Remove a registration.
  unregister(name: CssCustomPropName): void;

  // Query helpers.
  has(name: CssCustomPropName): boolean;
  get(name: CssCustomPropName): PropertyRegistration | undefined;

  // Render one or all registrations to CSS text.
  renderOne(name: CssCustomPropName): string;
  renderAll(): string;
}