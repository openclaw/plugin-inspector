const loadSessionStoreReplacement =
  "getSessionEntry(...) / listSessionEntries(...) for reads and patchSessionEntry(...) / upsertSessionEntry(...) for writes";

const loadSessionStoreSpecifiers = new Set([
  "openclaw/plugin-sdk/config-runtime",
  "openclaw/plugin-sdk/session-store-runtime",
]);

export const pluginSdkDeprecationRules = [
  {
    code: "sdk-load-session-store",
    title: "deprecated whole-store session helper is still used",
    replacement: loadSessionStoreReplacement,
  },
];

export function inspectSdkDeprecations(text, filePath = "source.js", rules = pluginSdkDeprecationRules) {
  const findings = [];

  for (const rule of rules) {
    if (rule.code === "sdk-load-session-store") {
      collectLoadSessionStoreDeprecations(findings, { text, filePath, rule });
    }
  }

  return uniqueFindings(findings)
    .sort((left, right) => left.offset - right.offset || left.surface.localeCompare(right.surface))
    .map(({ offset, ...finding }) => finding);
}

function collectLoadSessionStoreDeprecations(findings, context) {
  collectNamedImportDeprecations(findings, context);
  collectNamedReexportDeprecations(findings, context);
  collectNamedRequireDeprecations(findings, context);
  collectNamespaceUsageDeprecations(findings, context);
  collectNamespaceRequireDeprecations(findings, context);
  collectRuntimeUsageDeprecations(findings, context);
}

function collectNamedImportDeprecations(findings, context) {
  const regex =
    /\bimport\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?{([^}]+)}\s*from\s*["'`]([^"'`]+)["'`]/g;
  for (const match of context.text.matchAll(regex)) {
    const specifier = match[2];
    if (!loadSessionStoreSpecifiers.has(specifier)) {
      continue;
    }
    for (const binding of parseNamedBindings(match[1])) {
      if (binding.exported !== "loadSessionStore") {
        continue;
      }
      findings.push(
        buildFinding(context.rule, {
          surface: `${specifier} import`,
          sourceText: context.text,
          filePath: context.filePath,
          offset: (match.index ?? 0) + match[0].lastIndexOf(binding.local),
        }),
      );
    }
  }
}

function collectNamedReexportDeprecations(findings, context) {
  const regex = /\bexport\s*{([^}]+)}\s*from\s*["'`]([^"'`]+)["'`]/g;
  for (const match of context.text.matchAll(regex)) {
    const specifier = match[2];
    if (!loadSessionStoreSpecifiers.has(specifier)) {
      continue;
    }
    for (const binding of parseNamedBindings(match[1])) {
      if (binding.exported !== "loadSessionStore") {
        continue;
      }
      findings.push(
        buildFinding(context.rule, {
          surface: `${specifier} re-export`,
          sourceText: context.text,
          filePath: context.filePath,
          offset: (match.index ?? 0) + match[0].lastIndexOf(binding.local),
        }),
      );
    }
  }
}

function collectNamedRequireDeprecations(findings, context) {
  const regex = /\b(?:const|let|var)\s+{([^}]+)}\s*=\s*require\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  for (const match of context.text.matchAll(regex)) {
    const specifier = match[2];
    if (!loadSessionStoreSpecifiers.has(specifier)) {
      continue;
    }
    for (const binding of parseNamedBindings(match[1], { aliasSeparator: ":" })) {
      if (binding.exported !== "loadSessionStore") {
        continue;
      }
      findings.push(
        buildFinding(context.rule, {
          surface: `${specifier} require`,
          sourceText: context.text,
          filePath: context.filePath,
          offset: (match.index ?? 0) + match[0].lastIndexOf(binding.local),
        }),
      );
    }
  }
}

function collectNamespaceUsageDeprecations(findings, context) {
  const regex = /\bimport\s+(?:type\s+)?\*\s+as\s+([A-Za-z_$][\w$]*)\s*from\s*["'`]([^"'`]+)["'`]/g;
  for (const match of context.text.matchAll(regex)) {
    const local = match[1];
    const specifier = match[2];
    if (!loadSessionStoreSpecifiers.has(specifier)) {
      continue;
    }
    const accessRegex = new RegExp(
      `\\b${escapeRegex(local)}\\s*\\.\\s*loadSessionStore\\s*(?:\\?\\.)?\\s*\\(`,
      "g",
    );
    for (const access of context.text.matchAll(accessRegex)) {
      findings.push(
        buildFinding(context.rule, {
          surface: `${specifier} namespace access`,
          sourceText: context.text,
          filePath: context.filePath,
          offset: (access.index ?? 0) + access[0].lastIndexOf("loadSessionStore"),
        }),
      );
    }
  }
}

function collectNamespaceRequireDeprecations(findings, context) {
  const regex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  for (const match of context.text.matchAll(regex)) {
    const local = match[1];
    const specifier = match[2];
    if (!loadSessionStoreSpecifiers.has(specifier)) {
      continue;
    }
    const accessRegex = new RegExp(
      `\\b${escapeRegex(local)}\\s*\\.\\s*loadSessionStore\\s*(?:\\?\\.)?\\s*\\(`,
      "g",
    );
    for (const access of context.text.matchAll(accessRegex)) {
      findings.push(
        buildFinding(context.rule, {
          surface: `${specifier} require namespace access`,
          sourceText: context.text,
          filePath: context.filePath,
          offset: (access.index ?? 0) + access[0].lastIndexOf("loadSessionStore"),
        }),
      );
    }
  }
}

function collectRuntimeUsageDeprecations(findings, context) {
  const regex =
    /\b(?:[A-Za-z_$][\w$]*|this)\s*\.runtime\s*\.agent\s*\.session\s*\.loadSessionStore\s*(?:\?\.)?\s*\(/g;
  for (const match of context.text.matchAll(regex)) {
    findings.push(
      buildFinding(context.rule, {
        surface: "api.runtime.agent.session",
        sourceText: context.text,
        filePath: context.filePath,
        offset: (match.index ?? 0) + match[0].lastIndexOf("loadSessionStore"),
      }),
    );
  }
}

function parseNamedBindings(rawBindings, options = {}) {
  const aliasSeparator = options.aliasSeparator ?? "as";
  const aliasRegex = aliasSeparator === ":" ? /\s*:\s*/ : /\s+as\s+/;
  return rawBindings
    .split(",")
    .map((binding) => binding.trim())
    .filter(Boolean)
    .map((binding) => binding.replace(/^type\s+/, "").trim())
    .map((binding) => {
      const [exported, local = exported] = binding.split(aliasRegex);
      return {
        exported: exported?.trim(),
        local: local?.trim(),
      };
    })
    .filter((binding) => binding.exported && binding.local);
}

function buildFinding(rule, details) {
  const refLine = lineForOffset(details.sourceText, details.offset);
  return {
    code: rule.code,
    surface: details.surface,
    replacement: rule.replacement,
    ref: `${details.filePath}:${refLine}`,
    message: `loadSessionStore keeps the legacy whole-store session shape; use ${rule.replacement}.`,
    offset: details.offset,
  };
}

function uniqueFindings(findings) {
  const byKey = new Map();
  for (const finding of findings) {
    byKey.set(`${finding.code}:${finding.surface}:${finding.ref}`, finding);
  }
  return [...byKey.values()];
}

function lineForOffset(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}

function escapeRegex(value) {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
