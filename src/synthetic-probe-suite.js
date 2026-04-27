import { buildContractCapture } from "./contract-capture.js";
import { buildSyntheticProbePlan } from "./synthetic-probes.js";

export function buildSyntheticProbePlanFromReport(report, options = {}) {
  const capture = options.capture ?? buildContractCapture({
    report,
    hookAssertions: options.hookAssertions,
    hookContexts: options.hookContexts,
    hookEvents: options.hookEvents,
    registrationArguments: options.registrationArguments,
    registrationAssertions: options.registrationAssertions,
  });
  return buildSyntheticProbePlan({
    capture,
    hookContexts: options.hookContexts,
    hookEvents: options.hookEvents,
    registrationArguments: options.registrationArguments,
  });
}
