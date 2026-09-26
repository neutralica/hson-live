import type ts from "typescript";
import { create_schema_language_service } from "../schema-language-service.js";

function init(modules: Readonly<{ typescript: typeof ts }>): ts.server.PluginModule {
  return {
    create(info): ts.LanguageService {
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
      });
    },
  };
}

export = init;
