import { performance } from "node:perf_hooks";

function notify(observer, event) {
  try {
    // Observe rejected promises without waiting for slow or non-settling observers.
    Promise.resolve(observer(Object.freeze(event))).catch(() => {});
  } catch {
    // Diagnostics must not replace the inspection result or its original error.
  }
}

export function runInspectionPhase(options, details, run) {
  const observer = options.onInspectionProgress;
  if (typeof observer !== "function") return run();

  const startedAt = performance.now();
  notify(observer, { ...details, event: "start", elapsedMs: 0 });
  return complete();

  async function complete() {
    try {
      const result = await run();
      notify(observer, { ...details, event: "end", elapsedMs: performance.now() - startedAt });
      return result;
    } catch (error) {
      notify(observer, { ...details, event: "error", elapsedMs: performance.now() - startedAt });
      throw error;
    }
  }
}
