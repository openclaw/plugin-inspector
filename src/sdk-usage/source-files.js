import { readdir } from "node:fs/promises";
import path from "node:path";
import ts from "../typescript.cjs";
import { readText } from "../read-text.js";

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
      // Excluded files matter only if an analyzed file imports them; read and
      // scan those on demand instead of holding every bundle's text.
      if (excluded) {
        candidates.set(file, { path: file, text: undefined, metadata, dependencies: undefined, included: false });
        continue;
      }
      const { text, dependencies } = await readCandidate(file, metadata);
      const testDependency = dependencies.some((name) => /^(?:vitest|node:test|@jest\/)/.test(name));
      candidates.set(file, { path: file, text, metadata, dependencies, included: metadata || !testFile.test(entry.name) && !testDependency });
    }
  }
  await walk(root);
  const pending = [...candidates.values()].filter((file) => file.included);
  while (pending.length) {
    const file = pending.pop();
    for (const specifier of file.dependencies) {
      if (!specifier.startsWith(".")) continue;
      const base = path.resolve(path.dirname(file.path), specifier);
      const variants = [base, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map((extension) => base.replace(/\.[cm]?jsx?$/, "") + extension), ...[".ts", ".js"].map((extension) => path.join(base, `index${extension}`))];
      const imported = variants.map((variant) => candidates.get(variant)).find(Boolean);
      if (imported && !imported.included) {
        imported.included = true;
        if (imported.text === undefined) Object.assign(imported, await readCandidate(imported.path, imported.metadata));
        pending.push(imported);
      }
    }
  }
  const files = [...candidates.values()].filter((file) => file.included);
  report.coverage.filesAnalyzed += files.length;
  report.coverage.filesExcluded += candidates.size - files.length;
  return files;
}

async function readCandidate(file, metadata) {
  const text = await readText(file);
  const dependencies = metadata ? [] : ts.preProcessFile(text, true, true).importedFiles.map((dependency) => dependency.fileName);
  return { text, dependencies };
}
