import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const sourceExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const testFile = /(?:\.(?:test|spec)[.-]|(?:^|[-.])test-(?:support|helpers)|^test-|^vitest\.|^jest\.|^(?:bench|benchmark)[-.])/i;
const excludedDirectory = /^(?:__tests__|__fixtures__|fixtures|test|tests|test-utils|test-support|test-helpers|coverage)$/;

/** Every file is accounted for. A production import overrides a test-directory/name exclusion. */
export async function readUsageFiles(root, report) {
  const candidates = new Map();
  async function walk(directory, excluded = false) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules" && report.inputKind === "source") continue;
        await walk(file, excluded || excludedDirectory.test(entry.name) || report.inputKind === "source" && /^(?:dist|build|vendor)$/.test(entry.name));
        continue;
      }
      report.coverage.filesDiscovered++;
      const metadata = entry.name === "package.json" || entry.name === "openclaw.plugin.json";
      if (!entry.isFile() || !metadata && !sourceExtension.test(entry.name)) { report.coverage.filesExcluded++; continue; }
      const text = await readFile(file, "utf8");
      const dependencies = metadata ? [] : ts.preProcessFile(text, true, true).importedFiles.map((dependency) => dependency.fileName);
      const testDependency = dependencies.some((name) => /^(?:vitest|node:test|@jest\/)/.test(name));
      candidates.set(file, { path: file, text, metadata, dependencies, included: !excluded && (metadata || !testFile.test(entry.name) && !testDependency) });
    }
  }
  await walk(root);
  function includeLocal(file) {
    for (const specifier of file.dependencies) {
      if (!specifier.startsWith(".")) continue;
      const base = path.resolve(path.dirname(file.path), specifier);
      const variants = [base, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map((extension) => base.replace(/\.[cm]?jsx?$/, "") + extension), ...[".ts", ".js"].map((extension) => path.join(base, `index${extension}`))];
      const imported = variants.map((variant) => candidates.get(variant)).find(Boolean);
      if (imported && !imported.included) { imported.included = true; includeLocal(imported); }
    }
  }
  for (const file of candidates.values()) if (file.included) includeLocal(file);
  const files = [...candidates.values()].filter((file) => file.included);
  report.coverage.filesAnalyzed += files.length;
  report.coverage.filesExcluded += candidates.size - files.length;
  return files;
}
