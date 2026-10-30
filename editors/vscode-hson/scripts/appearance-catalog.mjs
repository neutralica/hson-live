import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import textmate from 'vscode-textmate';
import oniguruma from 'vscode-oniguruma';

/** Strict generator-time validation of the owner-facing configuration. Syntax
 * families come from the actual bindings; native UI color IDs remain open keys. */
function fail(path, message) { throw new Error(`${path}: ${message}`); }
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
function suggestion(key, known) {
  const ranked = known.map(name => [name, distance(key.toLowerCase(), name.toLowerCase())]).sort((a, b) => a[1] - b[1]);
  return ranked[0]?.[1] <= Math.min(3, Math.max(2, Math.floor(key.length / 3))) ? ranked[0][0] : undefined;
}
function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    fail(path, 'Expected an object');
}
function properties(value, known, path) {
  object(value, path);
  for (const key of Object.keys(value)) if (!known.includes(key)) {
    const replacement = suggestion(key, known);
    fail(path ? `${path}.${key}` : key, `Unknown property ${JSON.stringify(key)}.${replacement ? ` Did you mean ${JSON.stringify(replacement)}?` : ''}`);
  }
}
function nonempty(value, path) {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'Expected a nonempty string');
}
function unit(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail(path, 'Expected a finite number between 0 and 1');
}
function color(value, path, alpha = false) {
  if (typeof value !== 'string' || !(alpha ? /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i : /^#[\da-f]{6}$/i).test(value))
    fail(path, alpha ? 'Expected a hexadecimal color (#RGB, #RGBA, #RRGGBB or #RRGGBBAA)' : 'Expected an opaque RGB foreground (#RRGGBB)');
}
const fontFlags = ['bold', 'italic', 'underline', 'strikethrough'];
function styleCheck(value, path) {
  properties(value, ['foreground', 'intensity', 'fontStyle', ...fontFlags], path);
  for (const [key, field] of Object.entries(value)) {
    const at = `${path}.${key}`;
    if (key === 'foreground') color(field, at);
    else if (key === 'intensity') unit(field, at);
    else if (key === 'fontStyle') {
      if (typeof field !== 'string' || field.trim().split(/\s+/).filter(Boolean).some(flag => !fontFlags.includes(flag)))
        fail(at, 'Expected a fontStyle string containing only bold, italic, underline or strikethrough (or an empty string)');
    } else if (typeof field !== 'boolean') fail(at, 'Expected a boolean');
  }
}
function validateEntry(entry, path, hson = false) {
  properties(entry, ['label', 'examples', 'inherits', 'house'], path);
  if (hson || Object.hasOwn(entry, 'label')) nonempty(entry.label, `${path}.label`);
  if (hson || Object.hasOwn(entry, 'examples')) {
    if (!Array.isArray(entry.examples) || !entry.examples.length) fail(`${path}.examples`, 'Expected a nonempty array of examples');
    entry.examples.forEach((example, index) => exampleRange(example, `${path}.examples[${index}]`));
  }
  if (Object.hasOwn(entry, 'inherits')) nonempty(entry.inherits, `${path}.inherits`);
  if (Object.hasOwn(entry, 'house')) {
    properties(entry.house, ['dark', 'light'], `${path}.house`);
    for (const [mode, value] of Object.entries(entry.house)) styleCheck(value, `${path}.house.${mode}`);
  }
  if (!Object.hasOwn(entry, 'inherits') && !Object.hasOwn(entry, 'house')) fail(path, 'Expected house styling or an inheritance reference');
}
function syntaxTree(paths) {
  const tree = {};
  for (const path of paths) {
    let branch = tree;
    for (const [index, key] of path.split('.').entries()) {
      branch[key] ??= index === path.split('.').length - 1 ? null : {};
      branch = branch[key];
    }
  }
  return tree;
}
function validateSyntax(value, tree, path, hson) {
  properties(value, Object.keys(tree), path);
  for (const [key, child] of Object.entries(tree)) {
    const at = `${path}.${key}`;
    if (!Object.hasOwn(value, key)) fail(at, 'Missing catalog entry');
    if (child === null) validateEntry(value[key], at, hson);
    else validateSyntax(value[key], child, at, hson);
  }
}
export function validateBranding(branding) {
  properties(branding, ['palette', 'library', 'authoring'], 'branding');
  properties(branding.palette, ['blue', 'yellow', 'pink', 'green'], 'branding.palette');
  for (const key of ['blue', 'yellow', 'pink', 'green']) color(branding.palette[key], `branding.palette.${key}`, true);
  for (const [family, letters] of [['library', ['h', 's', 'o', 'n']], ['authoring', ['H', 's', 'o', 'n']]]) {
    const path = `branding.${family}`, value = branding[family];
    properties(value, family === 'library' ? ['enabled', 'opacity', 'letters', 'separator'] : ['opacity', 'letters'], path);
    unit(value.opacity, `${path}.opacity`);
    properties(value.letters, letters, `${path}.letters`);
    for (const letter of letters) {
      if (typeof value.letters[letter] !== 'string' || !Object.hasOwn(branding.palette, value.letters[letter]))
        fail(`${path}.letters.${letter}`, `Unknown branding palette reference: ${family}.${letter} -> ${value.letters[letter]}`);
    }
    if (family === 'library') {
      if (typeof value.enabled !== 'boolean') fail(`${path}.enabled`, 'Expected a boolean');
      properties(value.separator, ['color'], `${path}.separator`);
      color(value.separator.color, `${path}.separator.color`, true);
    }
  }
}
export function validateCatalog(catalog, bindings, generalRules) {
  properties(catalog, ['syntax', 'ui', 'branding'], '');
  properties(catalog.syntax, ['hson', 'general'], 'syntax');
  validateSyntax(catalog.syntax.hson, syntaxTree(Object.keys(bindings)), 'syntax.hson', true);
  validateSyntax(catalog.syntax.general, syntaxTree(generalRules.map(rule => rule.path.slice('syntax.general.'.length))), 'syntax.general', false);
  properties(catalog.ui, ['palette', 'editor', 'workbench'], 'ui');
  for (const family of ['palette', 'editor', 'workbench']) {
    object(catalog.ui[family], `ui.${family}`);
    for (const [key, entry] of Object.entries(catalog.ui[family])) {
      if (!/^[A-Za-z][\w-]*(?:\.[\w-]+)*$/.test(key)) fail(`ui.${family}.${key}`, 'Expected a native VS Code color ID or palette name');
      validateEntry(entry, `ui.${family}.${key}`);
      // Workbench colors have no font styling target; reject rather than ignore.
      for (const [mode, value] of Object.entries(entry.house ?? {})) for (const property of ['fontStyle', ...fontFlags])
        if (Object.hasOwn(value, property)) fail(`ui.${family}.${key}.house.${mode}.${property}`, `Unsupported UI style property ${JSON.stringify(property)}`);
    }
  }
  validateBranding(catalog.branding);
}

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
export function resolveCatalog(catalog, bindings, generalRules) {
  validateCatalog(catalog, bindings, generalRules);
  const entries = catalogEntries(catalog), resolved = new Map(), visiting = [];
  function resolve(path) {
    if (resolved.has(path)) return resolved.get(path);
    const entry = entries.get(path);
    if (!entry) {
      const replacement = suggestion(path, [...entries.keys()]);
      fail(`${visiting.at(-1)}.inherits`, `Unknown appearance styling reference: ${[...visiting, path].join(' -> ')}.${replacement ? ` Did you mean "${replacement}"?` : ''}`);
    }
    if (visiting.includes(path)) fail(`${visiting.at(-1)}.inherits`, `Appearance inheritance cycle: ${[...visiting, path].join(' -> ')}`);
    visiting.push(path);
    let parent = {};
    if (entry.inherits !== undefined) {
      const target = /^(syntax|ui)\./.test(entry.inherits) ? entry.inherits : `syntax.hson.${entry.inherits}`;
      parent = resolve(target);
    }
    const style = {};
    for (const mode of ['dark', 'light']) {
      style[mode] = { ...parent[mode], ...entry.house?.[mode] };
      if (!Object.hasOwn(style[mode], 'foreground')) fail(`${path}.house.${mode}.foreground`, 'Expected an opaque RGB foreground (#RRGGBB), directly or through inheritance');
      styleCheck(style[mode], `${path}.house.${mode}`);
      if (path.startsWith('ui.')) for (const property of ['fontStyle', ...fontFlags])
        if (Object.hasOwn(style[mode], property)) fail(`${path}.house.${mode}.${property}`, `Unsupported UI style property ${JSON.stringify(property)} inherited from ${entry.inherits}`);
    }
    visiting.pop();
    resolved.set(path, style);
    return style;
  }
  for (const path of entries.keys()) resolve(path);
  return resolved;
}

export function exampleRange(example, path = 'example') {
  properties(example, ['code', 'highlight', 'occurrence'], path);
  if (typeof example.code !== 'string') fail(`${path}.code`, 'Expected a string');
  if (typeof example.highlight !== 'string' || !example.highlight.length) fail(`${path}.highlight`, 'Expected a nonempty string');
  const positions = [];
  for (let at = example.code.indexOf(example.highlight); at !== -1; at = example.code.indexOf(example.highlight, at + 1)) positions.push(at);
  if (!positions.length) throw new Error(`${path}: highlighted text ${JSON.stringify(example.highlight)} does not exist`);
  if (example.occurrence === undefined && positions.length !== 1) throw new Error(`${path}: ambiguous highlight; supply a one-based occurrence`);
  const occurrence = example.occurrence ?? 1;
  if ((Object.hasOwn(example, 'occurrence') && example.occurrence === undefined) || !Number.isInteger(occurrence) || occurrence < 1 || occurrence > positions.length)
    fail(`${path}.occurrence`, `invalid highlight occurrence ${String(example.occurrence)}`);
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
export async function validateExamples(catalog, syntaxBindings, syntaxExamplePath, generalRules) {
  resolveCatalog(catalog, syntaxBindings, generalRules);
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
