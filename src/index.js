import * as pluginApi from "./api.js";
import * as ciPolicyApi from "./ci-policy.js";
import * as ciSummaryApi from "./ci-summary.js";
import * as configApi from "./config.js";
import * as contractCaptureApi from "./contract-capture.js";
import * as contractCoverageApi from "./contract-coverage.js";
import * as executionResultsApi from "./execution-results.js";
import * as importLoopProfileApi from "./import-loop-profile.js";
import * as inspectorApi from "./inspector.js";
import * as issuesApi from "./issues.js";
import * as openClawTargetApi from "./openclaw-target.js";
import * as profileDiffApi from "./profile-diff.js";
import * as refDiffApi from "./ref-diff.js";
import * as reportApi from "./report.js";
import * as runtimeProfileApi from "./runtime-profile.js";
import * as runtimeReconciliationApi from "./runtime-reconciliation.js";
import * as syntheticEntrypointApi from "./synthetic-entrypoint.js";
import * as syntheticProbeSuiteApi from "./synthetic-probe-suite.js";
import * as syntheticProbesApi from "./synthetic-probes.js";

export const pluginRoot = Object.freeze({
  loadConfig: pluginApi.loadPluginConfig,
  inspect: pluginApi.inspectPluginRoot,
  runCheck: pluginApi.runPluginCheck,
  captureEntrypoint: pluginApi.capturePluginEntrypoint,
  setup: pluginApi.setupPluginInspector,
});

export const fixtureSuites = Object.freeze({
  loadConfig: configApi.loadInspectorConfig,
  inspect: pluginApi.inspectCompatibilityFixtureSetConfig,
  inspectStatic: pluginApi.inspectFixtureSetConfig,
  runReport: pluginApi.runFixtureSetReport,
  writeReports: pluginApi.writeFixtureSetReports,
  renderReport: pluginApi.renderFixtureSetMarkdownReport,
  renderIssues: pluginApi.renderFixtureSetIssuesReport,
  buildColdImportReadiness: pluginApi.buildFixtureSetColdImportReadiness,
  runColdImportReadiness: pluginApi.runFixtureSetColdImportReadiness,
  writeColdImportReadiness: pluginApi.writeFixtureSetColdImportReadiness,
  buildWorkspacePlan: pluginApi.buildFixtureSetWorkspacePlan,
  runWorkspacePlan: pluginApi.runFixtureSetWorkspacePlan,
  writeWorkspacePlan: pluginApi.writeFixtureSetWorkspacePlan,
  buildPlatformProbes: pluginApi.buildFixtureSetPlatformProbes,
  runPlatformProbes: pluginApi.runFixtureSetPlatformProbes,
  writePlatformProbes: pluginApi.writeFixtureSetPlatformProbes,
});

export const staticInspection = Object.freeze({
  loadConfig: configApi.loadInspectorConfig,
  inspectSourceText: inspectorApi.inspectSourceText,
  inspectPlugin: inspectorApi.inspectPlugin,
  inspectFixtureSet: inspectorApi.inspectFixtureSet,
});

export const reports = Object.freeze({
  renderMarkdown: reportApi.renderMarkdownReport,
  renderTextSummary: pluginApi.renderTextSummary,
  sanitizeArtifact: reportApi.sanitizeReportArtifact,
  write: reportApi.writeReport,
  issueId: issuesApi.issueId,
  classifyIssueFinding: issuesApi.classifyIssueFinding,
  knownIssueCodes: issuesApi.knownIssueCodes,
  openClawTargetPathCandidates: openClawTargetApi.openClawTargetPathCandidates,
  readOpenClawTargetSurface: openClawTargetApi.readOpenClawTargetSurface,
});

export const contracts = Object.freeze({
  buildCapture: contractCaptureApi.buildContractCapture,
  writeCapture: contractCaptureApi.writeContractCapture,
  renderCapture: contractCaptureApi.renderContractCaptureMarkdown,
  validateCapture: contractCaptureApi.validateContractCapture,
  validateCoverage: contractCoverageApi.validateContractCoverage,
  defaults: Object.freeze({
    registrationAssertions: contractCaptureApi.defaultRegistrationAssertions,
    registrationArguments: contractCaptureApi.defaultRegistrationArguments,
    hookAssertions: contractCaptureApi.defaultHookAssertions,
    hookEvents: contractCaptureApi.defaultHookEvents,
    hookContexts: contractCaptureApi.defaultHookContexts,
  }),
});

export const ci = Object.freeze({
  buildSummary: ciSummaryApi.buildCiSummary,
  writeSummary: ciSummaryApi.writeCiSummary,
  renderSummary: ciSummaryApi.renderCiSummaryMarkdown,
  readReports: ciSummaryApi.readCiReports,
  deriveStatus: ciSummaryApi.deriveCiStatus,
  buildPolicyReport: ciPolicyApi.buildCiPolicyReport,
  writePolicyReport: ciPolicyApi.writeCiPolicyReport,
  renderPolicyReport: ciPolicyApi.renderCiPolicyMarkdown,
  validatePolicy: ciPolicyApi.validateCiPolicy,
  validatePolicyReport: ciPolicyApi.validateCiPolicyReport,
  buildExecutionResults: executionResultsApi.buildExecutionResultsReport,
  writeExecutionResults: executionResultsApi.writeExecutionResultsReport,
  renderExecutionResults: executionResultsApi.renderExecutionResultsMarkdown,
  writeOutputs: pluginApi.writeCiOutputArtifacts,
});

export const runtime = Object.freeze({
  buildProfile: runtimeProfileApi.buildRuntimeProfile,
  writeProfile: runtimeProfileApi.writeRuntimeProfile,
  renderProfile: runtimeProfileApi.renderRuntimeProfileMarkdown,
  validateProfile: runtimeProfileApi.validateRuntimeProfile,
  buildProfileDiff: profileDiffApi.buildProfileDiff,
  writeProfileDiff: profileDiffApi.writeProfileDiff,
  renderProfileDiff: profileDiffApi.renderProfileDiffMarkdown,
  validateProfileDiff: profileDiffApi.validateProfileDiff,
  buildRefDiff: refDiffApi.buildRefDiff,
  writeRefDiff: refDiffApi.writeRefDiff,
  renderRefDiff: refDiffApi.renderRefDiffMarkdown,
  validateRefDiff: refDiffApi.validateRefDiff,
  buildImportLoopProfile: importLoopProfileApi.buildImportLoopProfile,
  writeImportLoopProfile: importLoopProfileApi.writeImportLoopProfile,
  renderImportLoopProfile: importLoopProfileApi.renderImportLoopProfileMarkdown,
  validateImportLoopProfile: importLoopProfileApi.validateImportLoopProfile,
  applyExecutionCoverage: runtimeReconciliationApi.applyRuntimeExecutionCoverage,
  buildExecutionCoverage: runtimeReconciliationApi.buildRuntimeExecutionCoverage,
});

export const synthetic = Object.freeze({
  buildPlan: syntheticProbesApi.buildSyntheticProbePlan,
  buildPlanFromReport: syntheticProbeSuiteApi.buildSyntheticProbePlanFromReport,
  writePlan: syntheticProbesApi.writeSyntheticProbePlan,
  renderPlan: syntheticProbesApi.renderSyntheticProbeMarkdown,
  validatePlan: syntheticProbesApi.validateSyntheticProbePlan,
  runCaptured: syntheticProbesApi.runCapturedSyntheticProbes,
  runEntrypoint: syntheticEntrypointApi.runEntrypointSyntheticProbes,
  registrationExecutionProfiles: syntheticProbesApi.syntheticRegistrationExecutionProfiles,
  defaultHookEvents: syntheticProbesApi.defaultSyntheticHookEvents,
  defaultHookContexts: syntheticProbesApi.defaultSyntheticHookContexts,
  defaultRegistrationArguments: syntheticProbesApi.defaultSyntheticRegistrationArguments,
});

export {
  capturePluginEntrypoint,
  buildFixtureSetColdImportReadiness,
  buildFixtureSetPlatformProbes,
  buildFixtureSetWorkspacePlan,
  createCaptureApi,
  inspectCompatibilityFixtureSetConfig,
  inspectFixtureSetConfig,
  inspectPluginRoot,
  loadPluginConfig,
  renderFixtureSetColdImportReadinessMarkdown,
  renderFixtureSetIssuesReport,
  renderFixtureSetMarkdownReport,
  renderFixtureSetPlatformProbesMarkdown,
  renderFixtureSetWorkspacePlanMarkdown,
  renderTextSummary,
  runFixtureSetColdImportReadiness,
  runFixtureSetPlatformProbes,
  runFixtureSetReport,
  runFixtureSetWorkspacePlan,
  runPluginCheck,
  setupPluginInspector,
  validateColdImportReadiness,
  validateFixtureSetPlatformProbes,
  validateFixtureSetWorkspacePlan,
  writeCiOutputArtifacts,
  writeFixtureSetColdImportReadiness,
  writeFixtureSetPlatformProbes,
  writeFixtureSetReports,
  writeFixtureSetWorkspacePlan,
  writePluginReports,
} from "./api.js";
export {
  buildContractCapture,
  defaultHookAssertions,
  defaultHookContexts,
  defaultHookEvents,
  defaultRegistrationArguments,
  defaultRegistrationAssertions,
  renderContractCaptureMarkdown,
  validateContractCapture,
  writeContractCapture,
} from "./contract-capture.js";
export { validateContractCoverage } from "./contract-coverage.js";
export {
  buildCiPolicyReport,
  defaultCiPolicyReportOptions,
  renderCiPolicyMarkdown,
  validateCiPolicy,
  validateCiPolicyReport,
  writeCiPolicyReport,
} from "./ci-policy.js";
export {
  buildCiSummary,
  defaultCiReportPaths,
  deriveCiStatus,
  readCiReports,
  renderCiSummaryMarkdown,
  writeCiSummary,
} from "./ci-summary.js";
export { loadInspectorConfig } from "./config.js";
export {
  buildExecutionResultsReport,
  defaultExecutionResultsOptions,
  renderExecutionResultsMarkdown,
  writeExecutionResultsReport,
} from "./execution-results.js";
export {
  buildImportLoopProfile,
  defaultImportLoopProfileOptions,
  renderImportLoopProfileMarkdown,
  validateImportLoopProfile,
  writeImportLoopProfile,
} from "./import-loop-profile.js";
export { classifyIssueFinding, issueId, knownIssueCodes } from "./issues.js";
export { inspectFixtureSet, inspectPlugin, inspectSourceText } from "./inspector.js";
export { openClawTargetPathCandidates, readOpenClawTargetSurface } from "./openclaw-target.js";
export {
  buildProfileDiff,
  defaultProfileDiffOptions,
  renderProfileDiffMarkdown,
  validateProfileDiff,
  writeProfileDiff,
} from "./profile-diff.js";
export {
  buildRefDiff,
  defaultRefDiffDimensions,
  defaultRefDiffOptions,
  renderRefDiffMarkdown,
  validateRefDiff,
  writeRefDiff,
} from "./ref-diff.js";
export { renderMarkdownReport, sanitizeReportArtifact, writeReport } from "./report.js";
export {
  buildRuntimeProfile,
  defaultRuntimeProfileCommands,
  defaultRuntimeProfileOptions,
  renderRuntimeProfileMarkdown,
  validateRuntimeProfile,
  writeRuntimeProfile,
} from "./runtime-profile.js";
export {
  applyRuntimeExecutionCoverage,
  buildRuntimeExecutionCoverage,
} from "./runtime-reconciliation.js";
export { runEntrypointSyntheticProbes } from "./synthetic-entrypoint.js";
export { buildSyntheticProbePlanFromReport } from "./synthetic-probe-suite.js";
export {
  buildSyntheticProbePlan,
  defaultSyntheticHookContexts,
  defaultSyntheticHookEvents,
  defaultSyntheticRegistrationArguments,
  renderSyntheticProbeMarkdown,
  runCapturedSyntheticProbes,
  syntheticRegistrationExecutionProfiles,
  validateSyntheticProbePlan,
  writeSyntheticProbePlan,
} from "./synthetic-probes.js";
