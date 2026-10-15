import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (actual, expected, label) => assert.deepEqual(actual, expected, `Benchmark freeze mismatch: ${label}`);

export async function loadFrozenBenchmark({ benchmarkDir, sourceRoot }) {
  let freezeBytes;
  try {
    freezeBytes = await readFile(path.join(benchmarkDir, "freeze.json"));
  } catch (error) {
    throw new Error("Benchmark freeze.json is required before generating candidate reports", { cause: error });
  }
  const freeze = JSON.parse(freezeBytes);
  assert(freeze.schemaVersion === 1 && freeze.status === "frozen" && freeze.population?.count === 69 && freeze.population.distribution === "core" && freeze.fixtures?.length === 69,
    "All 69 independent plugin audits must be frozen before candidate generation");
  async function frozenFile(file, hash) {
    assert(path.basename(file) === file, "Freeze file paths must be benchmark-relative filenames");
    const bytes = await readFile(path.join(benchmarkDir, file));
    same(sha256(bytes), hash, file);
    return bytes;
  }
  const contract = JSON.parse(await frozenFile("contract.json", freeze.contractSha256));
  await frozenFile("README.md", freeze.readmeSha256);
  const roster = JSON.parse(await frozenFile("roster.json", freeze.rosterSha256));
  const progress = JSON.parse(await frozenFile("audit-progress.json", freeze.progressSha256));
  for (const document of [contract, roster, progress]) same(document.source, freeze.source, "source identity");
  same(contract.population, freeze.population, "population");
  assert(progress.status === "frozen", "Audit ledger is not frozen");
  same(roster.plugins.length, 69, "roster size");
  same(progress.plugins.length, 69, "ledger size");
  const git = async (...args) => (await execute("git", args, { cwd: sourceRoot, maxBuffer: 32 * 1024 * 1024 })).stdout.trim();
  same(await git("rev-parse", "HEAD"), freeze.source.commit, "source HEAD");
  same(await git("rev-parse", `${freeze.source.commit}^{tree}`), freeze.source.tree, "source tree");
  const changed = (await git("diff", "--name-only", freeze.source.commit, "--")).split("\n").filter(Boolean);
  assert(changed.every((file) => file.endsWith(".md")), `Source checkout has tracked changes: ${changed.join(", ")}`);
  const { stdout } = await execute(process.execPath, ["scripts/generate-plugin-inventory-doc.mts", "--json", "--commit", freeze.source.commit], { cwd: sourceRoot, maxBuffer: 32 * 1024 * 1024 });
  const inventory = JSON.parse(stdout);
  same(inventory.sha256, freeze.source.inventorySha256, "canonical inventory digest");
  same(inventory.plugins.filter((plugin) => plugin.distribution === "core"), roster.plugins, "canonical core roster");
  const pluginIds = new Set();
  const auditors = new Set();
  const fixtures = [];
  for (const record of freeze.fixtures) {
    assert(!pluginIds.has(record.pluginId), `Duplicate frozen plugin ${record.pluginId}`);
    pluginIds.add(record.pluginId);
    const plugin = roster.plugins.find((item) => item.id === record.pluginId);
    assert(plugin, `Frozen plugin ${record.pluginId} missing from roster`);
    const ledger = progress.plugins.find((item) => item.id === plugin.id);
    assert(ledger?.status === "validated" && ledger.issues.length === 0, `Plugin ${plugin.id} is not validated`);
    same(ledger.path, plugin.path, `${plugin.id} ledger source path`);
    same(ledger.fixture, record.path, `${plugin.id} fixture filename`);
    const fixture = JSON.parse(await frozenFile(record.path, record.sha256));
    same(fixture.schemaVersion, 1, `${plugin.id} schema`);
    same(fixture.source, freeze.source, `${plugin.id} source`);
    same(fixture.plugin, { id: plugin.id, path: plugin.path }, `${plugin.id} plugin identity`);
    assert(fixture.auditor?.independent === true && typeof fixture.auditor.agentId === "string" && fixture.auditor.agentId.length > 0, `Plugin ${plugin.id} needs an independent auditor`);
    same(fixture.auditor.agentId, record.agentId, `${plugin.id} auditor`);
    same(ledger.agentId, record.agentId, `${plugin.id} ledger auditor`);
    assert(!auditors.has(record.agentId), `Auditor reused across plugins: ${record.agentId}`);
    auditors.add(record.agentId);
    same(record.counts, {
      findings: fixture.findings.length, reviewedFiles: fixture.reviewedFiles.length,
      excludedFiles: fixture.excludedFiles.length, unknowns: fixture.unknowns.length,
    }, `${plugin.id} counts`);
    same(ledger.counts, record.counts, `${plugin.id} ledger counts`);
    assert(fixture.findings.length > 0 || fixture.auditedEmpty === true, `Plugin ${plugin.id} lacks an explicit empty audit`);
    const keys = new Set();
    for (const finding of fixture.findings) {
      assert(finding.key === `${finding.kind}:${finding.identity}` && !keys.has(finding.key), `Invalid or duplicate expectation: ${finding.key}`);
      keys.add(finding.key);
    }
    const files = [...fixture.reviewedFiles, ...fixture.excludedFiles].map((file) => file.path);
    same(new Set(files).size, files.length, `${plugin.id} unique file partition`);
    const tracked = (await git("ls-tree", "-r", "--name-only", freeze.source.commit, "--", plugin.path)).split("\n").filter(Boolean);
    same(files.filter((file) => file.startsWith(`${plugin.path}/`)).sort(), tracked.sort(), `${plugin.id} complete source partition`);
    same(await git("ls-files", "--others", "--exclude-standard", "--", plugin.path), "", `${plugin.id} untracked files`);
    for (const file of fixture.reviewedFiles) {
      assert(!path.isAbsolute(file.path) && !file.path.split("/").includes(".."), "Reviewed paths must be repository-relative");
      same(sha256(await readFile(path.join(sourceRoot, file.path))), file.sha256, `${plugin.id} source file ${file.path}`);
    }
    fixtures.push(fixture);
  }
  same([...pluginIds].sort(), roster.plugins.map((plugin) => plugin.id).sort(), "all 69 plugins");
  return { freeze, freezeSha256: sha256(freezeBytes), fixtures };
}
