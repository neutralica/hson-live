import type ts from "typescript";
import { randomUUID } from "node:crypto";
import { create_schema_language_service } from "../schema-language-service.js";
import { register_native_semantic_tokens } from "./native-semantic-tokens.js";
import { isRecord } from "../native-semantic-tokens.js";
import { event_source_imports, type EventSourceEvidence } from "../event-source-evidence.js";
import { PROJECT_DISCOVERY_COMMAND, TypeScriptProjectScanner, type ActiveTypeScriptProject, type ProjectDiscoveryRequest } from "../typescript-project-discovery.js";

type EventConfiguration = { sessionId: string; input?: unknown; imports: ReturnType<typeof event_source_imports> };
const eventConfigurations = new WeakMap<ts.server.Session<unknown>, EventConfiguration>();

function readEventConfiguration(input: unknown): EventSourceEvidence[] | undefined {
  if (!isRecord(input) || !Array.isArray(input.eventSources)) return undefined;
  return input.eventSources.filter((source: unknown): source is EventSourceEvidence =>
    isRecord(source) && typeof source.fileName === "string" && typeof source.textHash === "string"
    && Array.isArray(source.importOffsets) && source.importOffsets.every(Number.isSafeInteger));
}

function init(modules: Readonly<{ typescript: typeof ts }>): ts.server.PluginModule {
  const unproven = event_source_imports([], modules.typescript.sys.useCaseSensitiveFileNames);
  let configure: ((input: unknown) => void) | undefined;
  return {
    create(info): ts.LanguageService {
      register_native_semantic_tokens(modules.typescript, info);
      const session = info.session;
      if (session !== undefined) {
        if (!eventConfigurations.has(session)) {
          const sessionId = randomUUID();
          eventConfigurations.set(session, { sessionId, imports: unproven });
          const scanner = new TypeScriptProjectScanner(modules.typescript);
          session.addProtocolHandler(PROJECT_DISCOVERY_COMMAND, request => {
            const projects = info.project.projectService;
            const loaded = [...projects.configuredProjects.values(), ...projects.inferredProjects, ...projects.externalProjects];
            const revision = () => JSON.stringify(loaded.map(project => [project.getProjectName(), project.getProjectVersion()]));
            if (request.arguments?.revisionOnly === true) return { response: { sessionId, revision: revision() }, responseRequired: true };
            const { roots, openFiles, changedFiles }: ProjectDiscoveryRequest = request.arguments;
            const active = new Map<string, ActiveTypeScriptProject>();
            for (const project of loaded) {
              const service: ts.LanguageService & { getHsonSourceMapping?: ActiveTypeScriptProject["mapping"] } = project.getLanguageService();
              const program = service.getProgram();
              if (!program) return { response: {}, responseRequired: true };
              active.set(project.getProjectName(), { program, mapping: service.getHsonSourceMapping });
            }
            const scan = scanner.scan(roots, new Map(openFiles), changedFiles, active);
            let step = scan.next();
            while (!step.done) step = scan.next();
            return { response: { sessionId, revision: revision(), projects: step.value }, responseRequired: true };
          });
        }
        configure = input => {
          const state = eventConfigurations.get(session)!;
          if (state.input === input || !isRecord(input)) return;
          const sources = readEventConfiguration(input);
          if (sources === undefined || sources.length && input.sessionId !== state.sessionId) return;
          state.input = input;
          state.imports = event_source_imports(sources, modules.typescript.sys.useCaseSensitiveFileNames);
          // VS Code already handles this tsserver notification by requesting
          // diagnostics for the open files. Their text may be unchanged.
          const projectService = info.project.projectService;
          const openFiles = [...projectService.openFiles.keys()].flatMap(file => {
            const script = projectService.getScriptInfoForNormalizedPath(modules.typescript.server.toNormalizedPath(file));
            return script === undefined ? [] : [script.fileName];
          });
          if (openFiles.length > 0) session.event({ openFiles }, "projectsUpdatedInBackground");
        };
      }
      return create_schema_language_service(modules.typescript, info.languageService, info.languageServiceHost, info.project.getProjectName(), (file, text) => {
        const path = modules.typescript.server.toNormalizedPath(file);
        if (text === undefined) {
          info.project.projectService.getScriptInfoForNormalizedPath(path)?.detachFromProject(info.project);
          return;
        }
        const script = info.project.projectService.getOrCreateScriptInfoForNormalizedPath(path, false, undefined, modules.typescript.ScriptKind.TS, true, { fileExists: () => true });
        if (script === undefined) throw new Error(`Cannot register virtual Hson Schema evidence: ${file}`);
        const previous = script.getSnapshot();
        if (previous.getText(0, previous.getLength()) !== text) script.editContent(0, previous.getLength(), text);
        script.attachToProject(info.project);
      }, () => session === undefined ? unproven : eventConfigurations.get(session)?.imports ?? unproven);
    },
    onConfigurationChanged(input: unknown): void { configure?.(input); },
  };
}

export = init;
