import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { batch } from "../src/index.js";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve("src/cli.js");

async function createCorpus(t) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-batch-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  return rootDir;
}

async function createPlugin(rootDir, relativePath, id) {
  const pluginRoot = path.join(rootDir, relativePath);
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(path.join(pluginRoot, "package.json"), JSON.stringify({ name: id, version: "1.0.0" }));
  await writeFile(path.join(pluginRoot, "openclaw.plugin.json"), JSON.stringify({ id }));
}

test("batch rejects non-finite concurrency before writing a misleading empty report", async (t) => {
  const rootDir = await createCorpus(t);
  await createPlugin(rootDir, "plugin", "example");
  for (const concurrency of [NaN, Infinity, -Infinity, "invalid"]) {
    await assert.rejects(batch.run({ rootDir, concurrency, openclawPath: false }), /concurrency.*finite number/);
  }
  await assert.rejects(readFile(path.join(rootDir, "reports", "plugin-inspector-batch-report.json")), { code: "ENOENT" });
});

test("batch CLI rejects invalid and missing concurrency instead of passing --check", async (t) => {
  const rootDir = await createCorpus(t);
  await createPlugin(rootDir, "plugin", "example");
  for (const values of [["invalid"], ["Infinity"], []]) {
    await assert.rejects(
      execFileAsync(process.execPath, [cliPath, "batch", rootDir, "--no-openclaw", "--check", "--concurrency", ...values]),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /concurrency.*finite number/);
        return true;
      },
    );
  }
  await assert.rejects(readFile(path.join(rootDir, "reports", "plugin-inspector-batch-report.json")), { code: "ENOENT" });
});

test("batch retains independent reports for paths that flatten to the same name", async (t) => {
  const rootDir = await createCorpus(t);
  const plugins = [["a/b", "nested"], ["a-b", "flat"], ["a b", "spaced"]];
  for (const [relativePath, id] of plugins) await createPlugin(rootDir, relativePath, id);
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath, "batch", rootDir, "--no-openclaw", "--keep-plugin-reports", "--concurrency", "3", "--json",
  ]);
  const aggregate = JSON.parse(stdout);
  assert.equal(aggregate.summary.pluginCount, plugins.length);
  const retainedFiles = await readdir(path.join(rootDir, "reports", "plugins"), { recursive: true });
  assert.equal(retainedFiles.filter((file) => path.basename(file) === "plugin-inspector-report.json").length, plugins.length);
  for (const [relativePath, id] of plugins) {
    const reportDir = path.join(rootDir, "reports", "plugins", relativePath);
    const report = JSON.parse(await readFile(path.join(reportDir, "plugin-inspector-report.json"), "utf8"));
    assert.equal(report.fixtures[0].id, id);
    assert.match(await readFile(path.join(reportDir, "plugin-inspector-report.md"), "utf8"), new RegExp(id));
    assert.ok((await readFile(path.join(reportDir, "plugin-inspector-issues.md"), "utf8")).length > 0);
  }
});

test("batch retains reports when the corpus root itself is a plugin", async (t) => {
  const rootDir = await createCorpus(t);
  await createPlugin(rootDir, ".", "root-plugin");
  const { report } = await batch.run({ rootDir, keepPluginReports: true, openclawPath: false });
  assert.equal(report.summary.pluginCount, 1);
  const retained = JSON.parse(await readFile(path.join(rootDir, "reports", "plugins", "plugin-inspector-report.json"), "utf8"));
  assert.equal(retained.fixtures[0].id, "root-plugin");
});
