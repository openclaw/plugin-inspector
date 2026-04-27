import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function createMockSdkPackage(rootDir) {
  const packageDir = path.join(rootDir, "node_modules", "openclaw");
  const pluginSdkDir = path.join(packageDir, "plugin-sdk");
  await mkdir(pluginSdkDir, { recursive: true });
  await writeFile(
    path.join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        name: "openclaw",
        version: "0.0.0-plugin-inspector-mock",
        type: "module",
        exports: {
          "./plugin-sdk": "./plugin-sdk/index.js",
          "./plugin-sdk/*": "./plugin-sdk/index.js",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(path.join(pluginSdkDir, "index.js"), mockSdkSource(), "utf8");
  return packageDir;
}

function mockSdkSource() {
  return `export function definePluginEntry(entry) {
  return typeof entry === "function" ? { register: entry } : entry;
}

export function defineChannelPluginEntry(entry) {
  return typeof entry === "function" ? { register: entry } : entry;
}

export function createChatChannelPlugin(entry) {
  return typeof entry === "function" ? { register: entry } : entry;
}

export function definePlugin(entry) {
  return definePluginEntry(entry);
}

export function createPlugin(entry) {
  return definePluginEntry(entry);
}

export const pluginSdkMock = true;

export default {
  createChatChannelPlugin,
  createPlugin,
  defineChannelPluginEntry,
  definePlugin,
  definePluginEntry,
  pluginSdkMock,
};
`;
}
