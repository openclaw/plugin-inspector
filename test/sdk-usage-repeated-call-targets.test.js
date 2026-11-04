import { inspectSdkUsageFixture } from "./helpers/sdk-usage-fixture.js";
import assert from "node:assert/strict";
import { test } from "node:test";

test("repeated calls through unchanged aliases do not exhaust SDK analysis", async (t) => {
  let source = "function leaf() {}\nconst alias0 = leaf;\n";
  for (let index = 1; index < 300; index++) source += `const alias${index} = alias${index - 1};\n`;
  source += "alias299();\n".repeat(4000);
  source += "export default { register(api) { api.registerTool({}); } };";
  const { sdkUsage } = await inspectSdkUsageFixture(t, {
    prefix: "sdk-repeated-call-targets-",
    packageJson: { name: "repeated-calls", version: "1.0.0", openclaw: { extensions: ["./index.ts"] } },
    files: { "index.ts": source },
  });
  assert.equal(sdkUsage.status, "complete");
  assert.deepEqual(sdkUsage.unknowns, []);
  assert.ok(sdkUsage.entries.some(({ key }) => key === "api-member:api.registerTool"));
});
