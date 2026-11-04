import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pluginRoot } from "../../src/index.js";

export async function inspectSdkUsageFixture(t, { prefix, packageJson, files }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "plugin");
  await mkdir(root);
  await writeFile(path.join(root, "package.json"), JSON.stringify(packageJson));
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(root, name), text);
  const run = await pluginRoot.runCheck({
    pluginRoot: root, outDir: path.join(directory, "report"), openclawPath: false,
    capture: false, allowExecution: false,
  });
  return JSON.parse(await readFile(run.paths.jsonPath, "utf8"));
}
