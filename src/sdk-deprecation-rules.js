const sessionStoreReadReplacement =
  "getSessionEntry(...) / listSessionEntries(...) for reads and patchSessionEntry(...) / upsertSessionEntry(...) for writes";
const sessionStoreWriteReplacement = "patchSessionEntry(...) / upsertSessionEntry(...) for row-scoped writes";
const sessionFileReplacement = "session entries and transcript identity helpers instead of persisted file paths";
const sessionTranscriptReplacement =
  "resolveSessionTranscriptTarget(...), appendSessionTranscriptMessageByIdentity(...), and publishSessionTranscriptUpdateByIdentity(...)";

const sdkSessionSpecifiers = new Set([
  "openclaw/plugin-sdk/config-runtime",
  "openclaw/plugin-sdk/mattermost",
  "openclaw/plugin-sdk/agent-harness-runtime",
  "openclaw/plugin-sdk/session-store-runtime",
  "openclaw/plugin-sdk/session-transcript-runtime",
]);

export const pluginSdkDeprecationRules = [
  {
    code: "sdk-load-session-store",
    symbols: new Set(["loadSessionStore"]),
    title: "deprecated whole-store session helper is still used",
    replacement: sessionStoreReadReplacement,
    message: (symbol, replacement) => `${symbol} keeps the legacy whole-store session shape; use ${replacement}.`,
  },
  {
    code: "sdk-session-store-write",
    symbols: new Set(["saveSessionStore", "updateSessionStore"]),
    title: "deprecated whole-store session write helper is still used",
    replacement: sessionStoreWriteReplacement,
    message: (symbol, replacement) => `${symbol} writes the legacy whole-store session shape; use ${replacement}.`,
  },
  {
    code: "sdk-session-file-helper",
    symbols: new Set(["resolveSessionFilePath", "resolveAndPersistSessionFile"]),
    title: "deprecated session file-path helper is still used",
    replacement: sessionFileReplacement,
    message: (symbol, replacement) => `${symbol} depends on legacy session transcript file paths; use ${replacement}.`,
  },
  {
    code: "sdk-session-transcript-file-target",
    symbols: new Set(["resolveSessionTranscriptLegacyFileTarget"]),
    title: "deprecated transcript file target helper is still used",
    replacement: "resolveSessionTranscriptTarget(...) or resolveSessionTranscriptIdentity(...)",
    message: (symbol, replacement) => `${symbol} exposes legacy transcript file targets; use ${replacement}.`,
  },
  {
    code: "sdk-session-transcript-low-level",
    symbols: new Set(["appendSessionTranscriptMessage", "emitSessionTranscriptUpdate"]),
    title: "deprecated low-level transcript helper is still used",
    replacement: sessionTranscriptReplacement,
    message: (symbol, replacement) => `${symbol} bypasses the structured transcript runtime surface; use ${replacement}.`,
  },
];

export function inspectSdkDeprecations(text, filePath = "source.js", rules = pluginSdkDeprecationRules) {
  const findings = [];

  for (const rule of rules) {
    collectSdkHelperDeprecations(findings, { text, filePath, rule });
  }

  return uniqueFindings(findings)
    .sort((left, right) => left.offset - right.offset || left.surface.localeCompare(right.surface))
    .map(({ offset, ...finding }) => finding);
}

function collectSdkHelperDeprecations(findings, context) {
  collectNamedImportDeprecations(findings, context);
  collectNamedReexportDeprecations(findings, context);
  collectNamedRequireDeprecations(findings, context);
  collectNamespaceUsageDeprecations(findings, context);
  collectNamespaceRequireDeprecations(findings, context);
  collectDynamicImportNamespaceDeprecations(findings, context);
  collectRuntimeUsageDeprecations(findings, context);
  collectRuntimeAliasUsageDeprecations(findings, context);
}

function collectNamedImportDeprecations(findings, context) {
  const regex =
    /\bimport\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?{([^}]+)}\s*from\s*["'`]([^"'`]+)["'`]/g;
  for (const match of context.text.matchAll(regex)) {
    const specifier = match[2];
    if (!sdkSessionSpecifiers.has(specifier)) {
      continue;
    }
    for (const binding of parseNamedBindings(match[1])) {
      if (!context.rule.symbols.has(binding.exported)) {
        continue;
      }
      findings.push(
        buildFinding(context.rule, {
          surface: `${specifier} ${binding.exported} import`,
          symbol: binding.exported,
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
    if (!sdkSessionSpecifiers.has(specifier)) {
      continue;
    }
    for (const binding of parseNamedBindings(match[1])) {
      if (!context.rule.symbols.has(binding.exported)) {
        continue;
      }
      findings.push(
        buildFinding(context.rule, {
          surface: `${specifier} ${binding.exported} re-export`,
          symbol: binding.exported,
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
    if (!sdkSessionSpecifiers.has(specifier)) {
      continue;
    }
    for (const binding of parseNamedBindings(match[1], { aliasSeparator: ":" })) {
      if (!context.rule.symbols.has(binding.exported)) {
        continue;
      }
      findings.push(
        buildFinding(context.rule, {
          surface: `${specifier} ${binding.exported} require`,
          symbol: binding.exported,
          sourceText: context.text,
          filePath: context.filePath,
          offset: (match.index ?? 0) + match[0].lastIndexOf(binding.local),
        }),
      );
    }
  }
}

function collectMemberCallDeprecations(findings, context, options) {
  for (const symbol of context.rule.symbols) {
    forEachMethodCall(context.text, symbol, (offset) => {
      // Normalize transparent parentheses and optional-chained member links before matching.
      const receiver = readNormalizedCallReceiver(context.text, offset);
      if (!receiver || !options.receiverMatcher(receiver)) {
        return;
      }
      findings.push(
        buildFinding(context.rule, {
          surface: `${options.surface} ${symbol}`,
          symbol,
          sourceText: context.text,
          filePath: context.filePath,
          offset,
        }),
      );
    });
  }
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
  return (
    /(?:^|\.)(?:[A-Za-z_$][A-Za-z0-9_$]*|this)\.runtime\.agent\.session$/.test(receiver) ||
    /^(?:runtime|[A-Za-z_$][A-Za-z0-9_$]*Runtime)\.agent\.session$/.test(receiver) ||
    /^(?:agentRuntime|[A-Za-z_$][A-Za-z0-9_$]*AgentRuntime)\.session$/.test(receiver)
  );
}

function collectNamespaceUsageDeprecations(findings, context) {
  const regex = /\bimport\s+(?:type\s+)?\*\s+as\s+([A-Za-z_$][\w$]*)\s*from\s*["'`]([^"'`]+)["'`]/g;
  for (const match of context.text.matchAll(regex)) {
    const local = match[1];
    const specifier = match[2];
    if (!sdkSessionSpecifiers.has(specifier)) {
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
    if (!sdkSessionSpecifiers.has(specifier)) {
      continue;
    }
    collectMemberCallDeprecations(findings, context, {
      receiverMatcher: (receiver) => receiver === local,
      surface: `${specifier} require namespace access`,
    });
  }
}

function collectDynamicImportNamespaceDeprecations(findings, context) {
  const regex =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?import\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  for (const match of context.text.matchAll(regex)) {
    const local = match[1];
    const specifier = match[2];
    if (!sdkSessionSpecifiers.has(specifier)) {
      continue;
    }
    collectMemberCallDeprecations(findings, context, {
      receiverMatcher: (receiver) => receiver === local,
      surface: `${specifier} dynamic import namespace access`,
    });
  }
}

function collectRuntimeUsageDeprecations(findings, context) {
  collectMemberCallDeprecations(findings, context, {
    receiverMatcher: isRuntimeSessionReceiver,
    surface: "api.runtime.agent.session",
  });
}

function collectRuntimeAliasUsageDeprecations(findings, context) {
  const aliases = collectRuntimeSessionAliases(context.text);
  if (aliases.size === 0) {
    return;
  }
  collectMemberCallDeprecations(findings, context, {
    receiverMatcher: (receiver) => aliases.has(receiver),
    surface: "api.runtime.agent.session alias",
  });
}

function collectRuntimeSessionAliases(text) {
  const aliases = new Set();
  const factories = collectRuntimeSessionFactoryNames(text);
  collectDirectRuntimeSessionAliases(text, aliases);
  collectFactoryCallRuntimeSessionAliases(text, aliases, factories);
  return aliases;
}

function collectRuntimeSessionFactoryNames(text) {
  const factories = new Set();
  for (const fn of findNamedFunctionBodies(text)) {
    const aliases = new Set();
    collectDirectRuntimeSessionAliases(fn.body, aliases);
    if (aliases.size === 0) {
      continue;
    }
    const returnRegex = /\breturn\s+([A-Za-z_$][\w$]*)\b/g;
    for (const match of fn.body.matchAll(returnRegex)) {
      if (aliases.has(match[1])) {
        factories.add(fn.name);
      }
    }
  }
  return factories;
}

function findNamedFunctionBodies(text) {
  const functions = [];
  let searchStart = 0;
  while (searchStart < text.length) {
    const keywordOffset = text.indexOf("function", searchStart);
    if (keywordOffset === -1) {
      break;
    }
    searchStart = keywordOffset + "function".length;
    if (!isIdentifierBoundary(text, keywordOffset - 1) || !isIdentifierBoundary(text, searchStart)) {
      continue;
    }
    let cursor = skipWhitespaceForward(text, searchStart);
    const name = readIdentifierAt(text, cursor);
    if (!name) {
      continue;
    }
    cursor = skipWhitespaceForward(text, name.end);
    if (text[cursor] !== "(") {
      continue;
    }
    const paramsEnd = findMatchingDelimiter(text, cursor, "(", ")");
    if (paramsEnd === -1) {
      continue;
    }
    cursor = skipWhitespaceForward(text, paramsEnd + 1);
    while (cursor < text.length && text[cursor] !== "{") {
      cursor += 1;
    }
    if (text[cursor] !== "{") {
      break;
    }
    const bodyStart = cursor + 1;
    const bodyEnd = findMatchingBrace(text, cursor);
    if (bodyEnd === -1) {
      continue;
    }
    functions.push({
      name: name.value,
      body: text.slice(bodyStart, bodyEnd),
    });
    searchStart = bodyEnd + 1;
  }
  return functions;
}

function readIdentifierAt(text, startOffset) {
  const first = text[startOffset];
  if (!/[A-Za-z_$]/.test(first)) {
    return null;
  }
  let end = startOffset + 1;
  while (end < text.length && /[A-Za-z0-9_$]/.test(text[end])) {
    end += 1;
  }
  return {
    value: text.slice(startOffset, end),
    end,
  };
}

function findMatchingDelimiter(text, openOffset, openChar, closeChar) {
  let depth = 0;
  for (let index = openOffset; index < text.length; index += 1) {
    const char = text[index];
    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function findMatchingBrace(text, openOffset) {
  return findMatchingDelimiter(text, openOffset, "{", "}");
}

function collectDirectRuntimeSessionAliases(text, aliases) {
  const runtimeAliases = collectRuntimeObjectAliases(text);
  const declarationRegex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
  for (const match of text.matchAll(declarationRegex)) {
    const local = match[1];
    const initializer = normalizeReceiverExpression(match[2]);
    if (isRuntimeSessionExpression(initializer, runtimeAliases)) {
      aliases.add(local);
    }
  }
}

function collectRuntimeObjectAliases(text) {
  const aliases = new Set();
  const declarationRegex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)\s*)?(?:[A-Za-z_$][\w$]*|this)\.runtime\b/g;
  for (const match of text.matchAll(declarationRegex)) {
    aliases.add(match[1]);
  }
  return aliases;
}

function isRuntimeSessionExpression(expression, runtimeAliases) {
  for (const part of expression.split("??")) {
    const candidate = part.trim();
    if (isRuntimeSessionReceiver(candidate)) {
      return true;
    }
    for (const alias of runtimeAliases) {
      if (candidate === `${alias}.agent.session` || candidate === `${alias}.channel.session`) {
        return true;
      }
    }
  }
  return false;
}

function collectFactoryCallRuntimeSessionAliases(text, aliases, factories) {
  if (factories.size === 0) {
    return;
  }
  const declarationRegex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of text.matchAll(declarationRegex)) {
    if (factories.has(match[2])) {
      aliases.add(match[1]);
    }
  }
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
    symbol: details.symbol,
    surface: details.surface,
    replacement: rule.replacement,
    ref: `${details.filePath}:${refLine}`,
    message: rule.message(details.symbol, rule.replacement),
    offset: details.offset,
  };
}

function uniqueFindings(findings) {
  const byKey = new Map();
  for (const finding of findings) {
    byKey.set(`${finding.code}:${finding.symbol}:${finding.surface}:${finding.ref}`, finding);
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
