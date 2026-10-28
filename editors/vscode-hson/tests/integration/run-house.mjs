import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { resolveCliArgsFromVSCodeExecutablePath } from "@vscode/test-electron";
import { validateVsix, compareInstalledPayload } from "../../scripts/vscode-local-lib.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const executable = process.env.HSON_VSCODE_EXECUTABLE ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
const testRoot = await realpath(await mkdtemp('/tmp/hson-house-'));
const workspace = join(testRoot, 'workspace');
const body = `<section @:deck hson:part slide:data="%{slide}"
  class="deck" title="Readable quoted content"
  <h1 part:optional "^{slide.title}"/>
  <p "%{slide.description}"/>
  <div for:row="^{slide.rows}" per:item="%{items}"
    <hson-part lib="parts" at="card"
      data:slide="%{slide}" doc:body="^{body}"/>
  />
  <svg viewBox="0 0 24 24" <path d="M2 10h4"/>/>
  \${deck.render(slide)}
/>`;
const source = `import { Hson } from "hson-live/hson";
interface Slide { title: string; description: string; }
class Deck {
  readonly title = "Native TypeScript";
  render(slide: Slide): string { return slide.title; }
}
const deck = new Deck();
const slide: Slide = { title: "House", description: "Calm colors" };

// Document: authored roles and native interpolation
const document = Hson.document\`
${body}\`;

// Schema: names, strings, primitives and structure
const schema = Hson.schema\`<type "document" tag "section"
  content <sequence «<tag "h1">, <tag "p">»>
>\`;
const data = Hson.data\`<count 42 enabled true empty null>\`;
const result = deck.render(slide);
`;
const run = (args, env = process.env, command = executable) => new Promise((accept, reject) => {
  const child = spawn(command, args, { env, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`VS Code House test exited ${code} (${signal})`)));
});
try {
  await mkdir(join(workspace, '.vscode'), { recursive: true });
  await mkdir(join(testRoot, 'extensions'));
  await writeFile(join(workspace, '.vscode/settings.json'), JSON.stringify({
    'editor.formatOnSave': false, 'hson.formatting.formatOnSave': false,
    'editor.fontSize': 14, 'editor.minimap.enabled': false, 'editor.renderValidationDecorations': 'off',
    'editor.semanticHighlighting.enabled': true, 'workbench.startupEditor': 'none',
    'window.title': 'Hson House verification — ${activeEditorShort}', 'workbench.activityBar.location': 'hidden',
  }));
  await writeFile(join(workspace, 'hson-authoring.d.ts'), 'declare module "hson-live/hson" { export const Hson: { document(strings: TemplateStringsArray, ...values: unknown[]): string; schema(strings: TemplateStringsArray, ...values: unknown[]): unknown; data(strings: TemplateStringsArray, ...values: unknown[]): unknown; }; }');
  for (const ext of ['ts', 'tsx']) await writeFile(join(workspace, 'house.' + ext), source);
  await writeFile(join(workspace, 'house.hson'), '// Same document in standalone Hson\n' + body.replace('${deck.render(slide)}', '<p "Native expression stays in TypeScript"/>') + '\n\n// Primitives and quotes\n<count 42 enabled true empty null>\n');
  await writeFile(join(workspace, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', jsx: 'preserve', strict: true }, include: ['*.ts', '*.tsx'] }));
  const profile = ['--user-data-dir=' + join(testRoot, 'user'), '--extensions-dir=' + join(testRoot, 'extensions')];
  let developmentPath = root;
  if (process.env.HSON_HOUSE_VSIX) {
    const vsix = resolve(root, process.env.HSON_HOUSE_VSIX);
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    await validateVsix(vsix, manifest);
    const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(executable);
    await run([...cliArgs, ...profile, '--install-extension', vsix, '--force'], process.env, cli);
    developmentPath = join(testRoot, 'driver');
    await mkdir(developmentPath);
    await writeFile(join(developmentPath, 'package.json'), JSON.stringify({ name: 'hson-house-test-driver', publisher: 'hson-tests', version: '0.0.0', engines: { vscode: '^1.95.0' } }));
    const { readdir } = await import('node:fs/promises');
    const installed = (await readdir(join(testRoot, 'extensions'))).find(name => name.startsWith('terminal-gothic.hson-language-'));
    if (!installed) throw new Error('Isolated installed Hson extension missing');
    const comparison = await compareInstalledPayload(join(testRoot, 'extensions', installed), vsix, manifest);
    if (!comparison.match) throw new Error('Installed payload differs: ' + JSON.stringify(comparison));
  }
  console.log('HOUSE_WORKSPACE=' + workspace);
  await run([workspace, '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-workspace-trust', ...profile,
    '--extensionDevelopmentPath=' + developmentPath, '--extensionTestsPath=' + join(root, '.test-dist/house-integration.cjs')],
    { ...process.env, HSON_HOUSE_WORKSPACE: workspace });
  console.log(await readFile(join(workspace, 'house-report.json'), 'utf8'));
} finally {
  if (process.env.HSON_HOUSE_KEEP !== '1') await rm(testRoot, { recursive: true, force: true });
}
