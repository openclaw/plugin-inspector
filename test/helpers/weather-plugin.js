import { createTempDir } from "./temp-dir.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function createWeatherPlugin(t, prefix, options = {}) {
  const rootDir = await createTempDir(t, prefix);
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  const packageJson = {
    name: "@example/openclaw-weather",
    version: "1.0.0",
    type: "module",
    openclaw: {
      extensions: ["src/index.js"],
      compat: { pluginApi: "^1.0.0" },
    },
    ...(options.packageJson ?? {}),
  };
  if (packageJson.openclaw === null) {
    delete packageJson.openclaw;
  }
  if (options.packageConfig) {
    packageJson.pluginInspector = {
      version: 1,
      ...options.packageConfig,
    };
  }
  await writeFile(
    path.join(rootDir, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "openclaw.plugin.json"),
    `${JSON.stringify({ id: "weather", name: "Weather", version: "1.0.0", contracts: { tools: {} } }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(rootDir, "src", "index.js"),
    'import { definePluginEntry } from "openclaw/plugin-sdk";\nexport default definePluginEntry((api) => api.registerTool({ name: "weather" }));\n',
    "utf8",
  );
  return rootDir;
}
