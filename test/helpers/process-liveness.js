import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

export function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

export async function assertGone(pid, message = `owned PID ${pid} survived completion`) {
  assert.ok(Number.isInteger(pid) && pid > 0);
  for (let i = 0; i < 100 && processExists(pid); i += 1) await delay(10);
  assert.equal(processExists(pid), false, message);
}
