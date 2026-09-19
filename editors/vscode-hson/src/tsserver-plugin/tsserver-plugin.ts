import type ts from "typescript";
import { filter_verified_schema_assignment_diagnostics, install_live_schema_proof_mask, verified_schema_assignment_ranges } from "../schema-editor-proof.js";

function init(modules: Readonly<{ typescript: typeof ts }>): ts.server.PluginModule {
  return {
    create(info): ts.LanguageService {
      const languageService = info.languageService;
      install_live_schema_proof_mask(modules.typescript, info.languageServiceHost, info.project.getProjectName());
      const proxy: ts.LanguageService = Object.create(languageService);
      proxy.getSemanticDiagnostics = (fileName): ts.Diagnostic[] => {
        const diagnostics = languageService.getSemanticDiagnostics(fileName);
        const program = languageService.getProgram();
        if (program === undefined) return diagnostics;
        return [...filter_verified_schema_assignment_diagnostics(diagnostics, verified_schema_assignment_ranges(modules.typescript, program, fileName))];
      };
      return proxy;
    },
  };
}

export = init;
