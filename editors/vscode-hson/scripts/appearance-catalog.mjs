import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import textmate from 'vscode-textmate';
import oniguruma from 'vscode-oniguruma';

/** Index style entries without inheriting documentation or binding metadata. */
export function catalogEntries(catalog) {
  const entries = new Map();
  function visit(value, path) {
    if (!value || typeof value !== 'object') return;
    if ('house' in value || 'inherits' in value || 'examples' in value) {
      entries.set(path, value);
      return;
    }
    for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
  }
  visit(catalog, '');
  return entries;
}
export function resolveCatalog(catalog) {
  const entries = catalogEntries(catalog), resolved = new Map(), visiting = [];
  function resolve(path) {
    if (resolved.has(path)) return resolved.get(path);
    const entry = entries.get(path);
    if (!entry) throw new Error(`Unknown appearance styling reference: ${[...visiting, path].join(' -> ')}`);
    if (visiting.includes(path)) throw new Error(`Appearance inheritance cycle: ${[...visiting, path].join(' -> ')}`);
    visiting.push(path);
    let parent = {};
    if (entry.inherits !== undefined) {
      if (typeof entry.inherits !== 'string') throw new Error(`${path}: inherits must be a catalog path`);
      const target = /^(syntax|ui)\./.test(entry.inherits) ? entry.inherits : `syntax.hson.${entry.inherits}`;
      parent = resolve(target);
    }
    for (const mode of Object.keys(entry.house ?? {})) {
      if (!['dark', 'light'].includes(mode)) throw new Error(`${path}.house: unknown theme ${mode}`);
    }
    const style = {};
    for (const mode of ['dark', 'light']) {
      style[mode] = { ...parent[mode], ...entry.house?.[mode] };
      for (const property of Object.keys(style[mode])) {
        if (!['foreground', 'intensity'].includes(property)) throw new Error(`${path}.house.${mode}: unknown style property ${property}`);
      }
      if (!/^#[\da-f]{6}$/i.test(style[mode].foreground)) throw new Error(`${path}.house.${mode}: expected an opaque RGB foreground`);
      const intensity = style[mode].intensity ?? 1;
      if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) throw new Error(`${path}.house.${mode}: invalid intensity ${intensity}`);
    }
    visiting.pop();
    resolved.set(path, style);
    return style;
  }
  for (const path of entries.keys()) resolve(path);
  return resolved;
}

export function exampleRange(example, path = 'example') {
  if (typeof example.code !== 'string' || typeof example.highlight !== 'string' || !example.highlight.length)
    throw new Error(`${path}: code and nonempty highlight strings are required`);
  const positions = [];
  for (let at = example.code.indexOf(example.highlight); at !== -1; at = example.code.indexOf(example.highlight, at + 1)) positions.push(at);
  if (!positions.length) throw new Error(`${path}: highlighted text ${JSON.stringify(example.highlight)} does not exist`);
  if (example.occurrence === undefined && positions.length !== 1) throw new Error(`${path}: ambiguous highlight; supply a one-based occurrence`);
  const occurrence = example.occurrence ?? 1;
  if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > positions.length) throw new Error(`${path}: invalid highlight occurrence ${occurrence}`);
  return { start: positions[occurrence - 1], end: positions[occurrence - 1] + example.highlight.length };
}

let grammarPromise;
function exampleGrammar() {
  return grammarPromise ??= (async () => {
    await oniguruma.loadWASM(await readFile(createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm')));
    const registry = new textmate.Registry({
      onigLib: Promise.resolve({ createOnigScanner: patterns => new oniguruma.OnigScanner(patterns), createOnigString: text => new oniguruma.OnigString(text) }),
      loadGrammar: async scope => scope === 'source.hson' ? JSON.parse(await readFile(new URL('../syntaxes/hson.tmLanguage.json', import.meta.url), 'utf8')) : null,
    });
    return { registry, grammar: await registry.loadGrammar('source.hson') };
  })();
}
export async function validateExamples(catalog, syntaxBindings, syntaxExamplePath) {
  const { grammar } = await exampleGrammar();
  const entries = catalogEntries(catalog);
  for (const [path, entry] of entries) {
    if (!path.startsWith('syntax.hson.')) continue;
    const binding = syntaxBindings[path.slice('syntax.hson.'.length)];
    if (!binding) throw new Error(`${path}: no grammar binding for syntax entry`);
    if (!entry.label || !entry.examples?.length) throw new Error(`${path}: label and examples are required`);
    for (const [index, example] of entry.examples.entries()) {
      const context = `${path}.examples[${index}]`;
      const range = exampleRange(example, context);
      let offset = 0, state = textmate.INITIAL, covered = 0;
      for (const line of example.code.split('\n')) {
        const result = grammar.tokenizeLine(line, state);
        state = result.ruleStack;
        for (const token of result.tokens) {
          const start = Math.max(offset + token.startIndex, range.start);
          const end = Math.min(offset + token.endIndex, range.end, offset + line.length);
          if (start >= end) continue;
          if (syntaxExamplePath(token.scopes) !== path.slice('syntax.hson.'.length))
            throw new Error(`${context}: ${JSON.stringify(example.highlight)} does not classify as ${entry.label}; got ${token.scopes.join(' ')}`);
          covered += end - start;
        }
        offset += line.length + 1;
      }
      if (covered !== range.end - range.start) throw new Error(`${context}: highlight must be fully classified syntax`);
    }
  }
  for (const path of Object.keys(syntaxBindings)) if (!entries.has(`syntax.hson.${path}`)) throw new Error(`Missing syntax catalog entry: ${path}`);
}
