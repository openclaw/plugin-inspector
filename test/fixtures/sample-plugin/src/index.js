import { definePluginEntry } from "openclaw/plugin-sdk";

export default definePluginEntry({
  register(api) {
    api.on("before_tool_call", () => undefined);
    api.registerTool({
      name: "sample_tool",
      inputSchema: { type: "object" },
      run() {
        return { ok: true };
      },
    });
  },
});
