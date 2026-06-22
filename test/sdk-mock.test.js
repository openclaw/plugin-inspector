import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createMockSdkPackage } from "../src/advanced.js";

test("mock SDK ignores subpaths that would escape the plugin-sdk package", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-sdk-mock-"));
  const pluginRoot = path.join(rootDir, "plugin");
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(
    path.join(pluginRoot, "index.js"),
    'import { nope } from "openclaw/plugin-sdk/../../escape";\nexport { nope };\n',
    "utf8",
  );

  await createMockSdkPackage(rootDir, { pluginRoot });

  await assert.rejects(stat(path.join(rootDir, "node_modules", "openclaw", "escape.js")), { code: "ENOENT" });
});
