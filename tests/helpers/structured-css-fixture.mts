import { generate, parse } from "css-tree/dist/csstree.esm";
import type { CssNode } from "css-tree";
import type { DocumentCssRecord, DocumentCssOrderEntry } from "../../src/types/document-css.types.ts";
import type { LiveMapDocumentLibrary } from "../../src/types/livemap.types.ts";
import { commit_document_css_internal } from "../../src/api/livemap/livemap.libraries.ts";

/** Static notation for internal structured-record fixtures. Never a raw authoring ingress. */
export function structured_css_fixture(source: string, existing: readonly string[] = []): DocumentCssRecord {
  const rules: DocumentCssRecord["rules"][number][] = [];
  const properties: DocumentCssRecord["properties"][number][] = [];
  const keyframes: DocumentCssRecord["keyframes"][number][] = [];
  let next = 0;
  const visit = (node: CssNode, scopes: readonly string[] = []): DocumentCssOrderEntry[] => {
    if (node.type === "StyleSheet") return node.children.toArray().flatMap(child => visit(child, scopes));
    if (node.type === "Rule") {
      let ruleKey: string;
      do { ruleKey = `stylesheet:${++next}`; } while (existing.includes(ruleKey));
      const declarations: [string, string][] = node.block.children.toArray().map(child => {
        if (child.type !== "Declaration") throw Error("Structured fixtures require flat declaration rules.");
        return [child.property, generate(child.value) + (child.important ? " !important" : "")];
      });
      if (!declarations.length) return [];
      rules.push({ ruleKey, selector: generate(node.prelude), scopes, declarations });
      return [{ kind: "rule", ruleKey, scopes }];
    }
    if (node.type === "Atrule" && node.block && node.name === "property") {
      const declarations = Object.fromEntries(node.block.children.toArray().map(child => {
        if(child.type !== "Declaration") throw Error("Expected property descriptor.");
        return [child.property, generate(child.value)];
      }));
      const name = generate(node.prelude!);
      properties.push({ name: name as `--${string}`, syn: JSON.parse(declarations.syntax!) as "*", inh: declarations.inherits === "true",
        ...(declarations["initial-value"] === undefined ? {} : {init:declarations["initial-value"]}) });
      return [{kind:"property",name}];
    }
    if (node.type === "Atrule" && node.block && node.name === "keyframes") {
      const name = generate(node.prelude!);
      const steps = node.block.children.toArray().map(child => {
        if (child.type !== "Rule") throw Error("Expected keyframe rule.");
        const declarations = child.block.children.toArray().map(declaration => {
          if(declaration.type !== "Declaration") throw Error("Expected keyframe declaration.");
          return [declaration.property,generate(declaration.value)] as const;
        });
        return {at:generate(child.prelude) as "from",declarations};
      });
      keyframes.push({name,steps});return [{kind:"keyframes",name}];
    }
    if (node.type === "Atrule" && node.block) {
      const header = `@${node.name}${node.prelude ? ` ${generate(node.prelude)}` : ""}`;
      return [{ kind: "group", header, entries: node.block.children.toArray().flatMap(child => visit(child, [...scopes, header])) }];
    }
    throw Error("Unsupported static structured fixture.");
  };
  const order = visit(parse(source, { context: "stylesheet" }));
  return { rules, properties, keyframes, order };
}

/** Exercise governed structured replacement without going through textual authoring. */
export function replace_structured_fixture(document: object, source: string): void {
  commit_document_css_internal(document, { domain: "css", kind: "replace", stylesheet: structured_css_fixture(source) });
}
