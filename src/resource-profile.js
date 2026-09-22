import { performance } from "node:perf_hooks";
import process from "node:process";
import { threadId } from "node:worker_threads";

const memoryFields = ["rss", "heapTotal", "heapUsed", "external", "arrayBuffers"];

// Call inside the measured runtime, not in the Inspector supervisor. CPU and
// RSS cover this process; other memory fields and resources belong to this thread.
export function captureProcessResources() {
  const activeResources = new Map();
  for (const type of process.getActiveResourcesInfo()) {
    activeResources.set(type, (activeResources.get(type) ?? 0) + 1);
  }
  return {
    pid: process.pid,
    threadId,
    timeOriginMs: performance.timeOrigin,
    elapsedMs: performance.now(),
    cpuMicros: process.cpuUsage(),
    memoryBytes: process.memoryUsage(),
    eventLoop: performance.eventLoopUtilization(),
    activeResources: Object.fromEntries([...activeResources].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)),
  };
}

export function diffProcessResources(before, after) {
  if (before.pid !== after.pid || before.threadId !== after.threadId || before.timeOriginMs !== after.timeOriginMs) {
    throw new Error("Resource snapshots must come from the same process lifetime and thread");
  }
  const wallMs = after.elapsedMs - before.elapsedMs;
  const user = (after.cpuMicros.user - before.cpuMicros.user) / 1000;
  const system = (after.cpuMicros.system - before.cpuMicros.system) / 1000;
  if (![wallMs, user, system].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("Resource snapshots must have ordered wall and CPU counters");
  }
  // The native two-snapshot helper returns zero before the consumer's loop
  // starts, even for transported samples. Difference the recorded counters.
  const active = after.eventLoop.active - before.eventLoop.active;
  const idle = after.eventLoop.idle - before.eventLoop.idle;
  const eventLoop = active + idle > 0
    ? { active, idle, utilization: active / (active + idle) }
    : null;
  const resourceTypes = [...new Set([
    ...Object.keys(before.activeResources),
    ...Object.keys(after.activeResources),
  ])].sort();
  return {
    wallMs,
    cpuMs: { user, system, total: user + system },
    memoryDeltaBytes: Object.fromEntries(memoryFields.map((field) => [field, after.memoryBytes[field] - before.memoryBytes[field]])),
    // Zero elapsed event-loop time is unavailable, not proof of an idle loop.
    eventLoop,
    activeResourceDelta: Object.fromEntries(resourceTypes.map((type) => [type, (after.activeResources[type] ?? 0) - (before.activeResources[type] ?? 0)])),
  };
}
