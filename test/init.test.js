import assert from "node:assert/strict";
import { test } from "node:test";
import { renderGithubActionsWorkflow } from "../src/init.js";

test("generated Corepack workflows do not query an unprepared package manager cache", () => {
  for (const packageManager of ["pnpm", "yarn"]) {
    const workflow = renderGithubActionsWorkflow({ packageManager });
    assert.doesNotMatch(workflow, /^\s+cache:/m);
    assert.match(workflow, /package-manager-cache: false/);
    assert.ok(workflow.indexOf("corepack enable") > workflow.indexOf("actions/setup-node@"));
    assert.ok(workflow.indexOf("corepack enable") < workflow.indexOf(`${packageManager} install`));
  }
});

test("generated Bun workflow installs Bun and does not require an npm lockfile", () => {
  const workflow = renderGithubActionsWorkflow({ packageManager: "bun" });
  assert.match(workflow, /uses: oven-sh\/setup-bun@v2/);
  assert.ok(workflow.indexOf("oven-sh/setup-bun@") < workflow.indexOf("bun install"));
  assert.doesNotMatch(workflow, /cache: npm|corepack enable/);
  assert.match(workflow, /bun install --frozen-lockfile/);
  assert.match(workflow, /bunx @openclaw\/plugin-inspector ci/);
});

test("generated npm workflow retains its lockfile cache and npm commands", () => {
  const workflow = renderGithubActionsWorkflow({ packageManager: "npm" });
  assert.match(workflow, /cache: npm/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npx @openclaw\/plugin-inspector ci/);
  assert.doesNotMatch(workflow, /corepack|setup-bun/);
});
