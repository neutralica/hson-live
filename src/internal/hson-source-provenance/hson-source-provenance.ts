import type { HsonNode } from "../../core/types.js";
import type { RawAttr, Tokens, TokenClose, TokenOpen } from "../../api/transform/token.types.js";

export type HsonSourceRange = Readonly<{ start: number; end: number }>;
export type HsonSourcePath = readonly number[];
export type HsonNodeSourceRole = "coverage" | "name" | "value" | "open" | "close";
export type HsonAttributeSourceRole = "coverage" | "name" | "value";

export type HsonSourceLocation =
  | Readonly<{ kind: "node"; path: HsonSourcePath; role: HsonNodeSourceRole }>
  | Readonly<{
      kind: "attribute";
      owner: HsonSourcePath;
      name: string;
      role: HsonAttributeSourceRole;
    }>;

export interface HsonSourceProvenance {
  readonly sourceRange: HsonSourceRange;
  range(location: HsonSourceLocation): HsonSourceRange | undefined;
}

export type ParsedHsonWithProvenance = Readonly<{
  value: HsonNode;
  provenance: HsonSourceProvenance;
}>;

type NodeRoles = Partial<Record<HsonNodeSourceRole, HsonSourceRange>>;
type AttributeRoles = Partial<Record<HsonAttributeSourceRole, HsonSourceRange>>;

export type HsonTokenSourceEvidence = Readonly<{
  roles: NodeRoles;
  coverageStart?: number;
  coverageEnd?: number;
}>;

export interface HsonSourceLexicalCollector {
  recordToken(token: Tokens, evidence: HsonTokenSourceEvidence): void;
  recordAttribute(attr: RawAttr, roles: AttributeRoles): void;
}

type Draft = {
  roles: NodeRoles;
  attributes?: Map<string, AttributeRoles>;
  scalar?: HsonSourceRange;
};

type TrieNode = {
  children?: Map<number, TrieNode>;
  roles?: Readonly<NodeRoles>;
  attributes?: ReadonlyMap<string, Readonly<AttributeRoles>>;
};

function frozenRange(range: HsonSourceRange): HsonSourceRange {
  return Object.freeze({ start: range.start, end: range.end });
}

function span(ranges: readonly (HsonSourceRange | undefined)[]): HsonSourceRange | undefined {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const range of ranges) {
    if (range === undefined) continue;
    start = Math.min(start, range.start);
    end = Math.max(end, range.end);
  }
  return Number.isFinite(start) ? { start, end } : undefined;
}

function freezeRoles<TRole extends string>(
  roles: Partial<Record<TRole, HsonSourceRange>>,
): Readonly<Partial<Record<TRole, HsonSourceRange>>> {
  const out: Partial<Record<TRole, HsonSourceRange>> = {};
  for (const role of Object.keys(roles) as TRole[]) {
    const range = roles[role];
    if (range !== undefined) out[role] = frozenRange(range);
  }
  return Object.freeze(out);
}

export class HsonSourceProvenanceBuilder implements HsonSourceLexicalCollector {
  private readonly tokenEvidence = new WeakMap<Tokens, HsonTokenSourceEvidence>();
  private readonly attributeEvidence = new WeakMap<RawAttr, AttributeRoles>();
  private readonly drafts = new WeakMap<HsonNode, Draft>();

  public recordToken(token: Tokens, evidence: HsonTokenSourceEvidence): void {
    this.tokenEvidence.set(token, evidence);
  }

  public recordAttribute(attr: RawAttr, roles: AttributeRoles): void {
    this.attributeEvidence.set(attr, roles);
  }

  public bindScalar(node: HsonNode, token: Tokens): void {
    const evidence = this.tokenEvidence.get(token);
    const value = evidence?.roles.value ?? evidence?.roles.coverage;
    this.drafts.set(node, {
      roles: value === undefined ? {} : { coverage: value },
      scalar: value,
    });
  }

  public bindEmptyObject(node: HsonNode, token: Tokens): void {
    const evidence = this.tokenEvidence.get(token);
    this.drafts.set(node, { roles: { ...(evidence?.roles ?? {}) } });
  }

  public bindTagStart(node: HsonNode, token: TokenOpen): void {
    const evidence = this.tokenEvidence.get(token);
    const attributes = new Map<string, AttributeRoles>();
    for (const attr of token.rawAttrs) {
      const roles = this.attributeEvidence.get(attr);
      if (roles !== undefined) attributes.set(attr.name, roles);
    }
    this.drafts.set(node, {
      roles: { ...(evidence?.roles ?? {}) },
      ...(attributes.size === 0 ? {} : { attributes }),
    });
  }

  public bindTagEnd(node: HsonNode, open: TokenOpen, close: TokenClose): void {
    const draft = this.drafts.get(node) ?? { roles: {} };
    const openEvidence = this.tokenEvidence.get(open);
    const closeEvidence = this.tokenEvidence.get(close);
    Object.assign(draft.roles, closeEvidence?.roles);
    const start = openEvidence?.coverageStart;
    const end = closeEvidence?.coverageEnd;
    if (start !== undefined && end !== undefined) draft.roles.coverage = { start, end };
    this.drafts.set(node, draft);
  }

  public bindArray(node: HsonNode, open: Tokens, close: Tokens): void {
    const openEvidence = this.tokenEvidence.get(open);
    const closeEvidence = this.tokenEvidence.get(close);
    const roles: NodeRoles = {
      ...(openEvidence?.roles ?? {}),
      ...(closeEvidence?.roles ?? {}),
    };
    if (openEvidence?.coverageStart !== undefined && closeEvidence?.coverageEnd !== undefined) {
      roles.coverage = { start: openEvidence.coverageStart, end: closeEvidence.coverageEnd };
    }
    this.drafts.set(node, { roles });
  }

  public bindSynthetic(node: HsonNode, children: readonly HsonNode[]): void {
    const coverage = span(children.map((child) => this.drafts.get(child)?.roles.coverage));
    this.drafts.set(node, { roles: coverage === undefined ? {} : { coverage } });
  }

  public bindArrayItem(node: HsonNode, child: HsonNode): void {
    const coverage = this.drafts.get(child)?.roles.coverage;
    this.drafts.set(node, { roles: coverage === undefined ? {} : { coverage } });
  }

  public finalize(value: HsonNode, sourceLength: number): HsonSourceProvenance {
    const root: TrieNode = {};

    const trieAt = (path: readonly number[]): TrieNode => {
      let current = root;
      for (const index of path) {
        current.children ??= new Map();
        let child = current.children.get(index);
        if (child === undefined) {
          child = {};
          current.children.set(index, child);
        }
        current = child;
      }
      return current;
    };

    const visit = (node: HsonNode, path: readonly number[]): void => {
      const draft = this.drafts.get(node);
      if (draft !== undefined) {
        const target = trieAt(path);
        target.roles = freezeRoles(draft.roles);
        if (draft.attributes !== undefined) {
          const attrs = new Map<string, Readonly<AttributeRoles>>();
          for (const [name, roles] of draft.attributes) attrs.set(name, freezeRoles(roles));
          target.attributes = attrs;
        }
        if (draft.scalar !== undefined && node.$_content.length === 1) {
          const scalar = trieAt([...path, 0]);
          scalar.roles = freezeRoles({ coverage: draft.scalar, value: draft.scalar });
        }
      }
      for (let index = 0; index < node.$_content.length; index += 1) {
        const child = node.$_content[index];
        if (typeof child === "object" && child !== null && "$_tag" in child) {
          visit(child, [...path, index]);
        }
      }
    };
    visit(value, []);

    const sourceRange = frozenRange({ start: 0, end: sourceLength });
    return Object.freeze({
      sourceRange,
      range(location: HsonSourceLocation): HsonSourceRange | undefined {
        const path = location.kind === "node" ? location.path : location.owner;
        let current: TrieNode | undefined = root;
        for (const index of path) {
          if (current === undefined) return undefined;
          current = current.children?.get(index);
        }
        if (current === undefined) return undefined;
        return location.kind === "node"
          ? current.roles?.[location.role]
          : current.attributes?.get(location.name)?.[location.role];
      },
    });
  }
}
