import type ts from "typescript";
import { randomUUID } from "node:crypto";
import { create_schema_language_service } from "../schema-language-service.js";
import { register_native_semantic_tokens } from "./native-semantic-tokens.js";
import { isRecord } from "../native-semantic-tokens.js";
import { event_source_imports, type ConfiguredEventSource } from "../event-source-evidence.js";
import { PROJECT_DISCOVERY_COMMAND, TypeScriptProjectScanner, type ActiveTypeScriptProject, type ProjectDiscoveryRequest } from "../typescript-project-discovery.js";

type EventDiscovery = {
  id: string;
  revisions: ReadonlyMap<string, string>;
  lifetimes: ReadonlyMap<string, string>;
  sources: ReadonlyMap<string, ConfiguredEventSource>;
};

type EventConfiguration = {
  discovery?: EventDiscovery;
  sessionId: string;
  revision: number;
  lifetimes: ReadonlyMap<string, string>;
  sources: readonly ConfiguredEventSource[];
  imports: ReturnType<typeof event_source_imports>;
};
const eventConfigurations = new WeakMap<ts.server.Session<unknown>, EventConfiguration>();
const deletedCleanBuffer = Symbol("deleted clean buffer");
const schemaIntegration = Symbol("Hson Schema language service");

type ProjectIntegration = { lifetime: string; changedDiagnosticFiles?: () => ReadonlySet<string> };

function projectIntegration(project: ts.server.Project | undefined): ProjectIntegration | undefined {
  return project === undefined ? undefined : Reflect.get(project, schemaIntegration);
}

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

function readEventSources(input: unknown): ConfiguredEventSource[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const sources: unknown[] = input;
  if (sources.every((source): source is ConfiguredEventSource =>
    isRecord(source) && typeof source.fileName === "string" && typeof source.textHash === "string"
    && Array.isArray(source.owners) && source.owners.length > 0 && source.owners.every(owner => typeof owner === "string")
    && Array.isArray(source.importOffsets) && source.importOffsets.every(Number.isSafeInteger))) return sources;
}

function sameSources(left: ConfiguredEventSource, right: ConfiguredEventSource | undefined): boolean {
  return right !== undefined && left.textHash === right.textHash
    && left.owners.length === right.owners.length && left.owners.every((owner, index) => owner === right.owners[index])
    && left.importOffsets.length === right.importOffsets.length
    && left.importOffsets.every((offset, index) => offset === right.importOffsets[index]);
}

function sameRevisions(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
  return left.size === right.size && [...left].every(([project, revision]) => right.get(project) === revision);
}

function init(modules: Readonly<{ typescript: typeof ts }>): ts.server.PluginModule {
  const caseSensitive = modules.typescript.sys.useCaseSensitiveFileNames;
  const unproven = event_source_imports([], caseSensitive);
  let configure: ((input: unknown) => void) | undefined;
  return {
    create(info): ts.LanguageService {
      register_native_semantic_tokens(modules.typescript, info);
      const session = info.session;
      const projects = info.project.projectService;
      const projectName = info.project.getProjectName();
      const loadedProjects = () => [...projects.configuredProjects.values(), ...projects.inferredProjects, ...projects.externalProjects].filter(project => !project.isClosed());
      const projectRevisions = (loaded: readonly ts.server.Project[]) => loaded.map(project => {
        const lifetime = projectIntegration(project)?.lifetime ?? "";
        return [project.getProjectName(), `${lifetime}:${project.hasRoots() ? project.getProjectVersion() : "pending"}`] as const;
      });
      const projectLifetimes = (loaded: readonly ts.server.Project[]) => new Map(loaded.flatMap(project => {
        const identity = projectIntegration(project);
        return identity === undefined ? [] : [[project.getProjectName(), identity.lifetime] as const];
      }));
      const existing = projectIntegration(info.project);
      const integration: ProjectIntegration = existing ?? { lifetime: randomUUID() };
      let retireEventSources: (() => void) | undefined;
      if (session !== undefined) {
        if (!eventConfigurations.has(session)) {
          const sessionId = randomUUID();
          const state: EventConfiguration = { sessionId, revision: -1, lifetimes: new Map(), sources: [], imports: unproven };
          eventConfigurations.set(session, state);
          const scanner = new TypeScriptProjectScanner(modules.typescript);
          session.addProtocolHandler(PROJECT_DISCOVERY_COMMAND, request => {
            let snapshots: Map<string, string> | undefined;
            const discovery: ProjectDiscoveryRequest | undefined = request.arguments?.revisionOnly === true ? undefined : request.arguments;
            if (discovery !== undefined) {
              snapshots = new Map();
              let changedFile: string | undefined;
              for (const [file, text, dirty] of discovery.openFiles) {
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
                // Let the server rehome an open buffer that lost its configured
                // project membership. Its own editor still needs a ScriptInfo.
                projects.getScriptInfoEnsuringProjectsUptoDate(changedFile);
              }
            }
            const loaded = loadedProjects();
            if (discovery === undefined || snapshots === undefined) return { response: { sessionId, revision: projectRevisions(loaded) }, responseRequired: true };
            const { roots, changedFiles } = discovery;
            // A failed full discovery also supersedes the preceding observation.
            state.discovery = undefined;
            const active = new Map<string, ActiveTypeScriptProject>();
            for (const project of loaded) {
              // Configured projects install plugins before populating their root file maps.
              // Reading a service here would cache an empty Program at the current version.
              if (!project.hasRoots()) {
                active.set(project.getProjectName(), { program: null });
                continue;
              }
              const service: ts.LanguageService & { getHsonSourceMapping?: ActiveTypeScriptProject["mapping"] } = project.getLanguageService();
              const program = service.getProgram();
              active.set(project.getProjectName(), { program: program ?? null, mapping: service.getHsonSourceMapping });
            }
            const scan = scanner.scan(roots, snapshots, changedFiles, active);
            let step = scan.next();
            while (!step.done) step = scan.next();
            const discoveryId = randomUUID();
            const sources = new Map(step.value.sources.flatMap(({ eventEvidence, owners }) =>
              eventEvidence === undefined ? [] : [[eventEvidence.fileName, { ...eventEvidence, owners }] as const]));
            const revision = projectRevisions(loaded);
            state.discovery = { id: discoveryId, revisions: new Map(revision), lifetimes: projectLifetimes(loaded), sources };
            return { response: { sessionId, revision, discoveryId, projects: step.value }, responseRequired: true };
          });
        }
        const state = eventConfigurations.get(session)!;
        const notify = (allOpen: boolean) => {
          const affected = new Set<string>();
          // A full notification can occur inside plugin creation or disposal.
          // tsserver will serve geterr after the project transition completes.
          if (!allOpen) for (const project of loadedProjects()) {
            if (!project.hasRoots()) continue;
            for (const file of projectIntegration(project)?.changedDiagnosticFiles?.() ?? []) affected.add(projects.toPath(file));
          }
          // VS Code already handles this tsserver notification by requesting
          // diagnostics for the open files. Their text may be unchanged.
          const openFiles = [...projects.openFiles.keys()].flatMap(file => {
            const script = projects.getScriptInfoForNormalizedPath(modules.typescript.server.toNormalizedPath(file));
            return script === undefined || !allOpen && !affected.has(file) ? [] : [script.fileName];
          });
          if (openFiles.length > 0) session.event({ openFiles }, "projectsUpdatedInBackground");
        };
        const currentSources = (sources: readonly ConfiguredEventSource[], lifetimes: ReadonlyMap<string, string>) =>
          sources.filter(source => source.owners.every(owner => lifetimes.get(owner) === projectIntegration(projects.findProject(owner))?.lifetime));
        const replaceSources = (sources: readonly ConfiguredEventSource[]) => {
          state.sources = sources;
          state.imports = sources.length === 0 ? unproven : event_source_imports(sources, caseSensitive);
        };
        retireEventSources = () => {
          const retained = currentSources(state.sources, state.lifetimes);
          if (retained.length === state.sources.length) return;
          replaceSources(retained);
          notify(true);
        };
        configure = input => {
          if (projectIntegration(info.project) !== integration || !isRecord(input) || input.sessionId !== state.sessionId
            || typeof input.revision !== "number" || !Number.isSafeInteger(input.revision)
            || input.revision <= state.revision) return;
          let retained: readonly ConfiguredEventSource[];
          let lifetimes = state.lifetimes;
          if ("retainedEventSources" in input) {
            if ("discoveryId" in input || "eventSources" in input) return;
            const sources = readEventSources(input.retainedEventSources);
            if (sources === undefined || new Set(sources.map(source => source.fileName)).size !== sources.length) return;
            // An invalidation may precede a scan or overtake a full snapshot.
            // Retain only the evidence that both sides already agree on.
            const requested = new Map(sources.map(source => [source.fileName, source]));
            retained = state.sources.filter(source => sameSources(source, requested.get(source.fileName)));
          } else {
            const discovery = state.discovery;
            if (discovery === undefined || input.discoveryId !== discovery.id
              || !sameRevisions(discovery.revisions, new Map(projectRevisions(loadedProjects())))) return;
            const sources = readEventSources(input.eventSources);
            if (sources === undefined || new Set(sources.map(source => source.fileName)).size !== sources.length
              || !sources.every(source => sameSources(source, discovery.sources.get(source.fileName)))) return;
            retained = sources;
            lifetimes = discovery.lifetimes;
          }
          const changed = JSON.stringify(state.sources) !== JSON.stringify(retained);
          const rebound = !sameRevisions(lifetimes, state.lifetimes);
          state.revision = input.revision;
          state.lifetimes = lifetimes;
          if (changed) replaceSources(retained);
          notify(changed || rebound && retained.length > 0);
        };
      }
      // In both supported SDKs the Project creates and disposes the underlying
      // service. Reload keeps it, even if a later plugin fronts our proxy.
      if (existing !== undefined) return info.languageService;
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
      }, () => {
        const state = session === undefined ? undefined : eventConfigurations.get(session);
        return projectIntegration(info.project) === integration && state?.lifetimes.get(projectName) === integration.lifetime
          ? state.imports : unproven;
      }, file => {
        const script = projects.getScriptInfo(file);
        return !script?.isScriptOpen() || Reflect.get(script, deletedCleanBuffer) !== true;
      });
      integration.changedDiagnosticFiles = service.changedDiagnosticFiles;
      const dispose = service.dispose;
      Object.defineProperty(info.project, schemaIntegration, { value: integration, configurable: true });
      retireEventSources?.();
      service.dispose = () => {
        if (projectIntegration(info.project) === integration) {
          Reflect.deleteProperty(info.project, schemaIntegration);
          retireEventSources?.();
        }
        dispose();
      };
      return service;
    },
    onConfigurationChanged(input: unknown): void { configure?.(input); },
  };
}

export = init;
