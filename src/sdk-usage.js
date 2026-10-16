import path from "node:path";
import ts from "typescript";
import { collectSdkImports } from "./sdk-usage/imports.js";
import { collectManifestContracts } from "./sdk-usage/manifest.js";
import { createUsageReport } from "./sdk-usage/model.js";
import { readUsageFiles } from "./sdk-usage/source-files.js";
import { createUsageProgram } from "./sdk-usage/program.js";
import { createProvenance } from "./sdk-usage/provenance.js";
import { collectSdkMembers } from "./sdk-usage/members.js";
import { pluginEntrypointSources } from "./sdk-usage/entrypoints.js";

/** Offline static inventory. Neither plugin modules nor target modules are imported. */
export async function inspectSdkUsage({ root, inputKind = "source", targetRoot, compatDeprecations }) {
  const report = createUsageReport({ root, inputKind, compatDeprecations });
  const files = await readUsageFiles(root, report);
  const context = createUsageProgram(files, targetRoot);
  const { sources, checker } = context;
  const provenance = createProvenance({ ...context, entrypoints: pluginEntrypointSources({ root, files, sources, inputKind, report }) });
  for (const source of sources) {
    for (const diagnostic of source.parseDiagnostics) {
      report.unknown(source, `Source syntax could not be parsed: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
    }
  }
  collectSdkImports({ sources, checker, report, provenance });
  collectSdkMembers({ sources, checker, report, provenance });
  for (const file of files) if (path.basename(file.path) === "openclaw.plugin.json") collectManifestContracts(file, report);
  return report.finish();
}
