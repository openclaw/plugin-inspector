const sdkImportPattern = /openclaw\/plugin-sdk(?:$|\/)/;

/** Machine-readable plugin SDK deprecation rules consumed by static inspection. */
export const pluginSdkDeprecationRules = [
  {
    code: "sdk-session-transcript-file-identity",
    title: "Plugin SDK session/transcript file-backed identity is deprecated",
    window: "pre-SQLite deprecation window",
    namedExports: [],
    functionOptions: [
      {
        imports: ["runEmbeddedAgent"],
        surface: "runEmbeddedAgent options",
        properties: [
          {
            name: "sessionFile",
            replacement: "storage-neutral agent/session identity options",
          },
        ],
      },
      {
        imports: ["emitSessionTranscriptUpdate"],
        surface: "emitSessionTranscriptUpdate payload",
        properties: [
          {
            name: "sessionFile",
            replacement: "publishSessionTranscriptUpdateByIdentity with SessionTranscriptTarget",
          },
        ],
      },
      {
        imports: ["appendSessionTranscriptMessage"],
        surface: "appendSessionTranscriptMessage options",
        properties: [
          {
            name: "sessionFile",
            replacement: "appendSessionTranscriptMessageByIdentity with SessionTranscriptIdentity",
          },
          {
            name: "transcriptPath",
            replacement: "appendSessionTranscriptMessageByIdentity with SessionTranscriptIdentity",
          },
        ],
      },
    ],
    memberOptions: [
      {
        objectType: "MemorySearchManager",
        method: "sync",
        surface: "MemorySearchManager.sync options",
        properties: [
          {
            name: "sessionFiles",
            replacement: "sessions: MemorySessionSyncTarget[]",
          },
        ],
      },
    ],
    eventFields: [
      {
        callbacks: ["onSessionTranscriptUpdate"],
        payloadType: "SessionTranscriptUpdate",
        surface: "SessionTranscriptUpdate field",
        fields: [
          {
            name: "sessionFile",
            replacement: "structured update.target identity",
          },
        ],
      },
    ],
  },
];

/**
 * Inspects plugin SDK source for advisory deprecation rules.
 *
 * The scanner intentionally avoids a parser dependency for this narrow rule set. It detects direct
 * named or namespace SDK imports, balanced function calls with object-literal option keys, typed
 * MemorySearchManager.sync calls, and direct SessionTranscriptUpdate payload member reads.
 */
export function inspectSdkDeprecations(text, filePath = "source.js", rules = pluginSdkDeprecationRules) {
  const imports = collectSdkImports(text);
  if (imports.named.size === 0 && imports.namespaces.size === 0) {
    return [];
  }

  const findings = [];
  for (const rule of rules) {
    collectNamedExportDeprecations(findings, { rule, imports, text, filePath });
    collectFunctionOptionDeprecations(findings, { rule, imports, text, filePath });
    collectMemberOptionDeprecations(findings, { rule, imports, text, filePath });
    collectEventFieldDeprecations(findings, { rule, imports, text, filePath });
  }

  return uniqueFindings(findings)
    .sort((left, right) => left.offset - right.offset || left.surface.localeCompare(right.surface))
    .map(({ offset, ...finding }) => finding);
}

function collectSdkImports(text) {
  const imports = { named: new Map(), namespaces: new Map() };
  const regex = /\bimport\s+(type\s+)?(?:(\*\s+as\s+([A-Za-z_$][\w$]*))|{([^}]+)}|([A-Za-z_$][\w$]*))?\s*from\s*["'`]([^"'`]+)["'`]/g;
  for (const match of text.matchAll(regex)) {
    const specifier = match[6];
    if (!sdkImportPattern.test(specifier)) {
      continue;
    }

    if (match[3]) {
      addImportBinding(imports.namespaces, "*", match[3], { specifier, typeOnly: false });
      continue;
    }

    if (match[4]) {
      for (const binding of parseNamedImportBindings(match[4], Boolean(match[1]), specifier)) {
        addImportBinding(imports.named, binding.imported, binding.local, binding);
      }
      continue;
    }

    if (match[5]) {
      addImportBinding(imports.named, "default", match[5], { specifier, typeOnly: Boolean(match[1]) });
    }
  }
  return imports;
}

function parseNamedImportBindings(rawBindings, importTypeOnly, specifier) {
  return rawBindings
    .split(",")
    .map((binding) => binding.trim())
    .filter(Boolean)
    .map((binding) => {
      const typeOnly = importTypeOnly || binding.startsWith("type ");
      const normalized = binding.replace(/^type\s+/, "").trim();
      const [imported, local = imported] = normalized.split(/\s+as\s+/);
      return { imported: imported.trim(), local: local.trim(), specifier, typeOnly };
    })
    .filter((binding) => binding.imported && binding.local);
}

function addImportBinding(bindings, imported, local, binding) {
  const existing = bindings.get(imported) ?? [];
  existing.push({ ...binding, imported, local });
  bindings.set(imported, existing);
}

function collectNamedExportDeprecations(findings, context) {
  for (const exportRule of context.rule.namedExports ?? []) {
    for (const binding of context.imports.named.get(exportRule.name) ?? []) {
      findings.push(
        buildFinding(context.rule, {
          surface: `${binding.specifier} export`,
          property: exportRule.name,
          replacement: exportRule.replacement,
          sourceText: context.text,
          filePath: context.filePath,
          offset: 0,
        }),
      );
    }
  }
}

function collectFunctionOptionDeprecations(findings, context) {
  for (const optionRule of context.rule.functionOptions ?? []) {
    const localNames = optionRule.imports.flatMap((name) =>
      (context.imports.named.get(name) ?? []).filter((binding) => !binding.typeOnly).map((binding) => binding.local),
    );
    for (const localName of localNames) {
      for (const call of findCallRanges(context.text, localName)) {
        collectPropertyFindings(findings, context.rule, optionRule, context.filePath, context.text, call.body, call.bodyOffset);
      }
    }

    for (const namespace of importedNamespaceNames(context.imports)) {
      for (const importedName of optionRule.imports) {
        for (const call of findCallRanges(context.text, `${namespace}.${importedName}`)) {
          collectPropertyFindings(findings, context.rule, optionRule, context.filePath, context.text, call.body, call.bodyOffset);
        }
      }
    }
  }
}

function collectMemberOptionDeprecations(findings, context) {
  for (const optionRule of context.rule.memberOptions ?? []) {
    const objectTypeNames = importedLocalNames(context.imports, optionRule.objectType);
    const objectNames = objectTypeNames.flatMap((typeName) => typedIdentifiers(context.text, typeName));
    for (const objectName of objectNames) {
      for (const call of findMemberCallRanges(context.text, objectName, optionRule.method)) {
        collectPropertyFindings(findings, context.rule, optionRule, context.filePath, context.text, call.body, call.bodyOffset);
      }
    }
  }
}

function collectEventFieldDeprecations(findings, context) {
  for (const eventRule of context.rule.eventFields ?? []) {
    const payloadTypeNames = importedLocalNames(context.imports, eventRule.payloadType);
    const typedPayloadNames = payloadTypeNames.flatMap((typeName) => typedIdentifiers(context.text, typeName));
    for (const payloadName of typedPayloadNames) {
      collectPayloadFieldFindings(findings, context.rule, eventRule, context.filePath, context.text, context.text, 0, payloadName);
    }

    const callbackNames = eventRule.callbacks.flatMap((name) =>
      (context.imports.named.get(name) ?? []).filter((binding) => !binding.typeOnly).map((binding) => binding.local),
    );
    for (const callbackName of callbackNames) {
      for (const call of findCallRanges(context.text, callbackName)) {
        for (const field of eventRule.fields) {
          collectDestructuredPayloadField(
            findings,
            context.rule,
            eventRule,
            field,
            context.filePath,
            context.text,
            call.body,
            call.bodyOffset,
          );
        }
        const payloadName = callbackPayloadName(call.body, eventRule.payloadType);
        if (payloadName) {
          collectPayloadFieldFindings(
            findings,
            context.rule,
            eventRule,
            context.filePath,
            context.text,
            call.body,
            call.bodyOffset,
            payloadName,
          );
        }
      }
    }
  }
}

function collectPropertyFindings(findings, rule, optionRule, filePath, sourceText, text, baseOffset) {
  for (const property of optionRule.properties) {
    for (const match of propertyMatches(text, property.name)) {
      findings.push(
        buildFinding(rule, {
          surface: optionRule.surface,
          property: property.name,
          replacement: property.replacement,
          sourceText,
          filePath,
          offset: baseOffset + match.offset,
        }),
      );
    }
  }
}

function collectPayloadFieldFindings(findings, rule, eventRule, filePath, sourceText, text, baseOffset, payloadName) {
  for (const field of eventRule.fields) {
    const regex = new RegExp(`${escapeRegex(payloadName)}\\s*\\.\\s*${escapeRegex(field.name)}\\b`, "g");
    for (const match of text.matchAll(regex)) {
      findings.push(
        buildFinding(rule, {
          surface: eventRule.surface,
          property: field.name,
          replacement: field.replacement,
          sourceText,
          filePath,
          offset: baseOffset + (match.index ?? 0),
        }),
      );
    }
  }
}

function collectDestructuredPayloadField(findings, rule, eventRule, field, filePath, sourceText, text, baseOffset) {
  const regex = new RegExp(`\\(\\s*{[^}]*\\b${escapeRegex(field.name)}\\b`, "g");
  for (const match of text.matchAll(regex)) {
    findings.push(
      buildFinding(rule, {
        surface: eventRule.surface,
        property: field.name,
        replacement: field.replacement,
        sourceText,
        filePath,
        offset: baseOffset + (match.index ?? 0) + match[0].lastIndexOf(field.name),
      }),
    );
  }
}

function buildFinding(rule, details) {
  const refLine = lineForOffset(details.sourceText, details.offset);
  return {
    code: rule.code,
    surface: details.surface,
    property: details.property,
    replacement: details.replacement,
    ref: `${details.filePath}:${refLine}`,
    message: `${details.surface}.${details.property} is supported only during the ${rule.window}; use ${details.replacement}.`,
    offset: details.offset,
  };
}

function importedNamespaceNames(imports) {
  return (imports.namespaces.get("*") ?? []).map((binding) => binding.local);
}

function importedLocalNames(imports, importedName) {
  return (imports.named.get(importedName) ?? []).map((binding) => binding.local);
}

function typedIdentifiers(text, typeName) {
  const identifiers = new Set();
  const typePattern = escapeRegex(typeName);
  const variableRegex = new RegExp(
    `\\b(?:declare\\s+)?(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*:\\s*${typePattern}\\b`,
    "g",
  );
  for (const match of text.matchAll(variableRegex)) {
    identifiers.add(match[1]);
  }

  const parameterRegex = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*:\\s*${typePattern}\\b`, "g");
  for (const match of text.matchAll(parameterRegex)) {
    identifiers.add(match[1]);
  }
  return [...identifiers];
}

function callbackPayloadName(text, payloadType) {
  const typed = new RegExp(`\\(?\\s*([A-Za-z_$][\\w$]*)\\s*:\\s*${escapeRegex(payloadType)}\\b`).exec(text);
  if (typed?.[1]) {
    return typed[1];
  }

  const untyped = /\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/.exec(text);
  return untyped?.[1] ?? null;
}

function findCallRanges(text, callee) {
  const ranges = [];
  const regex = new RegExp(`\\b${escapeRegex(callee)}\\s*\\(`, "g");
  for (const match of text.matchAll(regex)) {
    const openParen = (match.index ?? 0) + match[0].lastIndexOf("(");
    const closeParen = findClosingDelimiter(text, openParen, "(", ")");
    if (closeParen > openParen) {
      ranges.push({
        body: text.slice(openParen + 1, closeParen),
        bodyOffset: openParen + 1,
      });
    }
  }
  return ranges;
}

function findMemberCallRanges(text, objectName, methodName) {
  const ranges = [];
  const regex = new RegExp(`\\b${escapeRegex(objectName)}\\s*\\.\\s*${escapeRegex(methodName)}\\s*(?:\\?\\.)?\\s*\\(`, "g");
  for (const match of text.matchAll(regex)) {
    const openParen = (match.index ?? 0) + match[0].lastIndexOf("(");
    const closeParen = findClosingDelimiter(text, openParen, "(", ")");
    if (closeParen > openParen) {
      ranges.push({
        body: text.slice(openParen + 1, closeParen),
        bodyOffset: openParen + 1,
      });
    }
  }
  return ranges;
}

function findClosingDelimiter(text, openOffset, openDelimiter, closeDelimiter) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openOffset; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === openDelimiter) {
      depth += 1;
      continue;
    }
    if (char === closeDelimiter) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function propertyMatches(text, propertyName) {
  const matches = [];
  const regex = new RegExp(`(^|[,{]\\s*)(?:["'\`]${escapeRegex(propertyName)}["'\`]|${escapeRegex(propertyName)})\\s*(?=[:,])`, "gm");
  for (const match of text.matchAll(regex)) {
    const propertyOffset = (match.index ?? 0) + match[0].lastIndexOf(propertyName);
    matches.push({ offset: propertyOffset });
  }
  return matches;
}

function uniqueFindings(findings) {
  const byKey = new Map();
  for (const finding of findings) {
    byKey.set(`${finding.code}:${finding.surface}:${finding.property}:${finding.ref}`, finding);
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
