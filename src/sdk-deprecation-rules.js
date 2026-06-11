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

function collectMemberCallDeprecations(findings, context, options) {
  forEachMethodCall(context.text, "loadSessionStore", (offset) => {
    // Normalize transparent parentheses and optional-chained member links before matching.
    const receiver = readNormalizedCallReceiver(context.text, offset);
    if (!receiver || !options.receiverMatcher(receiver)) {
      return;
    }
    findings.push(
      buildFinding(context.rule, {
        surface: options.surface,
        sourceText: context.text,
        filePath: context.filePath,
        offset,
      }),
    );
  });
}

function forEachMethodCall(text, methodName, visit) {
  let start = 0;
  while (start < text.length) {
    const offset = text.indexOf(methodName, start);
    if (offset === -1) {
      return;
    }
    start = offset + methodName.length;
    if (!isIdentifierBoundary(text, offset - 1) || !isIdentifierBoundary(text, offset + methodName.length)) {
      continue;
    }
    if (!hasCallSuffix(text, offset + methodName.length)) {
      continue;
    }
    visit(offset);
  }
}

function readNormalizedCallReceiver(text, methodOffset) {
  let cursor = skipWhitespaceBackward(text, methodOffset);
  const operator = readMemberAccessOperator(text, cursor);
  if (!operator) {
    return null;
  }
  cursor = operator.start;
  const receiverStart = findReceiverStart(text, cursor);
  if (receiverStart === cursor) {
    return null;
  }
  return normalizeReceiverExpression(text.slice(receiverStart, cursor));
}

function readMemberAccessOperator(text, endOffset) {
  if (endOffset >= 2 && text.slice(endOffset - 2, endOffset) === "?.") {
    return { kind: "optional", start: endOffset - 2 };
  }
  if (endOffset >= 1 && text[endOffset - 1] === ".") {
    return { kind: "direct", start: endOffset - 1 };
  }
  return null;
}

function findReceiverStart(text, endOffset) {
  let cursor = endOffset;
  let parenDepth = 0;
  while (cursor > 0) {
    const char = text[cursor - 1];
    if (char === ")") {
      parenDepth += 1;
      cursor -= 1;
      continue;
    }
    if (char === "(") {
      if (parenDepth === 0) {
        break;
      }
      parenDepth -= 1;
      cursor -= 1;
      continue;
    }
    if (parenDepth > 0) {
      cursor -= 1;
      continue;
    }
    if (isReceiverCharacter(char)) {
      cursor -= 1;
      continue;
    }
    break;
  }
  return cursor;
}

function normalizeReceiverExpression(rawReceiver) {
  let normalized = rawReceiver.replace(/\s+/g, "");
  while (normalized.startsWith("(") && normalized.endsWith(")") && wrapsWholeExpression(normalized)) {
    normalized = normalized.slice(1, -1);
  }
  return normalized.replaceAll("?.", ".");
}

function wrapsWholeExpression(value) {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0 && index < value.length - 1) {
        return false;
      }
    }
  }
  return depth === 0;
}

function hasCallSuffix(text, startOffset) {
  let cursor = skipWhitespaceForward(text, startOffset);
  if (text.slice(cursor, cursor + 2) === "?.") {
    cursor = skipWhitespaceForward(text, cursor + 2);
  }
  return text[cursor] === "(";
}

function skipWhitespaceForward(text, startOffset) {
  let cursor = startOffset;
  while (cursor < text.length && /\s/.test(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function skipWhitespaceBackward(text, endOffset) {
  let cursor = endOffset;
  while (cursor > 0 && /\s/.test(text[cursor - 1])) {
    cursor -= 1;
  }
  return cursor;
}

function isReceiverCharacter(char) {
  return /[A-Za-z0-9_$?.]/.test(char);
}

function isIdentifierBoundary(text, offset) {
  if (offset < 0 || offset >= text.length) {
    return true;
  }
  return !/[A-Za-z0-9_$]/.test(text[offset]);
}

function isRuntimeSessionReceiver(receiver) {
  return /^(?:[A-Za-z_$][A-Za-z0-9_$]*|this)\.runtime\.agent\.session$/.test(receiver);
}

function collectNamespaceUsageDeprecations(findings, context) {
  const regex = /\bimport\s+(?:type\s+)?\*\s+as\s+([A-Za-z_$][\w$]*)\s*from\s*["'`]([^"'`]+)["'`]/g;
  for (const match of context.text.matchAll(regex)) {
    const local = match[1];
    const specifier = match[2];
    if (!loadSessionStoreSpecifiers.has(specifier)) {
      continue;
    }
    collectMemberCallDeprecations(findings, context, {
      receiverMatcher: (receiver) => receiver === local,
      surface: `${specifier} namespace access`,
    });
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
    collectMemberCallDeprecations(findings, context, {
      receiverMatcher: (receiver) => receiver === local,
      surface: `${specifier} require namespace access`,
    });
  }
}

function collectRuntimeUsageDeprecations(findings, context) {
  collectMemberCallDeprecations(findings, context, {
    receiverMatcher: isRuntimeSessionReceiver,
    surface: "api.runtime.agent.session",
  });
}

function parseNamedBindings(rawBindings, options = {}) {
  const aliasSeparator = options.aliasSeparator ?? "as";
  return rawBindings
    .split(",")
    .map((binding) => binding.trim())
    .filter(Boolean)
    .map((binding) => binding.replace(/^type\s+/, "").trim())
    .map((binding) => parseBindingAlias(binding, aliasSeparator))
    .filter((binding) => binding.exported && binding.local);
}

function parseBindingAlias(binding, aliasSeparator) {
  if (aliasSeparator === ":") {
    const separatorIndex = binding.indexOf(":");
    if (separatorIndex === -1) {
      return {
        exported: binding.trim(),
        local: binding.trim(),
      };
    }
    return {
      exported: binding.slice(0, separatorIndex).trim(),
      local: binding.slice(separatorIndex + 1).trim(),
    };
  }

  const tokens = binding.trim().split(/\s+/);
  if (tokens.length === 3 && tokens[1] === "as") {
    return {
      exported: tokens[0],
      local: tokens[2],
    };
  }

  return {
    exported: binding.trim(),
    local: binding.trim(),
  };
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
