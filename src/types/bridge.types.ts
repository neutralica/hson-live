import type { JsonValue } from "../core/types.js";

// PROPOSED FILE GROUP: bridge.types.ts
//
// Move this type/contract block first. It is dependency-light and should be
// imported by the renderer and binding groups after the split.
export type BridgePathParts = readonly string[];
// Bridge result contracts

export type LiveMapBridgeBinding = Readonly<{
  dispose: () => void;
}>;

export type LiveMapBridgeBindingGroup = Readonly<{
  dispose: () => void;
  bindings: readonly LiveMapBridgeBinding[];
}>;
// Schema-control contracts

export type LiveMapSchemaControlKind = "string" | "number" | "boolean" | "enum";

export type LiveMapSchemaControlNode = Readonly<{
  kind?: LiveMapSchemaControlKind;
  label?: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  choices?: readonly string[];
}>;

export type LiveMapSchemaControlSpec = Readonly<Record<string, LiveMapSchemaControlNode>>;
// LiveTree target contracts

export type LiveTextBridgeTarget = Readonly<{
  text: Readonly<{
    get: () => string;
    set: (value: string) => unknown;
    overwrite: (value: string) => unknown;
  }>;
}>;

export type LiveContentBridgeTarget = Readonly<{
  content: Readonly<{
    markup: Readonly<{
      innerHTML: string;
    }>;
  }>;
}>;

export type LiveCreateDivBridgeTarget = Readonly<{
  create: Readonly<{
    div: () => LiveSnapViewBridgeTarget;
  }>;
}>;

export type LiveSnapViewBridgeTarget = LiveContentBridgeTarget &
  LiveCreateDivBridgeTarget &
  LiveTextBridgeTarget &
  LiveAttrBridgeTarget;

export type LiveAttrBridgeTarget = Readonly<{
  attr: Readonly<{
    get: (name: string) => string | undefined;
    set: (name: string, value: string) => unknown;
    drop: (name: string) => unknown;
  }>;
}>;

export type LiveInputListenerResult = Readonly<{
  off: () => void;
  count: number;
  ok: boolean;
}>;

export type LiveInputBridgeTarget = Readonly<{
  form: Readonly<{
    getValue: () => JsonValue | undefined;
    setValue: (value: JsonValue, options?: { silent?: boolean; }) => unknown;
    getChecked?: () => boolean | undefined;
    setChecked?: (value: boolean, options?: { silent?: boolean; }) => unknown;
  }>;
  listen: Readonly<{
    onInput: (listener: () => void) => LiveInputListenerResult;
  }>;
}>;

export type LiveCreateControlBridgeTarget = Readonly<{
  create: Readonly<{
    div: () => LiveControlViewBridgeTarget;
    tag: (tag: string) => LiveControlViewBridgeTarget;
  }>;
}>;

export type LiveControlViewBridgeTarget = LiveContentBridgeTarget &
  LiveCreateControlBridgeTarget &
  LiveTextBridgeTarget &
  LiveAttrBridgeTarget &
  LiveInputBridgeTarget;
