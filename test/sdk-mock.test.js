import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

test("mock SDK preserves the isRecord predicate contract", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "plugin-inspector-sdk-mock-"));
  const pluginRoot = path.join(rootDir, "plugin");
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(
    path.join(pluginRoot, "index.js"),
    [
      'import { asNullableRecord, asOptionalRecord, asRecord, isRecord, readStringField } from "openclaw/plugin-sdk/string-coerce-runtime";',
      "export { asNullableRecord, asOptionalRecord, asRecord, isRecord, readStringField };",
      "",
    ].join("\n"),
    "utf8",
  );

  await createMockSdkPackage(rootDir, { pluginRoot });

  const mockModule = await import(
    pathToFileURL(path.join(rootDir, "node_modules", "openclaw", "plugin-sdk", "string-coerce-runtime.js")).href
  );
  const record = { count: 42, value: "ok" };
  const array = ["value"];
  assert.equal(mockModule.isRecord(record), true);
  assert.equal(mockModule.isRecord([]), false);
  assert.equal(mockModule.isRecord("value"), false);
  assert.equal(mockModule.isRecord(42), false);
  assert.equal(mockModule.isRecord(null), false);
  assert.equal(mockModule.isRecord(undefined), false);
  assert.equal(mockModule.asRecord(record), record);
  assert.equal(mockModule.asRecord(array), array);
  assert.deepEqual(mockModule.asRecord(null), {});
  assert.equal(mockModule.asOptionalRecord(record), record);
  assert.equal(mockModule.asOptionalRecord(array), undefined);
  assert.equal(mockModule.asNullableRecord(record), record);
  assert.equal(mockModule.asNullableRecord(array), null);
  assert.equal(mockModule.readStringField(record, "value"), "ok");
  assert.equal(mockModule.readStringField(record, "count"), undefined);
  assert.equal(mockModule.readStringField(undefined, "value"), undefined);
});
