import type ts from "typescript";
import { create_schema_language_service } from "../schema-language-service.js";
import { register_native_semantic_tokens } from "./native-semantic-tokens.js";
import { isRecord } from "../native-semantic-tokens.js";
import { PROJECT_DISCOVERY_COMMAND, TypeScriptProjectScanner, type ProjectDiscoveryRequest } from "../typescript-project-discovery.js";

const discoverySessions = new WeakSet<ts.server.Session<unknown>>();
const deletedCleanBuffer = Symbol("deleted clean buffer");
const schemaIntegration = Symbol("Hson Schema language service");

function invalidateProjectResolution(project: ts.server.Project): void {
  // Use the same compiler invalidation that tsserver applies when options
  // affect resolution. Open scripts bypass its normal disk notifications.
  const cache: unknown = Reflect.get(project, "resolutionCache");
  const markDirty: unknown = Reflect.get(project, "markAsDirty");
  if (isRecord(cache) && typeof cache.onChangesAffectModuleResolution === "function" && typeof markDirty === "function") {
    cache.onChangesAffectModuleResolution();
    markDirty.call(project);
  }
}

function init(modules: Readonly<{ typescript: typeof ts }>): ts.server.PluginModule {
  return {
    create(info): ts.LanguageService {
      register_native_semantic_tokens(modules.typescript, info);
      const session = info.session;
      const projects = info.project.projectService;
      const projectName = info.project.getProjectName();
      const loadedProjects = () => [...projects.configuredProjects.values(), ...projects.inferredProjects, ...projects.externalProjects].filter(project => !project.isClosed());
      if (session !== undefined && !discoverySessions.has(session)) {
        const scanner = new TypeScriptProjectScanner(modules.typescript);
        session.addProtocolHandler(PROJECT_DISCOVERY_COMMAND, request => {
          const { roots, openFiles, changedFiles }: ProjectDiscoveryRequest = request.arguments;
          const snapshots = new Map<string, string>();
          let changedFile: string | undefined;
          for (const [file, text, dirty] of openFiles) {
            const script = projects.getScriptInfo(file);
            const missing = !dirty && !projects.host.fileExists(file);
            if (script?.isScriptOpen() && (Reflect.get(script, deletedCleanBuffer) === true) !== missing) {
              Reflect.set(script, deletedCleanBuffer, missing);
              changedFile = file;
            }
            if (!missing) snapshots.set(file, text);
          }
          if (changedFile !== undefined) {
            for (const project of loadedProjects()) invalidateProjectResolution(project);
            // Rehome a clean open buffer that lost its configured project membership.
            projects.getScriptInfoEnsuringProjectsUptoDate(changedFile);
          }
          const active = new Map(loadedProjects().map(project => [project.getProjectName(),
            project.hasRoots() ? project.getLanguageService().getProgram() ?? null : null] as const));
          const scan = scanner.scan(roots, snapshots, changedFiles, active);
          let step = scan.next();
          while (!step.done) step = scan.next();
          return { response: step.value, responseRequired: true };
        });
        discoverySessions.add(session);
      }
      // In both supported SDKs the Project creates and disposes the underlying
      // service. Reload keeps it, even if a later plugin fronts our proxy.
      if (Reflect.has(info.project, schemaIntegration)) return info.languageService;
      const service = create_schema_language_service(modules.typescript, info.languageService, info.languageServiceHost, projectName, (file, text) => {
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
      }, file => {
        const script = projects.getScriptInfo(file);
        return !script?.isScriptOpen() || Reflect.get(script, deletedCleanBuffer) !== true;
      });
      if (session !== undefined) {
        const diagnostics = service.getSemanticDiagnostics;
        service.getSemanticDiagnostics = file => {
          const result = diagnostics(file);
          const openFiles = [...service.changedDiagnosticFiles()].filter(candidate => {
            if (projects.toPath(candidate) === projects.toPath(file)) return false;
            const path = modules.typescript.server.toNormalizedPath(candidate);
            return projects.getScriptInfoForNormalizedPath(path)?.isScriptOpen() === true
              && projects.getDefaultProjectForFile(path, false) === info.project;
          });
          if (openFiles.length) session.event({ openFiles }, "projectsUpdatedInBackground");
          return result;
        };
      }
      const dispose = service.dispose;
      Object.defineProperty(info.project, schemaIntegration, { value: service, configurable: true });
      service.dispose = () => {
        if (Reflect.get(info.project, schemaIntegration) === service) Reflect.deleteProperty(info.project, schemaIntegration);
        dispose();
      };
      return service;
    },
  };
}

export = init;
